/* eslint-disable import-x/no-nodejs-modules -- The suite runs in Node and reads the oracle fixtures from disk. */
import { readFileSync } from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules -- Only the fixture imports above need Node. */
import {
  describe,
  expect,
  it
} from 'vitest';

import type { OracleFile } from './oracle-file.ts';

import { classSetsOf } from './score.ts';
import {
  compareSyntax,
  CONSTRUCTS
} from './syntax-score.ts';

const ORACLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle');
const ORACLE_FILES = [
  'obsidian-1.14.4-seed-12345.json',
  'obsidian-1.14.4-seed-777.json',
  'obsidian-1.14.4-seed-4242.json',
  'obsidian-1.14.4-seed-2026.json',
  'obsidian-1.14.4-seed-9001.json'
];

/*
 * Per construct, the documents of the five oracles that use it and the documents where the tree agrees with the live
 * editor. `docs/syntax.md` explains the rest. A change that moves either number in either direction must update it here.
 */
const EXPECTED_SCORES = new Map<string, readonly [using: number, agreeing: number]>([
  ['block id', [979, 946]],
  ['callout', [426, 395]],
  ['comment', [1962, 1453]],
  ['footnote definition', [455, 436]],
  ['footnote reference', [384, 360]],
  ['front matter', [2732, 2732]],
  ['highlight', [2177, 1437]],
  ['inline footnote', [355, 342]],
  ['internal link', [1416, 1334]],
  ['math', [1775, 1357]],
  ['tag', [951, 894]],
  ['task marker', [1054, 937]]
]);

describe('compareSyntax', () => {
  it('should score the tree against the live editor as recorded', () => {
    const scores = new Map<string, [number, number]>(CONSTRUCTS.map((c) => [c.name, [0, 0]]));
    for (const file of ORACLE_FILES) {
      const oracle = JSON.parse(readFileSync(join(ORACLE_DIR, file), 'utf-8')) as OracleFile;
      for (const document of oracle.docs) {
        const comparisons = compareSyntax(document.text, classSetsOf(document.text, document.nodes));
        for (const [name, comparison] of comparisons) {
          const score = scores.get(name);
          if (!score || comparison.editorCount + comparison.treeCount === 0) {
            continue;
          }
          score[0]++;
          if (comparison.extra.length === 0 && comparison.missed.length === 0) {
            score[1]++;
          }
        }
      }
    }
    expect(scores).toEqual(EXPECTED_SCORES);
  });

  it('should find a construct the editor marks and the tree misses, and one the tree marks alone', () => {
    const text = 'a #t';
    const sets = classSetsOf(text, [[2, 4, 1, 'hashtag']]);
    expect(compareSyntax(text, sets).get('tag')).toEqual({ editorCount: 2, extra: [], missed: [], treeCount: 2 });
    const none = classSetsOf(text, []);
    expect(compareSyntax(text, none).get('tag')).toEqual({ editorCount: 0, extra: [2, 3], missed: [], treeCount: 2 });
  });
});
