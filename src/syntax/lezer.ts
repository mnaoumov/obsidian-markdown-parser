/**
 * @file
 *
 * The Obsidian syntax as `@lezer/markdown` extensions, built on the rules in `spec.ts`.
 *
 * {@link obsidianSyntax} adds internal links and embeds, tags, `%%` comments, math, highlights, footnote references,
 * inline footnotes, footnote definitions, block ids, callouts, Obsidian's task markers and front matter.
 * {@link obsidianMarkdown} adds the GFM pieces Obsidian supports as well: tables, strikethrough and bare URLs.
 */

import type {
  BlockContext,
  Element,
  InlineContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
  MarkdownParser
} from '@lezer/markdown';

import { tags } from '@lezer/highlight';
import {
  Autolink,
  parser,
  Strikethrough,
  Table
} from '@lezer/markdown';

import type {
  ObsidianSyntaxFlags,
  ObsidianSyntaxOptions
} from './options.ts';

import { commonMarkFixes } from './lezer-commonmark.ts';
import { createLezerQuirks } from './lezer-quirks.ts';
import {
  resolveObsidianQuirks,
  resolveObsidianSyntax
} from './options.ts';
import {
  canOpenHighlightBefore,
  canOpenTagAfter,
  equalsRunLength,
  findCommentClose,
  findInternalLinkEnd,
  findMathClose,
  isBlockId,
  isFrontMatterFence,
  matchCalloutMarker,
  matchFootnoteDefinition,
  matchFootnoteReference,
  matchInlineFootnote,
  matchMathOpen,
  matchTagName,
  matchTaskMarker,
  ObsidianNode,
  splitInternalLink
} from './spec.ts';

declare module '@lezer/markdown' {
  interface Line {
    /**
     * How many of the open composite blocks the line continues. `@lezer/markdown` marks it internal, and its own fenced
     * code parser reads it the same way: a line that continues fewer blocks than are open is a lazy line.
     */
    readonly depth: number;
  }
}

interface ParserSpec {
  readonly name: string;
}

const CODE_INDENT = 4;
const DELIMITER_SIZE = 2;

const Char = {
  Bang: codeOf('!'),
  Caret: codeOf('^'),
  Dollar: codeOf('$'),
  Equals: codeOf('='),
  GreaterThan: codeOf('>'),
  Hash: codeOf('#'),
  OpenBracket: codeOf('['),
  Percent: codeOf('%'),
  Space: codeOf(' '),
  Tab: codeOf('\t')
} as const;

// Where the title of the callout a parse opened last starts, so the title's paragraph can be told from any other.
const calloutTitleStarts = new WeakMap<BlockContext, number>();

const HIGHLIGHT_DELIMITER = { mark: ObsidianNode.HighlightMark, resolve: ObsidianNode.Highlight };

interface DelimitedBlockSpec {
  readonly findClose: (text: string) => number;
  readonly mark: string;
  readonly opener: string;
  readonly type: string;
}

const MATH_BLOCK: DelimitedBlockSpec = {
  findClose: (text) => findMathClose(text, DELIMITER_SIZE),
  mark: ObsidianNode.MathMark,
  opener: '$$',
  type: ObsidianNode.MathBlock
};

const COMMENT_BLOCK: DelimitedBlockSpec = {
  findClose: findCommentClose,
  mark: ObsidianNode.CommentMark,
  opener: '%%',
  type: ObsidianNode.CommentBlock
};

/*
 * A callout's title is the rest of its first line. Lines continuing the quote with `>` start its content, but lazy
 * lines (with no `>`) continue the paragraph the title line opened, as in the editor, and become the first paragraph of
 * the content.
 */
class CalloutTitleParser implements LeafBlockParser {
  public finish(cx: BlockContext, leaf: LeafBlock): boolean {
    const lineEnd = leaf.content.indexOf('\n');
    const title = (lineEnd === -1 ? leaf.content : leaf.content.slice(0, lineEnd)).trimEnd();
    cx.addElement(cx.elt(ObsidianNode.CalloutTitle, leaf.start, leaf.start + title.length, cx.parser.parseInline(title, leaf.start)));
    if (lineEnd !== -1) {
      const restFrom = leaf.start + lineEnd + 1;
      const rest = leaf.content.slice(lineEnd + 1);
      cx.addElement(cx.elt('Paragraph', restFrom, restFrom + rest.length, cx.parser.parseInline(rest, restFrom)));
    }
    return true;
  }

