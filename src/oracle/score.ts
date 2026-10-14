/**
 * @file
 *
 * Compares the classes the tokenizer predicts with the classes the oracle read from the live editor, per character
 * (token classes) and per line (line classes).
 *
 * Both sides go through the same encoding the editor's tree uses, classes sorted and joined by `_`, so a class that
 * itself contains `_` (a `tag-<name>` of a tag with an underscore) splits the same way on both.
 */

import type { HighlightedLine } from '../editor/highlight.ts';
import type {
  OracleDocument,
  OracleNode
} from './oracle-file.ts';

import { highlight } from '../editor/highlight.ts';

const LINE_NODE_DEPTH = 1;
const NESTED_NODE_DEPTH = 2;
const HALVES = 2;

/**
 * The classes per character and per line.
 */
export interface ClassSets {
  /**
   * The line classes of each line.
   */
  readonly line: readonly ReadonlySet<string>[];

  /**
   * The token classes of each character (empty for newlines).
   */
  readonly tok: readonly ReadonlySet<string>[];
}

/**
 * One disagreement.
 */
export interface Difference {
  /**
   * The class.
   */
  readonly cls: string;

  /**
   * Whether the oracle has it and the prediction does not.
   */
  readonly kind: 'extra' | 'missed';

  /**
   * The line index.
   */
  readonly line: number;

  /**
   * The character offset, or `null` for a line class.
   */
  readonly pos: null | number;
}

/**
 * The comparison of one document.
 */
export interface DocumentComparison {
  /**
   * Every disagreement.
   */
  readonly differences: readonly Difference[];

  /**
   * The oracle's classes.
   */
  readonly oracle: ClassSets;

  /**
   * The predicted classes.
   */
  readonly predicted: ClassSets;
}

/**
 * Decodes the editor tree's nodes into class sets.
 *
 * @param text - The document.
 * @param nodes - The nodes.
 * @returns The classes per character and per line.
 */
export function classSetsOf(text: string, nodes: readonly OracleNode[]): ClassSets {
  const starts = lineStartsOf(text);
  const tok = Array.from({ length: text.length }, () => new Set<string>());
  const line = starts.map(() => new Set<string>());
  for (const [from, to, depth, name] of nodes) {
    const names = name.split('_').filter(Boolean);
    if (depth === LINE_NODE_DEPTH && names.length > 0 && names.every((n) => n.startsWith('HyperMD-'))) {
      const lineSet = line[lineIndexOf(starts, from)];
      for (const n of names) {
        lineSet?.add(n);
      }
      continue;
    }
    for (let index = from; index < to; index++) {
      if (text[index] !== '\n') {
        for (const n of names) {
          tok[index]?.add(n);
        }
      }
    }
  }
  return { line, tok };
}

/**
 * Orders strings by UTF-16 code units, the order `Array#sort()` uses without a compare function.
 *
 * @param a - The first string.
 * @param b - The second string.
 * @returns A negative number, zero or a positive number.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * Compares the prediction for a document with the oracle.
 *
 * @param oracleDocument - The oracle document.
 * @returns The comparison.
 */
export function compareDocument(oracleDocument: OracleDocument): DocumentComparison {
  const { text } = oracleDocument;
  const starts = lineStartsOf(text);
  const oracle = classSetsOf(text, oracleDocument.nodes);
  const predicted = classSetsOf(text, toNodes(highlight(text)));
  const differences: Difference[] = [];
  function compare(o: ReadonlySet<string> | undefined, p: ReadonlySet<string> | undefined, line: number, pos: null | number): void {
    const oracleClasses = o ?? [];
    for (const cls of oracleClasses) {
      if (!p?.has(cls)) {
        differences.push({ cls, kind: 'missed', line, pos });
      }
    }
    const predictedClasses = p ?? [];
    for (const cls of predictedClasses) {
      if (!o?.has(cls)) {
        differences.push({ cls, kind: 'extra', line, pos });
      }
    }
  }
  for (let index = 0; index < text.length; index++) {
    compare(oracle.tok[index], predicted.tok[index], lineIndexOf(starts, index), index);
  }
  for (const l of starts.keys()) {
    compare(oracle.line[l], predicted.line[l], l, null);
  }
  return { differences, oracle, predicted };
}

/**
 * The start offset of each line.
 *
 * @param text - The document.
 * @returns The offsets.
 */
export function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (const match of text.matchAll(/\n/gu)) {
    starts.push(match.index + 1);
  }
  return starts;
}

/**
 * Turns highlighted lines into nodes in the editor tree's encoding.
 *
 * @param lines - The highlighted lines.
 * @returns The nodes.
 */
export function toNodes(lines: readonly HighlightedLine[]): OracleNode[] {
  const nodes: OracleNode[] = [];
  for (const line of lines) {
    const hasLineNode = line.classes.length > 0;
    if (hasLineNode) {
      nodes.push([line.from, line.to, LINE_NODE_DEPTH, encode(line.classes)]);
    }
    for (const span of line.spans) {
      nodes.push([span.from, span.to, hasLineNode ? NESTED_NODE_DEPTH : LINE_NODE_DEPTH, encode(span.classes)]);
    }
  }
  return nodes;
}

function encode(classes: readonly string[]): string {
  return classes.toSorted(compareCodeUnits).join('_');
}

function lineIndexOf(starts: readonly number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / HALVES);
    if ((starts[mid] ?? 0) <= pos) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}
