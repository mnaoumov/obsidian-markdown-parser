/**
 * @file
 *
 * The Obsidian syntax as a markdown-it plugin, built on the rules in `spec.ts`.
 *
 * {@link markdownItObsidianSyntax} adds internal links and embeds, tags, `%%` comments, math, highlights, footnote
 * references, inline footnotes, footnote definitions, block ids, callouts, Obsidian's task markers and front matter.
 * {@link createObsidianMarkdownIt} adds it to a markdown-it with the GFM pieces Obsidian supports: tables,
 * strikethrough and bare URLs.
 *
 * The tokens are named after {@link ObsidianNode}: a node with nodes inside it opens with `<name>_open` and closes with
 * `<name>_close`, as markdown-it's own tokens do, and a node with none is a single `<name>` token. Every such token
 * carries the range of the source it covers in its `meta`, which {@link getObsidianTokenRange} reads, so the tokens
 * give the same outline as the `@lezer/markdown` tree.
 *
 * The inline rules see a block's inline content, not the document: a paragraph's lines without their container
 * prefixes, or a table cell without its escapes. So they record ranges in that content, and a core rule maps them back
 * to the document with the alignment each inline token's content was cut from.
 */

import type {
  MarkdownIt,
  MarkdownItOptions,
  Renderer,
  StateBlock,
  StateCore,
  StateInline,
  Token
} from 'markdown-it';

import MarkdownItCallable from 'markdown-it';

import type {
  CalloutMarker,
  ObsidianNodeName,
  TextRange
} from './spec.ts';