  public nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    return line.depth >= cx.depth && this.finish(cx, leaf);
  }
}

class TaskParser implements LeafBlockParser {
  public finish(cx: BlockContext, leaf: LeafBlock): boolean {
    const markerEnd = leaf.start + matchTaskMarker(leaf.content);
    const content = cx.parser.parseInline(leaf.content.slice(markerEnd - leaf.start), markerEnd);
    const task = cx.elt(ObsidianNode.Task, leaf.start, leaf.start + leaf.content.length, [cx.elt(ObsidianNode.TaskMarker, leaf.start, markerEnd), ...content]);
    cx.addLeafElement(leaf, task);
    return true;
  }

  public nextLine(): boolean {
    return false;
  }
}

/**
 * The Obsidian syntax.
 */
export const obsidianSyntax: MarkdownConfig = {
  defineNodes: [
    { name: ObsidianNode.BlockId, style: tags.labelName },
    { name: ObsidianNode.BlockIdMark, style: tags.processingInstruction },
    { block: true, composite: canContinueQuote, name: ObsidianNode.Callout, style: tags.quote },
    { name: ObsidianNode.CalloutFold, style: tags.processingInstruction },
    { name: ObsidianNode.CalloutMark, style: tags.processingInstruction },
    { name: ObsidianNode.CalloutTitle, style: tags.heading },
    { name: ObsidianNode.CalloutType, style: tags.typeName },
    { name: ObsidianNode.Comment, style: tags.comment },
    { block: true, name: ObsidianNode.CommentBlock, style: tags.comment },
    { name: ObsidianNode.CommentMark, style: tags.comment },
    { name: ObsidianNode.Embed },
    { block: true, composite: canContinueFootnoteDefinition, name: ObsidianNode.FootnoteDefinition },
    { name: ObsidianNode.FootnoteLabel, style: tags.labelName },
    { name: ObsidianNode.FootnoteMark, style: tags.processingInstruction },
    { name: ObsidianNode.FootnoteReference },
    { block: true, name: ObsidianNode.FrontMatter, style: tags.meta },
    { name: ObsidianNode.FrontMatterContent },
    { name: ObsidianNode.FrontMatterMark, style: tags.processingInstruction },
    { name: ObsidianNode.Highlight },
    { name: ObsidianNode.HighlightMark, style: tags.processingInstruction },
    { name: ObsidianNode.InlineFootnote },
    { name: ObsidianNode.InlineMath },
    { name: ObsidianNode.InternalLink },
    { name: ObsidianNode.InternalLinkAlias, style: tags.link },
    { name: ObsidianNode.InternalLinkAliasMark, style: tags.processingInstruction },
    { name: ObsidianNode.InternalLinkMark, style: tags.processingInstruction },
    { name: ObsidianNode.InternalLinkPath, style: tags.url },
    { name: ObsidianNode.InternalLinkSubpath, style: tags.url },
    { block: true, name: ObsidianNode.MathBlock },
    { name: ObsidianNode.MathMark, style: tags.processingInstruction },
    { name: ObsidianNode.Tag, style: tags.labelName },
    { name: ObsidianNode.TagMark, style: tags.processingInstruction },
    { name: ObsidianNode.TagName },
    { block: true, name: ObsidianNode.Task, style: tags.list },
    { name: ObsidianNode.TaskMarker, style: tags.atom }
  ],
  parseBlock: [
    { before: 'IndentedCode', name: ObsidianNode.FrontMatter, parse: checkFrontMatter },
    {
      before: 'FencedCode',
      endLeaf: (_cx, line, leaf): boolean => isDelimitedBlockStart(line, MATH_BLOCK) && !isLeftOpen(leaf.content, MATH_BLOCK),
      name: ObsidianNode.MathBlock,
      parse: (cx, line): boolean => checkDelimitedBlock(cx, line, MATH_BLOCK)
    },
    {
      before: 'FencedCode',
      endLeaf: (_cx, line, leaf): boolean => isDelimitedBlockStart(line, COMMENT_BLOCK) && !isLeftOpen(leaf.content, COMMENT_BLOCK),
      name: ObsidianNode.CommentBlock,
      parse: (cx, line): boolean => checkDelimitedBlock(cx, line, COMMENT_BLOCK)
    },
    { before: 'Blockquote', name: ObsidianNode.Callout, parse: parseCallout },
    {
      before: 'Blockquote',
      // A definition ends a paragraph only where it opens its line, with no container markup before it.
      endLeaf: (_cx, line): boolean => line.basePos === 0 && line.indent < CODE_INDENT && matchFootnoteDefinition(line.text.slice(line.pos)) !== null,
      name: ObsidianNode.FootnoteDefinition,
      parse: parseFootnoteDefinition
    },
    {
      before: 'LinkReference',
      leaf: (cx, leaf): LeafBlockParser | null => calloutTitleStarts.get(cx) === leaf.start ? new CalloutTitleParser() : null,
      name: ObsidianNode.CalloutTitle
    },
    {
      after: 'LinkReference',
      leaf: dropFootnoteLinkReference,
      name: 'FootnoteLinkReference'
    },
    {
      after: 'SetextHeading',
      leaf: (cx, leaf): LeafBlockParser | null => matchTaskMarker(leaf.content) > 0 && cx.parentType().name === 'ListItem' ? new TaskParser() : null,
      name: 'TaskList'
    }
  ],
  parseInline: [
    { before: 'Link', name: ObsidianNode.InternalLink, parse: parseInternalLink },
    { before: 'Link', name: ObsidianNode.FootnoteReference, parse: parseFootnoteReference },
    { before: 'Link', name: ObsidianNode.InlineFootnote, parse: parseInlineFootnote },
    { before: 'Link', name: ObsidianNode.BlockId, parse: parseBlockId },
    { before: 'Link', name: ObsidianNode.Tag, parse: parseTag },
    { before: 'Link', name: ObsidianNode.Comment, parse: parseComment },
    { before: 'Link', name: ObsidianNode.InlineMath, parse: parseInlineMath },
    { before: 'Link', name: ObsidianNode.Highlight, parse: parseHighlight }
  ]
};

