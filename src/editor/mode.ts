/**
 * @file
 *
 * The shape of a line mode: CodeMirror's stream-parser interface, which both the markdown modes here and the
 * CodeMirror legacy modes implement.
 */

import { StringStream as CodeMirrorStringStream } from '@codemirror/streamparser';

/**
 * A mode whose state type is not known to the caller.
 */
export type AnyMode = Mode<object>;

const BUILT_IN_PROTOTYPES: ReadonlySet<unknown> = new Set([
  ArrayBuffer.prototype,
  Date.prototype,
  Map.prototype,
  Object.getPrototypeOf(Uint8Array.prototype),
  Promise.prototype,
  RegExp.prototype,
  Set.prototype,
  WeakMap.prototype,
  WeakSet.prototype
]);

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
 * Whether two mode states are equal, so a line tokenized from either gives the same classes and the same state after
 * it. Plain objects, class instances and arrays are compared by their own properties and elements, a line's stream by
 * its text, and anything else, functions and built-in objects such as regular expressions included, by identity. So
 * two states whose tokenizer functions are different closures are never equal, even when the closures behave the same.
 *
 * @param a - A state.
 * @param b - Another state.
 * @returns `true` when they are equal.
 */
export function areStatesEqual(a: unknown, b: unknown): boolean {
  return areValuesEqual(a, b, new Map());
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

// `seen` holds the pairs already being compared, so a cycle compares equal where it closes.
function areValuesEqual(a: unknown, b: unknown, seen: Map<object, object>): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  // A state keeps a line's stream to read its text from a later line, which reads nothing else of it.
  if (a instanceof CodeMirrorStringStream && b instanceof CodeMirrorStringStream) {
    return a.string === b.string;
  }
  if (!isComparedByValue(a) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
    return false;
  }
  if (seen.get(a) === b) {
    return true;
  }
  seen.set(a, b);
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  return keys.every((key) => Object.hasOwn(b, key) && areValuesEqual(aRecord[key], bRecord[key], seen));
}

// A built-in object keeps its contents out of its own properties, so it is compared by identity.
function isComparedByValue(value: object): boolean {
  if (Array.isArray(value)) {
    return true;
  }
  let prototype = Object.getPrototypeOf(value) as null | object;
  while (prototype !== null && prototype !== Object.prototype) {
    if (BUILT_IN_PROTOTYPES.has(prototype)) {
      return false;
    }
    prototype = Object.getPrototypeOf(prototype) as null | object;
  }
  return true;
}
