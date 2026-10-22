/**
 * @file
 *
 * Measures how much of a tree a re-parse took from the tree before it, for the suite and the bench: a chunk the parse
 * reused shares its array of children with the earlier tree's chunk, even an empty one, and a chunk it parsed again has
 * an array of its own.
 */

import { Tree } from '@lezer/common';

/**
 * How many characters of a tree are covered by chunks taken from an earlier tree, whether the re-parse resumed after
 * them or reused them after an edit.
 *
 * @param previous - The earlier tree.
 * @param next - The tree of the re-parse, built from the earlier tree's fragments.
 * @returns The length of the reused chunks.
 */
export function reusedLength(previous: Tree, next: Tree): number {
  const previousNodes = new Set<readonly unknown[]>();
  collectChildArrays(previous, previousNodes);
  return sharedLength(next, previousNodes);
}

function collectChildArrays(tree: Tree, arrays: Set<readonly unknown[]>): void {
  arrays.add(tree.children);
  for (const child of tree.children) {
    if (child instanceof Tree) {
      collectChildArrays(child, arrays);
    }
  }
}

function sharedLength(tree: Tree, previousNodes: ReadonlySet<readonly unknown[]>): number {
  if (previousNodes.has(tree.children)) {
    return tree.length;
  }
  let length = 0;
  for (const child of tree.children) {
    if (child instanceof Tree) {
      length += sharedLength(child, previousNodes);
    }
  }
  return length;
}
