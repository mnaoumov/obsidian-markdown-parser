/**
 * @file
 *
 * Measures the cost of a note's metadata: Obsidian's own metadata worker, its `worker.js` run offline in a Node `vm`
 * context as `scripts/capture/worker-oracle.ts` runs it, against `parseMetadata`, on the same texts. It also says whether
 * the two gave the same `CachedMetadata`.
 *
 * The texts are a real vault's notes repeated to the requested line counts, as `scripts/demo/demo-plugin-measure.ts`
 * builds its long note, and pathological shapes: lists and quotes nested past 512 levels, long runs of emphasis
 * delimiters, brackets and backticks that never close, and a footnote definition and a link reference definition longer
 * than 1,024 characters.
 *
 * Each `--worker` names one Obsidian release's `worker.js`, so one run compares releases too. The version is read from
 * the `package.json` beside it. Nothing of the worker is kept here.
 *
 * Usage: `jiti scripts/demo/metadata-bench.ts --worker <path to worker.js>... [--vault <dir>] [--lines <n>]... [--depth <n>]...
 * [--size <n>]... [--runs <n>]`.
 */

import {
  readdirSync,
  readFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createContext,
  runInContext
} from 'node:vm';

import type { CachedMetadata } from '../../src/metadata/types.ts';

import { parseMetadata } from '../../src/metadata/metadata.ts';

interface AppPackage {
  readonly version: string;
}

interface Case {
  readonly name: string;
  readonly text: string;
}

interface Timed<T> {
  readonly ms: number;
  readonly value: T;
}

// Obsidian 1.15.1 added a format version, `v: 1`, to the metadata its worker posts.
interface VersionedMetadata extends CachedMetadata {
  readonly v?: number;
}

interface Worker {
  readonly run: (text: string) => null | VersionedMetadata;
  readonly version: string;
}

interface WorkerMessage {
  readonly data: WorkerMessageData;
}

interface WorkerMessageData {
  readonly metadataCache: ArrayBuffer;
}

interface WorkerScope {
  readonly onmessage?: ($event: WorkerMessage) => void;
  readonly postMessage: (message: unknown) => void;
}

const HALF = 0.5;
const DECIMALS = 1;
// The longest run of backticks in the unclosed backtick runs: one to seven, over and over.
const MAX_BACKTICKS = 7;
// A definition holds two `word ` per `--size`, five characters each, so ten characters per `--size`.
const WORDS_PER_SIZE = 2;
const CHARACTERS_PER_SIZE = 10;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { values } = parseArgs({
  options: {
    depth: { default: ['500', '600'], multiple: true, type: 'string' },
    lines: { default: ['10000', '100000'], multiple: true, type: 'string' },
    runs: { default: '3', type: 'string' },
    size: { default: ['1000', '10000'], multiple: true, type: 'string' },
    vault: { default: join(root, '..', 'obsidian-community-vault'), type: 'string' },
    worker: { multiple: true, type: 'string' }
  }
});
const runs = Number(values.runs);
const workerPaths = values.worker ?? [join(root, '..', 'obsidian-versions', 'obsidian.asar', 'worker.js')];
const workers = workerPaths.map((path) => loadWorker(path));
const notes = readNotes(values.vault);

const cases: Case[] = values.lines.map((lines) => ({ name: `vault notes, ${lines} lines`, text: buildLongText(Number(lines)) }));
for (const depth of values.depth) {
  cases.push(...nestedCases(Number(depth)));
}
for (const size of values.size) {
  cases.push(...delimiterCases(Number(size)));
}

// Warm every engine up before timing anything.
const engines = [...workers.map((worker) => worker.run), parseMetadata];
for (const engine of engines) {
  for (const note of notes) {
    engine(note.text);
  }
}

console.log(`| Text | Characters | parseMetadata | ${workers.map((worker) => `Worker ${worker.version}`).join(' | ')} | Same metadata as |`);
console.log(`| :--- | ---------: | ------------: | ${workers.map(() => '---------:').join(' | ')} | :--------------- |`);
for (const { name, text } of cases) {
  const parser = time(() => parseMetadata(text));
  const timings = workers.map((worker) => time(() => worker.run(text)));
  const same = workers.filter((_, index) => isSameMetadata(timings[index]?.value, parser.value)).map((worker) => worker.version);
  console.log(`| ${name} | ${String(text.length)} | ${ms(parser.ms)} | ${timings.map((timing) => ms(timing.ms)).join(' | ')} | ${same.join(', ') || 'none'} |`);
}

