/**
 * @file
 *
 * Runs the private demo plugin in an owned Obsidian instance driven over CDP (`obsidian-integration-testing`,
 * installed globally) and prints its reports as JSON.
 *
 * It copies the notes of a real vault into the instance's temporary vault, adds a note of the requested length built
 * from those notes, installs `dist/demo-plugin/` (build it first with `jiti scripts/build-demo-plugin.ts`), and runs
 * the plugin's commands: the class comparison and the metadata comparison over every note, then the measurement on the
 * long note and on the longest copied note, in source mode and in live preview.
 *
 * Usage: `jiti scripts/demo-plugin-measure.ts [--vault <dir>] [--lines 100000] [--obsidian-version <version>]`.
 */

import { execSync } from 'node:child_process';
import {
  readdirSync,
  readFileSync
} from 'node:fs';
import {
  dirname,
  join,
  relative
} from 'node:path';
import {
  fileURLToPath,
  pathToFileURL
} from 'node:url';
import { parseArgs } from 'node:util';

import type {
  ClassComparisonReport,
  MeasurementReport,
  MetadataComparisonReport
} from '../src/demo-plugin/main.ts';

import { compareCodeUnits } from '../src/oracle/score.ts';

interface App {
  metadataCache: MetadataCache;
  plugins: Plugins;
  vault: Vault;
  workspace: Workspace;
}

interface CdpConnection extends AsyncDisposable {
  evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
}

type CommandResult<Name extends keyof DemoPlugin> = Awaited<ReturnType<DemoPlugin[Name]>>;

interface ConnectToCdpOptions {
  readonly commandTimeoutInMilliseconds?: number;
  readonly obsidianVersion?: string;
}

interface DataAdapter {
  mkdir: (path: string) => Promise<void>;
  write: (path: string, data: string) => Promise<void>;
}

interface DemoPlugin {
  compareClasses: () => Promise<ClassComparisonReport>;
  compareMetadata: () => Promise<MetadataComparisonReport>;
  measure: () => Promise<MeasurementReport | null>;
}

interface Electron {
  ipcRenderer?: IpcRenderer;
}

interface ElectronGlobal {
  electron?: Electron;
}

interface EvalInObsidianParams<Input extends object, Result> {
  readonly callback: (input: Input & ObsidianGlobals) => Promise<Result>;
  readonly input?: Input;
}

interface IpcRenderer {
  sendSync?: (channel: string) => string;
}

interface Leaf {
  setViewState: (state: unknown) => Promise<void>;
}

interface MetadataCache {
  getFileCache: (file: unknown) => unknown;
}

interface Note {
  readonly path: string;
  readonly text: string;
}

interface ObsidianGlobals {
  app: App;
}