// The flag that turns on each of the syntax's parsers.
const PARSER_FLAGS: Readonly<Record<string, keyof ObsidianSyntaxFlags>> = {
  FootnoteLinkReference: 'footnote',
  [ObsidianNode.BlockId]: 'blockId',
  [ObsidianNode.Callout]: 'callout',
  [ObsidianNode.CalloutTitle]: 'callout',
  [ObsidianNode.Comment]: 'comment',
  [ObsidianNode.CommentBlock]: 'comment',
  [ObsidianNode.FootnoteDefinition]: 'footnote',
  [ObsidianNode.FootnoteReference]: 'footnote',
  [ObsidianNode.FrontMatter]: 'frontMatter',
  [ObsidianNode.Highlight]: 'highlight',
  [ObsidianNode.InlineFootnote]: 'inlineFootnote',
  [ObsidianNode.InlineMath]: 'math',
  [ObsidianNode.InternalLink]: 'internalLink',
  [ObsidianNode.MathBlock]: 'math',
  [ObsidianNode.Tag]: 'tag',
  TaskList: 'task'
};

/**
 * The Obsidian syntax with the GFM extensions Obsidian supports: tables, strikethrough and bare URLs. Obsidian's task
 * markers replace GFM's.
 */
export const obsidianMarkdown: readonly MarkdownConfig[] = [commonMarkFixes, Table, Strikethrough, Autolink, obsidianSyntax];

/**
 * The `@lezer/markdown` parser configured with {@link obsidianMarkdown}.
 */
export const obsidianParser: MarkdownParser = parser.configure([...obsidianMarkdown]);

/**
 * The options of {@link createObsidianMarkdown}: the syntax to read.
 */
export type CreateObsidianMarkdownOptions = ObsidianSyntaxOptions;