function buildLongText(lines: number): string {
  const parts: string[] = [];
  let count = 0;
  for (let index = 0; count < lines; index++) {
    const note = notes[index % notes.length];
    if (!note) {
      break;
    }
    parts.push(note.text);
    count += note.text.split('\n').length;
  }
  return parts.join('\n');
}

function delimiterCases(size: number): Case[] {
  const backtickRuns = Array.from({ length: size }, (_, index) => '`'.repeat((index % MAX_BACKTICKS) + 1));
  const words = 'word '.repeat(size * WORDS_PER_SIZE);
  const characters = String(size * CHARACTERS_PER_SIZE);
  return [
    { name: `${String(size)} unclosed emphasis openers`, text: '*a _b '.repeat(size) },
    { name: `${String(size)} unclosed brackets`, text: '[a '.repeat(size) },
    { name: `${String(size)} unclosed backtick runs`, text: backtickRuns.join(' x ') },
    { name: `${String(size)} wikilinks on one line`, text: '[[note]] '.repeat(size) },
    { name: `footnote definition of ${characters} characters`, text: `use[^1]\n\n[^1]: ${words}\n- after` },
    { name: `reference definition title of ${characters} characters`, text: `[r]\n\n[r]: /url "${words}"` }
  ];
}

// The worker's metadata, without the format version 1.15.1 added, against the parser's, whole and in key order.
function isSameMetadata(worker: null | undefined | VersionedMetadata, parser: CachedMetadata | null): boolean {
  if (!worker) {
    return worker === parser;
  }
  const { v: _version, ...rest } = worker;
  return JSON.stringify(rest) === JSON.stringify(parser);
}

function loadWorker(path: string): Worker {
  let last: null | VersionedMetadata = null;
  const scope: WorkerScope = {
    postMessage(message) {
      last = message as null | VersionedMetadata;
    }
  };
  const quietConsole = { ...console, error: noop, warn: noop };
  const context = createContext({ ArrayBuffer, atob, btoa, clearTimeout, console: quietConsole, self: scope, setTimeout, TextDecoder, TextEncoder, Uint8Array, URL });
  runInContext('globalThis.window = globalThis;', context);
  runInContext(readFileSync(path, 'utf-8'), context);
  const appPackage = readFileSync(join(dirname(path), 'package.json'), 'utf-8');
  const { version } = JSON.parse(appPackage) as AppPackage;
  return {
    run(text: string): null | VersionedMetadata {
      last = null;
      scope.onmessage?.({ data: { metadataCache: new TextEncoder().encode(text).buffer } });
      return last;
    },
    version
  };
}

function ms(value: number): string {
  return `${value.toFixed(DECIMALS)} ms`;
}

function nestedCases(depth: number): Case[] {
  const listLines = Array.from({ length: depth }, (_, level) => `${'  '.repeat(level)}- item ${String(level)}`);
  return [
    { name: `list nested ${String(depth)} deep`, text: listLines.join('\n') },
    { name: `quote nested ${String(depth)} deep`, text: `${'> '.repeat(depth)}quoted` }
  ];
}

function noop(): void {
  // Nothing to report.
}

function readNotes(vault: string): Case[] {
  const found: Case[] = [];
  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          visit(path);
        }
      } else if (entry.name.endsWith('.md')) {
        found.push({ name: path, text: readFileSync(path, 'utf-8') });
      }
    }
  }
  visit(vault);
  return found.toSorted((a, b) => (a.name < b.name ? -1 : Number(a.name > b.name)));
}

// The median of `runs` timings, after a warm-up run, and the last run's result.
function time<T>(run: () => T): Timed<T> {
  const samples: number[] = [];
  let value = run();
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    value = run();
    samples.push(performance.now() - start);
  }
  return { ms: samples.toSorted((a, b) => a - b)[Math.floor(samples.length * HALF)] ?? 0, value };
}
