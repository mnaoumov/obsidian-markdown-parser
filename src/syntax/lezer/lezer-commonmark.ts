/**
 * @file
 *
 * Where `@lezer/markdown` 1.8 reads a document differently from CommonMark 0.31.2, and what this package does about it.
 *
 * {@link commonMarkFixes} corrects three of its rules, and every parser of this package includes it, or, with the
 * `htmlBlock` quirk, {@link commonMarkFixesWithoutHtmlBlock}:
 *
 * - An ATX heading's `#` sequence may be followed by a tab, not only by a space.
 * - `<textarea>` opens an HTML block of the first kind, beside `<pre>`, `<script>` and `<style>`, and any of their four
 *   end tags closes one.
 * - Raw inline HTML follows the spec: a tag name right after its `<`, an attribute only after whitespace, and the
 *   comment forms of 0.31.2 (`<!-->`, `<!--->`, and `--` inside a comment).
 *
 * The fourth difference is by design: to parse incrementally, `@lezer/markdown` does not check that a link reference is
 * defined, so it reads `[foo]` as a link even when no `[foo]:` definition exists, and that changes how brackets and
 * emphasis around it pair up. {@link linkReferenceCheck} makes it check, given the labels a document defines, and
 * {@link parseWithLinkReferences} parses a whole document that way, twice. A tree parsed with the check cannot be reused
 * incrementally once an edit adds or removes a definition, so the editor's parser leaves it out.
 *
 * The heading and HTML block parsers are adapted from `@lezer/markdown`'s own, under its MIT license (see
 * `THIRD-PARTY-NOTICES.md`).
 */

import type { Tree } from '@lezer/common';
import type {
  BlockContext,
  BlockParser,
  Element,
  InlineContext,
  InlineParser,
  Line,
  MarkdownConfig,
  MarkdownParser
} from '@lezer/markdown';

import { InlineContext as InlineContextClass } from '@lezer/markdown';
import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

// The internal state of `InlineContext` the link reference check needs: the delimiters and elements read so far.
interface InlineParts {
  readonly parts: (null | object)[];
}

const CODE_INDENT = 4;
const MAX_HEADING_LEVEL = 6;
// A full reference's label is longer than the two brackets of a collapsed one.
const BRACKETS_SIZE = 2;

const Char = {
  CloseBracket: codeOf(']'),
  Hash: codeOf('#'),
  LessThan: codeOf('<'),
  Space: codeOf(' '),
  Tab: codeOf('\t')
} as const;

const HTML_BLOCK_1_START_RE = /^<(?:pre|script|style|textarea)(?:[\t\n\f\r ]|>|$)/iu;
const HTML_BLOCK_1_END_RE = /<\/(?:pre|script|style|textarea)>/iu;

