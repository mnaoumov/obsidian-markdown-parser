/**
 * @file
 *
 * The rules of Obsidian's quirks that every adapter shares, on plain text: each adapter reads the text its own way and
 * asks these rules what Obsidian makes of it.
 */

import { characterEntitiesLegacy } from 'character-entities-legacy';
import { characterReferenceInvalid } from 'character-reference-invalid';
import { decodeNamedCharacterReference } from 'decode-named-character-reference';

/**
 * An autolink Obsidian reads: how much of the text it takes, the text it shows and where it links to, both before their
 * character references are decoded.
 */
export interface ObsidianAutolink {
  /**
   * Its length, from its `<`.
   */
  readonly length: number;

  /**
   * The text it shows. Its character references read as in inline content.
   */
  readonly text: string;

  /**
   * Where it links to. Its character references read as in a link destination.
   */
  readonly url: string;
}

/**
 * A character reference Obsidian reads: how much of the text it takes, and the text it stands for.
 */
export interface ObsidianCharacterReference {
  /**
   * Its length, from its `&`.
   */
  readonly length: number;

  /**
   * The text it stands for.
   */
  readonly value: string;
}

/**
 * A link reference definition Obsidian reads: the ranges of its parts, from the start of its text.
 */
export interface ObsidianDefinition {
  /**
   * Its destination, with its `<` and `>` when it has them.
   */
  readonly destination: TextSpan;

  /**
   * Its label, with its brackets.
   */
  readonly label: TextSpan;

  /**
   * Its length: it ends at the end of its last line, after any spaces and tabs there.
   */
  readonly length: number;

  /**
   * Its title, with its quotes or parentheses, or `null` for none.
   */
  readonly title: null | TextSpan;
}

/**
 * What {@link parseObsidianDefinition} found: a definition, none, or one that the text after it could still extend or
 * spoil.
 */
export type ObsidianDefinitionParse = 'pending' | null | ObsidianDefinition;

/**
 * A kind of HTML block Obsidian reads: what its first line starts with, what ends it, and whether it can interrupt a
 * paragraph.
 */
export interface ObsidianHtmlBlockKind {
  /**
   * Whether it can interrupt a paragraph.
   */
  readonly canInterrupt: boolean;

  /**
   * What ends it: a line that holds this, which is the block's last line, or `null` for an empty line, which is not.
   */
  readonly end: null | RegExp;

  /**
   * Whether it is a comment, a processing instruction or another kind of HTML.
   */
  readonly type: 'comment' | 'html' | 'processingInstruction';
}

/**
 * How a table column is aligned: `null` for no alignment.
 */
export type ObsidianTableAlignment = 'center' | 'left' | 'right' | null;

/**
 * A range of text.
 */
export interface TextSpan {
  /**
   * Where it starts.
   */
  readonly from: number;

  /**
   * Where it ends.
   */
  readonly to: number;
}

// A delimiter row being read: the cell so far, `false` before its first `-` or `:`, and the cells before it.
interface AlignmentScan {
  alignment: false | ObsidianTableAlignment;
  readonly alignments: ObsidianTableAlignment[];
  hasDash: boolean;
  isFirstPipe: boolean;
}

/**
 * What opens an HTML comment.
 */
export const COMMENT_OPEN = '<!--';

const LEGACY_NAMES: ReadonlySet<string> = new Set(characterEntitiesLegacy);
// What cannot follow the `&` of a character reference.
const NOT_AFTER_AMPERSAND = new Set(['\t', '\n', '\f', ' ', '&', '<']);
const NAME_RE = /^[\dA-Za-z]*/u;
const DECIMAL_RE = /^\d*/u;
const HEXADECIMAL_RE = /^[\dA-Fa-f]*/u;
const DECIMAL = 10;
const HEXADECIMAL = 16;
const MAX_CODE_POINT = 0x10_FF_FF;
const SURROGATE_FIRST = 0xD8_00;
const SURROGATE_LAST = 0xDF_FF;
const REPLACEMENT_CHARACTER = '�';
// The `&#` before a numeric reference's digits, and the `&#x` before a hexadecimal one's.
const NUMERIC_OPEN_LENGTH = 2;
const HEXADECIMAL_OPEN_LENGTH = 3;
// The `&` and the `;` around a name.
const AMPERSAND_AND_SEMICOLON = 2;

