/**
 * @file
 *
 * Re-reads every oracle from one Obsidian version, then reports the drift from the pinned version
 * (`scripts/oracle-drift.ts`) and the release differential of the bug finders' families
 * (`scripts/release-differential.ts`).
 *
 * It resolves the version first, by launching it once over CDP (`obsidian-integration-testing`, installed globally):
 * the installed one, or the one `--obsidian-version` names (`x.y.z`, `public-latest` or `catalyst-latest`). From that
 * instance it also takes the metadata worker, `worker.js`, into a temporary file outside the repository, which is
 * removed when the run ends. Then it runs, each pinned to that version and writing to the output directory:
 *
 * - `scripts/oracle.ts` once per class-span seed, with the pinned file's `--per-set`.
 * - `scripts/spec-oracle.ts`, `scripts/quirk-probe-oracle.ts`, `scripts/forum-issue-oracle.ts`, `scripts/editing-modes-oracle.ts`,
 *   `scripts/live-surfaces-oracle.ts`, `scripts/link-parity-oracle.ts`, `scripts/special-names-oracle.ts` and `scripts/link-cases-oracle.ts`.
 * - `scripts/worker-oracle.ts` on the worker it took, with the pinned file's `--per-set` and `--seed`.
 *
 * The output directory is `oracle/`, so a newer version's files land beside the pinned ones. A re-read of the pinned
 * version itself goes to a temporary directory instead, so it never overwrites the files the suites check against.
 *
 * Usage: `jiti scripts/oracle-refresh.ts [--obsidian-version <version>] [--out-dir <directory>] [--only <oracle>,...]
 * [--skip-drift] [--skip-differential]`, where an oracle is `classes`, `spec`, `quirk-probes`, `forum-issues`, `editing-modes`, `live-surfaces`, `link-parity`,
 * `special-names`, `link-cases` or `worker`.
 */

import {
  execSync,
  spawnSync
} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import {
  fileURLToPath,
  pathToFileURL
} from 'node:url';
import { parseArgs } from 'node:util';

import type { OracleFile } from '../src/oracle/oracle-file.ts';
import type { WorkerMetadataOracleFile } from '../src/oracle/worker-metadata.ts';

import {
  CLASS_ORACLE_SEEDS,
  classOracleFileName,
  PINNED_OBSIDIAN_VERSION,
  PINNED_ORACLE_DIRECTORY,
  readOracleFile,
  workerMetadataOracleFileName
} from '../src/oracle/oracle-location.ts';

interface CdpConnection {
  dispose: () => Promise<void>;
  evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
}

interface ConnectToCdpOptions {
  readonly isObsidianAppVisible?: boolean;
  readonly obsidianVersion?: string;
}

interface Electron {
  ipcRenderer?: IpcRenderer;
}

interface ElectronGlobal {
  electron?: Electron;
}

interface EvalInObsidianParams<Input extends object, Result> {
  readonly callback: (arguments_: Input) => Promise<Result> | Result;
  readonly input?: Input;
}

interface InstanceRead {
  readonly appVersion: null | string;
  readonly worker: string;
}

interface IpcRenderer {
  sendSync?: (channel: string) => string;
}

