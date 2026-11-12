/**
 * @file
 *
 * The list construct of the `listItem` quirk: lists as Obsidian structures them (see `ObsidianQuirkFlags.listItem`),
 * with the tokens of micromark's own list construct, from which it is adapted under its MIT license (see
 * `THIRD-PARTY-NOTICES.md`). It differs in four places:
 *
 * - An ordered marker takes any number of digits.
 * - An item whose first line is empty has its content right after its marker, and a blank line after that line does not
 *   end it.
 * - A line indented more than four columns, but less than the item's content, continues the item.
 * - A marker of the same list indented less than the item's content opens the next item, however far it is indented.
 */

import type {
  Code,
  Construct,
  Effects,
  State,
  TokenizeContext,
  Tokenizer
} from 'micromark-util-types';

import {
  blankLine,
  thematicBreak
} from 'micromark-core-commonmark';
import { factorySpace } from 'micromark-factory-space';
import {
  asciiDigit,
  markdownLineEnding,
  markdownSpace
} from 'micromark-util-character';
import {
  codes,
  constants
} from 'micromark-util-symbol';

import type { StateResult } from './micromark-state.ts';

/**
 * The list construct of the `listItem` quirk, in place of micromark's `list`.
 */
export const obsidianList: Construct = {
  continuation: { tokenize: withContext(tokenizeListContinuation) },
  exit: tokenizeListEnd,
  name: 'obsidianList',
  tokenize: withContext(tokenizeListStart)
};

type ContextTokenizer = (context: TokenizeContext, effects: Effects, ok: State, nok: State) => State;

// An ordered marker with more digits than this interrupts no paragraph.
const MAX_INTERRUPTING_DIGITS = 1;
const BULLETS: ReadonlySet<Code> = new Set([codes.asterisk, codes.dash, codes.plusSign]);

const listItemPrefixWhitespaceConstruct: Construct = { partial: true, tokenize: withContext(tokenizeListItemPrefixWhitespace) };
const indentConstruct: Construct = { partial: true, tokenize: withContext(tokenizeIndent) };
const siblingMarkerConstruct: Construct = { partial: true, tokenize: withContext(tokenizeSiblingMarker) };

// Whether micromark reads indented code, which caps how far whitespace before a block may go.
function codeIndentLimit(context: TokenizeContext): null | number {
  return context.parser.constructs.disable.null?.includes('codeIndented') === true ? null : constants.tabSize;
}

function containerSize(context: TokenizeContext): number {
  return context.containerState?.size ?? 0;
}

// The columns of whitespace the last token of a tokenizer took, when it is of the given type.
function tailColumns(context: TokenizeContext, type: string): number {
  const tail = context.events.at(-1);
  if (!tail) {
    return 0;
  }
  const [, token, tokenizer] = tail;
  return token.type === type ? tokenizer.sliceSerialize(token, true).length : 0;
}

function tokenizeIndent(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const size = containerSize(context);
  return factorySpace(effects, afterPrefix, 'listItemIndent', size + 1);

  // The item's content, or more than four columns of whitespace short of it.
  function afterPrefix(code: Code): StateResult {
    const indent = tailColumns(context, 'listItemIndent');
    return indent === size || (indent > constants.tabSize && !markdownLineEnding(code) && code !== codes.eof) ? ok(code) : nok(code);
  }
}

function tokenizeListContinuation(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  if (context.containerState) {
    context.containerState._closeFlow = undefined;
  }
  return effects.check(blankLine, onBlank, notBlank);

  // A blank line never ends an item by itself, not even one whose first line is empty.
  function onBlank(code: Code): StateResult {
    return factorySpace(effects, ok, 'listItemIndent', containerSize(context) + 1)(code);
  }

  function notBlank(code: Code): StateResult {
    return markdownSpace(code) ? effects.check(siblingMarkerConstruct, notInCurrentItem, effects.attempt(indentConstruct, ok, notInCurrentItem))(code) : notInCurrentItem(code);
  }

  // A sibling item may be indented as far as the item's content, short of it.
  function notInCurrentItem(code: Code): StateResult {
    if (context.containerState) {
      context.containerState._closeFlow = true;
    }
    context.interrupt = undefined;
    return factorySpace(effects, effects.attempt(obsidianList, ok, nok), 'linePrefix', Math.max(containerSize(context), codeIndentLimit(context) ?? 0) || undefined)(code);
  }
}

function tokenizeListEnd(this: TokenizeContext, effects: Effects): undefined {
  const type = this.containerState?.type;
  if (type === 'listOrdered' || type === 'listUnordered') {
    effects.exit(type);
  }
}

