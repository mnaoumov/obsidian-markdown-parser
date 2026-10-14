/**
 * @file
 *
 * Obsidian's quirks as micromark extensions: where Obsidian reads valid CommonMark differently (see `options.ts`).
 *
 * - `setextHeading: 'single-line'`: micromark's setext underline construct is disabled and wrapped by one that first
 *   checks Obsidian's rule, so an underline Obsidian does not read stays text, or is a thematic break.
 * - `emptyListItem: 'interrupts-paragraph'`: micromark's list construct is wrapped by one that lets an empty item open
 *   a list where it interrupts a paragraph, unless the line is the paragraph's setext underline.
 * - `softLineBreak: 'hard-break'`: a line ending inside inline content gets a `hardBreakTrailing` token before it, so
 *   the HTML compiler and `mdast-util-from-markdown` read it as a hard line break.
 * - `looseList: 'blank-line-anywhere'`: the HTML compiler decides whether a list is loose, from the events. A resolver
 *   marks each list the quirk makes loose, and {@link micromarkQuirksHtml} reads the mark. `parseMdast` applies the
 *   quirk to the mdast tree itself.
 *
 * The list handler of {@link micromarkQuirksHtml} is adapted from micromark's HTML compiler, under its MIT license (see
 * `THIRD-PARTY-NOTICES.md`).
 */

import type {
  Code,
  CompileContext,
  Construct,
  Effects,
  Event,
  Extension,
  HtmlExtension,
  State,
  Token,
  TokenizeContext,
  Tokenizer,
  TokenType
} from 'micromark-util-types';

import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { micromark } from 'micromark';
import {
  htmlFlow,
  htmlText,
  lineEnding,
  list,
  setextUnderline
} from 'micromark-core-commonmark';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import { encode } from 'micromark-util-encode';
import { sanitizeUri } from 'micromark-util-sanitize-uri';
import { codes } from 'micromark-util-symbol';

import type { ObsidianQuirkFlags } from './options.ts';
import type {
  ObsidianAutolink,
  ObsidianCharacterReference,
  ObsidianHtmlBlockKind
} from './quirk-rules.ts';

import {
  COMMENT_OPEN,
  decodeObsidianCharacterReferences,
  isObsidianHtmlComment,
  matchObsidianAutolink,
  matchObsidianCharacterReference,
  obsidianHtmlBlockKind
} from './quirk-rules.ts';

declare module 'micromark-util-types' {
  interface Token {
    /**
     * On an `obsidianAutolinkTarget`: what the autolink shows and where it links to, decoded.
     */
    _obsidianAutolink?: ObsidianLinkTarget | undefined;

    /**
     * On a list: whether the `looseList` quirk made it loose.
     */
    _obsidianLoose?: boolean;

    /**
     * On a character reference's value: the text it stands for, when the `characterReference` quirk read it.
     */
    _obsidianValue?: string | undefined;
  }

  interface TokenTypeMap {
    obsidianAutolinkTarget: 'obsidianAutolinkTarget';
  }
}

/**
 * What an autolink the `autolink` quirk read shows, and where it links to, with their character references decoded.
 */
export interface ObsidianLinkTarget {
  /**
   * The text it shows.
   */
  readonly text: string;

  /**
   * Where it links to.
   */
  readonly url: string;
}

type ContextTokenizer = (context: TokenizeContext, effects: Effects, ok: State, nok: State) => State;

// A list being scanned for a blank line followed by more of it.
interface LooseListScan {
  hasBlankLine: boolean;
  // How many quotes hold the list: a line with more quote prefixes has a quote of the list's own.
  readonly quoteDepth: number;
  readonly token: Token;
}

// The document's lines read so far by the loose list resolver.
interface LooseListsScan {
  hasItemMarker: boolean;
  readonly lists: LooseListScan[];
  quoteDepth: number;
  quotePrefixes: number;
}

const Char = {
  Asterisk: codeOf('*'),
  CloseParen: codeOf(')'),
  Dash: codeOf('-'),
  Dot: codeOf('.'),
  Equals: codeOf('='),
  One: codeOf('1'),
  Plus: codeOf('+')
} as const;

// The token a lookahead consumes into, as `micromark.ts` names it. It never reaches the events.
const PEEK = 'ObsidianPeek';

