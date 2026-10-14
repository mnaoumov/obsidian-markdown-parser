/**
 * @file
 *
 * The Obsidian syntax as a micromark syntax extension, built on the rules in `spec.ts`.
 *
 * {@link micromarkObsidianSyntax} adds internal links and embeds, tags, `%%` comments, math, highlights, footnote
 * references, inline footnotes, footnote definitions, block ids, callouts, Obsidian's task markers and front matter.
 * {@link micromarkObsidianMarkdown} adds the GFM pieces Obsidian supports as well: tables, strikethrough and bare URLs.
 *
 * The tokens carry the names of {@link ObsidianNode}, so the events give the same outline as the `@lezer/markdown`
 * tree. A micromark construct reads its input one character at a time, so most constructs here first look ahead
 * with `effects.check`, collect the rest of the line or of the inline content, measure it with the rule in `spec.ts`,
 * and then consume exactly that many characters.
 */

import type {
  Code,
  Construct,
  Effects,
  Event,
  Extension,
  ParseContext,
  State,
  Token,
  TokenizeContext,
  Tokenizer,
  TokenType
} from 'micromark-util-types';

import {
  blockQuote,
  definition
} from 'micromark-core-commonmark';
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { splice } from 'micromark-util-chunked';
import { resolveAll } from 'micromark-util-resolve-all';
import { codes } from 'micromark-util-symbol';

import type {
  ObsidianSyntaxFlags,
  ObsidianSyntaxOptions
} from './options.ts';
import type { CalloutMarker } from './spec.ts';

import {
  createMicromarkQuirks,
  micromarkObsidianTable
} from './micromark-quirks.ts';
import {
  OBSIDIAN_SYNTAX_PRESETS,
  resolveObsidianQuirks,
  resolveObsidianSyntax
} from './options.ts';
import {
  canOpenHighlightBefore,
  canOpenTagAfter,
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

/**
 * The tokens the extension emits besides the {@link ObsidianNode} names.
 */
export const ObsidianToken = {
  /**
   * The text of a comment or of math, between its delimiters.
   */
  Content: 'ObsidianContent',

  /**
   * The indentation a footnote definition takes from a line that continues it.
   */
  FootnoteDefinitionIndent: 'ObsidianFootnoteDefinitionIndent',

  /**
   * A highlight delimiter before it is paired. One left unpaired becomes `data`.
   */
  HighlightSequence: 'ObsidianHighlightSequence',

  /**
   * A line ending inside a paragraph that is not part of its text: the one after a callout's title line, or after a
   * task marker with nothing else on its line. A lineEnding there would add a line break to the paragraph's text.
   */
  LineEnding: 'ObsidianLineEnding',

  /**
   * Text that belongs to no node of its own: punctuation inside a mark, whitespace, the lines of a block.
   */
  Part: 'ObsidianPart',

  /**
   * The text a lookahead collects. It never reaches the events.
   */
  Peek: 'ObsidianPeek'
} as const;

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    BlockId: 'BlockId';
    BlockIdMark: 'BlockIdMark';
    Callout: 'Callout';
    CalloutFold: 'CalloutFold';
    CalloutMark: 'CalloutMark';
    CalloutTitle: 'CalloutTitle';
    CalloutType: 'CalloutType';
    Embed: 'Embed';
    FootnoteDefinition: 'FootnoteDefinition';
    FootnoteLabel: 'FootnoteLabel';
    FootnoteMark: 'FootnoteMark';
    FootnoteReference: 'FootnoteReference';
    FrontMatter: 'FrontMatter';
    FrontMatterContent: 'FrontMatterContent';
    FrontMatterMark: 'FrontMatterMark';
    Highlight: 'Highlight';
    HighlightMark: 'HighlightMark';
    InlineFootnote: 'InlineFootnote';
    InlineMath: 'InlineMath';
    InternalLink: 'InternalLink';
    InternalLinkAlias: 'InternalLinkAlias';
    InternalLinkAliasMark: 'InternalLinkAliasMark';
    InternalLinkMark: 'InternalLinkMark';
    InternalLinkPath: 'InternalLinkPath';
    InternalLinkSubpath: 'InternalLinkSubpath';
    MathBlock: 'MathBlock';
    MathMark: 'MathMark';
    ObsidianComment: 'ObsidianComment';
    ObsidianCommentBlock: 'ObsidianCommentBlock';
    ObsidianCommentMark: 'ObsidianCommentMark';
    ObsidianContent: 'ObsidianContent';
    ObsidianFootnoteDefinitionIndent: 'ObsidianFootnoteDefinitionIndent';
    ObsidianHighlightSequence: 'ObsidianHighlightSequence';
    ObsidianLineEnding: 'ObsidianLineEnding';
    ObsidianPart: 'ObsidianPart';
    ObsidianPeek: 'ObsidianPeek';
    Tag: 'Tag';
    TagMark: 'TagMark';
    TagName: 'TagName';
    Task: 'Task';
    TaskMarker: 'TaskMarker';
  }
}

