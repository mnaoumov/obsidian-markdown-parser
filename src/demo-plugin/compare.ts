/**
 * @file
 *
 * The demo plugin's comparisons, free of Obsidian: the node list of an editor tree as the oracle reads it, where two
 * trees first give a character or a line different classes, where two node lists first differ, where two metadata
 * values first differ, and the median of timings.
 */

import type { Tree } from '@lezer/common';

import type { OracleNode } from '../oracle/oracle-file.ts';

import {
  classSetsOf,
  compareCodeUnits,
  lineStartsOf
} from '../oracle/classes/score.ts';

/**
 * Where two trees first give a character or a line different classes.
 */
export interface ClassDifference {
  /**
   * The character offset, or the line index for a line.
   */
  readonly index: number;

  /**
   * Whether a character's token classes or a line's line classes differ.
   */
  readonly kind: 'character' | 'line';
}

/**
 * Where two node lists first differ.
 */
export interface NodeListDifference {
  /**
   * The actual list's node there, or `null` past its end.
   */
  readonly actual: null | OracleNode;

  /**
   * The expected list's node there, or `null` past its end.
   */
  readonly expected: null | OracleNode;

  /**
   * The index of the first node that differs.
   */
  readonly index: number;
}

const HALF = 0.5;
const PAIR = 2;

/**
 * Finds where two trees' nodes first give a character different token classes or a line different line classes, the
 * measure the oracle scores by.
 *
 * @param text - The document.
 * @param expected - The expected nodes.
 * @param actual - The actual nodes.
 * @returns The first difference, characters first, or `null` when every character and line has the same classes.
 */
export function findClassDifference(text: string, expected: readonly OracleNode[], actual: readonly OracleNode[]): ClassDifference | null {
  const expectedSets = classSetsOf(text, expected);
  const actualSets = classSetsOf(text, actual);
  for (let index = 0; index < text.length; index++) {
    if (!areSetsEqual(expectedSets.tok[index], actualSets.tok[index])) {
      return { index, kind: 'character' };
    }
  }
  for (const index of lineStartsOf(text).keys()) {
    if (!areSetsEqual(expectedSets.line[index], actualSets.line[index])) {
      return { index, kind: 'line' };
    }
  }
  return null;
}

/**
 * Finds where two node lists first differ.
 *
 * @param expected - The expected nodes.
 * @param actual - The actual nodes.
 * @returns The first difference, or `null` when the lists are equal.
 */
export function findNodeListDifference(expected: readonly OracleNode[], actual: readonly OracleNode[]): NodeListDifference | null {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index++) {
    const expectedNode = expected[index] ?? null;
    const actualNode = actual[index] ?? null;
    if (!expectedNode || !actualNode || expectedNode.some((part, partIndex) => part !== actualNode[partIndex])) {
      return { actual: actualNode, expected: expectedNode, index };
    }
  }
  return null;
}

/**
 * Finds where two metadata values first differ, ignoring key order, as JSON compares them: `undefined` properties are
 * absent.
 *
 * @param expected - The expected value.
 * @param actual - The actual value.
 * @returns The path of the first difference, `$` for the values themselves, or `null` when they are equal.
 */
export function findValueDifference(expected: unknown, actual: unknown): null | string {
  return findDifferenceAt(normalize(expected), normalize(actual), '$');
}

/**
 * The median of a list of numbers.
 *
 * @param values - The numbers.
 * @returns The median, or `NaN` for an empty list.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length * HALF);
  return sorted.length % PAIR === 1 ? sorted[middle] ?? NaN : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) * HALF;
}

/**
 * Reads a tree's nodes below its top node in document order, as the oracle reads the live editor's tree.
 *
 * @param tree - The tree.
 * @returns The nodes.
 */
export function readTreeNodes(tree: Tree): OracleNode[] {
  const nodes: OracleNode[] = [];
  const cursor = tree.cursor();
  let depth = 0;
  for (;;) {
    if (depth > 0) {
      nodes.push([cursor.from, cursor.to, depth, cursor.type.name]);
    }
    if (cursor.firstChild()) {
      depth++;
      continue;
    }
    while (!cursor.nextSibling()) {
      if (!cursor.parent()) {
        return nodes;
      }
      depth--;
    }
  }
}

function areSetsEqual(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
  const left = a ?? new Set<string>();
  const right = b ?? new Set<string>();
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function findDifferenceAt(expected: unknown, actual: unknown, path: string): null | string {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      return path;
    }
    for (const [index, item] of expected.entries()) {
      const found = findDifferenceAt(item, actual[index], `${path}[${String(index)}]`);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].toSorted(compareCodeUnits)) {
      const found = findDifferenceAt(expected[key], actual[key], `${path}.${key}`);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  return Object.is(expected, actual) ? null : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalize(value: unknown): unknown {
  const json = JSON.stringify(value);
  return json === undefined ? undefined : JSON.parse(json);
}
