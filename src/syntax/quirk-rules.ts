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
 * Whether text that starts with `<!--` starts with an HTML comment Obsidian reads.
 *
 * @param text - The text, from its `<`.
 * @returns Whether it opens with a comment.
 */
export function isObsidianHtmlComment(text: string): boolean {
  return OBSIDIAN_COMMENT_RE.test(text);
}

/**
 * The character reference at the start of the text, as Obsidian reads it in inline content: a numeric reference takes
 * any number of digits, and its `;` is optional; a named reference ends with a `;` and a name HTML defines, or, without
 * the `;`, with the longest of HTML's legacy names it starts with. A numeric reference to a surrogate or past the last
 * code point is U+FFFD, and one to a code point HTML replaces is its replacement.
 *
 * @param text - The text, from its `&`.
 * @returns The reference, or `null` for an `&` that opens none.
 */
export function matchObsidianCharacterReference(text: string): null | ObsidianCharacterReference {
  const next = text.charAt(1);
  if (next === '' || NOT_AFTER_AMPERSAND.has(next)) {
    return null;
  }
  if (next === '#') {
    const isHexadecimal = text.charAt(NUMERIC_OPEN_LENGTH).toLowerCase() === 'x';
    const from = isHexadecimal ? HEXADECIMAL_OPEN_LENGTH : NUMERIC_OPEN_LENGTH;
    const digits = (isHexadecimal ? HEXADECIMAL_RE : DECIMAL_RE).exec(text.slice(from))?.[0] ?? '';
    if (digits === '') {
      return null;
    }
    const end = from + digits.length;
    return {
      length: text.charAt(end) === ';' ? end + 1 : end,
      value: numericReferenceValue(Number.parseInt(digits, isHexadecimal ? HEXADECIMAL : DECIMAL))
    };
  }
  const name = NAME_RE.exec(text.slice(1))?.[0] ?? '';
  const named = text.charAt(name.length + 1) === ';' && decodeNamedCharacterReference(name);
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

function numericReferenceValue(code: number): string {
  return (code >= SURROGATE_FIRST && code <= SURROGATE_LAST) || code > MAX_CODE_POINT ? REPLACEMENT_CHARACTER : characterReferenceInvalid[code] ?? String.fromCodePoint(code);
}