import {
  canOpenHighlightBefore,
  canOpenTagAfter,
  equalsRunLength,
  findCommentClose,
  findInternalLinkEnd,
  findMathClose,
  isBlockId,
  isFrontMatterFence,
  isObsidianNodeName,
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

/**
 * The options of {@link createObsidianMarkdownIt}: markdown-it's own.
 */
export type CreateObsidianMarkdownItOptions = MarkdownItOptions;

// Where a delimited block closes: the line holding the closing delimiter and the delimiter's offset, or `-1` for both.
interface BlockClose {
  readonly at: number;
  readonly line: number;
  // The first line after the block's last line.
  readonly nextLine: number;
}
// A callout's first line: the quote's `>`, the marker and the title after it, in document offsets.
interface CalloutLine {
  readonly marker: CalloutMarker;
  readonly markerFrom: number;
  // The line from the marker on.
  readonly markerText: string;
  readonly quoteFrom: number;
  readonly title: string;
  readonly titleFrom: number;
}

interface DelimitedBlockSpec {
  readonly findClose: (text: string) => number;
  readonly mark: ObsidianNodeName;
  readonly opener: string;
  readonly type: ObsidianNodeName;
}

// A highlight delimiter before it is paired.
interface HighlightDelimiter {
  readonly canOpen: boolean;
}

// The parts of markdown-it's types its package root does not export.
type Nesting = Token['nesting'];

type RuleBlock = ReturnType<MarkdownIt['block']['ruler']['getRules']>[number];

// A task marker found at the start of a list item's first paragraph, in document offsets.
interface TaskStart {
  readonly marker: string;
  readonly markerRange: TextRange;
}

interface TokenFields {
  readonly content?: string;
  readonly markup?: string;
}

const OPEN_SUFFIX = '_open';
const CLOSE_SUFFIX = '_close';
const DELIMITER_SIZE = 2;
const EMBED_OPENER_SIZE = 3;
const CODE_INDENT = 4;
// A paragraph is three tokens: its opening, its inline content and its closing.
const PARAGRAPH_TOKENS = 3;
const LEADING_SPACE_RE = /^[ \t]*/u;
const CLOSING_SEQUENCE_RE = /[ \t]#+$/u;
const HTML_ESCAPE_RE = /[&<>"]/gu;
const HTML_ESCAPES: Readonly<Record<string, string>> = { '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' };
// The block rules a footnote definition, a callout and a comment or math block can interrupt, as fenced code can.
const INTERRUPTS = ['paragraph', 'reference', 'blockquote', 'list'];

const HIDDEN_LEAVES: readonly ObsidianNodeName[] = [
  ObsidianNode.BlockIdMark,
  ObsidianNode.CalloutFold,
  ObsidianNode.CalloutType,
  ObsidianNode.CommentMark,
  ObsidianNode.FootnoteMark,
  ObsidianNode.FrontMatterContent,
  ObsidianNode.FrontMatterMark,
  ObsidianNode.HighlightMark,
  ObsidianNode.InternalLinkAliasMark,
  ObsidianNode.InternalLinkMark,
  ObsidianNode.MathMark,
  ObsidianNode.TaskMarker
];
const HIDDEN_NODES: readonly ObsidianNodeName[] = [
  ObsidianNode.BlockId,
  ObsidianNode.CalloutMark,
  ObsidianNode.Comment,
  ObsidianNode.CommentBlock,
  ObsidianNode.FrontMatter
];

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

// The ranges inline rules record, as offsets into their inline content.
const contentRanges = new WeakMap<Token, TextRange>();
// For each inline token, the document offset of every character of its content, and of the end of the content.
const sourceOffsets = new WeakMap<Token, readonly number[]>();
const highlightDelimiters = new WeakMap<Token, HighlightDelimiter>();
const taskStarts = new WeakMap<Token, TaskStart>();

/**
 * Creates a markdown-it with the Obsidian syntax and the GFM pieces Obsidian supports: tables, strikethrough (`~~`
 * only) and bare URLs, with HTML enabled. The given options are applied on top.
 *
 * @param options - markdown-it options.
 * @returns The markdown-it instance.
 */
export function createObsidianMarkdownIt(options: CreateObsidianMarkdownItOptions = {}): MarkdownIt {
  return new MarkdownItCallable({ html: true, linkify: true, ...options }).use(markdownItObsidianSyntax);
}

/**
 * Reads the source range an Obsidian token covers, from its `meta`.
 *
 * @param token - A markdown-it token.
 * @returns The range, as offsets into the source as markdown-it normalizes it (line endings as `\n`), or `null` for a
 *   token that carries none: a closing token, or a token of plain markdown.
 */
export function getObsidianTokenRange(token: Token): null | TextRange {
  const meta: unknown = token.meta;
  return isTextRange(meta) ? { from: meta.from, to: meta.to } : null;
}

/**
 * The Obsidian syntax as a markdown-it plugin.
 *
 * @param md - The markdown-it instance to extend.
 */
export function markdownItObsidianSyntax(md: MarkdownIt): void {
  const blockquote = findBlockRule(md, 'blockquote');
  const reference = findBlockRule(md, 'reference');

  md.block.ruler.before('table', 'obsidian_front_matter', checkFrontMatter);
  // A `[^label]:` line is a footnote definition before it is a table's header row or a link reference definition.
  md.block.ruler.before('table', 'obsidian_footnote_definition', checkFootnoteDefinition, { alt: INTERRUPTS });
  md.block.ruler.before('fence', 'obsidian_math_block', delimitedBlockRule(MATH_BLOCK), { alt: INTERRUPTS });
  md.block.ruler.before('fence', 'obsidian_comment_block', delimitedBlockRule(COMMENT_BLOCK), { alt: INTERRUPTS });
  if (blockquote) {
    md.block.ruler.before('blockquote', 'obsidian_callout', calloutRule(blockquote), { alt: INTERRUPTS });
  }
  if (reference) {
    // A `[^label]:` is never a link reference definition, even where it is no footnote definition, as in a quote.
    md.block.ruler.at('reference', (state, startLine, endLine, isSilent) => !lineContent(state, startLine).startsWith('[^') && reference(state, startLine, endLine, isSilent));
  }

  md.inline.ruler.before('link', 'obsidian_internal_link', checkInternalLink);
  md.inline.ruler.before('link', 'obsidian_footnote_reference', checkFootnoteReference);
  md.inline.ruler.before('link', 'obsidian_inline_footnote', checkInlineFootnote);
  md.inline.ruler.before('link', 'obsidian_block_id', checkBlockId);
  md.inline.ruler.before('link', 'obsidian_tag', checkTag);
  md.inline.ruler.before('link', 'obsidian_comment', checkComment);
  md.inline.ruler.before('link', 'obsidian_inline_math', checkInlineMath);
  md.inline.ruler.before('link', 'obsidian_highlight', checkHighlight);
  md.inline.ruler2.before('fragments_join', 'obsidian_highlight', (state) => {
    pairHighlights(state);
    return true;
  });

  md.core.ruler.before('inline', 'obsidian_inline_sources', prepareInlineContent);
  md.core.ruler.after('inline', 'obsidian_ranges', resolveInlineRanges);

  addRenderRules(md);
}

/**
 * The Obsidian node an opening or single token stands for.
 *
 * @param token - A markdown-it token.
 * @returns The node name, or `null` for a closing token or a token of plain markdown.
 */
export function obsidianNodeNameOf(token: Token): null | ObsidianNodeName {
  if (token.nesting === -1) {
    return null;
  }
  const name = token.nesting === 1 && token.type.endsWith(OPEN_SUFFIX) ? token.type.slice(0, -OPEN_SUFFIX.length) : token.type;
  return isObsidianNodeName(name) ? name : null;
}

/**
 * Parses a markdown document into markdown-it tokens with the Obsidian syntax, as {@link createObsidianMarkdownIt}
 * configures it.
 *
 * @param markdown - The document to parse.
 * @returns The block tokens; inline tokens hold their inline content's tokens as `children`.
 */
export function parseMarkdownIt(markdown: string): Token[] {
  return createObsidianMarkdownIt().parse(markdown, {});
}

function addRenderRules(md: MarkdownIt): void {
  const { rules } = md.renderer;
  for (const name of HIDDEN_LEAVES) {
    rules[name] = renderNothing;
  }
  for (const name of HIDDEN_NODES) {
    rules[name + OPEN_SUFFIX] = renderNothing;
    rules[name + CLOSE_SUFFIX] = renderNothing;
  }
  rules[ObsidianNode.FootnoteLabel] = renderFootnoteLabel;
  rules[ObsidianNode.InlineMath + OPEN_SUFFIX] = renderMath;
  rules[ObsidianNode.InternalLinkAlias] = renderContent;
  rules[ObsidianNode.InternalLinkPath] = renderLinkTarget;
  rules[ObsidianNode.InternalLinkSubpath] = renderLinkTarget;
  rules[ObsidianNode.MathBlock + OPEN_SUFFIX] = renderMath;
  rules[ObsidianNode.TagMark] = renderMarkup;
  rules[ObsidianNode.TagName] = renderContent;
  rules[ObsidianNode.Task + OPEN_SUFFIX] = renderTask;
  rules[ObsidianNode.Task + CLOSE_SUFFIX] = renderNothing;
}

function alignCell(source: string, content: string, start: number, end: number): null | number[] {
  const offsets: number[] = [];
  let position = start;
  for (const ch of content) {
    if (ch === '|' && source.startsWith(String.raw`\|`, position)) {
      offsets.push(position);
      position += DELIMITER_SIZE;
    } else if (position < end && source[position] === ch) {
      offsets.push(position);
      position++;
    } else {
      return null;
    }
  }
  offsets.push(position);
  return offsets;
}

// A block token that is not pushed yet, for a place in the stream other than its end.
function blockToken(state: StateBlock, type: string, nesting: Nesting, tokenRange: null | TextRange, fields: TokenFields = {}): Token {
  const token = new state.Token(type, '', nesting);
  token.block = true;
  token.content = fields.content ?? '';
  token.markup = fields.markup ?? '';
  if (tokenRange) {
    token.meta = rangeMeta(tokenRange);
  }
  return token;
}

// The text of a delimited block between its delimiters, without the line break after the opener and before the closer.
function blockValue(state: StateBlock, spec: DelimitedBlockSpec, startLine: number, close: BlockClose): string {
  const value: string[] = [];
  const firstRest = lineContent(state, startLine).slice(spec.opener.length);
  if (firstRest) {
    value.push(firstRest);
  }
  const isClosed = close.line !== -1;
  for (let line = startLine + 1; line < (isClosed ? close.line : close.nextLine); line++) {
    value.push(state.src.slice(state.bMarks[line], state.eMarks[line]));
  }
  const closePrefix = isClosed ? state.src.slice(state.bMarks[close.line], close.at) : '';
  if (closePrefix) {
    value.push(closePrefix);
  }
  return value.join('\n');
}

// The marker and the title that open a callout's content, as block tokens.
function calloutHead(state: StateBlock, line: CalloutLine, startLine: number): Token[] {
  const { marker, markerFrom, markerText } = line;
  const head: Token[] = [
    blockToken(state, ObsidianNode.CalloutMark + OPEN_SUFFIX, 1, range(markerFrom, markerFrom + marker.mark.to)),
    blockToken(state, ObsidianNode.CalloutType, 0, shift(marker.type, markerFrom), { content: markerText.slice(marker.type.from, marker.type.to) }),
    ...marker.fold ? [blockToken(state, ObsidianNode.CalloutFold, 0, shift(marker.fold, markerFrom), { markup: markerText.slice(marker.fold.from, marker.fold.to) })] : [],
    blockToken(state, ObsidianNode.CalloutMark + CLOSE_SUFFIX, -1, null)
  ];
  if (line.title) {
    const titleInline = blockToken(state, 'inline', 0, null, { content: line.title });
    titleInline.children = [];
    titleInline.map = [startLine, startLine + 1];
    sourceOffsets.set(titleInline, consecutiveOffsets(line.titleFrom, line.title.length));
    const titleOpen = blockToken(state, ObsidianNode.CalloutTitle + OPEN_SUFFIX, 1, range(line.titleFrom, line.titleFrom + line.title.length));
    titleOpen.tag = 'div';
    titleOpen.attrSet('class', 'callout-title');
    const titleClose = blockToken(state, ObsidianNode.CalloutTitle + CLOSE_SUFFIX, -1, null);
    titleClose.tag = 'div';
    head.push(titleOpen, titleInline, titleClose);
  }
  return head;
}

/*
 * A quote whose first line opens with `[!type]` right after the `>` and its space is a callout. The quote is read as
 * markdown-it reads any quote; its first paragraph's first line then becomes the marker and the title, and the rest of
 * that paragraph the content's first paragraph. A marker with no title takes its line alone, so a lazy line after it
 * does not continue the callout, as in the editor.
 */
function calloutRule(blockquote: RuleBlock): RuleBlock {
  return (state, startLine, endLine, isSilent) => {
    const line = matchCalloutLine(state, startLine);
    if (!line) {
      return false;
    }
    if (isSilent) {
      return true;
    }
    const quoteEnd = line.title === '' && isLazyLine(state, startLine + 1, endLine) ? startLine + 1 : endLine;
    const first = state.tokens.length;
    if (!blockquote(state, startLine, quoteEnd, false)) {
      return false;
    }
    makeCallout(state, first, line);
    return true;
  };
}

function checkBlockId(state: StateInline, isSilent: boolean): boolean {
  const start = state.pos;
  if (state.src[start] !== '^') {
    return false;
  }
  const end = inlineLineEnd(state, start);
  if (!isBlockId(state.src.slice(start, end))) {
    return false;
  }
  if (!isSilent) {
    const open = pushInline(state, ObsidianNode.BlockId + OPEN_SUFFIX, '', 1, range(start, end));
    open.content = state.src.slice(start + 1, end);
    pushInline(state, ObsidianNode.BlockIdMark, '', 0, range(start, start + 1)).markup = '^';
    pushInline(state, ObsidianNode.BlockId + CLOSE_SUFFIX, '', -1, null);
  }
  state.pos = end;
  return true;
}

// An inline comment runs from `%%` to the next `%%`, or to the end of the inline content when none closes it.
function checkComment(state: StateInline, isSilent: boolean): boolean {
  return state.src.startsWith('%%', state.pos)
    && checkDelimitedInline({ findClose: findCommentClose, mark: ObsidianNode.CommentMark, opener: '%%', type: ObsidianNode.Comment }, state, isSilent);
}

// The shared shape of an inline comment and inline math: an opener, content the rules inside do not read, a closer.
function checkDelimitedInline(spec: DelimitedBlockSpec, state: StateInline, isSilent: boolean): boolean {
  const start = state.pos;
  const contentFrom = start + spec.opener.length;
  const close = spec.findClose(state.src.slice(contentFrom, state.posMax));
  const contentTo = close === -1 ? state.posMax : contentFrom + close;
  const end = close === -1 ? state.posMax : contentTo + spec.opener.length;
  if (!isSilent) {
    const tag = spec.type === ObsidianNode.InlineMath ? 'span' : '';
    const open = pushInline(state, spec.type + OPEN_SUFFIX, tag, 1, range(start, end));
    open.content = state.src.slice(contentFrom, contentTo);
    open.markup = spec.opener;
    if (tag) {
      open.attrSet('class', 'math math-inline');
    }
    pushInline(state, spec.mark, '', 0, range(start, contentFrom)).markup = spec.opener;
    if (close !== -1) {
      pushInline(state, spec.mark, '', 0, range(contentTo, end)).markup = spec.opener;
    }
    pushInline(state, spec.type + CLOSE_SUFFIX, tag, -1, null);
  }
  state.pos = end;
  return true;
}

/*
 * A footnote definition opens its line, with nothing but indentation before it that no container owns, so in a quote
 * or a list item `[^label]: text` is a reference followed by text. Its content continues on indented lines and across
 * blank lines, and a line opening another definition ends it.
 */
function checkFootnoteDefinition(state: StateBlock, startLine: number, endLine: number, isSilent: boolean): boolean {
  const contentStart = lineStart(state, startLine);
  const indent = state.sCount[startLine] ?? 0;
  const isOutsideContainers = (state.blkIndent === 0 || indent < state.blkIndent)
    && state.src.slice(lineBegin(state, startLine), contentStart).trim() === '';
  const text = lineContent(state, startLine);
  const definition = isOutsideContainers && indent < CODE_INDENT ? matchFootnoteDefinition(text) : null;
  if (!definition) {
    return false;
  }
  if (isSilent) {
    return true;
  }
  const label = text.slice(definition.label.from, definition.label.to);
  const open = state.push(ObsidianNode.FootnoteDefinition + OPEN_SUFFIX, 'div', 1);
  open.block = true;
  open.attrSet('class', 'footnote-definition');
  open.attrSet('id', `fn-${label}`);
  pushBlockLeaf(state, ObsidianNode.FootnoteMark, range(contentStart, contentStart + definition.label.from), { markup: '[^' });
  pushBlockLeaf(state, ObsidianNode.FootnoteLabel, shift(definition.label, contentStart), { content: label });
  pushBlockLeaf(state, ObsidianNode.FootnoteMark, range(contentStart + definition.label.to, contentStart + definition.markEnd), { markup: ']:' });

  const oldBMark = state.bMarks[startLine] ?? 0;
  const oldTShift = state.tShift[startLine] ?? 0;
  const oldBlkIndent = state.blkIndent;
  // The content on the definition's own line starts after the `]:` and its whitespace, at the content's indentation.
  state.blkIndent = Math.max(oldBlkIndent, 0) + 1;
  state.bMarks[startLine] = contentStart + definition.markEnd + leadingSpace(text.slice(definition.markEnd));
  state.tShift[startLine] = 0;
  state.sCount[startLine] = state.blkIndent;
  state.md.block.tokenize(state, startLine, endLine);
  state.bMarks[startLine] = oldBMark;
  state.tShift[startLine] = oldTShift;
  state.sCount[startLine] = indent;
  state.blkIndent = oldBlkIndent;

  let lastLine = Math.max(state.line - 1, startLine);
  while (lastLine > startLine && state.isEmpty(lastLine)) {
    lastLine--;
  }
  open.map = [startLine, lastLine + 1];
  open.meta = rangeMeta(range(contentStart, state.eMarks[lastLine] ?? contentStart));
  state.push(ObsidianNode.FootnoteDefinition + CLOSE_SUFFIX, 'div', -1).block = true;
  return true;
}

function checkFootnoteReference(state: StateInline, isSilent: boolean): boolean {
  const start = state.pos;
  const length = matchFootnoteReference(state.src.slice(start, state.posMax));
  if (length === 0) {
    return false;
  }
  const end = start + length;
  if (!isSilent) {
    const label = state.src.slice(start + DELIMITER_SIZE, end - 1);
    const open = pushInline(state, ObsidianNode.FootnoteReference + OPEN_SUFFIX, 'sup', 1, range(start, end));
    open.attrSet('class', 'footnote-ref');
    open.attrSet('data-footnote', label);
    pushInline(state, ObsidianNode.FootnoteMark, '', 0, range(start, start + DELIMITER_SIZE)).markup = '[^';
    pushInline(state, ObsidianNode.FootnoteLabel, '', 0, range(start + DELIMITER_SIZE, end - 1)).content = label;
    pushInline(state, ObsidianNode.FootnoteMark, '', 0, range(end - 1, end)).markup = ']';
    pushInline(state, ObsidianNode.FootnoteReference + CLOSE_SUFFIX, 'sup', -1, null);
  }
  state.pos = end;
  return true;
}

/*
 * Front matter opens on the document's first line, a line of exactly `---`, and runs to the next such line. Like in the
 * editor, front matter that never closes runs to the end of the document.
 */
function checkFrontMatter(state: StateBlock, startLine: number, endLine: number, isSilent: boolean): boolean {
  if (startLine !== 0 || lineStart(state, 0) !== 0 || !isFrontMatterFence(lineContent(state, 0))) {
    return false;
  }
  if (isSilent) {
    return true;
  }
  let closeLine = 1;
  while (closeLine < endLine && !isFrontMatterFence(state.src.slice(state.bMarks[closeLine], state.eMarks[closeLine]))) {
    closeLine++;
  }
  const isClosed = closeLine < endLine;
  const lines: string[] = [];
  for (let line = 1; line < closeLine; line++) {
    lines.push(state.src.slice(state.bMarks[line], state.eMarks[line]));
  }
  const fenceEnd = state.eMarks[0] ?? 0;
  const lastLine = isClosed ? closeLine : endLine - 1;
  // Front matter that never closes takes the rest of the document, its last line break included.
  const end = isClosed ? state.eMarks[closeLine] ?? fenceEnd : state.src.length;
  const open = state.push(ObsidianNode.FrontMatter + OPEN_SUFFIX, '', 1);
  open.block = true;
  open.content = lines.join('\n');
  open.map = [0, lastLine + 1];
  open.meta = rangeMeta(range(0, end));
  pushBlockLeaf(state, ObsidianNode.FrontMatterMark, range(0, fenceEnd), { markup: '---' });
  // The content is every line between the fences, empty ones included, and may itself be empty.
  const contentFrom = fenceEnd + 1;
  if (isClosed ? closeLine > 1 : end >= contentFrom) {
    const contentTo = isClosed ? state.eMarks[closeLine - 1] ?? contentFrom : end;
    pushBlockLeaf(state, ObsidianNode.FrontMatterContent, range(contentFrom, contentTo), { content: state.src.slice(contentFrom, contentTo) });
  }
  if (isClosed) {
    pushBlockLeaf(state, ObsidianNode.FrontMatterMark, range(state.bMarks[closeLine] ?? 0, end), { markup: '---' });
  }
  state.push(ObsidianNode.FrontMatter + CLOSE_SUFFIX, '', -1).block = true;
  state.line = lastLine + 1;
  return true;
}

/*
 * A highlight delimiter is a run of exactly two `=`. It opens before a non-space, and any of them closes; the pairs
 * are made once the content is read. A longer run is text: no `==` is read inside it.
 */
function checkHighlight(state: StateInline, isSilent: boolean): boolean {
  const start = state.pos;
  if (state.src[start] !== '=' || state.src[start - 1] === '=') {
    return false;
  }
  const size = equalsRunLength(state.src.slice(start, state.posMax));
  if (!isSilent) {
    if (size === DELIMITER_SIZE) {
      const token = pushInline(state, 'text', '', 0, range(start, start + size));
      token.content = '==';
      const after = start + size < state.posMax ? state.src[start + size] ?? '' : '';
      highlightDelimiters.set(token, { canOpen: canOpenHighlightBefore(after) });
    } else {
      state.pending += state.src.slice(start, start + size);
    }
  }
  state.pos = start + size;
  return true;
}

// An inline footnote's text is read as inline markdown.
function checkInlineFootnote(state: StateInline, isSilent: boolean): boolean {
  const start = state.pos;
  const length = matchInlineFootnote(state.src.slice(start, state.posMax));
  if (length === 0) {
    return false;
  }
  const end = start + length;
  if (!isSilent) {
    const open = pushInline(state, ObsidianNode.InlineFootnote + OPEN_SUFFIX, 'span', 1, range(start, end));
    open.attrSet('class', 'inline-footnote');
    pushInline(state, ObsidianNode.FootnoteMark, '', 0, range(start, start + DELIMITER_SIZE)).markup = '^[';
    const oldMax = state.posMax;
    state.pos = start + DELIMITER_SIZE;
    state.posMax = end - 1;
    state.md.inline.tokenize(state);
    state.posMax = oldMax;
    pushInline(state, ObsidianNode.FootnoteMark, '', 0, range(end - 1, end)).markup = ']';
    pushInline(state, ObsidianNode.InlineFootnote + CLOSE_SUFFIX, 'span', -1, null);
  }
  state.pos = end;
  return true;
}

function checkInlineMath(state: StateInline, isSilent: boolean): boolean {
  const start = state.pos;
  const size = state.src[start] === '$' ? matchMathOpen(state.src.slice(start, inlineLineEnd(state, start))) : 0;
  if (size === 0) {
    return false;
  }
  // Display math that never closes runs to the end of the inline content.
  const spec: DelimitedBlockSpec = {
    findClose: (content) => findMathClose(content, size),
    mark: ObsidianNode.MathMark,
    opener: '$'.repeat(size),
    type: ObsidianNode.InlineMath
  };
  return checkDelimitedInline(spec, state, isSilent);
}

function checkInternalLink(state: StateInline, isSilent: boolean): boolean {
  const start = state.pos;
  const text = state.src.slice(start, state.posMax);
  const isEmbed = text.startsWith('![[');
  const openerSize = isEmbed ? EMBED_OPENER_SIZE : DELIMITER_SIZE;
  const length = isEmbed || text.startsWith('[[') ? findInternalLinkEnd(text.slice(openerSize)) : -1;
  if (length === -1) {
    return false;
  }
  const contentFrom = start + openerSize;
  const end = contentFrom + length + DELIMITER_SIZE;
  if (!isSilent) {
    const content = text.slice(openerSize, openerSize + length);
    const parts = splitInternalLink(content);
    const targetEnd = parts.aliasMark?.from ?? length;
    const target = content.slice(0, targetEnd);
    const type = isEmbed ? ObsidianNode.Embed : ObsidianNode.InternalLink;
    const tag = isEmbed ? 'span' : 'a';
    const open = pushInline(state, type + OPEN_SUFFIX, tag, 1, range(start, end));
    open.attrSet('class', isEmbed ? 'internal-embed' : 'internal-link');
    open.attrSet(isEmbed ? 'src' : 'href', target);
    open.attrSet('data-href', target);
    pushInline(state, ObsidianNode.InternalLinkMark, '', 0, range(start, contentFrom)).markup = text.slice(0, openerSize);
    pushPart(state, ObsidianNode.InternalLinkPath, content, parts.path, contentFrom);
    if (parts.subpath) {
      pushPart(state, ObsidianNode.InternalLinkSubpath, content, range(parts.subpath.from, targetEnd), contentFrom);
    }
    if (parts.aliasMark) {
      pushInline(state, ObsidianNode.InternalLinkAliasMark, '', 0, shift(parts.aliasMark, contentFrom)).markup = content.slice(parts.aliasMark.from, parts.aliasMark.to);
    }
    if (parts.alias) {
      pushPart(state, ObsidianNode.InternalLinkAlias, content, parts.alias, contentFrom);
    }
    pushInline(state, ObsidianNode.InternalLinkMark, '', 0, range(end - DELIMITER_SIZE, end)).markup = ']]';
    pushInline(state, type + CLOSE_SUFFIX, tag, -1, null);
  }
  state.pos = end;
  return true;
}

function checkTag(state: StateInline, isSilent: boolean): boolean {
  const start = state.pos;
  const before = start === 0 ? '' : state.src[start - 1] ?? '';
  const length = state.src[start] === '#' && canOpenTagAfter(before) ? matchTagName(state.src.slice(start + 1, state.posMax)) : 0;
  if (length === 0) {
    return false;
  }
  const end = start + 1 + length;
  if (!isSilent) {
    const name = state.src.slice(start + 1, end);
    const open = pushInline(state, ObsidianNode.Tag + OPEN_SUFFIX, 'a', 1, range(start, end));
    open.attrSet('class', 'tag');
    open.attrSet('href', `#${name}`);
    pushInline(state, ObsidianNode.TagMark, '', 0, range(start, start + 1)).markup = '#';
    pushInline(state, ObsidianNode.TagName, '', 0, range(start + 1, end)).content = name;
    pushInline(state, ObsidianNode.Tag + CLOSE_SUFFIX, 'a', -1, null);
  }
  state.pos = end;
  return true;
}

function consecutiveOffsets(from: number, length: number): number[] {
  return Array.from({ length: length + 1 }, (_, index) => from + index);
}

/*
 * A `$$` or `%%` line that the same line does not close opens a block, which runs over blank lines to the line holding
 * the closing delimiter, or to the end of its container. The rest of the closing line is not read.
 */
function delimitedBlockRule(spec: DelimitedBlockSpec): RuleBlock {
  return (state, startLine, endLine, isSilent) => {
    const text = lineContent(state, startLine);
    if (
      (state.sCount[startLine] ?? 0) - state.blkIndent >= CODE_INDENT || !text.startsWith(spec.opener)
      || spec.findClose(text.slice(spec.opener.length)) !== -1
    ) {
      return false;
    }
    if (isSilent) {
      // A paragraph that leaves the delimiter open reads this line as the inline span's end.
      return state.parentType !== 'paragraph' || !isLeftOpen(state.getLines(state.line, startLine, state.blkIndent, false), spec.opener);
    }
    const from = lineStart(state, startLine);
    const close = findBlockClose(state, spec, startLine, endLine);
    const isClosed = close.line !== -1;
    const lastLine = isClosed ? close.line : close.nextLine - 1;
    const to = isClosed ? close.at + spec.opener.length : unclosedBlockEnd(state, startLine, lastLine, close.nextLine);
    const open = state.push(spec.type + OPEN_SUFFIX, 'div', 1);
    open.block = true;
    open.content = blockValue(state, spec, startLine, close);
    open.map = [startLine, lastLine + 1];
    open.meta = rangeMeta(range(from, to));
    if (spec.type === ObsidianNode.MathBlock) {
      open.attrSet('class', 'math math-block');
    }
    pushBlockLeaf(state, spec.mark, range(from, from + spec.opener.length), { markup: spec.opener });
    if (isClosed) {
      pushBlockLeaf(state, spec.mark, range(close.at, to), { markup: spec.opener });
    }
    state.push(spec.type + CLOSE_SUFFIX, 'div', -1).block = true;
    state.line = lastLine + 1;
    return true;
  };
}

// The escaping markdown-it's own renderer applies, which its package exports only on an instance.
function escapeHtml(text: string): string {
  return text.replaceAll(HTML_ESCAPE_RE, (ch) => HTML_ESCAPES[ch] ?? ch);
}

// The line that closes a delimited block, before a line its container does not hold.
function findBlockClose(state: StateBlock, spec: DelimitedBlockSpec, startLine: number, endLine: number): BlockClose {
  let line = startLine + 1;
  for (; line < endLine; line++) {
    if (!state.isEmpty(line) && (state.sCount[line] ?? 0) < state.blkIndent) {
      break;
    }
    const lineFrom = state.bMarks[line] ?? 0;
    const close = spec.findClose(state.src.slice(lineFrom, state.eMarks[line]));
    if (close !== -1) {
      return { at: lineFrom + close, line, nextLine: line + 1 };
    }
  }
  return { at: -1, line: -1, nextLine: line };
}

/*
 * The rules of markdown-it are private, so the current function of a rule is found by disabling the rule and seeing
 * which function leaves the chain.
 */
function findBlockRule(md: MarkdownIt, name: string): null | RuleBlock {
  const { ruler } = md.block;
  const enabled = ruler.getRules('');
  if (ruler.disable(name, true).length === 0) {
    return null;
  }
  const remaining = ruler.getRules('');
  ruler.enable(name);
  return enabled.find((rule) => !remaining.includes(rule)) ?? null;
}

// Whether the link a part of an internal link or embed belongs to has an alias.
function hasAlias(tokens: readonly Token[], index: number): boolean {
  for (let next = index + 1; next < tokens.length; next++) {
    const type = tokens[next]?.type;
    if (type === ObsidianNode.InternalLinkAlias) {
      return true;
    }
    if (type === ObsidianNode.InternalLink + CLOSE_SUFFIX || type === ObsidianNode.Embed + CLOSE_SUFFIX) {
      return false;
    }
  }
  return false;
}

// The end of the line an inline rule starts on, within the inline content.
function inlineLineEnd(state: StateInline, start: number): number {
  const lineBreak = state.src.indexOf('\n', start);
  return lineBreak === -1 || lineBreak > state.posMax ? state.posMax : lineBreak;
}

function isLazyLine(state: StateBlock, line: number, endLine: number): boolean {
  return line < endLine && !state.isEmpty(line) && ((state.sCount[line] ?? 0) < state.blkIndent || !lineContent(state, line).startsWith('>'));
}

function isLeftOpen(text: string, opener: string): boolean {
  let isOpen = false;
  for (let index = text.indexOf(opener); index !== -1; index = text.indexOf(opener, index + opener.length)) {
    if (text[index - 1] !== '\\') {
      isOpen = !isOpen;
    }
  }
  return isOpen;
}

function isTextRange(value: unknown): value is TextRange {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value && typeof value.from === 'number'
    && typeof value.to === 'number';
}

// Where a paragraph's or a heading's last content line ends in the document.
function lastLineEnd(source: string, line: TextRange, text: string, isAtxHeading: boolean): number {
  const trimmedEnd = line.from + source.slice(line.from, line.to).trimEnd().length;
  if (!isAtxHeading) {
    return trimmedEnd;
  }
  const beforeClosing = source.slice(line.from, trimmedEnd).replace(CLOSING_SEQUENCE_RE, '').trimEnd();
  const headingEnd = line.from + beforeClosing.length;
  return source.slice(headingEnd - text.length, headingEnd) === text ? headingEnd : trimmedEnd;
}

function leadingSpace(text: string): number {
  return LEADING_SPACE_RE.exec(text)?.[0].length ?? 0;
}

// Where a line begins in the document, before any container prefix.
function lineBegin(state: StateBlock, line: number): number {
  return line === 0 ? 0 : (state.eMarks[line - 1] ?? 0) + 1;
}

// The content of a line, after its container prefixes and indentation.
function lineContent(state: StateBlock, line: number): string {
  return state.src.slice(lineStart(state, line), state.eMarks[line]);
}

// Where a line's content starts: after its container prefixes and indentation.
function lineStart(state: StateBlock, line: number): number {
  return (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
}

// Finds a table cell's content in its row, from where the cells before it ended.
function locateCell(source: string, content: string, line: TextRange | undefined, cellCursors: Map<number, number>, lineIndex: number): number[] {
  const rowFrom = cellCursors.get(lineIndex) ?? line?.from ?? 0;
  const rowTo = line?.to ?? source.length;
  for (let start = rowFrom; start < rowTo; start++) {
    const offsets = alignCell(source, content, start, rowTo);
    if (offsets) {
      cellCursors.set(lineIndex, offsets.at(-1) ?? start);
      return offsets;
    }
  }
  return consecutiveOffsets(rowFrom, content.length);
}

/*
 * Where each character of an inline token's content lies in the document, and where the content ends. A paragraph's
 * lines are its document lines without their prefixes, so each content line ends where its document line does, the
 * last one before its trailing whitespace. A heading's content also ends before a closing `#` sequence.
 */
function locateContent(source: string, token: Token, opener: Token | undefined, lines: readonly TextRange[]): number[] {
  const { content, map } = token;
  if (!map) {
    return consecutiveOffsets(0, content.length);
  }
  const isAtxHeading = opener?.type === 'heading_open' && opener.markup.startsWith('#');
  const lastLine = map[1] - 1;
  const contentLines = content.split('\n');
  const offsets: number[] = [];
  for (const [index, text] of contentLines.entries()) {
    const line = lines[lastLine - (contentLines.length - 1 - index)] ?? range(0, 0);
    const end = index === contentLines.length - 1 ? lastLineEnd(source, line, text, isAtxHeading) : line.to;
    const start = end - text.length;
    for (let column = 0; column < text.length; column++) {
      offsets.push(Math.max(line.from, start + column));
    }
    offsets.push(end);
  }
  return offsets;
}

/*
 * Turns the quote markdown-it read into a callout: the marker and the title out of its first paragraph, and the rest
 * of that paragraph left as the content's first paragraph. A quote whose first block is no such paragraph stays a
 * quote.
 */
function makeCallout(state: StateBlock, first: number, line: CalloutLine): void {
  const { tokens } = state;
  const [open, paragraph, inline] = tokens.slice(first, first + PARAGRAPH_TOKENS);
  const close = tokens.at(-1);
  const startLine = open?.map?.[0] ?? 0;
  const paragraphEnd = paragraph?.map?.[1] ?? startLine;
  if (
    !open || !close || paragraph?.type !== 'paragraph_open' || paragraph.map?.[0] !== startLine || inline?.type !== 'inline'
    || !inline.content.startsWith(line.markerText.slice(0, line.marker.mark.to))
  ) {
    return;
  }
  renameQuote(state, open, close, line);

  const head = calloutHead(state, line, startLine);
  for (const token of head) {
    token.level = paragraph.level;
  }
  const lineBreak = inline.content.indexOf('\n');
  const rest = lineBreak === -1 ? '' : inline.content.slice(lineBreak + 1).trim();
  if (rest) {
    inline.content = rest;
    paragraph.map = [startLine + 1, paragraphEnd];
    inline.map = [startLine + 1, paragraphEnd];
    tokens.splice(first + 1, 0, ...head);
  } else {
    tokens.splice(first + 1, PARAGRAPH_TOKENS, ...head);
  }
}

// Reads a callout's first line: `>`, an optional space, and the marker, with the rest of the line as the title.
function matchCalloutLine(state: StateBlock, startLine: number): CalloutLine | null {
  const text = lineContent(state, startLine);
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= CODE_INDENT || !text.startsWith('>')) {
    return null;
  }
  const markerOffset = text[1] === ' ' ? DELIMITER_SIZE : 1;
  const markerText = text.slice(markerOffset);
  const marker = matchCalloutMarker(markerText);
  if (!marker) {
    return null;
  }
  const afterMark = markerText.slice(marker.mark.to);
  const titleOffset = leadingSpace(afterMark);
  const quoteFrom = lineStart(state, startLine);
  const markerFrom = quoteFrom + markerOffset;
  return {
    marker,
    markerFrom,
    markerText,
    quoteFrom,
    title: afterMark.slice(titleOffset).trimEnd(),
    titleFrom: markerFrom + marker.mark.to + titleOffset
  };
}

/*
 * Pairs the highlight delimiters, as the micromark extension does: each `==` closes the nearest `==` before it that
 * can open and is not closed yet, at the same nesting level. One that closes nothing opens when it can, and is text
 * otherwise.
 */
function pairHighlights(state: StateInline): void {
  const closers = new Map<Token, Token>();
  const openers = new Set<Token>();
  const levels: Token[][] = [[]];
  for (const token of state.tokens) {
    if (token.nesting === 1) {
      levels.push([]);
    } else if (token.nesting === -1 && levels.length > 1) {
      levels.pop();
    }
    const delimiter = highlightDelimiters.get(token);
    const level = levels.at(-1);
    if (!delimiter || !level) {
      continue;
    }
    const opener = level.pop();
    if (opener) {
      closers.set(opener, token);
      openers.add(opener);
      closers.set(token, token);
    } else if (delimiter.canOpen) {
      level.push(token);
    }
  }
  const tokens: Token[] = [];
  for (const token of state.tokens) {
    const closer = closers.get(token);
    if (!closer) {
      tokens.push(token);
      continue;
    }
    const mark = new state.Token(ObsidianNode.HighlightMark, '', 0);
    mark.markup = '==';
    contentRanges.set(mark, contentRanges.get(token) ?? range(0, 0));
    if (openers.has(token)) {
      const open = new state.Token(ObsidianNode.Highlight + OPEN_SUFFIX, 'mark', 1);
      open.markup = '==';
      contentRanges.set(open, range(contentRanges.get(token)?.from ?? 0, contentRanges.get(closer)?.to ?? 0));
      tokens.push(open, mark);
    } else {
      const close = new state.Token(ObsidianNode.Highlight + CLOSE_SUFFIX, 'mark', -1);
      close.markup = '==';
      tokens.push(mark, close);
    }
  }
  state.tokens.splice(0, state.tokens.length, ...tokens);
}

/*
 * Before the inline rules run: finds where each inline token's content lies in the document, and takes the task marker
 * off the first paragraph of a list item.
 */
function prepareInlineContent(state: StateCore): void {
  const lines = sourceLines(state.src);
  // How far the cells of each table row have been found.
  const cellCursors = new Map<number, number>();
  // A table cell's inline content has no line map, only its row has.
  let rowLine = 0;
  for (const [index, token] of state.tokens.entries()) {
    if (token.type === 'tr_open') {
      rowLine = token.map?.[0] ?? rowLine;
    }
    if (token.type !== 'inline' || sourceOffsets.has(token)) {
      continue;
    }
    const opener = state.tokens[index - 1];
    const isCell = opener?.type === 'th_open' || opener?.type === 'td_open';
    sourceOffsets.set(token, isCell ? locateCell(state.src, token.content, lines[rowLine], cellCursors, rowLine) : locateContent(state.src, token, opener, lines));
    const listItem = state.tokens[index - DELIMITER_SIZE];
    if (opener?.type === 'paragraph_open' && listItem?.type === 'list_item_open') {
      takeTaskMarker(token, listItem);
    }
  }
}

function pushBlockLeaf(state: StateBlock, type: ObsidianNodeName, tokenRange: TextRange, fields: TokenFields): void {
  const token = state.push(type, '', 0);
  token.block = true;
  token.content = fields.content ?? '';
  token.markup = fields.markup ?? '';
  token.meta = rangeMeta(tokenRange);
}

function pushInline(state: StateInline, type: string, tag: string, nesting: Nesting, tokenRange: null | TextRange): Token {
  const token = state.push(type, tag, nesting);
  if (tokenRange) {
    contentRanges.set(token, tokenRange);
  }
  return token;
}

// A part of an internal link: its path, subpath or alias, when it is not empty.
function pushPart(state: StateInline, type: ObsidianNodeName, content: string, part: TextRange, contentFrom: number): void {
  if (part.to > part.from) {
    pushInline(state, type, '', 0, shift(part, contentFrom)).content = content.slice(part.from, part.to);
  }
}

function range(from: number, to: number): TextRange {
  return { from, to };
}

// The types of markdown-it give a token's meta as an index-signature record, which an interface does not satisfy.
function rangeMeta(textRange: null | TextRange): null | Record<string, unknown> {
  return textRange && { from: textRange.from, to: textRange.to };
}

// Turns a quote's opening and closing tokens into a callout's.
function renameQuote(state: StateBlock, open: Token, close: Token, line: CalloutLine): void {
  const { marker, markerText } = line;
  const lastLine = (open.map?.[1] ?? 1) - 1;
  open.type = ObsidianNode.Callout + OPEN_SUFFIX;
  open.tag = 'div';
  open.markup = '';
  open.attrSet('class', 'callout');
  open.attrSet('data-callout', markerText.slice(marker.type.from, marker.type.to).toLowerCase());
  if (marker.fold) {
    open.attrSet('data-callout-fold', markerText.slice(marker.fold.from, marker.fold.to));
  }
  open.meta = rangeMeta(range(line.quoteFrom, state.eMarks[lastLine] ?? line.quoteFrom));
  close.type = ObsidianNode.Callout + CLOSE_SUFFIX;
  close.tag = 'div';
  close.markup = '';
}

function renderContent(tokens: Token[], index: number): string {
  return escapeHtml(tokens[index]?.content ?? '');
}

// A definition shows its label before its content, and a reference shows its label as its text.
function renderFootnoteLabel(tokens: Token[], index: number): string {
  const token = tokens[index];
  const label = escapeHtml(token?.content ?? '');
  return token?.block ? `<sup class="footnote-label">${label}</sup> ` : label;
}

// A link shows its alias, or its target without one.
function renderLinkTarget(tokens: Token[], index: number): string {
  return hasAlias(tokens, index) ? '' : renderContent(tokens, index);
}

function renderMarkup(tokens: Token[], index: number): string {
  return escapeHtml(tokens[index]?.markup ?? '');
}

// Math shows its source, for a math renderer to typeset.
function renderMath(tokens: Token[], index: number, _options: MarkdownItOptions, _env: unknown, self: Renderer): string {
  const token = tokens[index];
  return token ? `<${token.tag}${self.renderAttrs(token)}>${escapeHtml(token.content)}` : '';
}

function renderNothing(): string {
  return '';
}

function renderTask(tokens: Token[], index: number): string {
  const marker = tokens[index]?.markup ?? ' ';
  return `<input class="task-list-item-checkbox" type="checkbox" data-task="${escapeHtml(marker)}"${marker === ' ' ? '' : ' checked'} disabled> `;
}

/*
 * After the inline rules run: turns the ranges the inline rules recorded in their content into document ranges, and
 * wraps a task's paragraph in its task.
 */
function resolveInlineRanges(state: StateCore): void {
  for (const token of state.tokens) {
    const offsets = sourceOffsets.get(token);
    if (!offsets || token.type !== 'inline' || !token.children) {
      continue;
    }
    const end = offsets.at(-1) ?? 0;
    for (const child of token.children) {
      const contentRange = contentRanges.get(child);
      if (contentRange) {
        child.meta = rangeMeta(range(offsets[contentRange.from] ?? end, offsets[contentRange.to] ?? end));
      }
    }
    const task = taskStarts.get(token);
    if (!task) {
      continue;
    }
    const open = new state.Token(ObsidianNode.Task + OPEN_SUFFIX, '', 1);
    open.markup = task.marker;
    open.meta = rangeMeta(range(task.markerRange.from, end));
    const marker = new state.Token(ObsidianNode.TaskMarker, '', 0);
    marker.markup = `[${task.marker}]`;
    marker.meta = rangeMeta(task.markerRange);
    token.children = [open, marker, ...token.children, new state.Token(ObsidianNode.Task + CLOSE_SUFFIX, '', -1)];
  }
}

function shift(textRange: TextRange, offset: number): TextRange {
  return range(textRange.from + offset, textRange.to + offset);
}

function sourceLines(source: string): TextRange[] {
  const lines: TextRange[] = [];
  let from = 0;
  for (let lineBreak = source.indexOf('\n'); lineBreak !== -1; lineBreak = source.indexOf('\n', from)) {
    lines.push(range(from, lineBreak));
    from = lineBreak + 1;
  }
  lines.push(range(from, source.length));
  return lines;
}

/*
 * A task marker, `[c]` followed by whitespace, opens the first paragraph of a list item. The marker and the whitespace
 * after it come off the paragraph's content. A marker with nothing but whitespace after it on its line takes the line
 * break and the next line's indentation as well.
 */
function takeTaskMarker(inline: Token, listItem: Token): void {
  const length = matchTaskMarker(inline.content);
  const offsets = sourceOffsets.get(inline);
  if (length === 0 || !offsets) {
    return;
  }
  let rest = length + leadingSpace(inline.content.slice(length));
  if (inline.content[rest] === '\n') {
    rest++;
    rest += leadingSpace(inline.content.slice(rest));
  }
  const marker = inline.content.slice(1, length - 1);
  taskStarts.set(inline, { marker, markerRange: range(offsets[0] ?? 0, offsets[length] ?? 0) });
  inline.content = inline.content.slice(rest);
  sourceOffsets.set(inline, offsets.slice(rest));
  listItem.attrJoin('class', 'task-list-item');
  listItem.attrSet('data-task', marker);
}

/*
 * Where an unclosed block ends: at the end of its last line. markdown-it drops a last line of the document that holds
 * only whitespace and no line break, so a block that reaches the end of the document takes that whitespace too, unless
 * it is in a quote, which a line without a `>` does not continue.
 */
function unclosedBlockEnd(state: StateBlock, startLine: number, lastLine: number, nextLine: number): number {
  const end = state.eMarks[lastLine] ?? 0;
  const tail = state.src.slice(end + 1);
  const isInQuote = state.src.slice(lineBegin(state, startLine), state.bMarks[startLine]).includes('>');
  if (isInQuote || tail === '' || nextLine !== state.lineMax) {
    return end;
  }
  return tail.trim() === '' && !tail.includes('\n') ? state.src.length : end;
}
