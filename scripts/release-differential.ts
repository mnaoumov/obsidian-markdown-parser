/**
 * @file
 *
 * The release differential (`src/oracle/release-differential.ts`): runs the bug finders on one Obsidian version's
 * oracles and on another's, and reports which families appeared, vanished or changed their counts.
 *
 * Per version it runs `scripts/mode-judge.ts`, which judges the editor's trees of the class-span oracles, and
 * `scripts/self-check.ts --count 0 --live-surfaces`, which judges the live surface oracle's readings, each in a child
 * process that `ORACLE_OBSIDIAN_VERSION` and `ORACLE_DIRECTORY` point at that version's files. The offline self-check
 * judges are left out: they judge the parser's own engines, so a build cannot move their families. A judge run whose
 * oracles either version lacks is skipped, and the report says which file it missed. The two versions' raw reports and
 * `report.md` go to the output directory.
 *
 * It is a report, not a gate: it exits 0 unless a judge run fails.
 *
 * Usage: `jiti scripts/release-differential.ts --to-version <version> [--to-dir <directory>] [--from-version <version>]
 * [--from-dir <directory>] [--out-dir <directory>]`. Both directories default to `oracle/`, the older version to the
 * pinned one, and the output directory to `dist/release-differential/<from>-to-<to>`.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type {
  FamilyCount,
  FamilyTablePair
} from '../src/oracle/release-differential.ts';

import {
  CLASS_ORACLE_SEEDS,
  classOracleFileName,
  liveSurfacesOracleFileName,
  ORACLE_DIRECTORY_VARIABLE,
  ORACLE_VERSION_VARIABLE,
  PINNED_OBSIDIAN_VERSION,
  PINNED_ORACLE_DIRECTORY,
  specOracleFileName,
  workerMetadataOracleFileName
} from '../src/oracle/oracle-location.ts';
import { formatDifferential } from '../src/oracle/release-differential.ts';

interface ModeJudgeReport {
  readonly documents: number;
  readonly families: readonly FamilyCount[];
}

interface SelfCheckReport {
  readonly liveSurfaceNotes: number;
  readonly liveSurfaces: readonly FamilyCount[];
}

// One side of the differential.
interface Side {
  readonly directory: string;
  readonly label: 'from' | 'to';
  readonly version: string;
}

// A judge run's report on one version: its families, and the number of documents it judged.
interface SideTable {
  readonly documents: number;
  readonly families: readonly FamilyCount[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const jitiCli = join(repoRoot, 'node_modules', 'jiti', 'lib', 'jiti-cli.mjs');

const { values } = parseArgs({
  options: {
    'from-dir': { default: PINNED_ORACLE_DIRECTORY, type: 'string' },
    'from-version': { default: PINNED_OBSIDIAN_VERSION, type: 'string' },
    'out-dir': { type: 'string' },
    'to-dir': { default: PINNED_ORACLE_DIRECTORY, type: 'string' },
    'to-version': { type: 'string' }
  }
});
const toVersion = values['to-version'];
if (toVersion === undefined) {
  throw new Error('--to-version is required');
}
const sides: readonly Side[] = [
  { directory: values['from-dir'], label: 'from', version: values['from-version'] },
  { directory: values['to-dir'], label: 'to', version: toVersion }
];
const [fromSide, toSide] = sides as [Side, Side];
const outDirectory = values['out-dir'] ?? join(repoRoot, 'dist', 'release-differential', `${fromSide.version}-to-${toSide.version}`);

// The first oracle file a judge run needs that one of the versions lacks, named for the report.
function missingFile(fileNamesOf: (version: string) => readonly string[]): string | undefined {
  for (const side of sides) {
    const missing = fileNamesOf(side.version).find((fileName) => !existsSync(join(side.directory, fileName)));
    if (missing !== undefined) {
      return `no ${missing} in ${side.directory}`;
    }
  }
  return undefined;
}

function readReport(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function reportPath(side: Side, name: string): string {
  return join(outDirectory, side.label, `${name}.json`);
}

function run(side: Side, script: string, arguments_: readonly string[]): void {
  console.log(`\n> ${side.version}: jiti scripts/${script} ${arguments_.join(' ')}`);
  const result = spawnSync(process.execPath, [jitiCli, join(here, script), ...arguments_], {
    cwd: repoRoot,
    env: { ...process.env, [ORACLE_DIRECTORY_VARIABLE]: side.directory, [ORACLE_VERSION_VARIABLE]: side.version },
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`scripts/${script} failed on ${side.version} with exit code ${String(result.status)}`);
  }
}

console.log(`Release differential from Obsidian ${fromSide.version} (${fromSide.directory}) to ${toSide.version} (${toSide.directory})`);
mkdirSync(outDirectory, { recursive: true });

const modeJudgeSkipped = missingFile((version) => [...CLASS_ORACLE_SEEDS.map((seed) => classOracleFileName(seed, version)), specOracleFileName(version), workerMetadataOracleFileName(version)]);
const liveSurfacesSkipped = missingFile((version) => [liveSurfacesOracleFileName(version)]);

for (const side of sides) {
  if (modeJudgeSkipped === undefined) {
    run(side, 'mode-judge.ts', ['--out', reportPath(side, 'mode-judge')]);
  }
  if (liveSurfacesSkipped === undefined) {
    run(side, 'self-check.ts', ['--count', '0', '--live-surfaces', '--out', reportPath(side, 'self-check')]);
  }
}

function tablePair(name: string, skipped: string | undefined, tableOf: (side: Side) => SideTable): FamilyTablePair {
  if (skipped !== undefined) {
    return { name, skipped };
  }
  const from = tableOf(fromSide);
  const to = tableOf(toSide);
  return { documents: { from: from.documents, to: to.documents }, from: from.families, name, to: to.families };
}

const tables: FamilyTablePair[] = [
  tablePair('Mode judge', modeJudgeSkipped, (side) => readReport(reportPath(side, 'mode-judge')) as ModeJudgeReport),
  tablePair('Live surfaces', liveSurfacesSkipped, (side) => {
    const report = readReport(reportPath(side, 'self-check')) as SelfCheckReport;
    return { documents: report.liveSurfaceNotes, families: report.liveSurfaces };
  })
];
const report = formatDifferential({ from: fromSide.version, to: toSide.version }, tables);
const reportFile = join(outDirectory, 'report.md');
writeFileSync(reportFile, report);
console.log(`\n${report}`);
console.log(`Wrote ${reportFile}`);
