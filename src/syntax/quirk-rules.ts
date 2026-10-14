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

const MAILTO = 'mailto:';
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
 * Whether text that starts with `<!--` starts with an HTML comment Obsidian reads.
 *
 * @param text - The text, from its `<`.
 * @returns Whether it opens with a comment.
 */
export function isObsidianHtmlComment(text: string): boolean {
  return OBSIDIAN_COMMENT_RE.test(text);
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

function numericReferenceValue(code: number): string {
  return (code >= SURROGATE_FIRST && code <= SURROGATE_LAST) || code > MAX_CODE_POINT ? REPLACEMENT_CHARACTER : characterReferenceInvalid[code] ?? String.fromCodePoint(code);
}
