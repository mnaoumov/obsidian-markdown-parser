/**
 * @file
 *
 * Runs the editor mode over a document, the way the editor does: one line at a time, carrying the state forward and
 * calling `blankLine` for empty lines. Classes prefixed `line-` or `line-background-` belong to the line.
 *
 * A line start outside a fenced code block and outside a script or style element of an HTML block is a resume point:
 * the state after that line can be copied, and highlighting the rest of the document from that copy gives the same
 * classes as highlighting the whole document. {@link isLineStateResumable} tells which states are.
 */

import type { ObsidianState } from './obsidian-mode.ts';
import type { LineReader } from './string-stream.ts';

import { areStatesEqual } from './mode.ts';
import { createObsidianMode } from './obsidian-mode.ts';
import { StringStream } from './string-stream.ts';
import { isHtmlInEmbeddedMode } from './sub-modes.ts';

/**
 * A run of characters with the classes the editor gives them.
 */
export interface ClassSpan {
  /**
   * The classes, in the order the mode emitted them (duplicates kept).
   */
  readonly classes: readonly string[];

  /**
   * The document offset where the span starts.
   */
  readonly from: number;

  /**
   * The document offset where the span ends.
   */
  readonly to: number;
}

/**
 * Which Obsidian release's editor classes the tokenizer gives.
 */
export interface EditorClassOptions {
  /**
   * The Obsidian version, as `x.y.z`. From 1.15.0 on, a mark that closes emphasis, strikethrough or a code span also
   * wears `formatting-<kind>-end`, and a `***` that opens both emphases wears `formatting-em` beside
   * `formatting-strong`.
   *
   * @default The classes of Obsidian 1.14.
   */
  readonly obsidianVersion?: string;
}

/**
 * The classes of one line.
 */
export interface HighlightedLine {
  /**
   * The line classes (rendered on `.cm-line`).
   */
  readonly classes: readonly string[];

  /**
   * The document offset of the line's start.
   */
  readonly from: number;

  /**
   * The token spans on the line.
   */
  readonly spans: readonly ClassSpan[];

  /**
   * The document offset of the line's end, before its newline.
   */
  readonly to: number;
}

/**
 * Parameters of {@link highlightLines}.
 */
export interface HighlightLinesParams extends EditorClassOptions {
  /**
   * The document's lines, without their newlines.
   */
  readonly lines: readonly string[];

  /**
   * Called with a copy of the state after each line, for callers that keep resume points.
   */
  readonly onLineEnd?: (lineIndex: number, state: LineState) => void;

  /**
   * The index of the first line to highlight.
   *
   * @default 0
   */
  readonly startLine?: number;

  /**
   * The state before `startLine`, from {@link HighlightLinesParams.onLineEnd}. A fresh state for `obsidianVersion` when
   * omitted; a given state keeps the version it was started for.
   */
  readonly state?: LineState;
}

/**
 * Options of {@link highlight}.
 */
export type HighlightOptions = EditorClassOptions;

/**
 * The tokenizer state between two lines. Treat it as opaque: copy it with {@link copyLineState} before reusing it.
 */
export type LineState = ObsidianState;

/**
 * Options of {@link startLineState}.
 */
export type StartLineStateOptions = EditorClassOptions;

/**
 * The classes of one line, with offsets relative to the line's start.
 */
export interface TokenizedLine {
  /**
   * The line classes (rendered on `.cm-line`).
   */
  readonly classes: readonly string[];

  /**
   * The token spans, relative to the line's start.
   */
  readonly spans: readonly ClassSpan[];
}

/**
 * Parameters of {@link tokenizeLine}.
 */
export interface TokenizeLineParams {
  /**
   * The line, without its newline.
   */
  readonly line: string;

  /**
   * The index of the line in the document, for error messages.
   */
  readonly lineIndex: number;

  /**
   * Reads the line `offset` lines after this one, or `undefined` past the end of the document.
   */
  readonly readLine: LineReader;

  /**
   * The state before the line. The call advances it past the line.
   */
  readonly state: LineState;
}

const LINE_CLASS_RE = /^line-(?:background-)?(?<name>.+)$/u;
const MAX_TOKENS_PER_POSITION = 10;
// The first release whose editor marks the end of emphasis, strikethrough and code spans.
const FORMATTING_END_MAJOR = 1;
const FORMATTING_END_MINOR = 15;
const VERSION_RE = /^(?<major>\d+)\.(?<minor>\d+)/u;
const mode = createObsidianMode();

interface HighlightLineParams {
  readonly line: string;
  readonly lineIndex: number;
  readonly lines: readonly string[];
  readonly offset: number;
  readonly state: ObsidianState;
}

/**
 * Whether two tokenizer states are equal: the lines after either give the same classes, so a parse that reaches a state
 * equal to an earlier parse's at the same text can reuse what that parse gave from there on.
 *
 * A state that is not resumable ({@link isLineStateResumable}) is equal to no other.
 *
 * @param a - A state.
 * @param b - Another state.
 * @returns `true` when they are equal.
 */
export function areLineStatesEqual(a: LineState, b: LineState): boolean {
  return isLineStateResumable(a) && areStatesEqual(a, b);
}

/**
 * Copies a tokenizer state, so it can be kept as a resume point.
 *
 * @param state - The state.
 * @returns The copy.
 */
export function copyLineState(state: LineState): LineState {
  return mode.copyState(state);
}

/**
 * Highlights a document.
 *
 * @param text - The document.
 * @param options - Which Obsidian release's classes to give.
 * @returns Its lines with their classes.
 */
