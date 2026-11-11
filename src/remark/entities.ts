/**
 * @file
 *
 * Character reference decoding as `remark-parse` 8 does it: a TypeScript port of `parse-entities` 2.0.0 (MIT, Titus
 * Wormer), with the position tracking the parser's text nodes need. Warnings are dropped, as nothing reads them.
 *
 * The port keeps one behaviour of the original on purpose, because Obsidian's parser has it: a reference that is not
 * one (unterminated where `nonTerminated` is off, or `&` with no name) reuses the last reference decoded before it in
 * the same value, so `&amp; &foo` in a link destination decodes to `& &`.
 */

/* eslint-disable complexity, no-magic-numbers, unicorn/consistent-boolean-name, unicorn/no-break-in-nested-loop, unicorn/prefer-code-point, unicorn/prefer-continue, unicorn/prefer-early-return -- A line-for-line port: its control flow, names and UTF-16 code units stay as upstream wrote them. */

import { characterEntitiesLegacy } from 'character-entities-legacy';
import { characterReferenceInvalid } from 'character-reference-invalid';
import { decodeNamedCharacterReference } from 'decode-named-character-reference';

import type { RemarkPoint } from './types.ts';

/**
 * The options of {@link decodeEntities}.
 */
export interface DecodeEntitiesOptions {
  /**
   * The column each line after the first starts at.
   */
  readonly indent?: readonly number[];

  /**
   * Whether a reference without its `;` is decoded.
   *
   * @default true
   */
  readonly nonTerminated?: boolean;

  /**
   * Called with each decoded reference, its range, and its source.
   */
  readonly onReference?: (value: string, range: EntityRange, source: string) => void;

  /**
   * Called with each run of text between references, and its range.
   */
  readonly onText?: (value: string, range: EntityRange) => void;

  /**
   * Where the value starts.
   */
  readonly start?: RemarkPoint;
}

/**
 * The range of a run of text or a reference.
 */
export interface EntityRange {
  /**
   * The end.
   */
  readonly end: RemarkPoint;

  /**
   * The start.
   */
  readonly start: RemarkPoint;
}

type ReferenceType = 'decimal' | 'hexadecimal' | 'named';

const TAB = 9;
const LINE_FEED = 10;
const FORM_FEED = 12;
const SPACE = 32;
const AMPERSAND = 38;
const SEMICOLON = 59;
const LESS_THAN = 60;
const NUMBER_SIGN = 35;
const UPPERCASE_X = 88;
const LOWERCASE_X = 120;
const REPLACEMENT_CHARACTER = 65_533;

const LEGACY: ReadonlySet<string> = new Set(characterEntitiesLegacy);
const INVALID: Readonly<Record<number, string>> = characterReferenceInvalid;
const BASES: Readonly<Record<Exclude<ReferenceType, 'named'>, number>> = { decimal: 10, hexadecimal: 16 };
const TESTS: Readonly<Record<ReferenceType, (code: number) => boolean>> = {
  decimal: isDecimal,
  hexadecimal: isHexadecimal,
  named: isAlphanumerical
};

/**
 * Decodes the character references in a value.
 *
 * @param value - The value.
 * @param options - Where it is, and what to call with each run of text and each reference.
 * @returns The decoded value.
 */
