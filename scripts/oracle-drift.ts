/**
 * @file
 *
 * The drift report: compares every oracle read from one Obsidian version with the same oracle read from another, and
 * says whether the parser matches each of them.
 *
 * Per oracle it gives the documents both versions read from the same source (compared), those whose reading changed
 * between the versions (changed), and those only the newer read holds, which a corpus grown since the older read adds
 * (new). It then scores the parser on both versions: the editor's classes on every class-span document and spec
 * example, and the whole `CachedMetadata` on every worker document and spec example, and both on every forum issue
 * and editing mode document, and the cache on every live surface note. Last, it runs the suites that
 * check the parser against Obsidian on the newer version's files (`src/oracle/oracle-location.ts`), which covers the
 * reading view's HTML of the spec and the quirk probes. A suite whose oracles the newer version lacks, as a re-read
 * limited by `oracle-refresh.ts --only` leaves them, is skipped, and the report says which file it missed.
 *
 * It exits 1 when the parser does not match the newer version where it matches the older one, or a suite fails.
 *
 * Usage: `jiti scripts/oracle-drift.ts --to-version <version> [--to-dir <directory>] [--from-version <version>]
 * [--from-dir <directory>] [--examples <n>] [--skip-tests]`. Both directories default to `oracle/`, and the older
 * version to the pinned one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type {
  EditingModesFile,
  EditingModesRead
} from '../src/oracle/editing-modes.ts';
import type {
  ForumIssueFile,
  ForumIssueRead
} from '../src/oracle/forum-issues.ts';
import type {
  LiveSurfaceFile,
  LiveSurfaceRead
} from '../src/oracle/live-surfaces.ts';
import type {
  OracleDocument,
  OracleFile
} from '../src/oracle/oracle-file.ts';
import type { QuirkProbeFile } from '../src/oracle/quirk-probes.ts';
import type {
  SpecOracleFile,
  SpecOracleRead
} from '../src/oracle/spec-oracle-file.ts';
import type { WorkerMetadataOracleFile } from '../src/oracle/worker-metadata.ts';

import { parseMetadata } from '../src/metadata/metadata.ts';
import {
  CLASS_ORACLE_SEEDS,
  classOracleFileName,
  editingModesOracleFileName,
  forumIssueOracleFileName,
  liveSurfacesOracleFileName,
  ORACLE_DIRECTORY_VARIABLE,
  ORACLE_VERSION_VARIABLE,
  PINNED_OBSIDIAN_VERSION,
  PINNED_ORACLE_DIRECTORY,
  quirkProbeOracleFileName,
  readOracleFile,
  specOracleFileName,
  workerMetadataOracleFileName
} from '../src/oracle/oracle-location.ts';
import { compareDocument } from '../src/oracle/score.ts';
import { exampleKey } from '../src/oracle/spec-quirks.ts';

// A suite that checks the parser against Obsidian, and the oracle files it reads.
interface ConformanceSuite {
  readonly fileNamesOf: (version: string) => readonly string[];
  readonly path: string;
}

interface DriftRow {
  readonly added: ReadonlySet<string>;
  readonly changed: readonly string[];
  readonly compared: number;
  readonly name: string;
  readonly parserFrom?: Score;
  readonly parserTo?: Score;
}

// A document whose metadata the parser is scored on.
interface MetadataItem {
  readonly key: string;
  readonly markdown: string;
  readonly metadata: unknown;
}

// An oracle, named after the version it was read from, and its rows of the report.
interface OracleSource {
  readonly fileNameOf: (version: string) => string;
  readonly name: string;
  readonly rowsOf: () => DriftRow[];
}

interface ParserMisses {
  readonly drifted: readonly string[];
  readonly uncovered: readonly string[];
}

// One oracle's documents, each under a key that names its source, with what the oracle read of it.
type Readings = ReadonlyMap<string, string>;

interface Score {
  readonly failing: readonly string[];
  readonly total: number;
}

// The suites that check the parser against Obsidian, and read their oracles through `oracle-location.ts`.
const CONFORMANCE_SUITES: readonly ConformanceSuite[] = [
  { fileNamesOf: classFileNames, path: 'src/editor/highlight.test.ts' },
  { fileNamesOf: classFileNames, path: 'src/editor/language.test.ts' },
  { fileNamesOf: (version) => [editingModesOracleFileName(version)], path: 'src/oracle/editing-modes.test.ts' },
  { fileNamesOf: (version) => [forumIssueOracleFileName(version)], path: 'src/oracle/forum-issues.test.ts' },
  { fileNamesOf: (version) => [quirkProbeOracleFileName(version)], path: 'src/oracle/quirk-probes.test.ts' },
  { fileNamesOf: (version) => [specOracleFileName(version)], path: 'src/oracle/spec-quirks.test.ts' },
  { fileNamesOf: (version) => [workerMetadataOracleFileName(version), specOracleFileName(version)], path: 'src/oracle/worker-metadata.test.ts' }
];
const DEFAULT_EXAMPLES = 5;

const { values } = parseArgs({
  options: {
    'examples': { default: String(DEFAULT_EXAMPLES), type: 'string' },
    'from-dir': { default: PINNED_ORACLE_DIRECTORY, type: 'string' },
    'from-version': { default: PINNED_OBSIDIAN_VERSION, type: 'string' },
    'skip-tests': { type: 'boolean' },
    'to-dir': { default: PINNED_ORACLE_DIRECTORY, type: 'string' },
    'to-version': { type: 'string' }
  }
});
const toVersionArgument = values['to-version'];
if (toVersionArgument === undefined) {
  throw new Error('--to-version is required');
}
const toVersion: string = toVersionArgument;
const fromVersion = values['from-version'];
const fromDirectory = values['from-dir'];
const toDirectory = values['to-dir'];
const examples = Number(values.examples);

function classFileNames(version: string): string[] {
  return CLASS_ORACLE_SEEDS.map((seed) => classOracleFileName(seed, version));
}

// A class-span document is keyed by its id and the text it was built as, so a corpus that changed under an id is new.
function classKey(document: OracleDocument): string {
  return `${document.id}\u{0}${document.original ?? document.text}`;
}

function classReadings(docs: readonly OracleDocument[]): Readings {
  return new Map(docs.map((document) => [classKey(document), JSON.stringify([document.text, document.nodes])]));
}

function classRow(seed: number): DriftRow {
  const from = readOracleFile(classOracleFileName(seed, fromVersion), fromDirectory) as OracleFile;
  const to = readOracleFile(classOracleFileName(seed, toVersion), toDirectory) as OracleFile;
  return {
    ...compareReadings(`classes, seed ${String(seed)}`, classReadings(from.docs), classReadings(to.docs)),
    parserFrom: scoreClasses(from.docs, fromVersion),
    parserTo: scoreClasses(to.docs, toVersion)
  };
}

function compareReadings(name: string, from: Readings, to: Readings): Pick<DriftRow, 'added' | 'changed' | 'compared' | 'name'> {
  const changed: string[] = [];
  let compared = 0;
  const added = new Set<string>();
  for (const [key, reading] of to) {
    const old = from.get(key);
    if (old === undefined) {
      added.add(key);
      continue;
    }
    compared++;
    if (old !== reading) {
      changed.push(key);
    }
  }
  return { added, changed, compared, name };
}

function editingModesRows(): DriftRow[] {
  const from = readOracleFile(editingModesOracleFileName(fromVersion), fromDirectory) as EditingModesFile;
  const to = readOracleFile(editingModesOracleFileName(toVersion), toDirectory) as EditingModesFile;
  function readings(file: EditingModesFile, field: (read: EditingModesRead) => unknown): Readings {
    return new Map(file.reads.map((read) => [read.markdown, JSON.stringify([field(read)])]));
  }
  function editorDocuments(file: EditingModesFile): OracleDocument[] {
    return file.reads.map((read) => ({ id: read.id, nodes: read.nodes, set: read.set, text: read.markdown }));
  }
  function metadataItems(file: EditingModesFile): MetadataItem[] {
    return file.reads.map((read) => ({ key: read.markdown, markdown: read.markdown, metadata: read.metadata }));
  }
  return [
    {
      ...compareReadings('editing modes, editor classes', readings(from, (read) => read.nodes), readings(to, (read) => read.nodes)),
      parserFrom: scoreClasses(editorDocuments(from), fromVersion),
      parserTo: scoreClasses(editorDocuments(to), toVersion)
    },
    {
      ...compareReadings('editing modes, worker metadata', readings(from, (read) => read.metadata), readings(to, (read) => read.metadata)),
      parserFrom: scoreMetadata(metadataItems(from)),
      parserTo: scoreMetadata(metadataItems(to))
    },
    compareReadings('editing modes, reading view (strict line breaks)', readings(from, (read) => read.html), readings(to, (read) => read.html)),
    compareReadings('editing modes, Source mode and Live Preview', readings(from, (read) => [read.sourceModeHtml, read.livePreviewHtml]), readings(to, (read) => [read.sourceModeHtml, read.livePreviewHtml]))
  ];
}

function formatScore(score: Score | undefined): string {
  return score === undefined ? '-' : `${String(score.total - score.failing.length)}/${String(score.total)}`;
}

function forumRows(): DriftRow[] {
  const from = readOracleFile(forumIssueOracleFileName(fromVersion), fromDirectory) as ForumIssueFile;
  const to = readOracleFile(forumIssueOracleFileName(toVersion), toDirectory) as ForumIssueFile;
  function readings(file: ForumIssueFile, field: (read: ForumIssueRead) => unknown): Readings {
    return new Map(file.reads.map((read) => [read.markdown, JSON.stringify([field(read)])]));
  }
  function editorDocuments(file: ForumIssueFile): OracleDocument[] {
    return file.reads.map((read) => ({ id: read.markdown, nodes: read.nodes, set: 'forum', text: read.markdown }));
  }
  function metadataItems(file: ForumIssueFile): MetadataItem[] {
    return file.reads.map((read) => ({ key: read.markdown, markdown: read.markdown, metadata: read.metadata }));
  }
  return [
    {
      ...compareReadings('forum issues, editor classes', readings(from, (read) => read.nodes), readings(to, (read) => read.nodes)),
      parserFrom: scoreClasses(editorDocuments(from), fromVersion),
      parserTo: scoreClasses(editorDocuments(to), toVersion)
    },
    {
      ...compareReadings('forum issues, worker metadata', readings(from, (read) => read.metadata), readings(to, (read) => read.metadata)),
      parserFrom: scoreMetadata(metadataItems(from)),
      parserTo: scoreMetadata(metadataItems(to))
    },
    compareReadings('forum issues, reading view (strict line breaks)', readings(from, (read) => read.html), readings(to, (read) => read.html))
  ];
}

// Whether both versions have the oracle file, whose name holds the version.
function hasBoth(fileNameOf: (version: string) => string): boolean {
  return existsSync(join(fromDirectory, fileNameOf(fromVersion))) && existsSync(join(toDirectory, fileNameOf(toVersion)));
}

function keyLabel(key: string): string {
  return JSON.stringify(key.split('\u{0}', 1)[0] ?? key);
}

function listKeys(keys: readonly string[]): string {
  return `${keys.slice(0, examples).map((key) => keyLabel(key)).join(', ')}${keys.length > examples ? ', ...' : ''}`;
}

/*
 * The documents the parser differs on in the newer read and not in the older one: those both read, where the newer
 * reading drifted from the parser, and those only the newer read holds, which no oracle of the older version covered.
 */