/**
 * The options of {@link createObsidianParser}: the syntax to read.
 */
export type CreateObsidianParserOptions = ObsidianSyntaxOptions;

/**
 * The `@lezer/markdown` extensions for the syntax the options turn on, and for the quirks they ask for. Every node of
 * the Obsidian syntax is defined whatever the flags, so trees from any configuration share one node set.
 *
 * @param options - The syntax to read.
 * @returns The extensions.
 */
export function createObsidianMarkdown(options: CreateObsidianMarkdownOptions = {}): MarkdownConfig[] {
  const flags = resolveObsidianSyntax(options);
  const configs: MarkdownConfig[] = [commonMarkFixes];
  if (flags.table) {
    configs.push(Table);
  }
  if (flags.strikethrough) {
    configs.push(Strikethrough);
  }
  if (flags.autolinkLiteral) {
    configs.push(Autolink);
  }
  configs.push({
    defineNodes: obsidianSyntax.defineNodes ?? [],
    parseBlock: (obsidianSyntax.parseBlock ?? []).filter((spec) => isParserOn(spec, flags)),
    parseInline: (obsidianSyntax.parseInline ?? []).filter((spec) => isParserOn(spec, flags))
  }, ...createLezerQuirks(resolveObsidianQuirks(options)));
  return configs;
}

/**
 * The `@lezer/markdown` parser for the syntax the options turn on. Configure it once and reuse it: incremental parsing
 * needs the same parser for every edit.
 *
 * @param options - The syntax to read.
 * @returns The parser.
 */
export function createObsidianParser(options: CreateObsidianParserOptions = {}): MarkdownParser {
  return parser.configure(createObsidianMarkdown(options));
}

/*
 * An indented line continues a footnote definition, and so does a blank line. The editor stops styling a definition's
 * lines at an indented list item, but the item's content still belongs to the definition, as in any container.
 */
function canContinueFootnoteDefinition(_cx: BlockContext, line: Line): boolean {
  if (line.next === -1) {
    return true;
  }
  if (line.indent <= line.baseIndent) {
    return false;
  }
  line.moveBaseColumn(line.baseIndent + Math.min(line.indent - line.baseIndent, CODE_INDENT));
  return true;
}

function canContinueQuote(cx: BlockContext, line: Line): boolean {
  if (line.next !== Char.GreaterThan) {
    return false;
  }
  const markFrom = cx.lineStart + line.pos;
  line.addMarker(cx.elt('QuoteMark', markFrom, markFrom + 1));
  line.moveBase(line.pos + (isSpaceOrTab(line.text.codePointAt(line.pos + 1)) ? DELIMITER_SIZE : 1));
  return true;
}

function checkDelimitedBlock(cx: BlockContext, line: Line, spec: DelimitedBlockSpec): boolean {
  if (!isDelimitedBlockStart(line, spec)) {
    return false;
  }
  const from = cx.lineStart + line.pos;
  const children: Element[] = [cx.elt(spec.mark, from, from + spec.opener.length)];
  while (cx.nextLine() && line.depth >= cx.depth) {
    children.push(...line.markers);
    const close = spec.findClose(line.text.slice(line.basePos));
    if (close !== -1) {
      const closeTo = cx.lineStart + line.basePos + close + spec.opener.length;
      children.push(cx.elt(spec.mark, closeTo - spec.opener.length, closeTo));
      cx.nextLine();
      // The block ends with its closing delimiter. The rest of that line is not read.
      cx.addElement(cx.elt(spec.type, from, closeTo, children));
      return true;
    }
  }
  // An unclosed block runs to the end of its container.
  cx.addElement(cx.elt(spec.type, from, cx.prevLineEnd(), children));
  return true;
}

