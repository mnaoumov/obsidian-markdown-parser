/**
 * @file
 *
 * Runs the self-check judges (`src/oracle/self-check.ts`) over generated notes (`src/oracle/note-grammar.ts`) and,
 * with `--oracles`, over every worker oracle document too. Up to `--per-key` notes of each key are reduced to minimal ones and
 * each put into a family (`src/oracle/self-check-families.ts`). Prints a table of the families and writes them, with their
 * reduced notes, to `dist/self-check/report.json`.
 *
 * Usage: `jiti scripts/self-check.ts [--count <n>] [--seed <n>] [--per-key <n>] [--oracles] [--out <file>]`.
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

import type { SelfCheckFamilyKind } from '../src/oracle/self-check-families.ts';
import type { WorkerMetadataOracleFile } from '../src/oracle/worker-metadata.ts';

import { generateNotes } from '../src/oracle/note-grammar.ts';
import {
  readOracleFile,
  workerMetadataOracleFileName
} from '../src/oracle/oracle-location.ts';
import { selfCheckFamilyOf } from '../src/oracle/self-check-families.ts';
import {
  judgeNote,
  reduceFinding
} from '../src/oracle/self-check.ts';

interface FamilyReport {
  readonly forumUrl: null | string;
  readonly id: string;
  readonly kind: 'unclassified' | SelfCheckFamilyKind;
  readonly note: string;
  readonly reduced: ReducedNote[];
  total: number;
}

interface KeyReport {
  count: number;
  readonly key: string;
  readonly samples: Sample[];
}

interface NoteSource {
  readonly source: string;
  readonly text: string;
}

interface ReducedNote {
  readonly count: number;
  readonly detail: string;
  readonly key: string;
  readonly markdown: string;
  readonly source: string;
}

interface ReducedSample {
  readonly detail: string;
  samples: number;
  readonly source: string;
}

interface Sample {
  readonly detail: string;
  readonly source: string;
  readonly text: string;
}

const DEFAULT_COUNT = 2000;
const DEFAULT_PER_KEY = 30;
const COUNT_WIDTH = 6;
const JSON_INDENT = 2;

const { values } = parseArgs({
  options: {
    'count': { type: 'string' },
    'oracles': { type: 'boolean' },
    'out': { type: 'string' },
    'per-key': { type: 'string' },
    'seed': { type: 'string' }
  }
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = values.out ?? join(root, 'dist', 'self-check', 'report.json');
const count = values.count === undefined ? DEFAULT_COUNT : Number(values.count);
const perKey = values['per-key'] === undefined ? DEFAULT_PER_KEY : Number(values['per-key']);
const notes: NoteSource[] = generateNotes({ count, ...(values.seed !== undefined && { seed: Number(values.seed) }) })
  .map((note) => ({ source: note.id, text: note.text }));
if (values.oracles) {
  const worker = readOracleFile(workerMetadataOracleFileName()) as WorkerMetadataOracleFile;
  notes.push(...worker.docs.map((document, index) => ({ source: `worker-${String(index)}`, text: document.text })));
}

const keys = new Map<string, KeyReport>();
const keyReports: KeyReport[] = [];
for (const note of notes) {
  for (const finding of judgeNote(note.text)) {
    const report = keys.get(finding.key);
    if (report === undefined) {
      const created = { count: 1, key: finding.key, samples: [{ detail: finding.detail, source: note.source, text: note.text }] };
      keys.set(finding.key, created);
      keyReports.push(created);
    } else {
      report.count++;
      if (report.samples.length < perKey) {
        report.samples.push({ detail: finding.detail, source: note.source, text: note.text });
      }
    }
  }
}

const families = new Map<string, FamilyReport>();
const familyReports: FamilyReport[] = [];
const reportsByCount = keyReports.toSorted((left, right) => right.count - left.count);
for (const report of reportsByCount) {
  const reducedNotes = new Map<string, ReducedSample>();
  for (const sample of report.samples) {
    const markdown = reduceFinding(sample.text, report.key);
    const seen = reducedNotes.get(markdown);
    if (seen === undefined) {
      reducedNotes.set(markdown, { detail: sample.detail, samples: 1, source: sample.source });
    } else {
      seen.samples++;
    }
  }
  for (const [markdown, reduced] of reducedNotes) {
    const family = selfCheckFamilyOf(report.key, markdown);
    const id = family?.id ?? `unclassified:${report.key}`;
    let familyReport = families.get(id);
    if (familyReport === undefined) {
      familyReport = { forumUrl: family?.forumUrl ?? null, id, kind: family?.kind ?? 'unclassified', note: family?.note ?? '', reduced: [], total: 0 };
      families.set(id, familyReport);
      familyReports.push(familyReport);
    }
    // A key's notes past the reduced samples are counted in the family of its most common reduction.
    const reducedCount = reducedNotes.size === 1 ? report.count : reduced.samples;
    familyReport.total += reducedCount;
    familyReport.reduced.push({ count: reducedCount, detail: reduced.detail, key: report.key, markdown, source: reduced.source });
  }
}
const sorted = familyReports.toSorted((left, right) => left.kind.localeCompare(right.kind) || right.total - left.total);
console.log(`${String(notes.length)} notes, ${String(keys.size)} keys, ${String(sorted.length)} families\n`);
for (const family of sorted) {
  console.log(`${family.kind.padEnd('unclassified'.length)} ${String(family.total).padStart(COUNT_WIDTH)}  ${family.id}`);
  for (const reduced of family.reduced) {
    console.log(`    ${String(reduced.count).padStart(COUNT_WIDTH)}  ${reduced.key}  ${JSON.stringify(reduced.markdown)}`);
  }
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({ families: sorted, notes: notes.length }, null, JSON_INDENT)}\n`);
console.log(`\nWrote ${outPath}`);