// A definition's empty label, and its empty pointy destination.
const LABEL_BRACKETS = 2;
const DESTINATION_BRACKETS = 2;
const ENCLOSED_DESTINATION_STOPS = new Set(['[', ']', '>']);
// What a part of a definition that the text ends inside gives.
const PENDING = -2;
const RAW_DESTINATION_STOP_RE = /[\s[\]]/u;
const DEFINITION_WHITESPACE = new Set(['\t', '\n', ' ']);
const TITLE_CLOSERS: Readonly<Record<string, string>> = { '\'': '\'', '"': '"', '(': ')' };

const MAILTO = 'mailto:';
const WHITESPACE_RE = /\s/u;
// A scheme up to its `://`, or an email address's local part up to its `@`, then the rest up to the `>`. What comes
// before either holds no `@` and no `:/`.
const AUTOLINK_RE = /^<(?<link>(?:[^\s:>@]|:(?!\/))+(?:(?<at>@)[^\s>]+|:\/\/[^\s>]*))>/u;

// The tags of the sixth kind of HTML block, as Obsidian reads them: CommonMark 0.31.2's, without `search`, and with `hgroup`,
// `meta`, `pre` and `source`.
const OBSIDIAN_BLOCK_TAGS = [
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'meta',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'pre',
  'section',
  'source',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul'
];
const ATTRIBUTE = String.raw`(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^"'<=>\x60\0- ]+|'[^']*'|"[^"]*"))?)`;
const OPEN_OR_CLOSE_TAG_LINE_RE = new RegExp(String.raw`^(?:<[A-Za-z][\dA-Za-z-]*${ATTRIBUTE}*\s*\/?>|<\/[A-Za-z][\dA-Za-z-]*\s*>)\s*$`, 'u');
const HTML_BLOCK_KINDS: readonly (readonly [RegExp, ObsidianHtmlBlockKind])[] = [
  [/^<(?:script|pre|style)(?=\s|>|$)/iu, { canInterrupt: true, end: /<\/(?:script|pre|style)>/iu, type: 'html' }],
  [/^<!--/u, { canInterrupt: true, end: /-->/u, type: 'comment' }],
  [/^<\?/u, { canInterrupt: true, end: /\?>/u, type: 'processingInstruction' }],
  [/^<![A-Za-z]/u, { canInterrupt: true, end: />/u, type: 'html' }],
  [/^<!\[CDATA\[/u, { canInterrupt: true, end: /\]\]>/u, type: 'html' }],
  [new RegExp(String.raw`^<\/?(?:${OBSIDIAN_BLOCK_TAGS.join('|')})(?=\s|\/?>|$)`, 'iu'), { canInterrupt: true, end: null, type: 'html' }],
  [OPEN_OR_CLOSE_TAG_LINE_RE, { canInterrupt: false, end: null, type: 'html' }]
];

// CommonMark 0.30's comment: text that does not start with `>` or `->`, does not end with `-` and holds no `--`.
const OBSIDIAN_COMMENT_RE = /^<!--(?:-?[^>-])(?:-?[^-])*-->|^<!---->/u;

/**
 * Decodes the character references in text as Obsidian reads them (see {@link matchObsidianCharacterReference}).
 *
 * @param text - The text.
 * @param requiresSemicolon - Whether a reference needs its `;`, as in a link destination.
 * @returns The text with each reference replaced by the text it stands for.
 */
export function decodeObsidianCharacterReferences(text: string, requiresSemicolon = false): string {
  let result = '';
  let pos = 0;
  for (let index = text.indexOf('&'); index !== -1; index = text.indexOf('&', pos)) {
    const reference = matchObsidianCharacterReference(text.slice(index), requiresSemicolon);
    result += text.slice(pos, index) + (reference?.value ?? '&');
    pos = index + (reference?.length ?? 1);
  }
  return result + text.slice(pos);
}

/**
 * Whether a line of a table starts with its pipe: Obsidian's rows agree with the header on this, and a row that does not
 * ends the table. Whitespace before the pipe is a start without it.
 *
 * @param line - The line, after the markup of its containers.
 * @returns Whether its first character is `|`.
 */
export function hasObsidianTableLeadingPipe(line: string): boolean {
  return line.startsWith('|');
}

/**
 * Whether text that starts with `<!--` starts with an HTML comment Obsidian reads.
 *
 * @param text - The text, from its `<`.
 * @returns Whether it opens with a comment.
 */
export function isObsidianHtmlComment(text: string): boolean {
  return OBSIDIAN_COMMENT_RE.test(text);
}