export function decodeEntities(value: string, options: DecodeEntitiesOptions = {}): string {
  const nonTerminated = options.nonTerminated ?? true;
  const indent = options.indent ?? [];
  const startOffset = options.start?.offset ?? 0;
  let length = value.length;
  let index = 0;
  let lines = -1;
  let column = options.start?.column ?? 1;
  let line = options.start?.line ?? 1;
  // The text since the last reference is always `value.slice(queueStart, index)`, so it is sliced once rather than built
  // a character at a time.
  let queueStart = 0;
  const result: string[] = [];
  let character = NaN;
  // Kept across references on purpose: see the file comment.
  let reference: null | string = null;
  let previous = now();

  // Walk over the first character and the end, inclusive.
  index--;
  length++;

  while (++index < length) {
    if (character === LINE_FEED) {
      column = indent[lines] ?? 1;
    }

    character = value.charCodeAt(index);

    if (character === AMPERSAND) {
      let following = value.charCodeAt(index + 1);

      if (
        following === TAB
        || following === LINE_FEED
        || following === FORM_FEED
        || following === SPACE
        || following === AMPERSAND
        || following === LESS_THAN
        || Number.isNaN(following)
      ) {
        // Not a character reference: nothing is consumed.
        column++;
        continue;
      }

      const start = index + 1;
      let begin = start;
      let end = start;
      let type: ReferenceType;

      if (following === NUMBER_SIGN) {
        end = ++begin;
        following = value.charCodeAt(end);

        if (following === UPPERCASE_X || following === LOWERCASE_X) {
          type = 'hexadecimal';
          end = ++begin;
        } else {
          type = 'decimal';
        }
      } else {
        type = 'named';
      }

      let entityCharacters = '';
      let entity: false | null | string = '';
      let characters = '';
      const test = TESTS[type];
      end--;

      while (++end < length) {
        following = value.charCodeAt(end);

        if (!test(following)) {
          break;
        }

        characters += String.fromCharCode(following);

        // The last legacy name matched so far, so nothing has to walk back later.
        if (type === 'named' && LEGACY.has(characters)) {
          entityCharacters = characters;
          entity = decodeNamedCharacterReference(characters);
        }
      }

      const terminated = value.charCodeAt(end) === SEMICOLON;

      if (terminated) {
        end++;

        const namedEntity = type === 'named' && decodeNamedCharacterReference(characters);

        if (namedEntity) {
          entityCharacters = characters;
          entity = namedEntity;
        }
      }

      if (!terminated && !nonTerminated) {
        // Empty.
      } else if (!characters) {
        // An empty reference: nothing.
      } else if (type === 'named') {
        // Something after a known name caps the reference.
        if (entityCharacters !== characters && (!terminated || entity)) {
          end = begin + entityCharacters.length;
        }

        reference = entity || null;
      } else {
        const code = Number.parseInt(characters, BASES[type]);

        if (isProhibited(code)) {
          reference = String.fromCharCode(REPLACEMENT_CHARACTER);
        } else if (Object.hasOwn(INVALID, code)) {
          reference = INVALID[code] ?? null;
        } else {
          reference = String.fromCodePoint(code);
        }
      }

      if (reference) {
        flush();

        previous = now();
        index = end - 1;
        queueStart = end;
        column += end - start + 1;
        result.push(reference);
        const next = now();
        next.offset++;

        options.onReference?.(reference, { end: next, start: previous }, value.slice(start - 1, end));

        previous = next;
      } else {
        // Not a reference: the characters checked are text, and hold no line feed and no ampersand.
        column += end - start + 1;
        index = end - 1;
      }
    } else {
      if (character === LINE_FEED) {
        line++;
        lines++;
        column = 0;
      }

      if (Number.isNaN(character)) {
        flush();
      } else {
        column++;
      }
    }
  }

  return result.join('');

  function now(): RemarkPoint {
    return { column, line, offset: index + startOffset };
  }

  function flush(): void {
    const queue = value.slice(queueStart, index);
    if (queue) {
      result.push(queue);
      options.onText?.(queue, { end: now(), start: previous });
    }
  }
}

function isAlphanumerical(code: number): boolean {
  return isDecimal(code) || (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

function isDecimal(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isHexadecimal(code: number): boolean {
  return (code >= 97 && code <= 102) || (code >= 65 && code <= 70) || isDecimal(code);
}

function isProhibited(code: number): boolean {
  return (code >= 0xD8_00 && code <= 0xDF_FF) || code > 0x10_FF_FF;
}

/* eslint-enable complexity, no-magic-numbers, unicorn/consistent-boolean-name, unicorn/no-break-in-nested-loop, unicorn/prefer-code-point, unicorn/prefer-continue, unicorn/prefer-early-return -- The port ends here. */