interface OitModule {
  connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

const ORACLES = ['classes', 'spec', 'quirk-probes', 'forum-issues', 'editing-modes', 'live-surfaces', 'link-parity', 'special-names', 'link-cases', 'worker'] as const;
type OracleName = typeof ORACLES[number];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const jitiCli = join(repoRoot, 'node_modules', 'jiti', 'lib', 'jiti-cli.mjs');

const { values } = parseArgs({
  options: {
    'obsidian-version': { type: 'string' },
    'only': { type: 'string' },
    'out-dir': { type: 'string' },
    'skip-differential': { type: 'boolean' },
    'skip-drift': { type: 'boolean' }
  }
});
const only = new Set<string>(values.only?.split(',').map((name) => name.trim()) ?? ORACLES);
for (const name of only) {
  if (!(ORACLES as readonly string[]).includes(name)) {
    throw new Error(`Unknown oracle ${name}: expected one of ${ORACLES.join(', ')}`);
  }
}

function isWanted(name: OracleName): boolean {
  return only.has(name);
}

async function readInstance(): Promise<InstanceRead> {
  const oitPath = join(execSync('npm root -g').toString().trim(), 'obsidian-integration-testing/dist/lib/esm/index.mjs');
  // eslint-disable-next-line no-restricted-syntax -- obsidian-integration-testing is installed globally, so its path is only known at run time.
  const oit = await import(pathToFileURL(oitPath).href) as OitModule;
  const requested = values['obsidian-version'];
  const conn = await oit.connectToCdp({ isObsidianAppVisible: false, ...(requested !== undefined && { obsidianVersion: requested }) });
  try {
    return await conn.evalInObsidian({
      callback: async () => {
        const { electron } = globalThis as ElectronGlobal & typeof globalThis;
        // The app starts its metadata worker from this file, beside its page.
        const response = await fetch('worker.js');
        return { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, worker: await response.text() };
      }
    });
  } finally {
    await conn.dispose();
  }
}

function run(script: string, arguments_: readonly string[]): void {
  console.log(`\n> jiti scripts/${script} ${arguments_.join(' ')}`);
  const result = spawnSync(process.execPath, [jitiCli, join(here, script), ...arguments_], { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`scripts/${script} failed with exit code ${String(result.status)}`);
  }
}

const instance = await readInstance();
const version = instance.appVersion;
if (version === null) {
  throw new Error('The instance did not report its version');
}
console.log(`oracle-refresh: reading every oracle from Obsidian ${version}`);

const isPinned = version === PINNED_OBSIDIAN_VERSION;
const outDirectory = values['out-dir'] ?? (isPinned ? join(tmpdir(), `obsidian-oracles-${version}`) : PINNED_ORACLE_DIRECTORY);
if (isPinned && values['out-dir'] === undefined) {
  console.log(`oracle-refresh: ${version} is the pinned version, so its re-read goes to ${outDirectory}, not to oracle/`);
}
mkdirSync(outDirectory, { recursive: true });

const workerDirectory = mkdtempSync(join(tmpdir(), 'oracle-worker-'));
try {
  const workerPath = join(workerDirectory, 'worker.js');
  writeFileSync(workerPath, instance.worker);
  const common = ['--obsidian-version', version, '--out-dir', outDirectory];

  if (isWanted('classes')) {
    for (const seed of CLASS_ORACLE_SEEDS) {
      const pinned = readOracleFile(classOracleFileName(seed, PINNED_OBSIDIAN_VERSION), PINNED_ORACLE_DIRECTORY) as OracleFile;
      run('oracle.ts', ['--seed', String(seed), '--per-set', String(pinned.meta.perSet), ...common]);
    }
  }
  if (isWanted('spec')) {
    run('spec-oracle.ts', common);
  }
  if (isWanted('quirk-probes')) {
    run('quirk-probe-oracle.ts', common);
  }
  if (isWanted('forum-issues')) {
    run('forum-issue-oracle.ts', common);
  }
  if (isWanted('editing-modes')) {
    run('editing-modes-oracle.ts', common);
  }
  if (isWanted('live-surfaces')) {
    run('live-surfaces-oracle.ts', common);
  }
  if (isWanted('link-parity')) {
    run('link-parity-oracle.ts', common);
  }
  if (isWanted('special-names')) {
    run('special-names-oracle.ts', common);
  }
  if (isWanted('link-cases')) {
    run('link-cases-oracle.ts', common);
  }
  if (isWanted('worker')) {
    const pinned = readOracleFile(workerMetadataOracleFileName(PINNED_OBSIDIAN_VERSION), PINNED_ORACLE_DIRECTORY) as WorkerMetadataOracleFile;
    run('worker-oracle.ts', ['--worker', workerPath, '--per-set', String(pinned.meta.perSet), '--seed', String(pinned.meta.seed), ...common]);
  }
} finally {
  rmSync(workerDirectory, { force: true, recursive: true });
}

if (!values['skip-drift']) {
  console.log('');
  const result = spawnSync(process.execPath, [jitiCli, join(here, 'oracle-drift.ts'), '--to-version', version, '--to-dir', outDirectory], { cwd: repoRoot, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
if (!values['skip-differential']) {
  console.log('');
  const result = spawnSync(process.execPath, [jitiCli, join(here, 'release-differential.ts'), '--to-version', version, '--to-dir', outDirectory], { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}
