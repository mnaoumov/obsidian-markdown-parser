/**
 * @file
 *
 * The link case oracle: writes the files of every case of `LINK_CASES` (`src/oracle/link-cases.ts`) into the empty vault
 * of an owned Obsidian driven over CDP (`obsidian-integration-testing`, installed globally), lets each case act (a
 * rename, a note composer merge, or the links `generateMarkdownLink` writes in both formats), and reads the cached links
 * of each case's note and the file the app's own `getFirstLinkpathDest` sends each one to. Writes them to
 * `oracle/link-cases-obsidian-<version>.json`.
 *
 * Every wait is done from Node between short calls into the app, since one call is capped at 30 s.
 *
 * Usage: `jiti scripts/link-cases-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 */

import { execSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import {
  fileURLToPath,
  pathToFileURL
} from 'node:url';
import { parseArgs } from 'node:util';

import type {
  LinkCase,
  LinkCaseRead,
  LinkCasesFile,
  LinkCasesMeta,
  LinkRead
} from '../src/oracle/link-cases.ts';

import {
  LINK_CASES,
  LINK_FORMATS
} from '../src/oracle/link-cases.ts';
import { linkCasesOracleFileName } from '../src/oracle/oracle-location.ts';

interface App {
  fileManager: FileManager;
  internalPlugins: InternalPlugins;
  metadataCache: MetadataCache;
  vault: Vault;
}

interface CachedLink {
  readonly link: string;
  readonly original: string;
  readonly position: Position;
}

interface CdpConnection {
  [Symbol.asyncDispose]: () => Promise<void>;
  evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
}

interface ConnectToCdpOptions {
  readonly obsidianVersion?: string;
}

interface Electron {
  ipcRenderer?: IpcRenderer;
}

interface EvalInObsidianParams<Input extends object, Result> {
  readonly callback: (input: Input & ObsidianGlobals) => Promise<Result> | Result;
  readonly input?: Input;
}

interface FileCache {
  readonly embeds?: readonly CachedLink[];
  readonly links?: readonly CachedLink[];
}

interface FileManager {
  generateMarkdownLink: (file: TFile, sourcePath: string) => string;
  renameFile: (file: TFile, newPath: string) => Promise<void>;
}

interface InternalPlugins {
  getPluginById: (id: string) => NoteComposerPlugin;
}

interface IpcRenderer {
  sendSync?: (channel: string) => string;
}

interface MetadataCache {
  getFileCache: (file: TFile) => FileCache | null;
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own name.
  getFirstLinkpathDest: (path: string, sourcePath: string) => null | TFile;
  readonly resolvedLinks: Record<string, Record<string, number> | undefined>;
}

// Note composer's merge: appends the text of `from` to `into` and trashes `from`.
interface NoteComposer {
  mergeFile: (into: TFile, from: TFile) => Promise<void>;
}

interface NoteComposerPlugin {
  readonly instance: NoteComposer;
}

// One case's note: its text, and its cached links in source order.
interface NoteRead {
  readonly links: readonly LinkRead[];
  readonly text: string;
}

interface ObsidianGlobals {
  readonly app: App;
}

interface OitModule {
  connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface Position {
  readonly start: PositionPoint;
}

interface PositionPoint {
  readonly offset: number;
}

interface ProbeGlobal {
  readonly electron?: Electron;
}

interface TFile {
  readonly path: string;
}

interface Vault {
  create: (path: string, text: string) => Promise<TFile>;
  createBinary: (path: string, data: ArrayBuffer) => Promise<TFile>;
  createFolder: (path: string) => Promise<unknown>;
  getAbstractFileByPath: (path: string) => unknown;
  getFileByPath: (path: string) => null | TFile;
  getName: () => string;
  read: (file: TFile) => Promise<string>;
  setConfig: (key: string, value: unknown) => void;
}

const JSON_INDENT = 2;
// A case's note is read once two reads 200 ms apart agree, after at least 1 s, for up to 6 s.
const SETTLE_POLL_MS = 200;
const SETTLE_MIN_POLLS = 5;
const SETTLE_POLLS = 30;
// A 1x1 transparent PNG.
const IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    'obsidian-version': { type: 'string' },
    'out-dir': { type: 'string' }
  }
});

const obsidianVersion = values['obsidian-version'];
const oitPath = join(execSync('npm root -g').toString().trim(), 'obsidian-integration-testing/dist/lib/esm/index.mjs');
// eslint-disable-next-line no-restricted-syntax -- obsidian-integration-testing is installed globally, so its path is only known at run time.
const oit = await import(pathToFileURL(oitPath).href) as OitModule;
// The connection is disposed by hand: `await using` needs a tslib helper this repo does not install.
const conn = await oit.connectToCdp(obsidianVersion === undefined ? {} : { obsidianVersion });

