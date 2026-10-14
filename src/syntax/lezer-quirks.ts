/**
 * @file
 *
 * Obsidian's quirks as `@lezer/markdown` extensions: where Obsidian reads valid CommonMark differently (see
 * `options.ts`).
 *
 * - `setextHeading: 'single-line'`: a leaf parser before `SetextHeading` drops the setext heading parser from a
 *   paragraph whose underline Obsidian does not read, so the line stays text, and a `---` line then ends the paragraph
 *   as a thematic break.
 * - `emptyListItem: 'interrupts-paragraph'`: an empty list item ends a paragraph, unless the line is the paragraph's
 *   setext underline.
 * - `softLineBreak: 'hard-break'`: a line ending inside inline content is a `HardBreak` node, with the whitespace
 *   before it.
 *
 * `looseList` has no node in the tree, which does not say whether a list is loose; `renderLezerHtml` applies it.
 */

import type {
  BlockContext,
  Element,
  InlineContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig
} from '@lezer/markdown';

import { parser } from '@lezer/markdown';

import type { ObsidianQuirkFlags } from './options.ts';
import type { ObsidianHtmlBlockKind } from './quirk-rules.ts';

import {
  COMMENT_OPEN,
  isObsidianHtmlComment,
  matchObsidianCharacterReference,
  obsidianHtmlBlockKind
} from './quirk-rules.ts';

// The parts of `MarkdownParser` its typings leave out: the leaf parser factories, in the order of the block names.
interface ParserInternals {
  readonly blockNames: readonly string[];
  readonly leafBlockParsers: readonly (((cx: null, leaf: null) => LeafBlockParser | null) | undefined)[];
}

const CODE_INDENT = 4;

const Char = {
  Ampersand: codeOf('&'),
  Dash: codeOf('-'),
  Equals: codeOf('='),
  LessThan: codeOf('<'),
  LineFeed: codeOf('\n'),
  Space: codeOf(' '),
  Tab: codeOf('\t')
} as const;

const HTML_BLOCK_NODES: Readonly<Record<ObsidianHtmlBlockKind['type'], string>> = {
  comment: 'CommentBlock',
  html: 'HTMLBlock',
  processingInstruction: 'ProcessingInstructionBlock'
};

const EMPTY_LIST_ITEM_RE = /^(?:[*+-]|1[).])[\t ]*$/u;
const BARE_UNDERLINE_RE = /^(?:=+|-+)$/u;
const THEMATIC_DASHES_RE = /^-[\t ]*-[\t ]*-[\t -]*$/u;

// The class of `@lezer/markdown`'s own setext heading parser, read from the factory it registers.
const SetextHeadingParserClass = findSetextHeadingParserClass();

/*
 * A paragraph whose next line is a setext underline Obsidian does not read loses the setext heading parser, so the
 * line is text of the paragraph, and no later line can make it a heading either: its text is no longer one line.
 */
class SingleLineSetextGuard implements LeafBlockParser {
  public finish(): boolean {
    return false;
  }

  public nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    if (isSetextUnderline(cx, line) && !isSingleLineSetextUnderline(line, leaf)) {
      // In place: the caller is iterating this very array for the current line.
      const index = leaf.parsers.findIndex((leafParser) => SetextHeadingParserClass !== undefined && leafParser instanceof SetextHeadingParserClass);
      if (index !== -1) {
        leaf.parsers.splice(index, 1);
      }
    }
    return false;
  }
}

/**
 * The `@lezer/markdown` extensions for the quirks asked for. The CommonMark behaviour of every quirk needs none.
 *
 * @param quirks - The quirks.
 * @returns The extensions.
 */
export function createLezerQuirks(quirks: ObsidianQuirkFlags): MarkdownConfig[] {
  const configs: MarkdownConfig[] = [];
  const isSingleLine = quirks.setextHeading === 'single-line';
  if (isSingleLine) {
    configs.push({
      parseBlock: [{
        before: 'SetextHeading',
        // A `---` line under a paragraph Obsidian gives no setext heading is a thematic break, which ends it.
        endLeaf: (cx, line, leaf): boolean => isSetextUnderline(cx, line) && !isSingleLineSetextUnderline(line, leaf) && isThematicDashes(line),
        leaf: (): LeafBlockParser => new SingleLineSetextGuard(),
        name: 'SingleLineSetextHeading'
      }]
    });
  }
  if (quirks.emptyListItem === 'interrupts-paragraph') {
    configs.push({
      parseBlock: [{
        endLeaf: (cx, line, leaf): boolean => isEmptyListItem(line) && !isTakenAsSetextUnderline(cx, line, leaf, isSingleLine),
        name: 'EmptyListItemInterrupt'
      }]
    });
  }
  if (quirks.softLineBreak === 'hard-break') {
    configs.push({ parseInline: [{ after: 'HardBreak', name: 'SoftLineBreakAsHardBreak', parse: parseSoftLineBreak }] });
  }
  if (quirks.htmlBlock === 'obsidian') {
    configs.push({
      parseBlock: [{
        before: 'HTMLBlock',
        endLeaf: (_cx, line): boolean => obsidianHtmlBlockKindAt(line)?.canInterrupt === true,
        name: 'ObsidianHTMLBlock',
        parse: checkObsidianHtmlBlock
      }],
      remove: ['HTMLBlock']
    });
  }
  if (quirks.characterReference === 'obsidian') {
    configs.push({ parseInline: [{ before: 'Entity', name: 'ObsidianCharacterReference', parse: parseObsidianCharacterReference }] });
  }
  if (quirks.htmlComment === 'obsidian') {
    configs.push({ parseInline: [{ before: 'RawHTML', name: 'ObsidianHTMLComment', parse: parseObsidianHtmlComment }] });
  }
  return configs;
}