const Char = {
  Bang: codeOf('!'),
  Caret: codeOf('^'),
  CarriageReturn: codes.carriageReturn,
  CarriageReturnLineFeed: codes.carriageReturnLineFeed,
  Dash: codeOf('-'),
  Dollar: codeOf('$'),
  Equals: codeOf('='),
  GreaterThan: codeOf('>'),
  Hash: codeOf('#'),
  HorizontalTab: codes.horizontalTab,
  LineFeed: codes.lineFeed,
  OpenBracket: codeOf('['),
  Percent: codeOf('%'),
  Space: codeOf(' '),
  VirtualSpace: codes.virtualSpace
} as const;

const SPACE_OR_TAB_CODES: ReadonlySet<Code> = new Set([Char.HorizontalTab, Char.Space, Char.VirtualSpace]);

const CODE_INDENT = 4;
const DELIMITER_SIZE = 2;
const FRONT_MATTER_FENCE_SIZE = 3;
const MAX_BMP_CODE_POINT = 0xFF_FF;
const LINE_BREAK_RE = /\r\n|\r|\n/u;
const LEADING_SPACE_RE = /^[ \t]*/u;

// Where the content of each callout starts, so the inline parser can tell a callout's first line from any other.
const calloutContentStarts = new WeakMap<ParseContext, Set<number>>();

// Consumes the given number of UTF-16 code units.
interface ConsumeOp {
  readonly kind: 'consume';
  readonly length: number;
}

type ContextTokenizer = (context: TokenizeContext, effects: Effects, ok: State, nok: State) => State;

interface DelimitedBlockSpec {
  readonly findClose: (text: string) => number;
  readonly mark: TokenType;
  readonly opener: string;
  readonly type: TokenType;
}

interface EnterOp {
  readonly isContainer?: boolean;
  // Whether the token is a chunk of inline content, parsed as text of its own.
  readonly isText?: boolean;
  readonly kind: 'enter';
  readonly type: TokenType;
}

interface ExitOp {
  readonly kind: 'exit';
  readonly type: TokenType;
}

// One step of a token layout.
type Op = ConsumeOp | EnterOp | ExitOp;