function checkFrontMatter(cx: BlockContext, line: Line): boolean {
  if (cx.lineStart !== 0 || !isFrontMatterFence(line.text)) {
    return false;
  }
  const children: Element[] = [cx.elt(ObsidianNode.FrontMatterMark, 0, line.text.length)];
  let contentFrom = -1;
  let contentTo = -1;
  let closeMark: Element | null = null;
  while (cx.nextLine()) {
    if (isFrontMatterFence(line.text)) {
      closeMark = cx.elt(ObsidianNode.FrontMatterMark, cx.lineStart, cx.lineStart + line.text.length);
      cx.nextLine();
      break;
    }
    if (contentFrom === -1) {
      contentFrom = cx.lineStart;
    }
    contentTo = cx.lineStart + line.text.length;
  }
  if (contentFrom !== -1) {
    children.push(cx.elt(ObsidianNode.FrontMatterContent, contentFrom, contentTo));
  }
  if (closeMark) {
    children.push(closeMark);
  }
  // Like the editor, front matter that never closes runs to the end of the document.
  cx.addElement(cx.elt(ObsidianNode.FrontMatter, 0, cx.prevLineEnd(), children));
  return true;
}

function codeOf(ch: string): number {
  return ch.codePointAt(0) ?? -1;
}

/*
 * A `[^label]:` that opens no footnote definition (inside a quote or a list item) is a footnote reference followed by
 * text, as in the editor, not a link reference definition. This runs right after the link reference parser has
 * attached itself to the paragraph, and detaches it.
 */
function dropFootnoteLinkReference(_cx: BlockContext, leaf: LeafBlock): null {
  if (leaf.content.startsWith('[^')) {
    leaf.parsers.length = 0;
  }
  return null;
}

function isDelimitedBlockStart(line: Line, spec: DelimitedBlockSpec): boolean {
  if (line.indent - line.baseIndent >= CODE_INDENT) {
    return false;
  }
  const text = line.text.slice(line.pos);
  return text.startsWith(spec.opener) && spec.findClose(text.slice(spec.opener.length)) === -1;
}

// Like the editor, a footnote definition must open its line, so none opens inside a quote or a list item.
function isFootnoteDefinitionStart(cx: BlockContext, line: Line): boolean {
  const parent = cx.parentType().name;
  return (parent === 'Document' || parent === ObsidianNode.FootnoteDefinition) && line.indent < CODE_INDENT && matchFootnoteDefinition(line.text.slice(line.pos)) !== null;
}

/*
 * Whether a paragraph's text leaves a delimiter open: `%%` or `$$` read inline spans lines, so a line opening that block
 * closes it rather than ending the paragraph.
 */
function isLeftOpen(text: string, spec: DelimitedBlockSpec): boolean {
  let isOpen = false;
  for (let index = text.indexOf(spec.opener); index !== -1; index = text.indexOf(spec.opener, index + spec.opener.length)) {
    if (text[index - 1] !== '\\') {
      isOpen = !isOpen;
    }
  }
  return isOpen;
}

// Whether a block or inline parser of the syntax is on: one that no flag governs always is.
function isParserOn(spec: ParserSpec, flags: ObsidianSyntaxFlags): boolean {
  const flag = PARSER_FLAGS[spec.name];
  return flag === undefined || flags[flag];
}

function isSpaceOrTab(ch: number | undefined): boolean {
  return ch === Char.Space || ch === Char.Tab;
}

function lineEndOf(cx: InlineContext, pos: number): number {
  const index = cx.text.indexOf('\n', pos - cx.offset);
  return index === -1 ? cx.end : cx.offset + index;
}

function parseBlockId(cx: InlineContext, next: number, pos: number): number {
  if (next !== Char.Caret) {
    return -1;
  }
  const end = lineEndOf(cx, pos);
  return isBlockId(cx.slice(pos, end)) ? cx.addElement(cx.elt(ObsidianNode.BlockId, pos, end, [cx.elt(ObsidianNode.BlockIdMark, pos, pos + 1)])) : -1;
}