/*
 * An HTML block as Obsidian reads it, adapted from `@lezer/markdown`'s own HTML block parser. It runs to the line that
 * holds its end, or to the line before an empty one, or to the end of its container.
 */
function checkObsidianHtmlBlock(cx: BlockContext, line: Line): boolean {
  const kind = obsidianHtmlBlockKindAt(line);
  if (!kind) {
    return false;
  }
  const from = cx.lineStart + line.pos;
  const marks: Element[] = [];
  let isClosed = kind.end?.test(line.text.slice(line.pos)) ?? false;
  while (!isClosed && cx.nextLine() && line.depth >= cx.depth) {
    if (kind.end === null && isEmptyLine(line)) {
      break;
    }
    marks.push(...line.markers);
    isClosed = kind.end?.test(line.text.slice(line.basePos)) ?? false;
  }
  if (isClosed) {
    cx.nextLine();
  }
  cx.addElement(cx.elt(HTML_BLOCK_NODES[kind.type], from, cx.prevLineEnd(), marks));
  return true;
}

function codeOf(ch: string): number {
  return ch.codePointAt(0) ?? -1;
}

function findSetextHeadingParserClass(): (abstract new () => LeafBlockParser) | undefined {
  const internals: unknown = parser;
  if (!hasParserInternals(internals)) {
    return undefined;
  }
  const factory = internals.leafBlockParsers[internals.blockNames.indexOf('SetextHeading')];
  const instance = factory?.(null, null);
  return instance?.constructor as (abstract new () => LeafBlockParser) | undefined;
}

function hasParserInternals(value: unknown): value is ParserInternals {
  return typeof value === 'object' && value !== null && 'blockNames' in value && 'leafBlockParsers' in value;
}

// A line with nothing after its container markup but whitespace those containers take.
function isEmptyLine(line: Line): boolean {
  return line.next === -1 && line.indent <= line.baseIndent;
}

function isEmptyListItem(line: Line): boolean {
  return EMPTY_LIST_ITEM_RE.test(line.text.slice(line.pos));
}

function isSetextUnderline(cx: BlockContext, line: Line): boolean {
  if (line.depth < cx.depth || (line.next !== Char.Dash && line.next !== Char.Equals) || line.indent >= line.baseIndent + CODE_INDENT) {
    return false;
  }
  let pos = line.pos + 1;
  while (pos < line.text.length && line.text.codePointAt(pos) === line.next) {
    pos++;
  }
  return line.skipSpace(pos) === line.text.length;
}

// Obsidian's setext heading: one line of text, and an underline that starts its line and ends with its marker.
function isSingleLineSetextUnderline(line: Line, leaf: LeafBlock): boolean {
  return !leaf.content.includes('\n') && line.indent === line.baseIndent && BARE_UNDERLINE_RE.test(line.text.slice(line.pos));
}

// Whether the paragraph's setext heading parser takes the line as its underline.
function isTakenAsSetextUnderline(cx: BlockContext, line: Line, leaf: LeafBlock, isSingleLine: boolean): boolean {
  return isSetextUnderline(cx, line) && (!isSingleLine || isSingleLineSetextUnderline(line, leaf));
}

function isThematicDashes(line: Line): boolean {
  return THEMATIC_DASHES_RE.test(line.text.slice(line.pos));
}

function obsidianHtmlBlockKindAt(line: Line): null | ObsidianHtmlBlockKind {
  return line.next === Char.LessThan && line.indent - line.baseIndent < CODE_INDENT ? obsidianHtmlBlockKind(line.text.slice(line.pos)) : null;
}

// A character reference as Obsidian reads it is an `Entity` node.
function parseObsidianCharacterReference(cx: InlineContext, next: number, start: number): number {
  if (next !== Char.Ampersand) {
    return -1;
  }
  const reference = matchObsidianCharacterReference(cx.slice(start, cx.end));
  return reference ? cx.addElement(cx.elt('Entity', start, start + reference.length)) : -1;
}

// A `<!--` that opens no comment of CommonMark 0.30 is text.
function parseObsidianHtmlComment(cx: InlineContext, next: number, start: number): number {
  if (next !== Char.LessThan || cx.slice(start, start + COMMENT_OPEN.length) !== COMMENT_OPEN) {
    return -1;
  }
  return isObsidianHtmlComment(cx.slice(start, cx.end)) ? -1 : start + 1;
}

// A line ending inside inline content, with any spaces and tabs before it, is a hard line break.
function parseSoftLineBreak(cx: InlineContext, next: number, start: number): number {
  let end = start;
  if (next === Char.Space || next === Char.Tab) {
    while (cx.char(end) === Char.Space || cx.char(end) === Char.Tab) {
      end++;
    }
  }
  return cx.char(end) === Char.LineFeed ? cx.addElement(cx.elt('HardBreak', start, end + 1)) : -1;
}
