/**
 * @file
 *
 * Scores the tokenizer against an oracle file, giving the classes of the Obsidian version the file was read from.
 *
 * Usage:
 * - `jiti scripts/oracles/oracle-diff.ts [--oracle <file>]`: the number of exact documents, and the classes that disagree most.
 * - `jiti scripts/oracles/oracle-diff.ts --show <id>...`: line by line, where chosen documents disagree.
 * - `jiti scripts/oracles/oracle-diff.ts --failing <n>`: the ids of the first `n` documents that disagree.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { ClassSets } from '../../src/oracle/classes/score.ts';
import type { OracleFile } from '../../src/oracle/oracle-file.ts';

import {
  compareCodeUnits,
  compareDocument,
  lineStartsOf
} from '../../src/oracle/classes/score.ts';
import {
  classOracleFileName,
  MAIN_CLASS_ORACLE_SEED,
  oracleDirectory
} from '../../src/oracle/oracle-location.ts';

interface ClassScore {
  readonly docs: Set<string>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Oracle scoring increments this counter for each differing class span.
  extra: number;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Oracle scoring increments this counter for each differing class span.
  missed: number;
}

interface SetScore {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Oracle scoring increments this counter for each measured document.
  exact: number;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Oracle scoring increments this counter for each measured document.
  total: number;
}

const DEFAULT_ORACLE = join(oracleDirectory(), classOracleFileName(MAIN_CLASS_ORACLE_SEED));
const TOP_CLASSES = 40;
const CLASS_COLUMN_WIDTH = 36;
const DOCS_COLUMN_WIDTH = 4;
const COUNT_COLUMN_WIDTH = 5;
const EXAMPLE_DOCS = 4;
const LINE_NUMBER_WIDTH = 3;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    failing: { type: 'string' },
    oracle: { default: DEFAULT_ORACLE, type: 'string' },
    set: { type: 'string' },
    show: { type: 'boolean' }
  }
});

const oracle = JSON.parse(readFileSync(values.oracle, 'utf-8')) as OracleFile;
const docs = oracle.docs.filter((d) => values.set === undefined || d.set === values.set);
const classOptions = oracle.meta.appVersion === null ? {} : { obsidianVersion: oracle.meta.appVersion };

if (values.show) {
  for (const id of positionals) {
    const document = oracle.docs.find((d) => d.id === id);
    if (!document) {
      console.log(`no document ${id}`);
      continue;
    }
    show(document.text, compareDocument(document, classOptions), id);
  }
} else {
  let exact = 0;
  const failing: string[] = [];
  const byClass = new Map<string, ClassScore>();
  const bySet = new Map<string, SetScore>();
  for (const document of docs) {
    const { differences } = compareDocument(document, classOptions);
    const scoreOfSet = bySet.get(document.set) ?? { exact: 0, total: 0 };
    scoreOfSet.total++;
    if (differences.length === 0) {
      exact++;
      scoreOfSet.exact++;
    } else {
      failing.push(document.id);
    }
    bySet.set(document.set, scoreOfSet);
    for (const d of differences) {
      const entry = byClass.get(d.cls) ?? { docs: new Set<string>(), extra: 0, missed: 0 };
      entry[d.kind]++;
      entry.docs.add(document.id);
      byClass.set(d.cls, entry);
    }
  }
  if (values.failing === undefined) {
    console.log(`exact: ${String(exact)}/${String(docs.length)}`);
    console.log([...bySet].map(([set, s]) => `${set} ${String(s.exact)}/${String(s.total)}`).join(', '));
    const rows = [...byClass].toSorted((a, b) => b[1].docs.size - a[1].docs.size).slice(0, TOP_CLASSES);
    for (const [cls, score] of rows) {
      console.log(`${cls.padEnd(CLASS_COLUMN_WIDTH)} docs ${String(score.docs.size).padStart(DOCS_COLUMN_WIDTH)} missed ${String(score.missed).padStart(COUNT_COLUMN_WIDTH)} extra ${String(score.extra).padStart(COUNT_COLUMN_WIDTH)}  e.g. ${[...score.docs].slice(0, EXAMPLE_DOCS).join(' ')}`);
    }
  } else {
    console.log(failing.slice(0, Number(values.failing || '20')).join(' '));
  }
}

function fmt(set: ReadonlySet<string> | undefined): string {
  return [...(set ?? [])].toSorted(compareCodeUnits).join(' ');
}

function sets(classSets: ClassSets, index: number): string {
  return fmt(classSets.tok[index]);
}

function show(text: string, comparison: ReturnType<typeof compareDocument>, id: string): void {
  const starts = lineStartsOf(text);
  function key(k: number): string {
    return `${sets(comparison.oracle, k)}|${sets(comparison.predicted, k)}`;
  }
  console.log(`=== ${id} ${JSON.stringify(text)}`);
  for (const [l, s] of starts.entries()) {
    const end = l + 1 < starts.length ? (starts[l + 1] ?? 0) - 1 : text.length;
    const o = fmt(comparison.oracle.line[l]);
    const p = fmt(comparison.predicted.line[l]);
    console.log(`${String(l).padStart(LINE_NUMBER_WIDTH)} ${JSON.stringify(text.slice(s, end))}${o === p ? '' : `   LINE obs[${o}] got[${p}]`}`);
    let runStart = s;
    for (let index = s; index <= end; index++) {
      if (index !== end && key(index) === key(runStart)) {
        continue;
      }

      if (runStart < end && sets(comparison.oracle, runStart) !== sets(comparison.predicted, runStart)) {
        console.log(`      ${String(runStart - s)}-${String(index - s)} ${JSON.stringify(text.slice(runStart, index))} obs[${sets(comparison.oracle, runStart)}] got[${sets(comparison.predicted, runStart)}]`);
      }
      runStart = index;
    }
  }
}