// A line of text and the length of the line ending after it (`0` on the last line).
interface TextLine {
  readonly eol: number;
  readonly text: string;
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

const internalLink: Construct = { name: 'obsidianInternalLink', tokenize: tokenizeInternalLink };
const footnoteReference: Construct = { name: 'obsidianFootnoteReference', tokenize: tokenizeFootnoteReference };
const inlineFootnote: Construct = { name: 'obsidianInlineFootnote', tokenize: tokenizeInlineFootnote };
const blockId: Construct = { name: 'obsidianBlockId', tokenize: tokenizeBlockId };
const tag: Construct = { name: 'obsidianTag', tokenize: withContext(tokenizeTag) };
const comment: Construct = { name: 'obsidianComment', tokenize: tokenizeComment };
const inlineMath: Construct = { name: 'obsidianInlineMath', tokenize: tokenizeInlineMath };
const highlight: Construct = { name: 'obsidianHighlight', resolveAll: resolveAllHighlight, tokenize: withContext(tokenizeHighlight) };
const calloutMarker: Construct = { name: 'obsidianCalloutMarker', tokenize: withContext(tokenizeCalloutMarker) };
const calloutMarkerLine: Construct = { name: 'obsidianCalloutMarkerLine', tokenize: withContext(tokenizeCalloutMarkerLine) };
const task: Construct = { name: 'obsidianTask', tokenize: withContext(tokenizeTask) };
const mathBlock: Construct = { concrete: true, name: 'obsidianMathBlock', tokenize: delimitedBlockTokenizer(MATH_BLOCK) };
const commentBlock: Construct = { concrete: true, name: 'obsidianCommentBlock', tokenize: delimitedBlockTokenizer(COMMENT_BLOCK) };
const frontMatter: Construct = { concrete: true, name: 'obsidianFrontMatter', tokenize: withContext(tokenizeFrontMatter) };
const callout: Construct = {
  continuation: blockQuote.continuation,
  exit: exitCallout,
  name: 'obsidianCallout',
  tokenize: withContext(tokenizeCallout)
};
const footnoteDefinition: Construct = {
  continuation: { tokenize: tokenizeFootnoteDefinitionContinuation },
  exit: exitFootnoteDefinition,
  name: 'obsidianFootnoteDefinition',
  tokenize: withContext(tokenizeFootnoteDefinition)
};
const linkDefinition: Construct = { name: 'obsidianLinkDefinition', tokenize: withContext(tokenizeLinkDefinition) };
const blankLine: Construct = { partial: true, tokenize: tokenizeBlankLine };
const nonLazyContinuation: Construct = { partial: true, tokenize: withContext(tokenizeNonLazyContinuation) };
const fenceAhead: Construct = { partial: true, tokenize: tokenizeFenceAhead };

/**
 * The Obsidian syntax as a micromark syntax extension.
 */
export const micromarkObsidianSyntax: Extension = createMicromarkObsidianSyntax(OBSIDIAN_SYNTAX_PRESETS.obsidian);

/**
 * The Obsidian syntax with the GFM extensions Obsidian supports: tables, strikethrough and bare URLs. Obsidian's task
 * markers replace GFM's. The Obsidian syntax comes last, so its constructs take precedence.
 */
export const micromarkObsidianMarkdown: readonly Extension[] = [
  gfmTable(),
  gfmStrikethrough({ singleTilde: false }),
  gfmAutolinkLiteral(),
  micromarkObsidianSyntax
];

/**
 * The options of {@link createMicromarkObsidianMarkdown}: the syntax to read.
 */
export type CreateMicromarkObsidianMarkdownOptions = ObsidianSyntaxOptions;

/**
 * The micromark syntax extensions for the syntax the options turn on: the GFM extensions it turns on, then the Obsidian
 * syntax, so that its constructs take precedence, then the quirks the options ask for.
 *
 * @param options - The syntax to read.
 * @returns The extensions.
 */
export function createMicromarkObsidianMarkdown(options: CreateMicromarkObsidianMarkdownOptions = {}): Extension[] {
  const flags = resolveObsidianSyntax(options);
  const quirks = resolveObsidianQuirks(options);
  const extensions: Extension[] = [];
  if (flags.table) {
    extensions.push(quirks.gfmTable === 'obsidian' ? micromarkObsidianTable : gfmTable());
  }
  if (flags.strikethrough) {
    extensions.push(gfmStrikethrough({ singleTilde: false }));
  }
  if (flags.autolinkLiteral) {
    extensions.push(gfmAutolinkLiteral());
  }
  extensions.push(createMicromarkObsidianSyntax(flags), createMicromarkQuirks(quirks, flags));
  return extensions;
}

/**
 * The micromark syntax extension for the Obsidian syntax the flags turn on.
 *
 * @param flags - The constructs to read.
 * @returns The extension.
 */
export function createMicromarkObsidianSyntax(flags: ObsidianSyntaxFlags): Extension {
  const extension: Extension = {
    document: {
      [Char.GreaterThan]: pick([[callout, flags.callout]]),
      [Char.OpenBracket]: pick([[footnoteDefinition, flags.footnote]])
    },
    flow: {
      [Char.Dash]: pick([[frontMatter, flags.frontMatter]]),
      [Char.Dollar]: pick([[mathBlock, flags.math]]),
      [Char.OpenBracket]: pick([[calloutMarkerLine, flags.callout]]),
      [Char.Percent]: pick([[commentBlock, flags.comment]])
    },
    text: {
      [Char.Bang]: pick([[internalLink, flags.internalLink]]),
      [Char.Caret]: pick([[inlineFootnote, flags.inlineFootnote], [blockId, flags.blockId]]),
      [Char.Dollar]: pick([[inlineMath, flags.math]]),
      [Char.Equals]: pick([[highlight, flags.highlight]]),
      [Char.Hash]: pick([[tag, flags.tag]]),
      [Char.OpenBracket]: pick([[task, flags.task], [calloutMarker, flags.callout], [internalLink, flags.internalLink], [footnoteReference, flags.footnote]]),
      [Char.Percent]: pick([[comment, flags.comment]])
    }
  };
  if (flags.footnote) {
    extension.contentInitial = { [Char.OpenBracket]: linkDefinition };
    extension.disable = { null: ['definition'] };
  }
  return extension;
}

function calloutMark(marker: CalloutMarker): Op[] {
  return node(
    ObsidianNode.CalloutMark,
    leaf(ObsidianToken.Part, marker.type.from),
    leaf(ObsidianNode.CalloutType, marker.type.to - marker.type.from),
    leaf(ObsidianToken.Part, 1),
    marker.fold ? leaf(ObsidianNode.CalloutFold, 1) : []
  );
}

function charOf(code: Code): string {
  switch (code) {
    case Char.CarriageReturn: {
      return '\r';
    }
    case Char.CarriageReturnLineFeed: {
      return '\r\n';
    }
    case Char.HorizontalTab: {
      return '\t';
    }
    case Char.LineFeed: {
      return '\n';
    }
    // A tab is followed by virtual spaces up to its tab stop. They count as spaces, so the lengths measured on the text
    // match the codes consumed.
    case Char.VirtualSpace: {
      return ' ';
    }
    case null: {
      return '';
    }
    default: {
      return String.fromCodePoint(code);
    }
  }
}
function codeOf(ch: string): number {
  return ch.codePointAt(0) ?? -1;
}

/*
 * A `$$` or `%%` line that the same line does not close opens a block, which runs over blank lines to the line holding
 * the closing delimiter, or to the end of its container. The rest of the closing line is not read.
 */
function delimitedBlockTokenizer(spec: DelimitedBlockSpec): Construct['tokenize'] {
  return withContext((context: TokenizeContext, effects: Effects, ok: State, nok: State): State => {
    let isContentOpen = false;
    return start;

    function start(code: Code): State | undefined {
      return lookahead(
        effects,
        true,
        (text) => {
          if (!text.startsWith(spec.opener) || spec.findClose(text.slice(spec.opener.length)) !== -1) {
            return null;
          }
          // A paragraph that leaves the delimiter open reads this line as the inline span's end.
          if (context.interrupt && isLeftOpen(paragraphSoFar(context), spec.opener)) {
            return null;
          }
          const rest = text.length - spec.opener.length;
          isContentOpen = rest > 0;
          return [
            enter(spec.type),
            ...leaf(spec.mark, spec.opener.length),
            ...isContentOpen ? [enter(ObsidianToken.Content), ...leaf(ObsidianToken.Part, rest)] : []
          ];
          // An interrupting construct only has to show that it starts, as micromark's fenced code does.
        },
        (next) => context.interrupt ? ok(next) : atLineEnd(next),
        nok
      )(code);
    }

    function atLineEnd(code: Code): State | undefined {
      return code === null ? done(code) : effects.check(nonLazyContinuation, atNextLine, done)(code);
    }

    function atNextLine(code: Code): State | undefined {
      if (!isContentOpen) {
        effects.enter(ObsidianToken.Content);
        isContentOpen = true;
      }
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      return lineStart;
    }

    function lineStart(code: Code): State | undefined {
      let isClosed = false;
      return lookahead(
        effects,
        true,
        (text) => {
          const close = spec.findClose(text);
          if (close === -1) {
            return leaf(ObsidianToken.Part, text.length);
          }
          isClosed = true;
          const closeEnd = close + spec.opener.length;
          return [
            ...leaf(ObsidianToken.Part, close),
            exit(ObsidianToken.Content),
            ...leaf(spec.mark, spec.opener.length),
            exit(spec.type),
            ...leaf(ObsidianToken.Part, text.length - closeEnd)
          ];
        },
        (next) => isClosed ? ok(next) : atLineEnd(next),
        nok
      )(code);
    }

    function done(code: Code): State | undefined {
      if (isContentOpen) {
        effects.exit(ObsidianToken.Content);
      }
      effects.exit(spec.type);
      return ok(code);
    }
  });
}

function enter(type: TokenType, isText?: boolean): Op {
  return isText ? { isText, kind: 'enter', type } : { kind: 'enter', type };
}

function exit(type: TokenType): Op {
  return { kind: 'exit', type };
}

function exitCallout(effects: Effects): undefined {
  effects.exit(ObsidianNode.Callout);
}

function exitFootnoteDefinition(effects: Effects): undefined {
  effects.exit(ObsidianNode.FootnoteDefinition);
}

// The nearest highlight delimiter before `close` that can open, or `-1`.
function findHighlightOpener(events: readonly Event[], close: number): number {
  for (let index = close - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.[0] === 'exit' && event[1].type === ObsidianToken.HighlightSequence && event[1]._open === true) {
      return index;
    }
  }
  return -1;
}