const ATTRIBUTE = String.raw`(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'<=>\x60]+|'[^']*'|"[^"]*"))?)`;
const OPEN_TAG_RE = new RegExp(String.raw`^<[A-Za-z][\dA-Za-z-]*${ATTRIBUTE}*\s*\/?>`, 'u');
const CLOSE_TAG_RE = /^<\/[A-Za-z][\dA-Za-z-]*\s*>/u;
const COMMENT_RE = /^<!--(?:-?>|[^]*?-->)/u;
const PROCESSING_INSTRUCTION_RE = /^<\?[^]*?\?>/u;
const DECLARATION_RE = /^<![A-Za-z][^>]*>/u;
const CDATA_RE = /^<!\[CDATA\[[^]*?\]\]>/u;
const URI_AUTOLINK_RE = /^<[A-Za-z][\d+.A-Za-z-]{1,31}:[^\0- <>]*>/u;
const EMAIL_AUTOLINK_RE = /^<[\w!#$%&'*+./=?^`{|}~-]+@[\dA-Za-z](?:[\dA-Za-z-]{0,61}[\dA-Za-z])?(?:\.[\dA-Za-z](?:[\dA-Za-z-]{0,61}[\dA-Za-z])?)*>/u;

// The pieces of an inline link after its `](`, as CommonMark reads them.
const LINK_WHITESPACE_RE = /^[\t ]*(?:\n[\t ]*)?/u;
const POINTY_DESTINATION_RE = /^<(?:[^\n<>\\]|\\[^])*>/u;
// One piece of a destination not in pointy brackets: an escaped punctuation character, a parenthesis or any other character.
const DESTINATION_PIECE_RE = /\\[!-/:-@[-`{-~]|[()]|[^\0- ()]/uy;
const PARENTHESIS_DEPTH: Readonly<Record<string, number>> = { '(': 1, ')': -1 };
const TITLE_RE = /^(?:"(?:[^"\\]|\\[^])*"|'(?:[^'\\]|\\[^])*'|\((?:[^()\\]|\\[^])*\))/u;
const BLANK_LINE_RE = /\n[\t >]*\n/u;
const LINK_LABEL_RE = /^\[(?:[^[\\\]]|\\[^]){0,999}\]/u;
const LABEL_LINE_BREAK_RE = /\n[\t >]*/gu;

const atxHeadingFix: BlockParser = {
  before: 'ATXHeading',
  endLeaf: (_cx, line): boolean => atxTabHeadingSize(line) > 0,
  name: 'ATXHeadingAfterTab',
  parse: checkAtxTabHeading
};
const rawHtmlFix: InlineParser = { before: 'HTMLTag', name: 'RawHTML', parse: parseRawHtml };

/**
 * Corrections that bring `@lezer/markdown` 1.8 closer to CommonMark 0.31.2.
 */
export const commonMarkFixes: MarkdownConfig = {
  parseBlock: [
    atxHeadingFix,
    {
      before: 'HTMLBlock',
      endLeaf: (_cx, line): boolean => isHtmlBlock1Start(line),
      name: 'HTMLBlockOfTheFirstKind',
      parse: checkHtmlBlock1
    }
  ],
  parseInline: [rawHtmlFix]
};

/**
 * {@link commonMarkFixes} without the HTML block of the first kind, for a parser that reads HTML blocks its own way.
 */
export const commonMarkFixesWithoutHtmlBlock: MarkdownConfig = {
  parseBlock: [atxHeadingFix],
  parseInline: [rawHtmlFix]
};

/**
 * The labels of the link reference definitions in a tree, normalized as CommonMark compares them.
 *
 * @param tree - The tree.
 * @param text - The document the tree was parsed from.
 * @returns The labels.
 */
export function collectLinkReferenceLabels(tree: Tree, text: string): Set<string> {
  const labels = new Set<string>();
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'LinkReference') {
        return true;
      }
      const label = node.node.getChild('LinkLabel');
      if (label) {
        labels.add(normalizeIdentifier(text.slice(label.from + 1, label.to - 1).replaceAll(LABEL_LINE_BREAK_RE, ' ')));
      }
      return false;
    }
  });
  return labels;
}

/**
 * Whether text opens with an autolink as CommonMark reads it.
 *
 * @param text - The text, from its `<`.
 * @returns Whether it does.
 */
export function isCommonMarkAutolink(text: string): boolean {
  return URI_AUTOLINK_RE.test(text) || EMAIL_AUTOLINK_RE.test(text);
}

/**
 * Makes link references links only when their label is defined: a `[text]`, `[text][]` or `[text][label]` whose label
 * is not among `labels` stays text, with its brackets.
 *
 * @param labels - The labels the document defines, normalized as CommonMark compares them (see
 *   {@link collectLinkReferenceLabels}).
 * @returns The extension.
 */
export function linkReferenceCheck(labels: ReadonlySet<string>): MarkdownConfig {
  return {
    parseInline: [{
      before: 'LinkEnd',
      name: 'LinkReferenceCheck',
      parse: (cx, next, start): number => resolveLinkReference(cx, next, start, labels)
    }]
  };
}

/**
 * Parses a whole document with link references checked: once to find the labels it defines, and again with
 * {@link linkReferenceCheck}.
 *
 * @param parser - The parser.
 * @param text - The document.
 * @returns The tree.
 */
export function parseWithLinkReferences(parser: MarkdownParser, text: string): Tree {
  const labels = collectLinkReferenceLabels(parser.parse(text), text);
  return parser.configure(linkReferenceCheck(labels)).parse(text);
}

function atxTabHeadingSize(line: Line): number {
  if (line.next !== Char.Hash || line.indent - line.baseIndent >= CODE_INDENT) {
    return 0;
  }
  let pos = line.pos;
  while (line.text.codePointAt(pos) === Char.Hash) {
    pos++;
  }
  const size = pos - line.pos;
  return size <= MAX_HEADING_LEVEL && line.text.codePointAt(pos) === Char.Tab ? size : 0;
}

function checkAtxTabHeading(cx: BlockContext, line: Line): boolean {
  const size = atxTabHeadingSize(line);
  if (size === 0) {
    return false;
  }
  const off = line.pos;
  const from = cx.lineStart + off;
  const text = line.text;
  let endOfSpace = text.length;
  while (endOfSpace > off && isSpaceOrTab(text.codePointAt(endOfSpace - 1))) {
    endOfSpace--;
  }
  let after = endOfSpace;
  while (after > off && text.codePointAt(after - 1) === Char.Hash) {
    after--;
  }
  if (after === endOfSpace || after === off || !isSpaceOrTab(text.codePointAt(after - 1))) {
    after = text.length;
  }
  const children: Element[] = [
    cx.elt('HeaderMark', from, from + size),
    ...cx.parser.parseInline(text.slice(off + size + 1, after), from + size + 1)
  ];
  if (after < text.length) {
    children.push(cx.elt('HeaderMark', cx.lineStart + after, cx.lineStart + endOfSpace));
  }
  const to = cx.lineStart + text.length;
  cx.nextLine();
  cx.addElement(cx.elt(`ATXHeading${String(size)}`, from, to, children));
  return true;
}

function checkHtmlBlock1(cx: BlockContext, line: Line): boolean {
  if (!isHtmlBlock1Start(line)) {
    return false;
  }
  const from = cx.lineStart + line.pos;
  const marks: Element[] = [];
  let isClosed = HTML_BLOCK_1_END_RE.test(line.text);
  while (!isClosed && cx.nextLine() && line.depth >= cx.depth) {
    marks.push(...line.markers);
    isClosed = HTML_BLOCK_1_END_RE.test(line.text);
  }
  if (isClosed) {
    cx.nextLine();
  }
  cx.addElement(cx.elt('HTMLBlock', from, cx.prevLineEnd(), marks));
  return true;
}

function codeOf(ch: string): number {
  return ch.codePointAt(0) ?? -1;
}

function hasInlineParts(cx: InlineContext): cx is InlineContext & InlineParts {
  return 'parts' in cx && Array.isArray(cx.parts);
}

function isHtmlBlock1Start(line: Line): boolean {
  return line.next === Char.LessThan && line.indent - line.baseIndent < CODE_INDENT && HTML_BLOCK_1_START_RE.test(line.text.slice(line.pos));
}

// Whether `text`, which starts with `(`, is the rest of an inline link: a destination and a title, both optional.
function isInlineLinkTail(text: string): boolean {
  let pos = skipLinkWhitespace(text, 1);
  if (text[pos] === ')') {
    return true;
  }
  const rest = text.slice(pos);
  const destinationLength = rest.startsWith('<') ? POINTY_DESTINATION_RE.exec(rest)?.[0].length ?? 0 : plainDestinationLength(rest);
  if (destinationLength === 0) {
    return false;
  }
  const destinationEnd = pos + destinationLength;
  pos = skipLinkWhitespace(text, destinationEnd);
  if (pos > destinationEnd && text[pos] !== ')') {
    const title = TITLE_RE.exec(text.slice(pos))?.[0];
    if (title === undefined || BLANK_LINE_RE.test(title)) {
      return false;
    }
    pos = skipLinkWhitespace(text, pos + title.length);
  }
  return text[pos] === ')';
}

function isSpaceOrTab(code: number | undefined): boolean {
  return code === Char.Space || code === Char.Tab;
}

/*
 * Raw inline HTML as CommonMark 0.31.2 reads it. An autolink is left to `@lezer/markdown`'s own parser, and a `<` that
 * opens neither is text.
 */
function parseRawHtml(cx: InlineContext, next: number, start: number): number {
  if (next !== Char.LessThan) {
    return -1;
  }
  const text = cx.slice(start, cx.end);
  if (isCommonMarkAutolink(text)) {
    return -1;
  }
  const comment = COMMENT_RE.exec(text);
  if (comment) {
    return cx.addElement(cx.elt('Comment', start, start + comment[0].length));
  }
  const instruction = PROCESSING_INSTRUCTION_RE.exec(text);
  if (instruction) {
    return cx.addElement(cx.elt('ProcessingInstruction', start, start + instruction[0].length));
  }
  const tag = OPEN_TAG_RE.exec(text) ?? CLOSE_TAG_RE.exec(text) ?? DECLARATION_RE.exec(text) ?? CDATA_RE.exec(text);
  return tag ? cx.addElement(cx.elt('HTMLTag', start, start + tag[0].length)) : start + 1;
}

function pieceAt(text: string, pos: number): string | undefined {
  DESTINATION_PIECE_RE.lastIndex = pos;
  return DESTINATION_PIECE_RE.exec(text)?.[0];
}

// The length of a destination not in pointy brackets at the start of `text`, or 0 when there is none: its parentheses
// must balance, and an unbalanced `)` ends it.
function plainDestinationLength(text: string): number {
  let pos = 0;
  let depth = 0;
  let piece = pieceAt(text, pos);
  while (piece !== undefined && !(piece === ')' && depth === 0)) {
    depth += PARENTHESIS_DEPTH[piece] ?? 0;
    pos += piece.length;
    piece = pieceAt(text, pos);
  }
  return depth === 0 ? pos : 0;
}

/*
 * The link a `]` closes, as CommonMark reads it: an inline link when a valid destination follows, else a reference
 * whose label must be defined. Only an undefined reference is handled here. Its opening bracket is dropped and the `]`
 * is text, as `@lezer/markdown` itself does with a bracket that opens no link. Everything else is left to its link
 * parser.
 */
function resolveLinkReference(cx: InlineContext, next: number, start: number, labels: ReadonlySet<string>): number {
  if (next !== Char.CloseBracket || !hasInlineParts(cx)) {
    return -1;
  }
  const linkIndex = cx.findOpeningDelimiter(InlineContextClass.linkStart);
  const imageIndex = cx.findOpeningDelimiter(InlineContextClass.imageStart);
  const index = Math.max(linkIndex ?? -1, imageIndex ?? -1);
  const opener = cx.getDelimiterAt(index);
  if (!opener) {
    return -1;
  }
  const after = cx.slice(start + 1, cx.end);
  if (after.startsWith('(') && isInlineLinkTail(after)) {
    return -1;
  }
  const fullLabel = LINK_LABEL_RE.exec(after)?.[0] ?? '';
  const label = fullLabel.length > BRACKETS_SIZE ? fullLabel.slice(1, -1) : cx.slice(opener.to, start);
  if (labels.has(normalizeIdentifier(label))) {
    return -1;
  }
  cx.parts[index] = null;
  return start + 1;
}

// Skips spaces and tabs, and at most one line ending among them.
function skipLinkWhitespace(text: string, from: number): number {
  return from + (LINK_WHITESPACE_RE.exec(text.slice(from))?.[0].length ?? 0);
}