interface OitModule {
  connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface Plugins {
  enablePlugin: (id: string) => Promise<void>;
  loadManifests: () => Promise<void>;
  plugins: Record<string, DemoPlugin | undefined>;
  setEnable: (isEnabled: boolean) => Promise<void>;
}

interface Vault {
  adapter: DataAdapter;
  getAbstractFileByPath: (path: string) => unknown;
  getMarkdownFiles: () => unknown[];
}

interface Workspace {
  getLeaf: (shouldCreateNewLeaf: boolean) => Leaf;
}

const PLUGIN_ID = 'markdown-parser-demo';
const SAMPLE_FOLDER = 'sample';
const LONG_NOTE = 'long.md';
const BATCH_SIZE = 50;
const LISTED = 5;
const JSON_INDENT = 2;
const POLL_MS = 200;
const MAX_POLLS = 300;
const COMMAND_TIMEOUT_MS = 600_000;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { values } = parseArgs({
  options: {
    'lines': { default: '100000', type: 'string' },
    'obsidian-version': { type: 'string' },
    'vault': { default: join(root, '..', 'obsidian-community-vault'), type: 'string' }
  }
});
const lineCount = Number(values.lines);
const obsidianVersion = values['obsidian-version'];

const notes = readNotes(values.vault);
const longest = findLongest(notes);
const longText = buildLongText(notes, lineCount);
const mainJs = readFileSync(join(root, 'dist', 'demo-plugin', 'main.js'), 'utf-8');
const manifest = readFileSync(join(root, 'dist', 'demo-plugin', 'manifest.json'), 'utf-8');

const oitPath = join(execSync('npm root -g').toString().trim(), 'obsidian-integration-testing/dist/lib/esm/index.mjs');
// eslint-disable-next-line no-restricted-syntax -- obsidian-integration-testing is installed globally, so its path is only known at run time.
const oit = await import(pathToFileURL(oitPath).href) as OitModule;

// The connection is disposed by hand: `await using` needs a tslib helper this repo does not install.
// A whole-vault comparison or the long note's measurement is one plugin call, which cannot be split into shorter calls.
const conn = await oit.connectToCdp({ commandTimeoutInMilliseconds: COMMAND_TIMEOUT_MS, ...(obsidianVersion !== undefined && { obsidianVersion }) });
try {
  for (let start = 0; start < notes.length; start += BATCH_SIZE) {
    await conn.evalInObsidian({
      callback: async ({ app, batch, folder }) => {
        for (const note of batch) {
          const parts = `${folder}/${note.path}`.split('/');
          for (let depth = 1; depth < parts.length; depth++) {
            await app.vault.adapter.mkdir(parts.slice(0, depth).join('/'));
          }
          await app.vault.adapter.write(`${folder}/${note.path}`, note.text);
        }
      },
      input: { batch: notes.slice(start, start + BATCH_SIZE), folder: SAMPLE_FOLDER }
    });
    progress(`copied ${String(Math.min(start + BATCH_SIZE, notes.length))}/${String(notes.length)} notes`);
  }
  await conn.evalInObsidian({
    callback: async ({ app, longNote, longNotePath, mainJs: pluginMain, manifest: pluginManifest, pluginId }) => {
      await app.vault.adapter.write(longNotePath, longNote);
      const directory = `.obsidian/plugins/${pluginId}`;
      await app.vault.adapter.mkdir(directory);
      await app.vault.adapter.write(`${directory}/main.js`, pluginMain);
      await app.vault.adapter.write(`${directory}/manifest.json`, pluginManifest);
      await app.plugins.setEnable(true);
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin(pluginId);
    },
    input: { longNote: longText, longNotePath: LONG_NOTE, mainJs, manifest, pluginId: PLUGIN_ID }
  });
  progress(`wrote ${LONG_NOTE} and enabled the plugin`);
  // The metadata cache fills as the worker reads each new note; the wait runs in Node, one short eval per poll.
  for (let poll = 0;; poll++) {
    const cached = await conn.evalInObsidian({
      callback: async ({ app }) => {
        await Promise.resolve();
        return app.vault.getMarkdownFiles().filter((file) => app.metadataCache.getFileCache(file) !== null).length;
      }
    });
    if (cached >= notes.length + 1) {
      progress('the metadata cache holds every note');
      break;
    }
    if (poll >= MAX_POLLS) {
      throw new Error(`The metadata cache holds ${String(cached)} of ${String(notes.length + 1)} notes`);
    }
    await sleep(POLL_MS);
  }
  const classes = await runCommand('compareClasses', `${SAMPLE_FOLDER}/${longest.path}`, true);
  progress('compared the editor classes');
  const metadata = await runCommand('compareMetadata', `${SAMPLE_FOLDER}/${longest.path}`, true);
  progress('compared the metadata');
  const measurements: unknown[] = [];
  for (const path of [`${SAMPLE_FOLDER}/${longest.path}`, LONG_NOTE]) {
    for (const isSource of [true, false]) {
      measurements.push({ mode: isSource ? 'source' : 'live preview', ...await runCommand('measure', path, isSource) });
      progress(`measured ${path} in ${isSource ? 'source mode' : 'live preview'}`);
    }
  }
  const appVersion = await conn.evalInObsidian({
    callback: async () => {
      await Promise.resolve();
      const { electron } = globalThis as ElectronGlobal & typeof globalThis;
      return electron?.ipcRenderer?.sendSync?.('version') ?? null;
    }
  });
  const reports = { appVersion, classes, measurements, metadata };
  console.log(JSON.stringify(
    {
      ...reports,
      classes: { ...reports.classes, differing: reports.classes.differing.slice(0, LISTED), differingCount: reports.classes.differing.length, differingNodes: reports.classes.differingNodes.slice(0, LISTED), differingNodesCount: reports.classes.differingNodes.length },
      metadata: { ...reports.metadata, differing: reports.metadata.differing.slice(0, LISTED), differingCount: reports.metadata.differing.length }
    },
    null,
    JSON_INDENT
  ));
} finally {
  await conn[Symbol.asyncDispose]();
}

// The vault's notes repeated, whole, until the text has the requested number of lines.

function buildLongText(sourceNotes: readonly Note[], lines: number): string {
  const parts: string[] = [];
  let count = 0;
  for (let index = 0; count < lines; index++) {
    const note = sourceNotes[index % sourceNotes.length];
    if (!note) {
      break;
    }
    parts.push(note.text);
    count += note.text.split('\n').length;
  }
  return parts.join('\n');
}

function findLongest(sourceNotes: readonly Note[]): Note {
  let longestNote: Note | undefined;
  for (const note of sourceNotes) {
    if (!longestNote || note.text.length > longestNote.text.length) {
      longestNote = note;
    }
  }
  if (!longestNote) {
    throw new Error('The vault has no notes');
  }
  return longestNote;
}

function progress(message: string): void {
  process.stderr.write(`demo-plugin: ${message}\n`);
}

function readNotes(vault: string): Note[] {
  const found: Note[] = [];
  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          visit(path);
        }
      } else if (entry.name.endsWith('.md')) {
        found.push({ path: relative(vault, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf-8') });
      }
    }
  }
  visit(vault);
  return found.toSorted((a, b) => compareCodeUnits(a.path, b.path));
}

// Opens a note in the editor, runs one of the plugin's commands on it and closes the report's modal.
async function runCommand<Name extends keyof DemoPlugin>(command: Name, path: string, isSource: boolean): Promise<CommandResult<Name>> {
  return conn.evalInObsidian({
    callback: async ({ app, commandName, notePath, pluginId, source }): Promise<CommandResult<Name>> => {
      const plugin = app.plugins.plugins[pluginId];
      if (!plugin) {
        throw new Error('The demo plugin did not load');
      }
      await app.workspace.getLeaf(false).setViewState({ state: { file: notePath, mode: 'source', source }, type: 'markdown' });
      const result = await plugin[commandName]() as CommandResult<Name>;
      for (const button of document.querySelectorAll<HTMLElement>('.modal-close-button')) {
        button.click();
      }
      return result;
    },
    input: { commandName: command, notePath: path, pluginId: PLUGIN_ID, source: isSource }
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