// Runs every case's action: the renames, the merges, and the generated links written into their notes.
async function act(): Promise<Record<string, string[]>> {
  return await conn.evalInObsidian({
    callback: async ({ app, cases, formats }) => {
      const generated: Record<string, string[]> = {};
      async function actOn({ action, id, note }: LinkCase): Promise<void> {
        if (action.kind === 'rename') {
          const file = app.vault.getFileByPath(action.from);
          if (file === null) {
            throw new Error(`No ${action.from}`);
          }
          await app.fileManager.renameFile(file, action.to);
          return;
        }
        if (action.kind === 'merge') {
          const into = app.vault.getFileByPath(note);
          const from = app.vault.getFileByPath(action.from);
          if (into === null || from === null) {
            throw new Error(`No ${note} or ${action.from}`);
          }
          await app.internalPlugins.getPluginById('note-composer').instance.mergeFile(into, from);
          return;
        }
        if (action.kind !== 'generate') {
          return;
        }
        const target = app.vault.getFileByPath(action.target);
        if (target === null) {
          throw new Error(`No ${action.target}`);
        }
        const links = formats.map((format) => {
          app.vault.setConfig('useMarkdownLinks', format === 'markdown');
          return app.fileManager.generateMarkdownLink(target, note);
        });
        app.vault.setConfig('useMarkdownLinks', false);
        generated[id] = links;
        await app.vault.create(note, links.map((link) => `${link}\n`).join('\n'));
      }
      for (const linkCase of cases) {
        await actOn(linkCase);
      }
      return generated;
    },
    input: { cases: LINK_CASES, formats: LINK_FORMATS }
  });
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// One case's note: its text, and its cached links and embeds in source order with where each leads.
async function readNote(note: string): Promise<NoteRead> {
  return await conn.evalInObsidian({
    callback: async ({ app, note: path }) => {
      const file = app.vault.getFileByPath(path);
      if (file === null) {
        throw new Error(`No ${path}`);
      }
      const cache = app.metadataCache.getFileCache(file);
      const cached = [...cache?.links ?? [], ...cache?.embeds ?? []].toSorted((a, b) => a.position.start.offset - b.position.start.offset);
      return {
        links: cached.map(({ link, original }) => ({
          destination: app.metadataCache.getFirstLinkpathDest(link.replace(/#.*$/s, ''), path)?.path ?? null,
          link,
          original
        })),
        text: await app.vault.read(file)
      };
    },
    input: { note }
  });
}

// A case's note once two reads in a row agree.
async function settleNote(note: string): Promise<NoteRead> {
  let previous = '';
  let read = await readNote(note);
  for (let poll = 0; poll < SETTLE_POLLS; poll++) {
    await pause(SETTLE_POLL_MS);
    read = await readNote(note);
    const current = JSON.stringify(read);
    if (current === previous && poll >= SETTLE_MIN_POLLS) {
      break;
    }
    previous = current;
  }
  return read;
}

async function setUp(): Promise<LinkCasesMeta> {
  return await conn.evalInObsidian({
    callback: ({ app }) => {
      const { electron } = globalThis as ProbeGlobal & typeof globalThis;
      app.vault.setConfig('newLinkFormat', 'shortest');
      app.vault.setConfig('useMarkdownLinks', false);
      app.vault.setConfig('alwaysUpdateLinks', true);
      return { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent, vault: app.vault.getName() };
    }
  });
}

// Writes every case's files through the vault, creating their folders first.
async function writeFiles(): Promise<void> {
  await conn.evalInObsidian({
    callback: async ({ app, files, imageBase64 }) => {
      const image = Uint8Array.from(atob(imageBase64), (character) => character.codePointAt(0) ?? 0).buffer;
      for (const [path, text] of files) {
        const parts = path.split('/').slice(0, -1);
        for (let depth = 1; depth <= parts.length; depth++) {
          const folder = parts.slice(0, depth).join('/');
          if (app.vault.getAbstractFileByPath(folder) === null) {
            await app.vault.createFolder(folder);
          }
        }
        await (text === null ? app.vault.createBinary(path, image) : app.vault.create(path, text));
      }
    },
    input: { files: LINK_CASES.flatMap(({ files }) => Object.entries(files)), imageBase64: IMAGE_BASE64 }
  });
}

try {
  const meta = await setUp();
  await writeFiles();
  // Every note written is indexed and its links resolved before any case acts.
  for (const { files } of LINK_CASES) {
    for (const [path, text] of Object.entries(files)) {
      if (text !== null && path.endsWith('.md')) {
        await settleNote(path);
      }
    }
  }
  const generated = await act();
  const reads: Record<string, LinkCaseRead> = {};
  for (const { id, note } of LINK_CASES) {
    reads[id] = { generated: generated[id] ?? [], ...await settleNote(note) };
  }
  console.log(`link-cases-oracle: ${String(LINK_CASES.length)} cases read`);

  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, linkCasesOracleFileName(meta.appVersion ?? 'unknown'));
  const oracleFile: LinkCasesFile = { meta, reads };
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  console.log(`link-cases-oracle: written to ${outFile}`);
} finally {
  await conn[Symbol.asyncDispose]();
}
