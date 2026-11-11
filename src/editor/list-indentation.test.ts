import {
  describe,
  expect,
  it
} from 'vitest';

import { highlight } from './highlight.ts';

/*
 * A child list indented less than CommonMark's content column, at it, and past it, with spaces and with a tab, and the
 * list depth the live editor of Obsidian 1.15.0 gave each line, read on 2026-11-10 (`HyperMD-list-line-<depth>`, `0`
 * for a line that is no list line). The worker's `listItems` and the reading view nest exactly where the editor does;
 * the worker oracle pins its side. Docs: `docs/remark-obsidian.md`.
 */
const MEASURED: readonly (readonly [text: string, depths: readonly number[]])[] = [
  ['1. a\n  - b', [1, 1]],
  ['1. a\n   - b', [1, 2]],
  ['1. a\n\t- b', [1, 2]],
  ['- a\n - b', [1, 1]],
  ['- a\n   - b', [1, 2]],
  ['- a\n    - b', [1, 2]],
  ['- a\n     - b', [1, 2]],
  ['- a\n\t- b', [1, 2]],
  ['10. a\n   - b', [1, 1]],
  ['10. a\n    - b', [1, 2]],
  ['10. a\n\t- b', [1, 2]],
  ['1. a\n  b', [1, 0]],
  ['- a\n\n   - b', [1, 0, 2]],
  ['- a\n\n    - b', [1, 0, 2]]
];

function listDepth(classes: readonly string[]): number {
  for (const name of classes) {
    const match = /^HyperMD-list-line-(?<depth>\d+)$/.exec(name);
    if (match?.groups?.['depth'] !== undefined) {
      return Number(match.groups['depth']);
    }
  }
  return 0;
}

describe('list indentation', () => {
  it.each(MEASURED)('nests %j as the live editor does', (text, depths) => {
    expect(highlight(text).map((line) => listDepth(line.classes))).toEqual(depths);
  });
});