function parseCallout(cx: BlockContext, line: Line): boolean | null {
  if (line.next !== Char.GreaterThan || line.indent - line.baseIndent >= CODE_INDENT) {
    return false;
  }
  const contentPos = line.pos + (line.text.codePointAt(line.pos + 1) === Char.Space ? DELIMITER_SIZE : 1);
  const marker = matchCalloutMarker(line.text.slice(contentPos));
  if (!marker) {
    return false;
  }
  const lineStart = cx.lineStart;
  const quoteFrom = lineStart + line.pos;
  const markFrom = lineStart + contentPos;
  cx.startComposite(ObsidianNode.Callout, line.pos);
  cx.addElement(cx.elt('QuoteMark', quoteFrom, quoteFrom + 1));
  const markChildren = [cx.elt(ObsidianNode.CalloutType, markFrom + marker.type.from, markFrom + marker.type.to)];
  if (marker.fold) {
    markChildren.push(cx.elt(ObsidianNode.CalloutFold, markFrom + marker.fold.from, markFrom + marker.fold.to));
  }
  cx.addElement(cx.elt(ObsidianNode.CalloutMark, markFrom + marker.mark.from, markFrom + marker.mark.to, markChildren));
  // The rest of the line is the title, read by `CalloutTitleParser`.
  calloutTitleStarts.set(cx, lineStart + line.skipSpace(contentPos + marker.mark.to));
  line.moveBase(contentPos + marker.mark.to);
  return null;
}

function parseComment(cx: InlineContext, next: number, pos: number): number {
  if (next !== Char.Percent || cx.char(pos + 1) !== Char.Percent) {
    return -1;
  }
  const contentFrom = pos + DELIMITER_SIZE;
  const close = findCommentClose(cx.slice(contentFrom, cx.end));
  const children = [cx.elt(ObsidianNode.CommentMark, pos, contentFrom)];
  // An unclosed comment runs to the end of the inline content.
  let end = cx.end;
  if (close !== -1) {
    end = contentFrom + close + DELIMITER_SIZE;
    children.push(cx.elt(ObsidianNode.CommentMark, end - DELIMITER_SIZE, end));
  }
  return cx.addElement(cx.elt(ObsidianNode.Comment, pos, end, children));
}

function parseFootnoteDefinition(cx: BlockContext, line: Line): boolean | null {
  const definition = isFootnoteDefinitionStart(cx, line) ? matchFootnoteDefinition(line.text.slice(line.pos)) : null;
  if (!definition) {
    return false;
  }
  const from = cx.lineStart + line.pos;
  cx.startComposite(ObsidianNode.FootnoteDefinition, line.pos);
  cx.addElement(cx.elt(ObsidianNode.FootnoteMark, from, from + definition.label.from));
  cx.addElement(cx.elt(ObsidianNode.FootnoteLabel, from + definition.label.from, from + definition.label.to));
  cx.addElement(cx.elt(ObsidianNode.FootnoteMark, from + definition.label.to, from + definition.markEnd));
  line.moveBase(line.skipSpace(line.pos + definition.markEnd));
  return null;
}

function parseFootnoteReference(cx: InlineContext, next: number, pos: number): number {
  if (next !== Char.OpenBracket || cx.char(pos + 1) !== Char.Caret) {
    return -1;
  }
  const length = matchFootnoteReference(cx.slice(pos, lineEndOf(cx, pos)));
  if (length === 0) {
    return -1;
  }
  const end = pos + length;
  return cx.addElement(cx.elt(ObsidianNode.FootnoteReference, pos, end, [
    cx.elt(ObsidianNode.FootnoteMark, pos, pos + DELIMITER_SIZE),
    cx.elt(ObsidianNode.FootnoteLabel, pos + DELIMITER_SIZE, end - 1),
    cx.elt(ObsidianNode.FootnoteMark, end - 1, end)
  ]));
}

function parseHighlight(cx: InlineContext, next: number, pos: number): number {
  if (next !== Char.Equals) {
    return -1;
  }
  const run = equalsRunLength(cx.slice(pos, pos + DELIMITER_SIZE + 1));
  if (run !== DELIMITER_SIZE) {
    // A single `=` is text, and so is a longer run, which is consumed whole so that no `==` is read inside it.
    return run === 1 ? -1 : pos + equalsRunLength(cx.slice(pos, lineEndOf(cx, pos)));
  }
  const after = cx.slice(pos + DELIMITER_SIZE, pos + DELIMITER_SIZE + 1);
  return cx.addDelimiter(HIGHLIGHT_DELIMITER, pos, pos + DELIMITER_SIZE, canOpenHighlightBefore(after), true);
}