/**
 * Whether a line can be a row of an Obsidian table: it holds a `|` after its first character, escaped or not.
 *
 * @param line - The line, after the markup of its containers.
 * @returns Whether it can.
 */
export function isObsidianTableRow(line: string): boolean {
  return line.includes('|', 1);
}
/**
 * The autolink at the start of the text, as Obsidian reads it: a `<`, then either an address of non-whitespace with an
 * `@` in it, or a scheme of any characters but whitespace and `@` with `://` and more after it, then a `>`. An email
 * address links to `mailto:` and the address, and a `mailto:` address shows without its scheme.
 *
 * @param text - The text, from its `<`.
 * @returns The autolink, or `null` for a `<` that opens none.
 */
export function matchObsidianAutolink(text: string): null | ObsidianAutolink {
  const match = AUTOLINK_RE.exec(text);
  const link = match?.groups?.['link'];
  if (!match || link === undefined) {
    return null;
  }
  const isEmail = match.groups?.['at'] !== undefined;
  const hasMailto = isEmail && link.slice(0, MAILTO.length).toLowerCase() === MAILTO;
  return {
    length: match[0].length,
    text: hasMailto ? link.slice(MAILTO.length) : link,
    url: isEmail && !hasMailto ? MAILTO + link : link
  };
}

/**
 * The character reference at the start of the text, as Obsidian reads it in inline content: a numeric reference takes
 * any number of digits, and its `;` is optional; a named reference ends with a `;` and a name HTML defines, or, without
 * the `;`, with the longest of HTML's legacy names it starts with. A numeric reference to a surrogate or past the last
 * code point is U+FFFD, and one to a code point HTML replaces is its replacement.
 *
 * In a link destination, a reference needs its `;`: the digits or the name that follow its `&` end with one, though the
 * legacy name it takes may be shorter.
 *
 * @param text - The text, from its `&`.
 * @param requiresSemicolon - Whether the reference needs its `;`, as in a link destination.
 * @returns The reference, or `null` for an `&` that opens none.
 */
export function matchObsidianCharacterReference(text: string, requiresSemicolon = false): null | ObsidianCharacterReference {
  const next = text.charAt(1);
  if (next === '' || NOT_AFTER_AMPERSAND.has(next)) {
    return null;
  }
  return next === '#' ? matchNumericReference(text, requiresSemicolon) : matchNamedReference(text, requiresSemicolon);
}

/**
 * The kind of HTML block a line opens, as Obsidian reads it. Its first kind is `<script>`, `<pre>` and `<style>`, with
 * no `<textarea>`; its sixth kind takes Obsidian's own tags; and the sixth and seventh end at an empty line, not at a
 * line of whitespace.
 *
 * @param line - The line, from its first non-whitespace character.
 * @returns The kind, or `null` for a line that opens no HTML block.
 */
export function obsidianHtmlBlockKind(line: string): null | ObsidianHtmlBlockKind {
  return HTML_BLOCK_KINDS.find(([start]) => start.test(line))?.[1] ?? null;
}

/**
 * The alignments of an Obsidian table's delimiter row: cells of `-`, `:` and whitespace between pipes, with no empty
 * cell after the first pipe. A `:` alone aligns left, `:` after a `-` right, and a second `:` center.
 *
 * @param line - The line, after the markup of its containers.
 * @returns One alignment per column, or `null` for a line that is no delimiter row.
 */
export function obsidianTableAlignments(line: string): null | ObsidianTableAlignment[] {
  const scan: AlignmentScan = { alignment: false, alignments: [], hasDash: false, isFirstPipe: true };
  for (const char of line) {
    if (!canScanAlignmentChar(scan, char)) {
      return null;
    }
  }
  if (scan.alignment !== false) {
    scan.alignments.push(scan.alignment);
  }
  return scan.alignments.length > 0 ? scan.alignments : null;
}
/**
 * The cells of a row of an Obsidian table, as the ranges of their content, without the whitespace around it. Unescaped
 * pipes separate them. A row that starts with its pipe has no cell before it; one that does not has one, empty when
 * only whitespace comes before the first pipe. Nothing after the last pipe is no cell.
 *
 * @param line - The line, after the markup of its containers.
 * @returns The cells. An empty cell is an empty range at its closing pipe.
 */
