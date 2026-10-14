/**
 * @file
 *
 * The shape of a line mode: CodeMirror's stream-parser interface, which both the markdown modes here and the
 * CodeMirror legacy modes implement.
 */

import type { StringStream as CodeMirrorStringStream } from '@codemirror/streamparser';

/**
 * A mode whose state type is not known to the caller.
 */
export type AnyMode = Mode<object>;

/**
 * A line mode: a tokenizer with copyable state that reads one line at a time.
 */
export interface Mode<State> {
  /**
   * Notifies the mode of an empty line.
   *
   * @param state - The state.
   * @param indentUnit - The indent unit.
   * @returns A style for the line, if any.
   */
  blankLine?: (state: State, indentUnit: number) => null | string | undefined;

  /**
   * Copies a state.
   *
   * @param state - The state.
   * @returns The copy.
   */
  copyState?: (state: State) => State;

  /**
   * The mode's name.
   */
  name?: string;

  /**
   * Creates the state at the start of a document.
   *
   * @param baseColumn - The column the mode's text starts at. CodeMirror 5's markdown mode never passes one.
   * @returns The state.
   */
  startState?: (baseColumn?: number) => State;

  /**
   * Reads one token.
   *
   * @param stream - The line cursor.
   * @param state - The state.
   * @returns The token's space-separated classes, or `null` for none.
   */
  token: (stream: CodeMirrorStringStream, state: State) => null | string;
}

/**
 * Copies a mode's state, the way CodeMirror does when the mode has no `copyState`: a shallow copy that also copies
 * arrays held at the top level.
 *
 * @param mode - The mode.
 * @param state - The state.
 * @returns The copy.
 */
export function copyState(mode: AnyMode, state: object): object {
  if (mode.copyState) {
    return mode.copyState(state);
  }
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    copy[key] = Array.isArray(value) ? [...value] : value;
  }
  return copy;
}

/**
 * Creates a mode's start state, the way CodeMirror 5's markdown mode does: with no base column, since a mode such as
 * Python reads one as the indentation its first scope starts at.
 *
 * @param mode - The mode.
 * @returns The state.
 */
export function startState(mode: AnyMode): object {
  return mode.startState?.() ?? {};
}
