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
 * - `htmlBlock: 'obsidian'`: an HTML block parser in place of `@lezer/markdown`'s reads Obsidian's kinds (see
 *   `obsidianHtmlBlockKind`), adapted from `@lezer/markdown`'s own under its MIT license (see `THIRD-PARTY-NOTICES.md`).
 *   The parser leaves out the `<textarea>` fix of `commonMarkFixes`.
 * - `htmlComment: 'obsidian'`: a `<!--` that opens no comment of CommonMark 0.30 is text.
 * - `characterReference: 'obsidian'`: an inline parser before `Entity` reads Obsidian's references as `Entity` nodes.
 * - `autolink: 'obsidian'`: an inline parser before `RawHTML` reads Obsidian's autolinks as `Autolink` nodes.
 * - `linkDefinition: 'obsidian'`: a `LinkReference` leaf parser in place of `@lezer/markdown`'s reads Obsidian's
 *   definitions.
 * - `gfmTable: 'obsidian'`: {@link obsidianTable} replaces `@lezer/markdown`'s `Table`. A row of a table without a
 *   leading pipe that another block interrupts a paragraph with ends the table, as `@lezer/markdown` ends the
 *   paragraph before a leaf parser sees the line.
 *
 * `looseList` has no node in the tree, which does not say whether a list is loose; `renderLezerHtml` applies it, as it
 * decodes Obsidian's character references, shows Obsidian's autolinks and reads Obsidian's table cells. `listItem` has
 * no extension: `@lezer/markdown` keeps list item continuation internal.
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

import {
  parser,
  Table
} from '@lezer/markdown';

import type { ObsidianQuirkFlags } from '../options.ts';
import type {
  ObsidianDefinition,
  ObsidianHtmlBlockKind
} from '../quirk-rules.ts';

import {
  COMMENT_OPEN,
  hasObsidianTableLeadingPipe,
  isObsidianHtmlComment,
  isObsidianTableRow,
  matchObsidianAutolink,
  matchObsidianCharacterReference,
  obsidianHtmlBlockKind,
  obsidianTableAlignments,
  obsidianTableCells,
  parseObsidianDefinition
} from '../quirk-rules.ts';
import { isCommonMarkAutolink } from './lezer-commonmark.ts';

// The line a paragraph starts on: where the base of its containers is, and its text from there.
interface HeaderLine {
  readonly from: number;
  readonly text: string;
}

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

// The line each paragraph of a parse starts on, by where the paragraph starts.
const headerLines = new WeakMap<BlockContext, Map<number, HeaderLine>>();

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
 * A link reference definition as Obsidian reads it (see `parseObsidianDefinition`), in place of `@lezer/markdown`'s own
 * parser, and with its nodes. It is decided at the first line that settles it, and the paragraph's lines after it are
 * parsed again, as `@lezer/markdown` does. A definition of one line with a setext underline below it is the heading's
 * text.
 */
class ObsidianLinkReferenceParser implements LeafBlockParser {
  private isFailed = false;

  public constructor(private readonly isSingleLineSetext: boolean) {}

  public finish(cx: BlockContext, leaf: LeafBlock): boolean {
    const definition = this.isFailed ? null : parseObsidianDefinition(leaf.content, true);
    if (definition === null || definition === 'pending' || definition.length !== leaf.content.length) {
      return false;
    }
    addDefinition(cx, leaf, definition);
    return true;
  }

  public nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    if (this.isFailed) {
      return false;
    }
    if (!leaf.content.includes('\n') && isTakenAsSetextUnderline(cx, line, leaf, this.isSingleLineSetext)) {
      this.isFailed = true;
      return false;
    }
    const definition = parseObsidianDefinition(`${leaf.content}\n${scrubbed(line)}`, false);
    if (definition === 'pending') {
      return false;
    }
    if (definition === null || definition.length > leaf.content.length) {
      this.isFailed = true;
      return false;
    }
    addDefinition(cx, leaf, definition);
    return true;
  }
}

/*
 * A table as Obsidian reads it (see `ObsidianQuirkFlags.gfmTable`), with the nodes of `@lezer/markdown`'s own. It is a
 * leaf parser, so it interrupts no paragraph, and it ends at the first line that is no row of it. Every cell is a
 * `TableCell`, an empty one empty, and every pipe a `TableDelimiter`.
 */
class ObsidianTableParser implements LeafBlockParser {
  private readonly hasLeadingPipe: boolean;
  private rows: Element[] | false | null = null;

  public constructor(private readonly header: HeaderLine) {
    this.hasLeadingPipe = hasObsidianTableLeadingPipe(header.text);
  }

  public finish(cx: BlockContext, leaf: LeafBlock): boolean {
    if (!this.rows) {
      return false;
    }
    cx.addLeafElement(leaf, cx.elt('Table', leaf.start, leaf.start + leaf.content.length, this.rows));
    return true;
  }