const LINE_BREAK_RE = /\r\n|\r|\n/u;
const BLANK_LINE_RE = /^[\t ]*(?:\r\n|\r|\n)?$/u;
const DEFINITION_START_RE = /^ {0,3}\[/u;
const DIGIT_COUNT = 10;
const DECIMAL = 10;
const HEXADECIMAL = 16;
const DIGIT_CODES = Array.from({ length: DIGIT_COUNT }, (_, digit) => codeOf('0') + digit);
const BULLET_CODES: ReadonlySet<Code> = new Set([Char.Asterisk, Char.Dash, Char.Plus]);
const LIST_START_CODES = [Char.Asterisk, Char.Plus, Char.Dash, ...DIGIT_CODES];

const SPACE_OR_TAB_CODES: ReadonlySet<Code> = new Set([codes.horizontalTab, codes.space, codes.virtualSpace]);
const LINE_ENDING_CODES: ReadonlySet<Code> = new Set([codes.carriageReturn, codes.carriageReturnLineFeed, codes.lineFeed]);

// The line endings the soft line break construct read, which are the ones of inline content.
const softLineEndings = new WeakSet<Token>();

// The comment is decided at its first `-->` after the opener, or at the end of the content.
const COMMENT_MIN_LENGTH = COMMENT_OPEN.length + 1;
const COMMENT_CLOSE = '-->';
// What a character reference holds after its `&`, read ahead until anything else.
// The `<` and `>` around an autolink.
const AUTOLINK_MARKERS = 2;
const MAX_BMP_CODE_POINT = 0xFF_FF;
const SURROGATE_PAIR = 2;
// The schemes micromark links an autolink to unless dangerous protocols are allowed, as its HTML compiler does.
const PROTOCOL_HREF_RE = /^(?:https?|ircs?|mailto|xmpp)$/iu;
const CHARACTER_REFERENCE_CHAR_RE = /^[#;\dA-Za-z]$/u;

const bareUnderline: Construct = { partial: true, tokenize: tokenizeBareUnderline };
const emptyNextLine: Construct = { partial: true, tokenize: tokenizeEmptyNextLine };
const nextLineInContainers: Construct = { partial: true, tokenize: withContext(tokenizeNextLineInContainers) };
// Whether a `<` opens anything but a comment CommonMark 0.30 does not read.
const obsidianHtmlCommentAhead = scanAhead((text, next) => {
  if (text.length <= COMMENT_OPEN.length && !COMMENT_OPEN.startsWith(text)) {
    return true;
  }
  const isDecided = next === null || (text.length >= COMMENT_MIN_LENGTH && text.endsWith(COMMENT_CLOSE));
  return isDecided ? text.length < COMMENT_OPEN.length || isObsidianHtmlComment(text) : null;
});
const emptyListItemLine: Construct = { partial: true, tokenize: tokenizeEmptyListItemLine };

/**
 * The micromark syntax extension for the quirks asked for. The CommonMark behaviour of every quirk needs none.
 *
 * @param quirks - The quirks.
 * @returns The extension.
 */
export function createMicromarkQuirks(quirks: ObsidianQuirkFlags): Extension {
  const extension: Extension = {};
  const isSingleLine = quirks.setextHeading === 'single-line';
  if (isSingleLine) {
    const singleLineSetextUnderline: Construct = {
      ...setextUnderline,
      name: 'obsidianSingleLineSetextUnderline',
      tokenize: withContext(tokenizeSingleLineSetextUnderline)
    };
    extension.flow = { [Char.Dash]: singleLineSetextUnderline, [Char.Equals]: singleLineSetextUnderline };
    extension.disable = { null: ['setextUnderline'] };
  }
  const listStarts: Construct[] = [];
  if (quirks.emptyListItem === 'interrupts-paragraph') {
    listStarts.push({
      ...list,
      name: 'obsidianEmptyListItem',
      tokenize: withContext((context, effects, ok, nok) => tokenizeEmptyListItem(context, effects, ok, nok, isSingleLine))
    });
  }
  if (quirks.looseList === 'blank-line-anywhere') {
    // Starts every list micromark starts, so that its resolver sees the document's lists.
    listStarts.push({ ...list, name: 'obsidianLooseList', resolveAll: resolveLooseLists });
  }
  if (listStarts.length > 0) {
    extension.document = Object.fromEntries(LIST_START_CODES.map((code) => [code, listStarts]));
  }
  const text: Record<number, Construct[]> = {};
  const disabled: string[] = [];
  if (quirks.softLineBreak === 'hard-break') {
    const softLineBreak: Construct = {
      name: 'obsidianSoftLineBreak',
      resolveAll: resolveSoftLineBreaks,
      tokenize: withContext(tokenizeSoftLineBreak)
    };
    for (const code of [codes.carriageReturn, codes.carriageReturnLineFeed, codes.lineFeed]) {
      text[code] = [softLineBreak];
    }
  }
  if (quirks.htmlBlock === 'obsidian') {
    extension.flow = { ...extension.flow, [codes.lessThan]: { ...htmlFlow, name: 'obsidianHtmlFlow', tokenize: withContext(tokenizeObsidianHtmlFlow) } };
    disabled.push('htmlFlow');
  }
  if (quirks.characterReference === 'obsidian') {
    text[codes.ampersand] = [{ name: 'obsidianCharacterReference', tokenize: tokenizeObsidianCharacterReference }];
  }
  if (quirks.autolink === 'obsidian') {
    text[codes.lessThan] = [{ name: 'obsidianAutolink', tokenize: tokenizeObsidianAutolink }];
    disabled.push('autolink');
  }
  if (quirks.htmlComment === 'obsidian') {
    text[codes.lessThan] = [...text[codes.lessThan] ?? [], { ...htmlText, name: 'obsidianHtmlText', tokenize: withContext(tokenizeObsidianHtmlText) }];
    disabled.push('htmlText');
  }
  if (Object.keys(text).length > 0) {
    extension.text = text;
  }
  if (disabled.length > 0) {
    extension.disable = { null: [...extension.disable?.null ?? [], ...disabled] };
  }
  return extension;
}

/**
 * The micromark HTML extension for the quirks: a list the `looseList` quirk made loose renders loose. The compiler
 * decides whether a list is loose, so its list handlers are replaced by ones that also read the quirk's mark. Without
 * the quirk, it renders as the compiler does.
 */
export const micromarkQuirksHtml: HtmlExtension = {
  enter: {
    listOrdered: listEnterHandler('ol'),
    listUnordered: listEnterHandler('ul'),
    obsidianAutolinkTarget(this: CompileContext, token: Token): undefined {
      const target = token._obsidianAutolink;
      if (!target) {
        return;
      }

      this.tag(`<a href="${sanitizeUri(target.url, this.options.allowDangerousProtocol === true ? undefined : PROTOCOL_HREF_RE)}">`);
      this.raw(encode(target.text));
      this.tag('</a>');
    }
  },
  exit: {
    characterReferenceValue(this: CompileContext, token: Token): undefined {
      const type = this.getData('characterReferenceType');
      this.setData('characterReferenceType');
      const value = characterReferenceValue(this.sliceSerialize(token), type, token);
      this.raw(encode(value));
    }
  }
};

/**
 * The text a character reference's value token stands for: what the `characterReference` quirk read, or what micromark
 * decodes, as its HTML compiler and `mdast-util-from-markdown` do.
 *
 * @param source - The value's source.
 * @param markerType - The type of the marker before the value, for a numeric reference.
 * @param token - The value token.
 * @returns The text.
 */
export function characterReferenceValue(source: string, markerType: string | undefined, token: Token): string {
  if (token._obsidianValue !== undefined) {
    return token._obsidianValue;
  }
  if (markerType) {
    return decodeNumericCharacterReference(source, markerType === 'characterReferenceMarkerNumeric' ? DECIMAL : HEXADECIMAL);
  }
  const named = decodeNamedCharacterReference(source);
  return named === false ? source : named;
}

function codeOf(ch: string): number {
  return ch.codePointAt(0) ?? -1;
}

/*
 * The lines of content after the link reference definitions it opens with, found by rendering its first lines: a
 * document of nothing but definitions renders empty.
 */
function contentParagraphLines(content: string): number {
  const lines = content.split(LINE_BREAK_RE);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  if (lines.length <= 1 || !DEFINITION_START_RE.test(lines[0] ?? '')) {
    return lines.length;
  }
  for (let definitionLines = lines.length - 1; definitionLines > 0; definitionLines--) {
    if (micromark(lines.slice(0, definitionLines).join('\n')) === '') {
      return lines.length - definitionLines;
    }
  }
  return lines.length;
}

// Whether the line so far, in a container tokenizer's events, starts with whitespace.
function isIndented(context: TokenizeContext): boolean {
  const tail = context.events.at(-1);
  return tail?.[1].type === 'linePrefix' && tail[1].start.line === context.now().line;
}

function isLineEnding(code: Code): boolean {
  return LINE_ENDING_CODES.has(code);
}

// The compiler's own list handler, with the `looseList` quirk's mark read beside its own.
function listEnterHandler(tag: string): (this: CompileContext, token: Token) => undefined {
  return function onEnterList(this: CompileContext, token: Token): undefined {
    this.getData('tightStack').push(token._loose !== true && token._obsidianLoose !== true);
    this.lineEndingIfNeeded();
    this.tag(`<${tag}`);
    this.setData('expectFirstItem', true);
  };
}

/*
 * How many lines the last paragraph of a flow tokenizer holds before `line`. A paragraph that has just closed (the
 * construct is reading the line that closed it) has its own events. One that is still open (the construct is trying to
 * interrupt it) is still content, which may open with link reference definitions: they are not paragraph lines.
 */
function paragraphLinesBefore(flow: TokenizeContext, line: number): number {
  const chunks: string[] = [];
  for (let index = flow.events.length - 1; index >= 0; index--) {
    const event = flow.events[index];
    if (!event) {
      break;
    }
    const [kind, token, tokenizer] = event;
    if (token.type === 'paragraph') {
      return line - token.start.line;
    }
    if (kind === 'enter' && token.type === 'content') {
      return contentParagraphLines(chunks.toReversed().join(''));
    }
    if (kind === 'exit' && token.type === 'chunkContent') {
      chunks.push(tokenizer.sliceSerialize(token));
    }
  }
  return 0;
}

// The flow tokenizer the document tokenizer feeds, from the last flow chunk it wrote.
function paragraphLinesBeforeDocumentLine(context: TokenizeContext): number {
  for (let index = context.events.length - 1; index >= 0; index--) {
    const token = context.events[index]?.[1];
    if (token?.type === 'chunkFlow' && token._tokenizer) {
      return paragraphLinesBefore(token._tokenizer, context.now().line);
    }
  }
  return 0;
}

/*
 * Marks a list loose when a blank line inside it is followed by more of it, reading the document's lines: each line's
 * flow chunk, after the prefixes of its containers. A line holding a list item's marker, or a prefix of a quote inside the
 * list, is not blank even with nothing after it.
 */
function resolveLooseLists(events: Event[], context: TokenizeContext): Event[] {
  const scan: LooseListsScan = { hasItemMarker: false, lists: [], quoteDepth: 0, quotePrefixes: 0 };
  for (const [kind, token] of events) {
    scanLooseListEvent(scan, kind === 'enter', token, context);
  }
  return events;
}

/*
 * Turns the line endings of inline content into hard line breaks: the trailing whitespace before one becomes the
 * break, and one with none gets an empty break before it.
 */
function resolveSoftLineBreaks(events: Event[], context: TokenizeContext): Event[] {
  for (let index = events.length - 1; index > 0; index--) {
    const event = events[index];
    if (event?.[0] !== 'enter' || !softLineEndings.has(event[1])) {
      continue;
    }
    const before = events[index - 1]?.[1];
    if (before?.type === 'hardBreakTrailing' || before?.type === 'hardBreakEscape') {
      continue;
    }
    if (before?.type === 'lineSuffix') {
      before.type = 'hardBreakTrailing';
      continue;
    }
    const point = { ...event[1].start };
    const hardBreak: Token = { end: point, start: point, type: 'hardBreakTrailing' };
    events.splice(index, 0, ['enter', hardBreak, context], ['exit', hardBreak, context]);
  }
  return events;
}

/*
 * Reads the text ahead a code at a time, without consuming it, until `decide` answers `true` for `ok` or `false` for
 * `nok`, where `null` reads on. At the end of the content, where `next` is `null`, it must answer.
 */
function scanAhead(decide: (text: string, next: Code) => boolean | null): Construct {
  return {
    partial: true,
    tokenize(effects: Effects, ok: State, nok: State): State {
      let text = '';
      let isEntered = false;
      return step;

      function step(code: Code): State | undefined {
        const answer = decide(text, code);
        if (answer !== null) {
          if (isEntered) {
            effects.exit(PEEK);
          }
          return answer ? ok(code) : nok(code);
        }
        if (!isEntered) {
          effects.enter(PEEK);
          isEntered = true;
        }
        text += textOf(code);
        effects.consume(code);
        return step;
      }
    }
  };
}

// Ends a line of the scan: a blank one opens a gap in the lists it belongs to, and any other closes the gaps open.
function scanListLine(scan: LooseListsScan, isBlankChunk: boolean): void {
  for (const open of scan.lists) {
    if (isBlankChunk && scan.quotePrefixes <= open.quoteDepth) {
      open.hasBlankLine = true;
    } else if (open.hasBlankLine) {
      open.token._obsidianLoose = true;
    }
  }
  scan.quotePrefixes = 0;
  scan.hasItemMarker = false;
}

function scanLooseListEvent(scan: LooseListsScan, isEnter: boolean, token: Token, context: TokenizeContext): void {
  switch (token.type) {
    case 'blockQuote': {
      scan.quoteDepth += isEnter ? 1 : -1;
      return;
    }
    case 'blockQuotePrefix': {
      scan.quotePrefixes += isEnter ? 1 : 0;
      return;
    }
    case 'chunkFlow': {
      if (!isEnter) {
        scanListLine(scan, !scan.hasItemMarker && BLANK_LINE_RE.test(context.sliceSerialize(token)));
      }
      return;
    }
    case 'listItemPrefix': {
      scan.hasItemMarker = true;
      return;
    }
    case 'listOrdered':
    case 'listUnordered': {
      if (isEnter) {
        scan.lists.push({ hasBlankLine: false, quoteDepth: scan.quoteDepth, token });
      } else {
        scan.lists.pop();
      }
      break;
    }
    default:
  }
}

function textOf(code: Code): string {
  if (code === null) {
    return '';
  }
  if (isLineEnding(code)) {
    return '\n';
  }
  if (code === codes.virtualSpace) {
    return ' ';
  }
  return code === codes.horizontalTab ? '\t' : String.fromCodePoint(code);
}

// A setext underline with nothing after its sequence of `=` or `-`.
function tokenizeBareUnderline(effects: Effects, ok: State, nok: State): State {
  let marker: Code = null;
  return start;

  function start(code: Code): State | undefined {
    marker = code;
    effects.enter(PEEK);
    return inside(code);
  }

  function inside(code: Code): State | undefined {
    if (code === marker) {
      effects.consume(code);
      return inside;
    }
    effects.exit(PEEK);
    return code === null || isLineEnding(code) ? ok(code) : nok(code);
  }
}

/*
 * An empty list item opens a list where it interrupts a paragraph: the list construct runs as if it did not interrupt.
 * A line the paragraph takes as its setext underline is left to it.
 */
function tokenizeEmptyListItem(context: TokenizeContext, effects: Effects, ok: State, nok: State, isSingleLine: boolean): State {
  const startList = list.tokenize.call(context, effects, ok, nok);
  return start;

  function start(code: Code): State | undefined {
    if (!context.interrupt) {
      return nok(code);
    }
    return effects.check(emptyListItemLine, code === Char.Dash ? afterDash : interrupting, nok)(code);
  }

  function afterDash(code: Code): State | undefined {
    if (!isSingleLine) {
      return nok(code);
    }
    return effects.check(bareUnderline, isSingleLineUnderline() ? nok : interrupting, interrupting)(code);
  }

  function isSingleLineUnderline(): boolean {
    return !isIndented(context) && paragraphLinesBeforeDocumentLine(context) === 1;
  }

  function interrupting(code: Code): State | undefined {
    context.interrupt = undefined;
    return startList(code);
  }
}

// A list marker with nothing but whitespace after it: `*`, `+`, `-`, `1.` or `1)`.
function tokenizeEmptyListItemLine(effects: Effects, ok: State, nok: State): State {
  return start;

  function start(code: Code): State | undefined {
    effects.enter(PEEK);
    if (BULLET_CODES.has(code)) {
      effects.consume(code);
      return whitespace;
    }
    if (code === Char.One) {
      effects.consume(code);
      return delimiter;
    }
    return nok(code);
  }

  function delimiter(code: Code): State | undefined {
    if (code === Char.Dot || code === Char.CloseParen) {
      effects.consume(code);
      return whitespace;
    }
    return nok(code);
  }

  function whitespace(code: Code): State | undefined {
    if (SPACE_OR_TAB_CODES.has(code)) {
      effects.consume(code);
      return whitespace;
    }
    effects.exit(PEEK);
    return code === null || isLineEnding(code) ? ok(code) : nok(code);
  }
}

// The next line is empty: nothing follows the prefixes of its containers.
function tokenizeEmptyNextLine(effects: Effects, ok: State, nok: State): State {
  return start;

  function start(code: Code): State | undefined {
    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
    return after;
  }

  function after(code: Code): State | undefined {
    return code === null || isLineEnding(code) ? ok(code) : nok(code);
  }
}

// The next line continues the containers of this one: it is no lazy line.
function tokenizeNextLineInContainers(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return start;

  function start(code: Code): State | undefined {
    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
    return after;
  }

  function after(code: Code): State | undefined {
    return code === null || context.parser.lazy[context.now().line] === true ? nok(code) : ok(code);
  }
}

/*
 * An autolink as Obsidian reads it: its markers as micromark's own, and an `obsidianAutolinkTarget` between them that
 * carries what it shows and where it links to, which `micromarkQuirksHtml` and `parseMdast` read. A CommonMark
 * autolink that is no autolink in Obsidian is left to raw HTML, which reads it as text.
 */
function tokenizeObsidianAutolink(effects: Effects, ok: State, nok: State): State {
  let autolink: null | ObsidianAutolink = null;
  let left = 0;
  const ahead = scanAhead((text, next) => {
    if (next !== null && !isLineEnding(next) && !SPACE_OR_TAB_CODES.has(next) && !text.endsWith('>')) {
      return null;
    }
    autolink = matchObsidianAutolink(text);
    return autolink !== null;
  });
  return start;

  function start(code: Code): State | undefined {
    return effects.check(ahead, open, nok)(code);
  }

  function open(code: Code): State | undefined {
    effects.enter('autolink');
    effects.enter('autolinkMarker');
    effects.consume(code);
    effects.exit('autolinkMarker');
    const target = effects.enter('obsidianAutolinkTarget');
    if (autolink) {
      target._obsidianAutolink = { text: decodeObsidianCharacterReferences(autolink.text), url: decodeObsidianCharacterReferences(autolink.url, true) };
      left = autolink.length - AUTOLINK_MARKERS;
    }
    return inside;
  }

  function inside(code: Code): State | undefined {
    if (left > 0) {
      effects.consume(code);
      left -= code !== null && code > MAX_BMP_CODE_POINT ? SURROGATE_PAIR : 1;
      return inside;
    }
    effects.exit('obsidianAutolinkTarget');
    effects.enter('autolinkMarker');
    effects.consume(code);
    effects.exit('autolinkMarker');
    effects.exit('autolink');
    return ok;
  }
}

/*
 * A character reference as Obsidian reads it, with the tokens of micromark's own. Its value token carries the text it
 * stands for, which `micromarkQuirksHtml` and `parseMdast` read.
 */
function tokenizeObsidianCharacterReference(effects: Effects, ok: State, nok: State): State {
  let reference: null | ObsidianCharacterReference = null;
  let source = '';
  let index = 0;
  const ahead = scanAhead((text, next) => {
    if (next !== null && (text === '' || (CHARACTER_REFERENCE_CHAR_RE.test(textOf(next)) && !text.endsWith(';')))) {
      return null;
    }
    reference = matchObsidianCharacterReference(text);
    source = text.slice(0, reference?.length ?? 0);
    return reference !== null;
  });
  return start;

  function start(code: Code): State | undefined {
    return effects.check(ahead, open, nok)(code);
  }

  function open(code: Code): State | undefined {
    effects.enter('characterReference');
    marker(code, 'characterReferenceMarker');
    return source.charAt(index) === '#' ? numeric : value;
  }

  function numeric(code: Code): State | undefined {
    marker(code, 'characterReferenceMarkerNumeric');
    return source.charAt(index).toLowerCase() === 'x' ? hexadecimal : value;
  }

  function hexadecimal(code: Code): State | undefined {
    marker(code, 'characterReferenceMarkerHexadecimal');
    return value;
  }

  function value(code: Code): State | undefined {
    const token = effects.enter('characterReferenceValue');
    token._obsidianValue = reference?.value;
    return inValue(code);
  }

  function inValue(code: Code): State | undefined {
    const isSemicolon = source.charAt(index) === ';';
    if (!isSemicolon && index < source.length) {
      effects.consume(code);
      index++;
      return inValue;
    }
    effects.exit('characterReferenceValue');
    if (isSemicolon) {
      marker(code, 'characterReferenceMarker');
      return done;
    }
    return done(code);
  }

  function done(code: Code): State | undefined {
    effects.exit('characterReference');
    return ok(code);
  }

  function marker(code: Code, type: TokenType): void {
    effects.enter(type);
    effects.consume(code);
    effects.exit(type);
    index++;
  }
}

/*
 * An HTML block as Obsidian reads it (see `obsidianHtmlBlockKind`), with the tokens of micromark's own. It runs to the
 * line that holds its end, or to the line before an empty one, or to the end of its containers.
 */
function tokenizeObsidianHtmlFlow(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let kind: null | ObsidianHtmlBlockKind = null;
  let lineText = '';
  const firstLine = scanAhead((text, next) => {
    if (next !== null && !isLineEnding(next)) {
      return null;
    }
    kind = obsidianHtmlBlockKind(text);
    return kind !== null && (context.interrupt !== true || kind.canInterrupt);
  });
  return start;

  function start(code: Code): State | undefined {
    return effects.check(firstLine, opened, nok)(code);
  }

  function opened(code: Code): State | undefined {
    // An interrupting construct only has to show that it starts.
    if (context.interrupt) {
      return ok(code);
    }
    effects.enter('htmlFlow');
    return lineStart(code);
  }

  function lineStart(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) {
      return lineEnd(code);
    }
    effects.enter('htmlFlowData');
    lineText = '';
    return inLine(code);
  }

  function inLine(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) {
      effects.exit('htmlFlowData');
      return kind?.end?.test(lineText) === true ? done(code) : lineEnd(code);
    }
    lineText += textOf(code);
    effects.consume(code);
    return inLine;
  }

  function lineEnd(code: Code): State | undefined {
    if (code === null) {
      return done(code);
    }
    return kind?.end === null ? effects.check(emptyNextLine, done, nextLine)(code) : nextLine(code);
  }

  function nextLine(code: Code): State | undefined {
    return effects.check(nextLineInContainers, atNextLine, done)(code);
  }

  function atNextLine(code: Code): State | undefined {
    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
    return lineStart;
  }

  function done(code: Code): State | undefined {
    effects.exit('htmlFlow');
    return ok(code);
  }
}