export function highlight(text: string, options: HighlightOptions = {}): HighlightedLine[] {
  return highlightLines({ ...options, lines: text.split('\n') });
}

/**
 * Highlights the lines of a document from a given line on, optionally resuming from a saved state.
 *
 * @param params - The lines, and where and how to start.
 * @returns The highlighted lines from `startLine` on.
 */
export function highlightLines(params: HighlightLinesParams): HighlightedLine[] {
  const { lines, onLineEnd, startLine = 0 } = params;
  const state = params.state ? mode.copyState(params.state) : startLineState(params);
  let offset = 0;
  for (let index = 0; index < startLine; index++) {
    offset += (lines[index] ?? '').length + 1;
  }
  const out: HighlightedLine[] = [];
  for (let lineIndex = startLine; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';
    out.push(highlightLine({ line, lineIndex, lines, offset, state }));
    onLineEnd?.(lineIndex, mode.copyState(state));
    offset += line.length + 1;
  }
  return out;
}

/**
 * Whether highlighting from a copy of a state gives what the parse that reached it gives from there on.
 *
 * A state inside a fenced code block, or inside a script or style element of an HTML block, is not. It holds a
 * CodeMirror 5 mode made for that block when the block opened, and such a mode can keep state of its own between tokens,
 * outside the state: the CSS mode keeps the last token's type, and a `-` it reads no token from takes that type. A copy
 * of the state shares the mode, so what the lines after it give depends on what that mode object tokenized last. A
 * resume before the block makes the mode again when the block opens, as a parse from the start does.
 *
 * @param state - The state after a line.
 * @returns `true` when the state is a resume point.
 */
export function isLineStateResumable(state: LineState): boolean {
  return state.localMode === null && (state.htmlState === null || !isHtmlInEmbeddedMode(state.htmlState));
}

/**
 * Creates the tokenizer state at the start of a document. The lines tokenized from it get the classes of the Obsidian
 * release it was started for.
 *
 * @param options - Which Obsidian release's classes to give.
 * @returns The state.
 */
export function startLineState(options: StartLineStateOptions = {}): LineState {
  const state = mode.startState();
  state.isFormattingEndMarked = isFormattingEndMarkedIn(options.obsidianVersion);
  return state;
}

/**
 * Tokenizes one line, the way the editor does: an empty line goes to `blankLine`, any other line is read token by
 * token. The caller decides whether to tokenize an empty last line, which the editor never does.
 *
 * @param params - The line, the state before it and how to read the lines after it.
 * @returns The line's classes, with offsets relative to its start.
 */
export function tokenizeLine(params: TokenizeLineParams): TokenizedLine {
  const { line, lineIndex, readLine, state } = params;
  const lineClasses: string[] = [];
  const spans: ClassSpan[] = [];
  function addStyle(style: null | string, from: number, to: number): void {
    const tokenClasses: string[] = [];
    const classes = (style ?? '').split(/\s+/u);
    for (const cls of classes) {
      if (!cls) {
        continue;
      }
      const lineClass = LINE_CLASS_RE.exec(cls)?.groups?.['name'];
      if (lineClass) {
        // Like CodeMirror, a line class is added once however many tokens carry it.
        if (!lineClasses.includes(lineClass)) {
          lineClasses.push(lineClass);
        }
      } else {
        tokenClasses.push(cls);
      }
    }
    // A token with no style is no span, but one whose style holds line classes only is a span with no classes.
    if (style !== null && to > from) {
      spans.push({ classes: tokenClasses, from, to });
    }
  }
  if (line.length === 0) {
    addStyle(mode.blankLine(state), 0, 0);
  } else {
    const stream = new StringStream({ line, lineIndex, readLine });
    while (!stream.eol()) {
      stream.start = stream.pos;
      addStyle(readToken(stream, state), stream.start, stream.pos);
    }
  }
  return { classes: lineClasses, spans };
}

function highlightLine(params: HighlightLineParams): HighlightedLine {
  const { line, lineIndex, lines, offset, state } = params;
  // The editor never parses an empty last line: its parse ends at the document's length.
  if (line.length === 0 && lineIndex === lines.length - 1) {
    return { classes: [], from: offset, spans: [], to: offset };
  }
  const { classes, spans } = tokenizeLine({ line, lineIndex, readLine: (n): null | string => lines[lineIndex + n] ?? null, state });
  return {
    classes,
    from: offset,
    spans: spans.map((span) => ({ classes: span.classes, from: offset + span.from, to: offset + span.to })),
    to: offset + line.length
  };
}

function isFormattingEndMarkedIn(obsidianVersion: string | undefined): boolean {
  const groups = obsidianVersion === undefined ? undefined : VERSION_RE.exec(obsidianVersion)?.groups;
  const major = Number(groups?.['major'] ?? 0);
  const minor = Number(groups?.['minor'] ?? 0);
  return major > FORMATTING_END_MAJOR || (major === FORMATTING_END_MAJOR && minor >= FORMATTING_END_MINOR);
}

// Like the editor, a token may be empty while it changes the state, but the mode must advance within a few calls.
function readToken(stream: StringStream, state: ObsidianState): null | string {
  for (let attempt = 0; attempt < MAX_TOKENS_PER_POSITION; attempt++) {
    const style = mode.token(stream, state);
    if (stream.pos > stream.start) {
      return style;
    }
  }
  throw new Error(`The mode failed to advance on line ${String(stream.lineIndex)} at column ${String(stream.pos)}`);
}