function liveSurfaceRows(): DriftRow[] {
  const from = readOracleFile(liveSurfacesOracleFileName(fromVersion), fromDirectory) as LiveSurfaceFile;
  const to = readOracleFile(liveSurfacesOracleFileName(toVersion), toDirectory) as LiveSurfaceFile;
  function readings(file: LiveSurfaceFile, field: (read: LiveSurfaceRead) => unknown): Readings {
    return new Map(file.reads.map((read) => [read.markdown, JSON.stringify([field(read)])]));
  }
  function metadataItems(file: LiveSurfaceFile): MetadataItem[] {
    return file.reads.map((read) => ({ key: read.markdown, markdown: read.markdown, metadata: read.cache }));
  }
  function row(name: string, field: (read: LiveSurfaceRead) => unknown): DriftRow {
    return compareReadings(`live surfaces, ${name}`, readings(from, field), readings(to, field));
  }
  return [
    {
      ...compareReadings('live surfaces, cache', readings(from, (read) => read.cache), readings(to, (read) => read.cache)),
      parserFrom: scoreMetadata(metadataItems(from)),
      parserTo: scoreMetadata(metadataItems(to))
    },
    row('cache after opening', (read) => read.cacheAfterOpen),
    row('resolvedLinks and unresolvedLinks', (read) => [read.resolvedLinks, read.unresolvedLinks]),
    row('Backlinks', (read) => read.backlinks),
    row('Outline', (read) => read.outline),
    row('renameFile and back', (read) => [read.renamedText, read.roundTripText]),
    row('processFrontMatter', (read) => [read.processedText, read.processError])
  ];
}