// Raw inline HTML as micromark reads it, except a `<!--` that opens no comment of CommonMark 0.30, which is text.
function tokenizeObsidianHtmlText(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return effects.check(obsidianHtmlCommentAhead, htmlText.tokenize.call(context, effects, ok, nok), nok);
}

/*
 * Obsidian's setext underline: under a paragraph of one line, at the start of its line, and with nothing after its
 * sequence. Anything else is left to the other constructs, as if micromark had no setext heading.
 */
function tokenizeSingleLineSetextUnderline(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const underline = setextUnderline.tokenize.call(context, effects, ok, nok);
  return start;

  function start(code: Code): State | undefined {
    return isIndented(context) || paragraphLinesBefore(context, context.now().line) !== 1 ? nok(code) : effects.check(bareUnderline, underline, nok)(code);
  }
}

// A line ending of inline content, read as micromark reads it, and recorded so the resolver finds it.
function tokenizeSoftLineBreak(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return lineEnding.tokenize.call(context, effects, (code) => {
    const token = context.events.findLast((event) => event[1].type === 'lineEnding')?.[1];
    if (token) {
      softLineEndings.add(token);
    }
    return ok(code);
  }, nok);
}

// Hands a tokenizer its context as a parameter.
function withContext(tokenize: ContextTokenizer): Tokenizer {
  return function tokenizeWithContext(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    return tokenize(this, effects, ok, nok);
  };
}
