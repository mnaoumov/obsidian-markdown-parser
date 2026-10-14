/**
 * @file
 *
 * Runs the editor mode over a document, the way the editor does: one line at a time, carrying the state forward and
 * calling `blankLine` for empty lines. Classes prefixed `line-` or `line-background-` belong to the line.
 *
 * Every line start is a resume point: the state after any line can be copied, and highlighting the rest of the
 * document from that copy gives the same classes as highlighting the whole document.
 */

import type { ObsidianState } from './obsidian-mode.ts';

import { createObsidianMode } from './obsidian-mode.ts';
import { StringStream } from './string-stream.ts';

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
export interface HighlightLinesParams {
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
   * The state before `startLine`, from {@link HighlightLinesParams.onLineEnd}. A fresh state when omitted.
   */
  readonly state?: LineState;
}

/**
 * The tokenizer state between two lines. Treat it as opaque: copy it with {@link copyLineState} before reusing it.
 */
export type LineState = ObsidianState;

const LINE_CLASS_RE = /^line-(?:background-)?(?<name>.+)$/u;
const MAX_TOKENS_PER_POSITION = 10;
const mode = createObsidianMode();

interface HighlightLineParams {
  readonly line: string;
  readonly lineIndex: number;
  readonly lines: readonly string[];
  readonly offset: number;
  readonly state: ObsidianState;
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
 * @returns Its lines with their classes.
 */
export function highlight(text: string): HighlightedLine[] {
  return highlightLines({ lines: text.split('\n') });
}

/**
 * Highlights the lines of a document from a given line on, optionally resuming from a saved state.
 *
 * @param params - The lines, and where and how to start.
 * @returns The highlighted lines from `startLine` on.
 */
export function highlightLines(params: HighlightLinesParams): HighlightedLine[] {
  const { lines, onLineEnd, startLine = 0 } = params;
  const state = params.state ? mode.copyState(params.state) : mode.startState();
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

function highlightLine(params: HighlightLineParams): HighlightedLine {
  const { line, lineIndex, lines, offset, state } = params;
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
    if (to > from) {
      spans.push({ classes: tokenClasses, from: offset + from, to: offset + to });
    }
  }
  if (line.length === 0) {
    // The editor never parses an empty last line: its parse ends at the document's length.
    if (lineIndex < lines.length - 1) {
      addStyle(mode.blankLine(state), 0, 0);
    }
  } else {
    const stream = new StringStream({ line, lineIndex, readLine: (n): string | undefined => lines[lineIndex + n] });
    while (!stream.eol()) {
      stream.start = stream.pos;
      addStyle(readToken(stream, state), stream.start, stream.pos);
    }
  }
  return { classes: lineClasses, from: offset, spans, to: offset + line.length };
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