function parseInlineFootnote(cx: InlineContext, next: number, pos: number): number {
  if (next !== Char.Caret || cx.char(pos + 1) !== Char.OpenBracket) {
    return -1;
  }
  const length = matchInlineFootnote(cx.slice(pos, lineEndOf(cx, pos)));
  if (length === 0) {
    return -1;
  }
  const contentFrom = pos + DELIMITER_SIZE;
  const end = pos + length;
  const content = cx.parser.parseInline(cx.slice(contentFrom, end - 1), contentFrom);
  return cx.addElement(cx.elt(ObsidianNode.InlineFootnote, pos, end, [
    cx.elt(ObsidianNode.FootnoteMark, pos, contentFrom),
    ...content,
    cx.elt(ObsidianNode.FootnoteMark, end - 1, end)
  ]));
}

function parseInlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== Char.Dollar) {
    return -1;
  }
  const size = matchMathOpen(cx.slice(pos, lineEndOf(cx, pos)));
  if (size === 0) {
    return -1;
  }
  const contentFrom = pos + size;
  const close = findMathClose(cx.slice(contentFrom, cx.end), size);
  const children = [cx.elt(ObsidianNode.MathMark, pos, contentFrom)];
  // Display math that never closes runs to the end of the inline content.
  let end = cx.end;
  if (close !== -1) {
    end = contentFrom + close + size;
    children.push(cx.elt(ObsidianNode.MathMark, end - size, end));
  }
  return cx.addElement(cx.elt(ObsidianNode.InlineMath, pos, end, children));
}

function parseInternalLink(cx: InlineContext, next: number, pos: number): number {
  const isEmbed = next === Char.Bang;
  if (!isEmbed && next !== Char.OpenBracket) {
    return -1;
  }
  const open = isEmbed ? pos + 1 : pos;
  if (cx.char(open) !== Char.OpenBracket || cx.char(open + 1) !== Char.OpenBracket) {
    return -1;
  }
  const contentFrom = open + DELIMITER_SIZE;
  const length = findInternalLinkEnd(cx.slice(contentFrom, lineEndOf(cx, contentFrom)));
  if (length === -1) {
    return -1;
  }
  const contentTo = contentFrom + length;
  const parts = splitInternalLink(cx.slice(contentFrom, contentTo));
  const children = [cx.elt(ObsidianNode.InternalLinkMark, pos, contentFrom)];
  if (parts.path.to > parts.path.from) {
    children.push(cx.elt(ObsidianNode.InternalLinkPath, contentFrom + parts.path.from, contentFrom + parts.path.to));
  }
  if (parts.subpath) {
    children.push(cx.elt(ObsidianNode.InternalLinkSubpath, contentFrom + parts.subpath.from, contentFrom + parts.subpath.to));
  }
  if (parts.aliasMark) {
    children.push(cx.elt(ObsidianNode.InternalLinkAliasMark, contentFrom + parts.aliasMark.from, contentFrom + parts.aliasMark.to));
  }
  if (parts.alias && parts.alias.to > parts.alias.from) {
    children.push(cx.elt(ObsidianNode.InternalLinkAlias, contentFrom + parts.alias.from, contentFrom + parts.alias.to));
  }
  children.push(cx.elt(ObsidianNode.InternalLinkMark, contentTo, contentTo + DELIMITER_SIZE));
  return cx.addElement(cx.elt(isEmbed ? ObsidianNode.Embed : ObsidianNode.InternalLink, pos, contentTo + DELIMITER_SIZE, children));
}

function parseTag(cx: InlineContext, next: number, pos: number): number {
  if (next !== Char.Hash) {
    return -1;
  }
  const before = pos === cx.offset ? '' : cx.slice(pos - 1, pos);
  if (!canOpenTagAfter(before)) {
    return -1;
  }
  const length = matchTagName(cx.slice(pos + 1, lineEndOf(cx, pos)));
  if (length === 0) {
    return -1;
  }
  const end = pos + 1 + length;
  return cx.addElement(cx.elt(ObsidianNode.Tag, pos, end, [
    cx.elt(ObsidianNode.TagMark, pos, pos + 1),
    cx.elt(ObsidianNode.TagName, pos + 1, end)
  ]));
}