function parserMissesOf(row: DriftRow): ParserMisses {
  const fromFailing = new Set(row.parserFrom?.failing);
  const misses = (row.parserTo?.failing ?? []).filter((key) => !fromFailing.has(key));
  return { drifted: misses.filter((key) => !row.added.has(key)), uncovered: misses.filter((key) => row.added.has(key)) };
}

function printRow(row: DriftRow): void {
  const parser = row.parserTo === undefined ? '' : `; parser exact on ${fromVersion} ${formatScore(row.parserFrom)}, on ${toVersion} ${formatScore(row.parserTo)}`;
  console.log(`${row.name}: ${String(row.compared)} compared, ${String(row.changed.length)} changed, ${String(row.added.size)} new${parser}`);
  if (row.changed.length > 0) {
    console.log(`  changed: ${listKeys(row.changed)}`);
  }
  const { drifted, uncovered } = parserMissesOf(row);
  if (drifted.length > 0) {
    console.log(`  parser differs on ${toVersion} where it matched ${fromVersion}: ${listKeys(drifted)}`);
  }
  if (uncovered.length > 0) {
    console.log(`  parser differs on new documents: ${listKeys(uncovered)}`);
  }
}

function probeRow(): DriftRow {
  const from = readOracleFile(quirkProbeOracleFileName(fromVersion), fromDirectory) as QuirkProbeFile;
  const to = readOracleFile(quirkProbeOracleFileName(toVersion), toDirectory) as QuirkProbeFile;
  function readings(file: QuirkProbeFile): Readings {
    return new Map(file.probes.map((probe) => [`${probe.preset}:${probe.markdown}`, JSON.stringify([probe.html, probe.sections])]));
  }
  return compareReadings('quirk probes, reading view and sections', readings(from), readings(to));
}

