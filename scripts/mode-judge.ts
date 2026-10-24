/**
 * @file
 *
 * Runs the mode judge (`src/oracle/mode-judge.ts`) over the pinned oracles: every class-span document, on the editor's own
 * tree, and every spec example and metadata worker document, on the class tokenizer's prediction of it, which is the
 * editor's on every oracle document. Each difference, up to `--per-key` of each key, is reduced to a minimal note and
 * put into a family (`src/oracle/mode-families.ts`). Prints a table of the families and writes them, with their reduced
 * notes, to `dist/mode-judge/report.json`.
 *
 * Usage: `jiti scripts/mode-judge.ts [--per-key <n>] [--out <file>]`.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { ModeFamilyKind } from '../src/oracle/mode-families.ts';
import type { OracleFile } from '../src/oracle/oracle-file.ts';
import type { SpecOracleFile } from '../src/oracle/spec-oracle-file.ts';
import type { WorkerMetadataOracleFile } from '../src/oracle/worker-metadata.ts';

import { familyOf } from '../src/oracle/mode-families.ts';
import {
  differenceKey,
  judgeModes,
  judgeModesPredicted,
  reduceDifference
} from '../src/oracle/mode-judge.ts';
import {
  CLASS_ORACLE_SEEDS,
  classOracleFileName,
  readOracleFile,
  specOracleFileName,
  workerMetadataOracleFileName
} from '../src/oracle/oracle-location.ts';

interface FamilyReport {
  readonly id: string;
  readonly issue: null | string;
  readonly kind: 'unclassified' | ModeFamilyKind;
  readonly note: string;
  readonly reduced: ReducedNote[];
  total: number;
}

interface ReducedNote {
  readonly count: number;
  readonly key: string;
  readonly markdown: string;
}

const DEFAULT_PER_KEY = 300;
const EXAMPLES_PER_FAMILY = 10;
const JSON_INDENT = 2;
const COUNT_WIDTH = 6;
const KIND_WIDTH = 12;
const ID_WIDTH = 36;
const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    'out': { type: 'string' },
    'per-key': { type: 'string' }
  }
});
const perKey = Number(values['per-key'] ?? DEFAULT_PER_KEY);

interface JudgedDocument {
  readonly nodes?: OracleFile['docs'][number]['nodes'];
  readonly text: string;
}

const documents: JudgedDocument[] = [];
for (const seed of CLASS_ORACLE_SEEDS) {
  const classOracle = readOracleFile(classOracleFileName(seed)) as OracleFile;
  for (const document of classOracle.docs) {
    documents.push({ nodes: document.nodes, text: document.text });
  }
}
const specOracle = readOracleFile(specOracleFileName()) as SpecOracleFile;
for (const example of specOracle.examples) {
  documents.push({ text: example.markdown });
}
const workerOracle = readOracleFile(workerMetadataOracleFileName()) as WorkerMetadataOracleFile;
for (const document of workerOracle.docs) {
  documents.push({ text: document.text });
}

const reducedPerKey = new Map<string, number>();
const documentsPerKey = new Map<string, number>();
const reducedCounts = new Map<string, number>();
let differing = 0;
for (const document of documents) {
  const differences = document.nodes === undefined ? judgeModesPredicted(document.text) : judgeModes(document.text, document.nodes);
  if (differences.length > 0) {
    differing++;
  }
  const keys = new Set(differences.map((difference) => differenceKey(difference)));
  for (const key of keys) {
    documentsPerKey.set(key, (documentsPerKey.get(key) ?? 0) + 1);
    const reducedSoFar = reducedPerKey.get(key) ?? 0;
    if (reducedSoFar >= perKey) {
      continue;
    }
    reducedPerKey.set(key, reducedSoFar + 1);
    const entry = JSON.stringify([key, reduceDifference(document.text, key)]);
    reducedCounts.set(entry, (reducedCounts.get(entry) ?? 0) + 1);
  }
}

const families: Record<string, FamilyReport> = {};
for (const [entry, count] of reducedCounts) {
  const [key, markdown] = JSON.parse(entry) as [string, string];
  const family = familyOf(key, markdown);
  const id = family?.id ?? 'unclassified';
  const report = families[id] ?? {
    id,
    issue: family?.issue ?? null,
    kind: family?.kind ?? 'unclassified',
    note: family?.note ?? 'No family takes these.',
    reduced: [],
    total: 0
  };
  report.total += count;
  report.reduced.push({ count, key, markdown });
  families[id] = report;
}
const sorted = Object.values(families).toSorted((a, b) => b.total - a.total);
for (const report of sorted) {
  report.reduced.sort((a, b) => b.count - a.count);
}

console.log(`mode-judge: ${String(differing)} of ${String(documents.length)} documents differ; ${String(reducedCounts.size)} distinct reduced notes from up to ${String(perKey)} per key`);
for (const report of sorted) {
  const example = report.reduced[0];
  console.log(`${String(report.total).padStart(COUNT_WIDTH)}  ${report.kind.padEnd(KIND_WIDTH)} ${report.id.padEnd(ID_WIDTH)} ${example === undefined ? '' : `${example.key} ${JSON.stringify(example.markdown)}`}`);
}

const outFile = values.out ?? join(here, '..', 'dist', 'mode-judge', 'report.json');
mkdirSync(dirname(outFile), { recursive: true });
const report = {
  differing,
  documents: documents.length,
  documentsPerKey: Object.fromEntries([...documentsPerKey].toSorted(([, a], [, b]) => b - a)),
  families: sorted.map((family) => ({ ...family, reduced: family.reduced.slice(0, EXAMPLES_PER_FAMILY) })),
  perKey
};
writeFileSync(outFile, `${JSON.stringify(report, null, JSON_INDENT)}\n`);
console.log(`mode-judge: report written to ${outFile}`);