function tokenizeListItemPrefixWhitespace(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const limit = codeIndentLimit(context);
  return factorySpace(effects, afterPrefix, 'listItemPrefixWhitespace', limit === null ? undefined : limit + 1);

  function afterPrefix(code: Code): StateResult {
    return !markdownSpace(code) && tailColumns(context, 'listItemPrefixWhitespace') > 0 ? ok(code) : nok(code);
  }
}

function tokenizeListStart(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const initialSize = tailColumns(context, 'linePrefix');
  let size = 0;
  return start;

  function start(code: Code): StateResult {
    const state = context.containerState;
    if (!state) {
      return nok(code);
    }
    const kind = state.type ?? (BULLETS.has(code) ? 'listUnordered' : 'listOrdered');
    const isMarker = kind === 'listUnordered' ? state.marker === undefined || code === state.marker : asciiDigit(code);
    if (!isMarker) {
      return nok(code);
    }
    if (!state.type) {
      state.type = kind;
      effects.enter(kind, { _container: true });
    }
    if (kind === 'listUnordered') {
      effects.enter('listItemPrefix');
      return code === codes.asterisk || code === codes.dash ? effects.check(thematicBreak, nok, atMarker)(code) : atMarker(code);
    }
    if (context.interrupt === true && code !== codes.digit1) {
      return nok(code);
    }
    effects.enter('listItemPrefix');
    effects.enter('listItemValue');
    return inside(code);
  }

  // Any number of digits.
  function inside(code: Code): StateResult {
    if (asciiDigit(code)) {
      size++;
      effects.consume(code);
      return inside;
    }
    const marker = context.containerState?.marker;
    const isDelimiter = marker === undefined ? code === codes.rightParenthesis || code === codes.dot : code === marker;
    if (isDelimiter && (context.interrupt !== true || size <= MAX_INTERRUPTING_DIGITS)) {
      effects.exit('listItemValue');
      return atMarker(code);
    }
    return nok(code);
  }

  function atMarker(code: Code): StateResult {
    effects.enter('listItemMarker');
    effects.consume(code);
    effects.exit('listItemMarker');
    const state = context.containerState;
    if (state) {
      state.marker ??= code;
    }
    return effects.check(blankLine, context.interrupt === true ? nok : onBlank, effects.attempt(listItemPrefixWhitespaceConstruct, endOfPrefix, otherPrefix));
  }

  // An item whose first line is empty has its content right after its marker.
  function onBlank(code: Code): StateResult {
    return endOfPrefix(code);
  }

  function otherPrefix(code: Code): StateResult {
    if (markdownSpace(code)) {
      effects.enter('listItemPrefixWhitespace');
      effects.consume(code);
      effects.exit('listItemPrefixWhitespace');
      return endOfPrefix;
    }
    return nok(code);
  }

  function endOfPrefix(code: Code): StateResult {
    const prefix = effects.exit('listItemPrefix');
    if (context.containerState) {
      context.containerState.size = initialSize + context.sliceSerialize(prefix, true).length;
    }
    return ok(code);
  }
}

// After whitespace short of the item's content, a marker of the same list: the next item.
function tokenizeSiblingMarker(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const marker = context.containerState?.marker;
  const isOrdered = context.containerState?.type === 'listOrdered';
  let hasDigits = false;
  const size = containerSize(context);
  // With no column short of the content, there is no whitespace to take: one would be an empty token.
  return size > 1 ? factorySpace(effects, start, 'linePrefix', size) : start;

  function start(code: Code): StateResult {
    if (isOrdered) {
      return digits(code);
    }
    if (code !== marker) {
      return nok(code);
    }
    effects.enter('listItemMarker');
    effects.consume(code);
    effects.exit('listItemMarker');
    return afterMarker;
  }

  function digits(code: Code): StateResult {
    if (asciiDigit(code)) {
      if (!hasDigits) {
        effects.enter('listItemValue');
        hasDigits = true;
      }
      effects.consume(code);
      return digits;
    }
    if (!hasDigits || code !== marker) {
      return nok(code);
    }
    effects.exit('listItemValue');
    effects.enter('listItemMarker');
    effects.consume(code);
    effects.exit('listItemMarker');
    return afterMarker;
  }

  function afterMarker(code: Code): StateResult {
    return code === codes.eof || markdownLineEnding(code) || markdownSpace(code) ? ok(code) : nok(code);
  }
}

// Hands a tokenizer its context as a parameter.
function withContext(tokenize: ContextTokenizer): Tokenizer {
  return function tokenizeWithContext(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    return tokenize(this, effects, ok, nok);
  };
}