function scoreClasses(docs: readonly OracleDocument[], obsidianVersion: string): Score {
  return { failing: docs.filter((document) => compareDocument(document, { obsidianVersion }).differences.length > 0).map((document) => classKey(document)), total: docs.length };
}

function scoreMetadata(items: readonly MetadataItem[]): Score {
  return { failing: items.filter((item) => JSON.stringify(parseMetadata(item.markdown)) !== JSON.stringify(item.metadata)).map((item) => item.key), total: items.length };
}

function specEditorDocument(read: SpecOracleRead): OracleDocument {
  return { id: exampleKey(read), nodes: read.editorNodes, set: read.suite, text: read.editorText ?? read.markdown, ...(read.editorText !== undefined && { original: read.markdown }) };
}

function specRows(): DriftRow[] {
  const from = readOracleFile(specOracleFileName(fromVersion), fromDirectory) as SpecOracleFile;
  const to = readOracleFile(specOracleFileName(toVersion), toDirectory) as SpecOracleFile;
  function readings(file: SpecOracleFile, field: (read: SpecOracleRead) => unknown): Readings {
    return new Map(file.examples.map((read) => [`${exampleKey(read)}\u{0}${read.markdown}`, JSON.stringify([field(read)])]));
  }
  function metadataItems(file: SpecOracleFile): MetadataItem[] {
    return file.examples.map((read) => ({ key: `${exampleKey(read)}\u{0}${read.markdown}`, markdown: read.markdown, metadata: read.metadata }));
  }
  return [
    {
      ...compareReadings('spec, editor classes', readings(from, (read) => [read.editorText, read.editorNodes]), readings(to, (read) => [read.editorText, read.editorNodes])),
      parserFrom: scoreClasses(from.examples.map((read) => specEditorDocument(read)), fromVersion),
      parserTo: scoreClasses(to.examples.map((read) => specEditorDocument(read)), toVersion)
    },
    {
      ...compareReadings('spec, worker metadata', readings(from, (read) => read.metadata), readings(to, (read) => read.metadata)),
      parserFrom: scoreMetadata(metadataItems(from)),
      parserTo: scoreMetadata(metadataItems(to))
    },
    compareReadings('spec, reading view', readings(from, (read) => read.html), readings(to, (read) => read.html)),
    compareReadings('spec, reading view (strict line breaks)', readings(from, (read) => read.htmlStrict), readings(to, (read) => read.htmlStrict))
  ];
}