export function obsidianTableCells(line: string): TextSpan[] {
  const cells: TextSpan[] = [];
  let isPreamble = hasObsidianTableLeadingPipe(line);
  let from = -1;
  let to = -1;
  for (let pos = 0; pos < line.length; pos++) {
    const char = line.charAt(pos);
    if (char === ' ' || char === '\t') {
      continue;
    }
    if (char === '|') {
      if (!isPreamble) {
        cells.push(from === -1 ? { from: pos, to: pos } : { from, to });
      }
      isPreamble = false;
      from = -1;
      continue;
    }
    isPreamble = false;
    if (from === -1) {
      from = pos;
    }
    if (char === '\\' && pos < line.length - 1) {
      pos++;
    }
    to = pos + 1;
  }
  if (from !== -1) {
    cells.push({ from, to });
  }
  return cells;
}

/**
 * The link reference definition at the start of the text, as Obsidian reads it. After up to any spaces and tabs come a
 * label in brackets, in which a backslash escapes the next character, then `:`, whitespace, and a destination: `<`,
 * characters but `<`, `>`, `[` and `]`, and a `>`, or characters but whitespace, `[` and `]`. Whitespace and a title may
 * follow: `"`, `'` or `(`, then text that has no blank line and starts no line with its closing `"`, `'` or `)`, which
 * ends it. Only spaces and tabs may follow on the definition's last line, or it is no definition at all.
 *
 * @param text - The text: a block's lines, joined by `\n`, without their containers' markup.
 * @param isEnd - Whether the text is all of the block. When it is not, a definition that the next line could still
 *   extend or spoil is `'pending'`.
 * @returns The definition, `null` for none, or `'pending'`.
 */
export function parseObsidianDefinition(text: string, isEnd: boolean): ObsidianDefinitionParse {
  const atEnd = isEnd ? null : 'pending';
  const labelFrom = skipSpacesAndTabs(text, 0);
  if (text.charAt(labelFrom) !== '[') {
    return null;
  }
  const labelTo = definitionLabelEnd(text, labelFrom + 1);
  if (labelTo === -1) {
    return atEnd;
  }
  if (labelTo === labelFrom + LABEL_BRACKETS || text.charAt(labelTo) !== ':') {
    return null;
  }
  const destinationFrom = skipWhitespace(text, labelTo + 1);
  if (destinationFrom >= text.length) {
    return atEnd;
  }
  const destinationTo = definitionDestinationEnd(text, destinationFrom);
  if (destinationTo === PENDING) {
    return atEnd;
  }
  if (destinationTo === -1) {
    return null;
  }
  const label = { from: labelFrom, to: labelTo };
  // An empty `<>` before a destination is no part of it.
  const destination = { from: text.startsWith('<>', destinationFrom) ? destinationFrom + DESTINATION_BRACKETS : destinationFrom, to: destinationTo };
  const titleFrom = skipWhitespace(text, destinationTo);
  const closer = TITLE_CLOSERS[text.charAt(titleFrom)];
  // Past the end of the text there is no title either.
  if (closer === undefined) {
    const end = skipSpacesAndTabs(text, destinationTo);
    if (end >= text.length) {
      return isEnd ? { destination, label, length: end, title: null } : 'pending';
    }
    return text.charAt(end) === '\n' ? { destination, label, length: end, title: null } : null;
  }
  if (titleFrom === destinationTo) {
    return null;
  }
  const titleTo = definitionTitleEnd(text, titleFrom + 1, closer);
  if (titleTo === -1) {
    return atEnd;
  }
  if (titleTo === 0) {
    return null;
  }
  const end = skipSpacesAndTabs(text, titleTo);
  const definition = { destination, label, length: end, title: { from: titleFrom, to: titleTo } };
  if (end >= text.length) {
    return isEnd ? definition : 'pending';
  }
  return text.charAt(end) === '\n' ? definition : null;
}

// Reads one character of a delimiter row, and whether the row can still be one.
function canScanAlignmentChar(scan: AlignmentScan, char: string): boolean {
  if (char === '|') {
    if (scan.alignment === false && !scan.isFirstPipe) {
      return false;
    }
    if (scan.alignment !== false) {
      scan.alignments.push(scan.alignment);
    }
    scan.alignment = false;
    scan.hasDash = false;
    scan.isFirstPipe = false;
    return true;
  }
  if (char === '-') {
    scan.hasDash = true;
    scan.alignment = scan.alignment === false ? null : scan.alignment;
    return true;
  }
  if (char === ':') {
    scan.alignment = nextAlignment(scan.alignment, scan.hasDash);
    return true;
  }
  return WHITESPACE_RE.test(char);
}