  public nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    const text = line.text.slice(line.basePos);
    const rowFrom = cx.lineStart + line.pos;
    const rowTo = cx.lineStart + line.text.length;
    if (this.rows === null) {
      const isDelimiter = isObsidianTableRow(text) && hasObsidianTableLeadingPipe(text) === this.hasLeadingPipe && obsidianTableAlignments(text) !== null;
      this.rows = isDelimiter && [
        cx.elt('TableHeader', leaf.start, leaf.start + leaf.content.length, tableRowElements(cx, this.header.text, this.header.from)),
        cx.elt('TableDelimiter', rowFrom, rowTo)
      ];
      return false;
    }
    if (!this.rows) {
      return false;
    }
    if (isObsidianTableRow(text) && hasObsidianTableLeadingPipe(text) === this.hasLeadingPipe) {
      this.rows.push(cx.elt('TableRow', rowFrom, rowTo, tableRowElements(cx, text, cx.lineStart + line.basePos)));
      return false;
    }
    return this.finish(cx, leaf);
  }
}

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
 * The `@lezer/markdown` table extension of the `gfmTable` quirk: tables as Obsidian reads them, with the nodes of
 * `@lezer/markdown`'s `Table`, which it replaces.
 */
export const obsidianTable: MarkdownConfig = {
  defineNodes: Table.defineNodes ?? [],
  parseBlock: [
    {
      before: 'LinkReference',
      name: 'ObsidianTableHeaderLine',
      parse: (cx, line): boolean => {
        recordHeaderLine(cx, line);
        return false;
      }
    },
    {
      before: 'SetextHeading',
      leaf: (cx, leaf): LeafBlockParser | null => {
        const header = headerLines.get(cx)?.get(leaf.start);
        return header && isObsidianTableRow(header.text) ? new ObsidianTableParser(header) : null;
      },
      name: 'Table'
    }
  ]
};

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
  if (quirks.autolink === 'obsidian') {
    configs.push({ parseInline: [{ before: 'RawHTML', name: 'ObsidianAutolink', parse: parseObsidianAutolink }] });
  }
  if (quirks.characterReference === 'obsidian') {
    configs.push({ parseInline: [{ before: 'Entity', name: 'ObsidianCharacterReference', parse: parseObsidianCharacterReference }] });
  }
  if (quirks.linkDefinition === 'obsidian') {
    configs.push({
      parseBlock: [{
        leaf: (_cx, leaf): LeafBlockParser | null => leaf.content.startsWith('[') ? new ObsidianLinkReferenceParser(isSingleLine) : null,
        name: 'LinkReference'
      }]
    });
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
function addDefinition(cx: BlockContext, leaf: LeafBlock, definition: ObsidianDefinition): void {
  function at(offset: number): number {
    return leaf.start + offset;
  }
  const children = [
    cx.elt('LinkLabel', at(definition.label.from), at(definition.label.to)),
    cx.elt('LinkMark', at(definition.label.to), at(definition.label.to + 1)),
    cx.elt('URL', at(definition.destination.from), at(definition.destination.to))
  ];
  if (definition.title) {
    children.push(cx.elt('LinkTitle', at(definition.title.from), at(definition.title.to)));
  }
  cx.addLeafElement(leaf, cx.elt('LinkReference', leaf.start, at(definition.length), children));
}

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

/*
 * An autolink as Obsidian reads it is an `Autolink` node, as `@lezer/markdown` gives one. A CommonMark autolink that is
 * no autolink in Obsidian is text, since it is no raw HTML either.
 */
function parseObsidianAutolink(cx: InlineContext, next: number, start: number): number {
  if (next !== Char.LessThan) {
    return -1;
  }
  const text = cx.slice(start, cx.end);
  const autolink = matchObsidianAutolink(text);
  if (!autolink) {
    return isCommonMarkAutolink(text) ? start + 1 : -1;
  }
  const end = start + autolink.length;
  return cx.addElement(cx.elt('Autolink', start, end, [
    cx.elt('LinkMark', start, start + 1),
    cx.elt('URL', start + 1, end - 1),
    cx.elt('LinkMark', end - 1, end)
  ]));
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

// The line a paragraph starts on, from the base of its containers, so the table parser sees its indentation.
function recordHeaderLine(cx: BlockContext, line: Line): void {
  let lines = headerLines.get(cx);
  if (!lines) {
    lines = new Map();
    headerLines.set(cx, lines);
  }
  lines.set(cx.lineStart + line.pos, { from: cx.lineStart + line.basePos, text: line.text.slice(line.basePos) });
}

/*
 * A line's text as a paragraph holds it: its container markup replaced by spaces, as `@lezer/markdown`'s internal
 * `Line.scrub` gives it.
 */
function scrubbed(line: Line): string {
  return line.baseIndent === 0 ? line.text : ' '.repeat(line.basePos) + line.text.slice(line.basePos);
}

// A table row's cells and pipes, read from its text, which starts at `from`.
function tableRowElements(cx: BlockContext, text: string, from: number): Element[] {
  const elements = obsidianTableCells(text).map((cell) => cx.elt('TableCell', from + cell.from, from + cell.to, cx.parser.parseInline(text.slice(cell.from, cell.to), from + cell.from)));
  for (let pos = 0; pos < text.length; pos++) {
    if (text.charAt(pos) === '\\') {
      pos++;
    } else if (text.charAt(pos) === '|') {
      elements.push(cx.elt('TableDelimiter', from + pos, from + pos + 1));
    }
  }
  return elements.toSorted((a, b) => a.from - b.from || a.to - b.to);
}