function workerRow(): DriftRow {
  const from = readOracleFile(workerMetadataOracleFileName(fromVersion), fromDirectory) as WorkerMetadataOracleFile;
  const to = readOracleFile(workerMetadataOracleFileName(toVersion), toDirectory) as WorkerMetadataOracleFile;
  function readings(file: WorkerMetadataOracleFile): Readings {
    return new Map(file.docs.map((document) => [`${document.set}: ${document.text}`, JSON.stringify(document.metadata)]));
  }
  function items(file: WorkerMetadataOracleFile): MetadataItem[] {
    return file.docs.map((document) => ({ key: `${document.set}: ${document.text}`, markdown: document.text, metadata: document.metadata }));
  }
  return { ...compareReadings('worker metadata', readings(from), readings(to)), parserFrom: scoreMetadata(items(from)), parserTo: scoreMetadata(items(to)) };
}

console.log(`Oracle drift from Obsidian ${fromVersion} (${fromDirectory}) to ${toVersion} (${toDirectory})\n`);
const rows: DriftRow[] = [];
const oracles: readonly OracleSource[] = [
  ...CLASS_ORACLE_SEEDS.map((seed): OracleSource => ({
    fileNameOf: (version: string): string => classOracleFileName(seed, version),
    name: `classes, seed ${String(seed)}`,
    rowsOf: (): DriftRow[] => [classRow(seed)]
  })),
  { fileNameOf: specOracleFileName, name: 'spec', rowsOf: specRows },
  { fileNameOf: quirkProbeOracleFileName, name: 'quirk probes', rowsOf: (): DriftRow[] => [probeRow()] },
  { fileNameOf: workerMetadataOracleFileName, name: 'worker metadata', rowsOf: (): DriftRow[] => [workerRow()] },
  { fileNameOf: forumIssueOracleFileName, name: 'forum issues', rowsOf: forumRows },
  { fileNameOf: editingModesOracleFileName, name: 'editing modes', rowsOf: editingModesRows },
  { fileNameOf: liveSurfacesOracleFileName, name: 'live surfaces', rowsOf: liveSurfaceRows }
];
for (const { fileNameOf, name, rowsOf } of oracles) {
  if (hasBoth(fileNameOf)) {
    rows.push(...rowsOf());
  } else {
    console.log(`${name}: skipped, no ${fileNameOf(fromVersion)} in ${fromDirectory} or no ${fileNameOf(toVersion)} in ${toDirectory}`);
  }
}
for (const row of rows) {
  printRow(row);
}

const changedTotal = rows.reduce((sum, row) => sum + row.changed.length, 0);
const misses = rows.map((row) => parserMissesOf(row));
const driftedTotal = misses.reduce((sum, miss) => sum + miss.drifted.length, 0);
const uncoveredTotal = misses.reduce((sum, miss) => sum + miss.uncovered.length, 0);
const regressionTotal = driftedTotal + uncoveredTotal;
console.log(
  `\n${String(changedTotal)} reading(s) changed between the versions. The parser differs on ${String(driftedTotal)} document(s) both versions read, where it matched ${fromVersion}, and on ${String(uncoveredTotal)} new document(s).`
);

// The first oracle file a suite reads that the newer version lacks, which a re-read limited by `--only` leaves out.
function missingSuiteFile(suite: ConformanceSuite): string | undefined {
  return suite.fileNamesOf(toVersion).find((fileName) => !existsSync(join(toDirectory, fileName)));
}

let isSuitesPassed = true;
if (!values['skip-tests']) {
  console.log(`\nRunning the conformance suites on ${toVersion}'s oracles:`);
  const suites: string[] = [];
  for (const suite of CONFORMANCE_SUITES) {
    const missing = missingSuiteFile(suite);
    if (missing === undefined) {
      suites.push(suite.path);
    } else {
      console.log(`${suite.path}: skipped, no ${missing} in ${toDirectory}`);
    }
  }
  // With no file named, vitest would run every suite in the repository, so an empty list runs nothing.
  if (suites.length === 0) {
    console.log(`No conformance suite has its oracles in ${toDirectory}.`);
  } else {
    const result = spawnSync(process.execPath, [join(PINNED_ORACLE_DIRECTORY, '..', 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...suites], {
      env: { ...process.env, [ORACLE_DIRECTORY_VARIABLE]: toDirectory, [ORACLE_VERSION_VARIABLE]: toVersion },
      stdio: 'inherit'
    });
    isSuitesPassed = result.status === 0;
    console.log(isSuitesPassed ? 'The conformance suites pass.' : 'The conformance suites FAIL on the newer version.');
  }
}

if (!isSuitesPassed || regressionTotal > 0) {
  process.exitCode = 1;
}