// The end of a destination from its first character, -1 for none, or `PENDING` for one the text ends inside.
function definitionDestinationEnd(text: string, from: number): number {
  let pos = from;
  if (text.charAt(pos) === '<') {
    pos++;
    while (pos < text.length && !ENCLOSED_DESTINATION_STOPS.has(text.charAt(pos))) {
      pos++;
    }
    if (pos >= text.length) {
      return PENDING;
    }
    if (text.charAt(pos) !== '>') {
      return -1;
    }
    pos++;
    if (pos > from + DESTINATION_BRACKETS) {
      return pos;
    }
  }
  const rawFrom = pos;
  while (pos < text.length && !RAW_DESTINATION_STOP_RE.test(text.charAt(pos))) {
    pos++;
  }
  return pos > rawFrom ? pos : -1;
}

// The end of a label from after its `[`, after its `]`, or -1 when the text ends inside it.
function definitionLabelEnd(text: string, from: number): number {
  for (let pos = from; pos < text.length; pos++) {
    const char = text.charAt(pos);
    if (char === ']') {
      return pos + 1;
    }
    if (char === '\\') {
      pos++;
    }
  }
  return -1;
}

// The end of a title from after its opener, after its closer; 0 for none; or -1 when the text ends inside it.
function definitionTitleEnd(text: string, from: number, closer: string): number {
  for (let pos = from; pos < text.length; pos++) {
    const char = text.charAt(pos);
    if (char === closer) {
      return pos + 1;
    }
    if (char !== '\n') {
      continue;
    }
    // The character after a line ending is the title's, whatever it is, but a blank line or a closer there spoils it.
    pos++;
    if (pos >= text.length) {
      return -1;
    }
    const next = text.charAt(pos);
    if (next === '\n' || next === closer) {
      return 0;
    }
  }
  return -1;
}

function matchNamedReference(text: string, requiresSemicolon: boolean): null | ObsidianCharacterReference {
  const name = NAME_RE.exec(text.slice(1))?.[0] ?? '';
  const isTerminated = text.charAt(name.length + 1) === ';';
  if (requiresSemicolon && !isTerminated) {
    return null;
  }
  const named = isTerminated && decodeNamedCharacterReference(name);
  if (named !== false) {
    return { length: name.length + AMPERSAND_AND_SEMICOLON, value: named };
  }
  for (let size = name.length; size > 0; size--) {
    const legacy = name.slice(0, size);
    const value = LEGACY_NAMES.has(legacy) && decodeNamedCharacterReference(legacy);
    if (value !== false) {
      return { length: size + 1, value };
    }
  }
  return null;
}

function matchNumericReference(text: string, requiresSemicolon: boolean): null | ObsidianCharacterReference {
  const isHexadecimal = text.charAt(NUMERIC_OPEN_LENGTH).toLowerCase() === 'x';
  const from = isHexadecimal ? HEXADECIMAL_OPEN_LENGTH : NUMERIC_OPEN_LENGTH;
  const digits = (isHexadecimal ? HEXADECIMAL_RE : DECIMAL_RE).exec(text.slice(from))?.[0] ?? '';
  const end = from + digits.length;
  const isTerminated = text.charAt(end) === ';';
  if (digits === '' || (requiresSemicolon && !isTerminated)) {
    return null;
  }
  return {
    length: isTerminated ? end + 1 : end,
    value: numericReferenceValue(Number.parseInt(digits, isHexadecimal ? HEXADECIMAL : DECIMAL))
  };
}

function nextAlignment(alignment: false | ObsidianTableAlignment, hasDash: boolean): ObsidianTableAlignment {
  if (alignment === 'left') {
    return 'center';
  }
  return hasDash && alignment === null ? 'right' : 'left';
}

function numericReferenceValue(code: number): string {
  return (code >= SURROGATE_FIRST && code <= SURROGATE_LAST) || code > MAX_CODE_POINT ? REPLACEMENT_CHARACTER : characterReferenceInvalid[code] ?? String.fromCodePoint(code);
}

function skipSpacesAndTabs(text: string, from: number): number {
  let pos = from;
  while (text.charAt(pos) === ' ' || text.charAt(pos) === '\t') {
    pos++;
  }
  return pos;
}

function skipWhitespace(text: string, from: number): number {
  let pos = from;
  while (pos < text.length && DEFINITION_WHITESPACE.has(text.charAt(pos))) {
    pos++;
  }
  return pos;
}
