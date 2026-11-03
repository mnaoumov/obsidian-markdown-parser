/**
 * @file
 *
 * Scores the Obsidian syntax tree against the live editor's classes in oracle files, construct by construct.
 *
 * Usage:
 * - `jiti scripts/oracles/syntax-diff.ts [--oracle <file>]...`: per construct, the documents that use it and those that agree.
 * - `jiti scripts/oracles/syntax-diff.ts --construct <name> --examples <n>`: the first `n` disagreements of one construct.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { OracleFile } from '../../src/oracle/oracle-file.ts';

import { classSetsOf } from '../../src/oracle/classes/score.ts';
import {
  compareSyntax,
  CONSTRUCTS
} from '../../src/oracle/classes/syntax-score.ts';
import {
  classOracleFileName,
  oracleDirectory
} from '../../src/oracle/oracle-location.ts';

interface ConstructScore {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Syntax scoring increments this counter as it compares documents.
  agreeing: number;
  readonly failing: string[];
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Syntax scoring increments this counter as it compares documents.
  using: number;
}

// eslint-disable-next-line no-magic-numbers -- These seed identifiers select the historically measured corpora.
const DEFAULT_ORACLE_SEEDS = [12_345, 777, 4242, 2026, 9001];
const DEFAULT_ORACLES = DEFAULT_ORACLE_SEEDS.map((seed) => join(oracleDirectory(), classOracleFileName(seed)));
const NAME_COLUMN_WIDTH = 22;
const COUNT_COLUMN_WIDTH = 7;
const CONTEXT = 30;

const { values } = parseArgs({
  options: {
    construct: { type: 'string' },
    examples: { default: '5', type: 'string' },
    oracle: { multiple: true, type: 'string' }
  }
});

const scores = new Map<string, ConstructScore>(CONSTRUCTS.map((c) => [c.name, { agreeing: 0, failing: [], using: 0 }]));
let shown = 0;
const oracleFiles = values.oracle ?? DEFAULT_ORACLES;
for (const file of oracleFiles) {
  const oracle = JSON.parse(readFileSync(file, 'utf-8')) as OracleFile;
  for (const document of oracle.docs) {
    const comparison = compareSyntax(document.text, classSetsOf(document.text, document.nodes));
    for (const [name, { editorCount, extra, missed, treeCount }] of comparison) {
      const score = scores.get(name);
      if (!score) {
        continue;
      }
      // A document counts for a construct when either side marks it.
      if (editorCount + treeCount === 0) {
        continue;
      }
      score.using++;
      if (extra.length === 0 && missed.length === 0) {
        score.agreeing++;
        continue;
      }
      score.failing.push(`${file.replace(/^.*seed-/u, '').replace('.json', '')}:${document.id}`);
      if (!(name === values.construct && shown < Number(values.examples))) {
        continue;
      }

      shown++;
      console.log(`--- ${document.id} missed ${JSON.stringify(missed.slice(0, CONTEXT))} extra ${JSON.stringify(extra.slice(0, CONTEXT))}`);
      console.log(document.text);
    }
  }
}

console.log(`${'construct'.padEnd(NAME_COLUMN_WIDTH)}${'docs'.padStart(COUNT_COLUMN_WIDTH)}${'agree'.padStart(COUNT_COLUMN_WIDTH)}`);
for (const [name, score] of scores) {
  const bySet = new Map<string, number>();
  for (const id of score.failing) {
    const set = id.replace(/^\d+:/u, '').replace(/-\d+$/u, '');
    bySet.set(set, (bySet.get(set) ?? 0) + 1);
  }
  const sets = [...bySet].toSorted((a, b) => b[1] - a[1]).map(([set, count]) => `${set} ${String(count)}`).join(', ');
  console.log(`${name.padEnd(NAME_COLUMN_WIDTH)}${String(score.using).padStart(COUNT_COLUMN_WIDTH)}${String(score.agreeing).padStart(COUNT_COLUMN_WIDTH)}  ${sets}`);
}