// Whether a container opens at the start of its line: nothing but indentation comes before it.
function isAtLineStart(context: TokenizeContext): boolean {
  const { line } = context.now();
  for (let index = context.events.length - 1; index >= 0; index--) {
    const token = context.events[index]?.[1];
    if (token?.start.line !== line) {
      return true;
    }
    if (token.type !== 'linePrefix') {
      return false;
    }
  }
  return true;
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

function isLineEnding(code: Code): boolean {
  return code !== null && code < Char.HorizontalTab;
}

function isSpaceOrTab(code: Code): boolean {
  return SPACE_OR_TAB_CODES.has(code);
}

function leaf(type: TokenType, length: number): Op[] {
  return length > 0 ? [enter(type), { kind: 'consume', length }, exit(type)] : [];
}

/*
 * Text that may cross line endings, as parts and line endings. Every line ending gets its own `lineEnding` token, as in
 * micromark's own constructs: the subtokenizer splits the events at those tokens to hand each line back to its chunk.
 */
function lines(text: string): Op[] {
  return splitLines(text).flatMap((line) => [...leaf(ObsidianToken.Part, line.text.length), ...leaf('lineEnding', line.eol)]);
}

/*
 * Collects the rest of the line, or of the whole content, without consuming it, lets `decide` lay out the tokens, and
 * runs them. `decide` returns `null` when the construct does not apply.
 */
function lookahead(
  effects: Effects,
  shouldStopAtLineEnding: boolean,
  decide: (text: string) => null | readonly Op[],
  ok: State,
  nok: State
): State {
  let ops: null | readonly Op[] = null;
  const peek: Construct = {
    partial: true,
    tokenize(peekEffects, peekOk) {
      let text = '';
      let isEntered = false;
      return inside;

      function inside(code: Code): State | undefined {
        if (code === null || (shouldStopAtLineEnding && isLineEnding(code))) {
          if (isEntered) {
            peekEffects.exit(ObsidianToken.Peek);
          }
          ops = decide(text);
          return peekOk(code);
        }
        if (!isEntered) {
          peekEffects.enter(ObsidianToken.Peek);
          isEntered = true;
        }
        text += charOf(code);
        peekEffects.consume(code);
        return inside;
      }
    }
  };
  return effects.check(peek, (code) => ops === null ? nok(code) : run(effects, ops, ok, nok)(code), nok);
}

function node(type: TokenType, ...children: readonly Op[][]): Op[] {
  return [enter(type), ...children.flat(), exit(type)];
}

// The text of the paragraph a flow construct is interrupting, up to the line being tried.
function paragraphSoFar(context: TokenizeContext): string {
  const chunks: string[] = [];
  for (let index = context.events.length - 1; index >= 0; index--) {
    const event = context.events[index];
    if (!event) {
      break;
    }
    const [kind, token, tokenizer] = event;
    if (token.type === 'content') {
      return kind === 'enter' ? chunks.toReversed().join('') : '';
    }
    if (kind === 'exit' && token.type === 'chunkContent') {
      chunks.push(tokenizer.sliceSerialize(token));
    }
  }
  return '';
}

// The constructs whose flag is on.
function pick(constructs: readonly (readonly [Construct, boolean])[]): Construct[] {
  return constructs.filter(([, isOn]) => isOn).map(([construct]) => construct);
}

/*
 * Pairs the highlight delimiters, as `micromark-extension-gfm-strikethrough` pairs its own: each `==` that can close
 * closes the nearest `==` before it that can open.
 */
function resolveAllHighlight(events: Event[], context: TokenizeContext): Event[] {
  for (let index = 0; index < events.length; index++) {
    const closeEvent = events[index];
    if (closeEvent?.[0] !== 'enter' || closeEvent[1].type !== ObsidianToken.HighlightSequence || !closeEvent[1]._close) {
      continue;
    }
    const open = findHighlightOpener(events, index);
    const openToken = events[open]?.[1];
    if (!openToken) {
      continue;
    }
    const closeToken = closeEvent[1];
    openToken.type = ObsidianNode.HighlightMark;
    closeToken.type = ObsidianNode.HighlightMark;
    const highlightToken: Token = { end: { ...closeToken.end }, start: { ...openToken.start }, type: ObsidianNode.Highlight };
    const inside = events.slice(open + 1, index);
    const insideSpan = context.parser.constructs.insideSpan.null;
    const nextEvents: Event[] = [
      ['enter', highlightToken, context],
      ['enter', openToken, context],
      ['exit', openToken, context],
      ...insideSpan ? resolveAll(insideSpan, inside, context) : inside,
      ['enter', closeToken, context],
      ['exit', closeToken, context],
      ['exit', highlightToken, context]
    ];
    splice(events, open - 1, index - open + DELIMITER_SIZE + 1, nextEvents);
    index = open + nextEvents.length - DELIMITER_SIZE;
  }
  for (const event of events) {
    if (event[1].type === ObsidianToken.HighlightSequence) {
      event[1].type = 'data';
    }
  }
  return events;
}

/*
 * Runs a token layout: enters and exits tokens and consumes the given number of characters (in UTF-16 code units, as
 * the rules in `spec.ts` measure them). A text chunk that crosses a line ending is split there, as micromark's own
 * chunks are, so the inner parser can skip the container prefixes of the next line.
 */
function run(effects: Effects, ops: readonly Op[], ok: State, nok: State): State {
  let index = 0;
  let left: number | undefined;
  let chunk: Token | undefined;
  return step;

  function step(code: Code): State | undefined {
    for (let op = ops[index]; op !== undefined; op = ops[index]) {
      if (op.kind === 'consume') {
        left ??= op.length;
        if (left <= 0) {
          left = undefined;
          index++;
          continue;
        }
        if (code === null) {
          return nok(code);
        }
        effects.consume(code);
        left -= unitsOf(code);
        if (chunk && left > 0 && isLineEnding(code)) {
          effects.exit('chunkText');
          const next = effects.enter('chunkText', { contentType: 'text', previous: chunk });
          chunk.next = next;
          chunk = next;
        }
        return step;
      }
      if (op.kind === 'enter') {
        const token = effects.enter(op.type, op.isText ? { contentType: 'text' } : (op.isContainer ? { _container: true } : undefined));
        chunk = op.isText ? token : chunk;
      } else {
        effects.exit(op.type);
        chunk = op.type === 'chunkText' ? undefined : chunk;
      }
      index++;
    }
    return ok(code);
  }
}

// A token over text that may cross line endings: a leaf on one line, the lines of the text inside it otherwise.
function spanning(type: TokenType, text: string): Op[] {
  return LINE_BREAK_RE.test(text) ? node(type, lines(text)) : leaf(type, text.length);
}

function splitLines(text: string): TextLine[] {
  const result: TextLine[] = [];
  let rest = text;
  for (let match = LINE_BREAK_RE.exec(rest); match; match = LINE_BREAK_RE.exec(rest)) {
    result.push({ eol: match[0].length, text: rest.slice(0, match.index) });
    rest = rest.slice(match.index + match[0].length);
  }
  result.push({ eol: 0, text: rest });
  return result;
}

function textChunk(length: number): Op[] {
  return length > 0 ? [enter('chunkText', true), { kind: 'consume', length }, exit('chunkText')] : [];
}

function tokenizeBlankLine(effects: Effects, ok: State, nok: State): State {
  let isEntered = false;
  return start;

  function start(code: Code): State | undefined {
    if (isSpaceOrTab(code)) {
      if (!isEntered) {
        effects.enter(ObsidianToken.Part);
        isEntered = true;
      }
      effects.consume(code);
      return start;
    }
    if (isEntered) {
      effects.exit(ObsidianToken.Part);
    }
    return code === null || isLineEnding(code) ? ok(code) : nok(code);
  }
}

function tokenizeBlockId(effects: Effects, ok: State, nok: State): State {
  return lookahead(effects, true, (text) => isBlockId(text) ? node(ObsidianNode.BlockId, leaf(ObsidianNode.BlockIdMark, 1), leaf(ObsidianToken.Part, text.length - 1)) : null, ok, nok);
}

/*
 * A quote whose first line opens with `[!type]` right after the `>` and its space is a callout. The container reads
 * like a block quote; the marker and the title are read inline, at the place recorded here.
 */
function tokenizeCallout(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return lookahead(effects, true, (text) => {
    if (!text.startsWith('>')) {
      return null;
    }
    const hasSpace = text[1] === ' ';
    if (!matchCalloutMarker(text.slice(hasSpace ? DELIMITER_SIZE : 1))) {
      return null;
    }
    return [
      { isContainer: true, kind: 'enter', type: ObsidianNode.Callout },
      enter('blockQuotePrefix'),
      ...leaf('blockQuoteMarker', 1),
      ...hasSpace ? leaf('blockQuotePrefixWhitespace', 1) : [],
      exit('blockQuotePrefix')
    ];
  }, (code) => {
    if (context.containerState) {
      context.containerState.open = true;
    }
    let starts = calloutContentStarts.get(context.parser);
    if (!starts) {
      starts = new Set();
      calloutContentStarts.set(context.parser, starts);
    }
    starts.add(context.now().offset);
    return ok(code);
  }, nok);
}

/*
 * The callout marker and the title, at the start of the callout's first paragraph. The title is the rest of the line;
 * the line ending after it and the next line's indentation go with it, so what follows reads as its own paragraph.
 */
function tokenizeCalloutMarker(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return (code) => {
    if (context.previous !== null || calloutContentStarts.get(context.parser)?.has(context.now().offset) !== true) {
      return nok(code);
    }
    return lookahead(
      effects,
      false,
      (text) => {
        const marker = matchCalloutMarker(text);
        if (!marker) {
          return null;
        }
        const [firstLine = { eol: 0, text: '' }, nextLine] = splitLines(text);
        const afterMark = firstLine.text.slice(marker.mark.to);
        const titleFrom = LEADING_SPACE_RE.exec(afterMark)?.[0].length ?? 0;
        const title = afterMark.slice(titleFrom).trimEnd();
        const trailing = afterMark.length - titleFrom - title.length;
        const nextIndent = nextLine ? LEADING_SPACE_RE.exec(nextLine.text)?.[0].length ?? 0 : 0;
        return [
          ...calloutMark(marker),
          ...leaf(ObsidianToken.Part, titleFrom),
          ...title ? node(ObsidianNode.CalloutTitle, textChunk(title.length)) : [],
          ...leaf(ObsidianToken.Part, trailing),
          ...leaf(ObsidianToken.LineEnding, firstLine.eol),
          ...leaf(ObsidianToken.Part, nextIndent)
        ];
      },
      ok,
      nok
    )(code);
  };
}

/*
 * A callout marker with no title after it takes its whole line, outside any paragraph, so a lazy line after it does not
 * continue the callout, as in the editor.
 */
function tokenizeCalloutMarkerLine(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return (code) => {
    if (calloutContentStarts.get(context.parser)?.has(context.now().offset) !== true) {
      return nok(code);
    }
    return lookahead(
      effects,
      true,
      (text) => {
        const marker = matchCalloutMarker(text);
        const rest = marker ? text.slice(marker.mark.to) : '';
        return marker && rest.trim() === '' ? [...calloutMark(marker), ...leaf(ObsidianToken.Part, rest.length)] : null;
      },
      ok,
      nok
    )(code);
  };
}
function tokenizeComment(effects: Effects, ok: State, nok: State): State {
  return lookahead(
    effects,
    false,
    (text) => {
      if (!text.startsWith('%%')) {
        return null;
      }
      const content = text.slice(DELIMITER_SIZE);
      const close = findCommentClose(content);
      // An unclosed comment runs to the end of the inline content.
      return node(
        ObsidianNode.Comment,
        leaf(ObsidianNode.CommentMark, DELIMITER_SIZE),
        spanning(ObsidianToken.Content, close === -1 ? content : content.slice(0, close)),
        close === -1 ? [] : leaf(ObsidianNode.CommentMark, DELIMITER_SIZE)
      );
    },
    ok,
    nok
  );
}

// Whether the next line closes front matter.
function tokenizeFenceAhead(effects: Effects, ok: State, nok: State): State {
  return start;

  function start(code: Code): State | undefined {
    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
    return lookahead(effects, true, (text) => isFrontMatterFence(text) ? [] : null, ok, nok);
  }
}

/*
 * A footnote definition opens its line, with no container markup before it. Its content continues on indented lines
 * and across blank lines.
 */
function tokenizeFootnoteDefinition(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return (code) => {
    if (!isAtLineStart(context)) {
      return nok(code);
    }
    return lookahead(
      effects,
      true,
      (text) => {
        const start = matchFootnoteDefinition(text);
        if (!start) {
          return null;
        }
        const space = LEADING_SPACE_RE.exec(text.slice(start.markEnd))?.[0].length ?? 0;
        return [
          { isContainer: true, kind: 'enter', type: ObsidianNode.FootnoteDefinition },
          ...leaf(ObsidianNode.FootnoteMark, start.label.from),
          ...leaf(ObsidianNode.FootnoteLabel, start.label.to - start.label.from),
          ...leaf(ObsidianNode.FootnoteMark, start.markEnd - start.label.to),
          ...leaf(ObsidianToken.Part, space)
        ];
      },
      ok,
      nok
    )(code);
  };
}

function tokenizeFootnoteDefinitionContinuation(effects: Effects, ok: State, nok: State): State {
  let columns = 0;
  return effects.check(blankLine, ok, indent);

  function indent(code: Code): State | undefined {
    if (isSpaceOrTab(code) && columns < CODE_INDENT) {
      if (columns === 0) {
        effects.enter(ObsidianToken.FootnoteDefinitionIndent);
      }
      effects.consume(code);
      columns++;
      return indent;
    }
    if (columns === 0) {
      return nok(code);
    }
    effects.exit(ObsidianToken.FootnoteDefinitionIndent);
    return ok(code);
  }
}

function tokenizeFootnoteReference(effects: Effects, ok: State, nok: State): State {
  return lookahead(
    effects,
    true,
    (text) => {
      const length = matchFootnoteReference(text);
      return length === 0
        ? null
        : node(
          ObsidianNode.FootnoteReference,
          leaf(ObsidianNode.FootnoteMark, DELIMITER_SIZE),
          leaf(ObsidianNode.FootnoteLabel, length - DELIMITER_SIZE - 1),
          leaf(ObsidianNode.FootnoteMark, 1)
        );
    },
    ok,
    nok
  );
}

/*
 * Front matter opens on the document's first line, a line of exactly `---`, and runs to the next such line. Like in the
 * editor, front matter that never closes runs to the end of the document.
 */
function tokenizeFrontMatter(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  // The content starts at the first content line, but its token is entered with the first character it takes, so
  // content of a single empty line gives no token.
  let content: 'none' | 'open' | 'pending' = 'none';
  return start;

  function start(code: Code): State | undefined {
    return context.now().offset === 0 ? lookahead(effects, true, (text) => isFrontMatterFence(text) ? [enter(ObsidianNode.FrontMatter), ...leaf(ObsidianNode.FrontMatterMark, FRONT_MATTER_FENCE_SIZE)] : null, atLineEnd, nok)(code) : nok(code);
  }

  function atLineEnd(code: Code): State | undefined {
    return code === null ? done(code) : effects.check(fenceAhead, atClosingFence, atContentLine)(code);
  }

  function atClosingFence(code: Code): State | undefined {
    exitContent();
    lineEnding(code);
    return lookahead(effects, true, () => [...leaf(ObsidianNode.FrontMatterMark, FRONT_MATTER_FENCE_SIZE), exit(ObsidianNode.FrontMatter)], ok, nok);
  }

  function atContentLine(code: Code): State | undefined {
    if (content === 'none') {
      // The line ending after the opening fence is outside the content.
      lineEnding(code);
      content = 'pending';
    } else {
      if (content === 'pending') {
        effects.enter(ObsidianNode.FrontMatterContent);
        content = 'open';
      }
      lineEnding(code);
    }
    return lookahead(
      effects,
      true,
      (text) => {
        if (text === '') {
          return [];
        }
        const ops = content === 'pending' ? [enter(ObsidianNode.FrontMatterContent)] : [];
        content = 'open';
        return [...ops, ...leaf(ObsidianToken.Part, text.length)];
      },
      atLineEnd,
      nok
    );
  }

  function done(code: Code): State | undefined {
    exitContent();
    effects.exit(ObsidianNode.FrontMatter);
    return ok(code);
  }

  function exitContent(): void {
    if (content === 'open') {
      effects.exit(ObsidianNode.FrontMatterContent);
    }
  }

  function lineEnding(code: Code): void {
    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
  }
}

/*
 * A highlight delimiter is a run of exactly two `=`. It opens before a non-space, and any of them closes. A longer run
 * is text: no `==` is read inside it.
 */
function tokenizeHighlight(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let size = 0;
  return start;

  function start(code: Code): State | undefined {
    if (context.previous === Char.Equals) {
      return nok(code);
    }
    effects.enter(ObsidianToken.HighlightSequence);
    return more(code);
  }

  function more(code: Code): State | undefined {
    if (code === Char.Equals) {
      effects.consume(code);
      size++;
      return more;
    }
    if (size !== DELIMITER_SIZE) {
      return nok(code);
    }
    const token = effects.exit(ObsidianToken.HighlightSequence);
    token._open = canOpenHighlightBefore(charOf(code));
    token._close = true;
    return ok(code);
  }
}

function tokenizeInlineFootnote(effects: Effects, ok: State, nok: State): State {
  return lookahead(
    effects,
    true,
    (text) => {
      const length = matchInlineFootnote(text);
      return length === 0
        ? null
        : node(
          ObsidianNode.InlineFootnote,
          leaf(ObsidianNode.FootnoteMark, DELIMITER_SIZE),
          textChunk(length - DELIMITER_SIZE - 1),
          leaf(ObsidianNode.FootnoteMark, 1)
        );
    },
    ok,
    nok
  );
}

function tokenizeInlineMath(effects: Effects, ok: State, nok: State): State {
  return lookahead(
    effects,
    false,
    (text) => {
      const [line = { eol: 0, text: '' }] = splitLines(text);
      const size = matchMathOpen(line.text);
      if (size === 0) {
        return null;
      }
      const content = text.slice(size);
      const close = findMathClose(content, size);
      // Display math that never closes runs to the end of the inline content.
      return node(
        ObsidianNode.InlineMath,
        leaf(ObsidianNode.MathMark, size),
        spanning(ObsidianToken.Content, close === -1 ? content : content.slice(0, close)),
        close === -1 ? [] : leaf(ObsidianNode.MathMark, size)
      );
    },
    ok,
    nok
  );
}

function tokenizeInternalLink(effects: Effects, ok: State, nok: State): State {
  return lookahead(
    effects,
    true,
    (text) => {
      const isEmbed = text.startsWith('!');
      const open = isEmbed ? DELIMITER_SIZE + 1 : DELIMITER_SIZE;
      if (!text.startsWith(isEmbed ? '![[' : '[[')) {
        return null;
      }
      const length = findInternalLinkEnd(text.slice(open));
      if (length === -1) {
        return null;
      }
      const parts = splitInternalLink(text.slice(open, open + length));
      const targetEnd = parts.aliasMark?.from ?? length;
      return node(
        isEmbed ? ObsidianNode.Embed : ObsidianNode.InternalLink,
        leaf(ObsidianNode.InternalLinkMark, open),
        leaf(ObsidianNode.InternalLinkPath, parts.path.to - parts.path.from),
        leaf(ObsidianNode.InternalLinkSubpath, parts.subpath ? targetEnd - parts.subpath.from : 0),
        parts.aliasMark ? leaf(ObsidianNode.InternalLinkAliasMark, parts.aliasMark.to - parts.aliasMark.from) : [],
        parts.alias ? leaf(ObsidianNode.InternalLinkAlias, parts.alias.to - parts.alias.from) : [],
        leaf(ObsidianNode.InternalLinkMark, DELIMITER_SIZE)
      );
    },
    ok,
    nok
  );
}

// CommonMark's link reference definition, except that `[^label]:` never opens one: that is a footnote.
function tokenizeLinkDefinition(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return lookahead(effects, true, (text) => text.startsWith('[^') ? null : [], (code) => definition.tokenize.call(context, effects, ok, nok)(code), nok);
}

function tokenizeNonLazyContinuation(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return start;

  function start(code: Code): State | undefined {
    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
    return lineStart;
  }

  function lineStart(code: Code): State | undefined {
    return code === null || context.parser.lazy[context.now().line] === true ? nok(code) : ok(code);
  }
}

function tokenizeTag(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return (code) => {
    if (!canOpenTagAfter(charOf(context.previous))) {
      return nok(code);
    }
    return lookahead(
      effects,
      true,
      (text) => {
        const length = matchTagName(text.slice(1));
        return length === 0 ? null : node(ObsidianNode.Tag, leaf(ObsidianNode.TagMark, 1), leaf(ObsidianNode.TagName, length));
      },
      ok,
      nok
    )(code);
  };
}

/*
 * A task marker opens the first paragraph of a list item. The task covers the paragraph, and the text after the marker
 * and its whitespace is read as inline content inside it.
 */
function tokenizeTask(context: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return (code) => {
    if (context.previous !== null || context._gfmTasklistFirstContentOfListItem !== true) {
      return nok(code);
    }
    return lookahead(
      effects,
      false,
      (text) => {
        const length = matchTaskMarker(text);
        if (length === 0) {
          return null;
        }
        const rest = text.slice(length);
        const [firstLine = { eol: 0, text: '' }, nextLine] = splitLines(rest);
        const space = LEADING_SPACE_RE.exec(firstLine.text)?.[0].length ?? 0;
        // A marker with nothing but whitespace after it on its line takes the line ending and the next line's indentation.
        const isLineBlank = space === firstLine.text.length && nextLine !== undefined;
        const eol = isLineBlank ? firstLine.eol : 0;
        const nextIndent = isLineBlank ? LEADING_SPACE_RE.exec(nextLine.text)?.[0].length ?? 0 : 0;
        return node(
          ObsidianNode.Task,
          leaf(ObsidianNode.TaskMarker, length),
          leaf(ObsidianToken.Part, space),
          leaf(ObsidianToken.LineEnding, eol),
          leaf(ObsidianToken.Part, nextIndent),
          textChunk(rest.length - space - eol - nextIndent)
        );
      },
      ok,
      nok
    )(code);
  };
}

function unitsOf(code: Code): number {
  if (code === null) {
    return 0;
  }
  if (code === Char.CarriageReturnLineFeed) {
    return DELIMITER_SIZE;
  }
  return code > MAX_BMP_CODE_POINT ? DELIMITER_SIZE : 1;
}

// Hands a tokenizer its context as a parameter.
function withContext(tokenize: ContextTokenizer): Tokenizer {
  return function tokenizeWithContext(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    return tokenize(this, effects, ok, nok);
  };
}
