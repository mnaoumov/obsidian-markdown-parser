/**
 * @file
 *
 * The live surface oracle: writes every note of `liveSurfaceDocuments()` (`src/oracle/checks/live-surfaces.ts`) and the files
 * they link to into the vault of an owned Obsidian driven over CDP (`obsidian-integration-testing`, installed globally),
 * and reads what exists only in the app: each note's cache, `resolvedLinks` and `unresolvedLinks`, its Outline view, its
 * Backlinks in the Backlinks view and `getBacklinksForFile` of each file it links to, its text after a real
 * `fileManager.renameFile` of every linked file and after renaming them back, and its text after a `processFrontMatter`.
 * Writes them to `oracle/live-surfaces-obsidian-<version>.json`.
 *
 * Usage: `jiti scripts/live-surfaces-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 */

/// <reference lib="dom.iterable" />

import { disposeAsync } from '@mnaoumov/typescript-lib/disposable';
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
  LiveSurfaceBacklinks,
  LiveSurfaceFile,
  LiveSurfaceOutlineItem,
  LiveSurfacePaneResult,
  LiveSurfaceRead,
  LiveSurfaceTarget
} from '../src/oracle/checks/live-surfaces.ts';
import type { SpecOracleMeta } from '../src/oracle/spec/spec-oracle-file.ts';

import {
  LIVE_SURFACE_FOLDER,
  LIVE_SURFACE_NOTE_FOLDER,
  LIVE_SURFACE_TARGETS,
  liveSurfaceDocuments,
  liveSurfaceNotePath,
  PROCESSED_KEY
} from '../src/oracle/checks/live-surfaces.ts';

interface App {
  readonly fileManager: FileManager;
  readonly internalPlugins: InternalPlugins;
  readonly metadataCache: MetadataCache;
  readonly vault: Vault;
  readonly workspace: Workspace;
}

interface BacklinkDom {
  readonly resultDomLookup: Map<TFile, BacklinkResultDom>;
}

interface BacklinkPane {
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's Backlinks view names its count element backlinkCountEl.
  readonly backlinkCountEl: HTMLElement;
  readonly backlinkDom: BacklinkDom;
}

interface BacklinkResultDom {
  readonly result: LiveSurfacePaneResult;
}

interface BacklinksResult {
  readonly data: Map<string, unknown[]>;
}

interface BacklinkView {
  readonly backlink: BacklinkPane;
}

interface CdpConnection {
  readonly evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

interface ConnectToCdpOptions {
  readonly obsidianVersion?: string;
}

interface DataAdapter {
  readonly mkdir: (path: string) => Promise<void>;
}

interface Electron {
  readonly ipcRenderer?: IpcRenderer;
}

interface ElectronGlobal {
  readonly electron?: Electron;
}

interface EvalInObsidianParams<Input extends object, Result> {
  readonly callback: (input: Input & ObsidianGlobals) => Promise<Result> | Result;
  readonly input?: Input;
}

interface FileManager {
  readonly processFrontMatter: (file: TFile, update: (frontMatter: Record<string, unknown>) => void) => Promise<void>;
  readonly renameFile: (file: TFile, newPath: string) => Promise<void>;
}

interface InternalPlugin {
  readonly enable: () => Promise<void>;
  readonly enabled: boolean;
}

interface InternalPlugins {
  readonly getPluginById: (id: string) => InternalPlugin | null;
}

interface IpcRenderer {
  readonly sendSync?: (channel: string) => string;
}

interface Leaf {
  readonly openFile: (file: TFile) => Promise<void>;
  readonly setViewState: (state: unknown) => Promise<void>;
  readonly view: unknown;
}

interface MetadataCache {
  readonly getBacklinksForFile: (file: TFile) => BacklinksResult;
  readonly getFileCache: (file: TFile) => unknown;
  readonly resolvedLinks: Record<string, Record<string, number> | undefined>;
  readonly unresolvedLinks: Record<string, Record<string, number> | undefined>;
}

interface NoteFile {
  readonly markdown: string;
  readonly path: string;
}

interface NoteRead {
  readonly api: Record<string, unknown[]>;
  readonly cache: unknown;
  readonly cacheAfterOpen: unknown;
  readonly outline: LiveSurfaceOutlineItem[];
  readonly resolvedLinks: Record<string, number>;
  readonly unresolvedLinks: Record<string, number>;
}

interface ObsidianGlobals {
  readonly app: App;
}

interface OitModule {
  readonly connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface OutlineView {
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's View names its element containerEl.
  readonly containerEl: HTMLElement;
  readonly file: null | TFile;
}

interface PaneRead {
  readonly count: number;
  readonly results: Record<string, LiveSurfacePaneResult>;
}

interface ProcessRead {
  readonly error: null | string;
  readonly text: null | string;
}

interface SetActiveLeafOptions {
  readonly focus: boolean;
}

interface TFile {
  readonly path: string;
}

interface Vault {
  readonly adapter: DataAdapter;
  readonly create: (path: string, data: string) => Promise<TFile>;
  readonly createBinary: (path: string, data: ArrayBuffer) => Promise<TFile>;
  readonly getFileByPath: (path: string) => null | TFile;
  readonly modify: (file: TFile, data: string) => Promise<void>;
  readonly read: (file: TFile) => Promise<string>;
  readonly setConfig: (name: string, value: unknown) => void;
}

interface Workspace {
  readonly getLeaf: (shouldCreateNewLeaf: boolean) => Leaf;
  readonly getLeavesOfType: (type: string) => Leaf[];
  readonly getRightLeaf: (shouldSplit: boolean) => Leaf | null;
  readonly revealLeaf: (leaf: Leaf) => Promise<void>;
  readonly setActiveLeaf: (leaf: Leaf, options: SetActiveLeafOptions) => void;
}

const JSON_INDENT = 2;
const PROGRESS_EVERY = 50;
const BATCH_SIZE = 50;
// How long the renames are left to settle before the notes are read: the metadata cache re-reads the rewritten notes.
const RENAME_SETTLE_MS = 1000;
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

function batches<Item>(items: readonly Item[]): Item[][] {
  const result: Item[][] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    result.push(items.slice(start, start + BATCH_SIZE));
  }
  return result;
}

// Whether every note is cached and resolved, waiting up to a few seconds for it.
async function isIndexed(paths: readonly string[]): Promise<boolean> {
  return await conn.evalInObsidian({
    callback: async ({ app, paths: notePaths }) => {
      const POLL_MS = 200;
      const MAX_POLLS = 50;
      for (let polls = 0; polls < MAX_POLLS; polls++) {
        const isDone = notePaths.every((path) => {
          const file = app.vault.getFileByPath(path);
          return file !== null && app.metadataCache.getFileCache(file) !== null && app.metadataCache.resolvedLinks[path] !== undefined;
        });
        if (isDone) {
          return true;
        }
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, POLL_MS);
        });
      }
      return false;
    },
    input: { paths }
  });
}

// Puts each note's text back, then sets the processed key on it through `processFrontMatter`.
async function processNotes(notes: readonly NoteFile[]): Promise<ProcessRead[]> {
  return await conn.evalInObsidian({
    callback: async ({ app, key, notes: noteFiles }) => {
      const reads: ProcessRead[] = [];
      for (const note of noteFiles) {
        const file = app.vault.getFileByPath(note.path);
        if (file === null) {
          throw new Error(`No note ${note.path}`);
        }
        await app.vault.modify(file, note.markdown);
        try {
          await app.fileManager.processFrontMatter(file, (frontMatter) => {
            frontMatter[key] = 1;
          });
          reads.push({ error: null, text: await app.vault.read(file) });
        } catch (error) {
          reads.push({ error: String(error), text: null });
        }
      }
      return reads;
    },
    input: { key: PROCESSED_KEY, notes }
  });
}

// One note's cache, links and Outline view: the cache is read, then the note is opened, and the view is read once it shows that note and has stopped changing.
async function readNote(path: string): Promise<NoteRead> {
  return await conn.evalInObsidian({
    callback: async ({ app, path: notePath, targets }) => {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback runs inside Obsidian, which sees nothing outside it.
      async function sleep(ms: number): Promise<void> {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });
      }

      function outlineItems(element: Element, depth: number, items: LiveSurfaceOutlineItem[]): void {
        for (const item of element.querySelectorAll(':scope > .tree-item')) {
          items.push({ depth, text: item.querySelector(':scope > .tree-item-self .tree-item-inner')?.textContent ?? '' });
          const children = item.querySelector(':scope > .tree-item-children');
          if (children !== null) {
            outlineItems(children, depth + 1, items);
          }
        }
      }
      const file = app.vault.getFileByPath(notePath);
      if (file === null) {
        throw new Error(`No note ${notePath}`);
      }
      const api: Record<string, unknown[]> = {};
      for (const target of targets) {
        const targetFile = app.vault.getFileByPath(target.path);
        const links = targetFile === null ? undefined : app.metadataCache.getBacklinksForFile(targetFile).data.get(notePath);
        if (links !== undefined) {
          api[target.path] = links;
        }
      }
      const cache = String(JSON.stringify(app.metadataCache.getFileCache(file)));
      const [outlineLeaf] = app.workspace.getLeavesOfType('outline');
      if (outlineLeaf === undefined) {
        throw new Error('No Outline view');
      }
      await app.workspace.revealLeaf(outlineLeaf);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      const view = outlineLeaf.view as OutlineView;
      const POLL_MS = 50;
      const MAX_POLLS = 200;
      const STABLE_POLLS = 4;
      let last = '';
      let stablePolls = 0;
      let outline: LiveSurfaceOutlineItem[] = [];
      for (let polls = 0; polls < MAX_POLLS && stablePolls < STABLE_POLLS; polls++) {
        await sleep(POLL_MS);
        const content = view.containerEl.querySelector(':scope .view-content > div');
        const items: LiveSurfaceOutlineItem[] = [];
        if (content !== null) {
          outlineItems(content, 0, items);
        }
        const read = JSON.stringify(items);
        stablePolls = read === last && view.file?.path === notePath ? stablePolls + 1 : 0;
        last = read;
        outline = items;
      }
      if (stablePolls < STABLE_POLLS) {
        throw new Error(`The Outline view did not settle on ${notePath}`);
      }
      const openedCache = String(JSON.stringify(app.metadataCache.getFileCache(file)));
      return {
        api: structuredClone(api),
        cache: JSON.parse(cache),
        cacheAfterOpen: openedCache === cache ? null : JSON.parse(openedCache),
        outline,
        resolvedLinks: { ...app.metadataCache.resolvedLinks[notePath] },
        unresolvedLinks: { ...app.metadataCache.unresolvedLinks[notePath] }
      };
    },
    input: { path, targets: LIVE_SURFACE_TARGETS }
  });
}

// The Backlinks view of one target: the target is opened, and the view is read once its results and its count have stopped changing.
async function readPane(target: LiveSurfaceTarget): Promise<PaneRead> {
  return await conn.evalInObsidian({
    callback: async ({ app, path }) => {
      const file = app.vault.getFileByPath(path);
      if (file === null) {
        throw new Error(`No target ${path}`);
      }
      const [backlinkLeaf] = app.workspace.getLeavesOfType('backlink');
      if (backlinkLeaf === undefined) {
        throw new Error('No Backlinks view');
      }
      await app.workspace.revealLeaf(backlinkLeaf);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      const { backlink } = backlinkLeaf.view as BacklinkView;
      const POLL_MS = 100;
      const MAX_POLLS = 250;
      const STABLE_POLLS = 10;
      let last = '';
      let stablePolls = 0;
      for (let polls = 0; polls < MAX_POLLS && stablePolls < STABLE_POLLS; polls++) {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, POLL_MS);
        });
        const read = `${String(backlink.backlinkDom.resultDomLookup.size)} ${backlink.backlinkCountEl.textContent}`;
        stablePolls = read === last ? stablePolls + 1 : 0;
        last = read;
      }
      if (stablePolls < STABLE_POLLS) {
        throw new Error(`The Backlinks view did not settle on ${path}`);
      }
      const results: Record<string, LiveSurfacePaneResult> = {};
      for (const [resultFile, dom] of backlink.backlinkDom.resultDomLookup) {
        results[resultFile.path] = structuredClone(dom.result);
      }
      return { count: Number(backlink.backlinkCountEl.textContent), results };
    },
    input: { path: target.path }
  });
}

async function readTexts(paths: readonly string[]): Promise<string[]> {
  return await conn.evalInObsidian({
    callback: async ({ app, paths: notePaths }) => {
      const texts: string[] = [];
      for (const path of notePaths) {
        const file = app.vault.getFileByPath(path);
        if (file === null) {
          throw new Error(`No note ${path}`);
        }
        texts.push(await app.vault.read(file));
      }
      return texts;
    },
    input: { paths }
  });
}

/*
 * Renames every target, to its new path or back, through `fileManager.renameFile`, which rewrites the links to it. Each
 * rename is its own eval and the settle wait is Node's: on a loaded machine the renames of one eval, each rewriting the
 * notes that link to its target, ran past the 30-second cap of an eval.
 */
async function renameTargets(isBack: boolean): Promise<void> {
  for (const target of LIVE_SURFACE_TARGETS) {
    await conn.evalInObsidian({
      callback: async ({ app, from, to }) => {
        const file = app.vault.getFileByPath(from);
        if (file === null) {
          throw new Error(`No target ${from}`);
        }
        await app.fileManager.renameFile(file, to);
      },
      input: isBack ? { from: target.renamedPath, to: target.path } : { from: target.path, to: target.renamedPath }
    });
  }
  await new Promise((resolve) => {
    setTimeout(resolve, RENAME_SETTLE_MS);
  });
}

// Every target, then every note, with the settings a rename depends on spelled out and both views open.
async function setUp(notes: readonly NoteFile[]): Promise<SpecOracleMeta> {
  return await conn.evalInObsidian({
    callback: async ({ app, folder, noteFolder, notes: noteFiles, targets }) => {
      app.vault.setConfig('alwaysUpdateLinks', true);
      app.vault.setConfig('newLinkFormat', 'shortest');
      app.vault.setConfig('useMarkdownLinks', false);
      for (const id of ['backlink', 'outline']) {
        const plugin = app.internalPlugins.getPluginById(id);
        if (plugin === null) {
          throw new Error(`No ${id} core plugin`);
        }
        if (!plugin.enabled) {
          await plugin.enable();
        }
        if (app.workspace.getLeavesOfType(id).length === 0) {
          await app.workspace.getRightLeaf(false)?.setViewState({ active: false, type: id });
        }
      }
      await app.vault.adapter.mkdir(folder);
      await app.vault.adapter.mkdir(noteFolder);
      for (const target of targets) {
        await (target.content === null ? app.vault.createBinary(target.path, new ArrayBuffer(0)) : app.vault.create(target.path, target.content));
      }
      for (const note of noteFiles) {
        await app.vault.create(note.path, note.markdown);
      }
      const { electron } = globalThis as ElectronGlobal & typeof globalThis;
      return { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent };
    },
    input: { folder: LIVE_SURFACE_FOLDER, noteFolder: LIVE_SURFACE_NOTE_FOLDER, notes, targets: LIVE_SURFACE_TARGETS }
  });
}

try {
  const documents = liveSurfaceDocuments();
  const notes = documents.map((document) => ({ markdown: document.markdown, path: liveSurfaceNotePath(document.id) }));
  const paths = notes.map((note) => note.path);
  const meta = await setUp(notes);
  if (!await isIndexed(paths) && !await isIndexed(paths)) {
    throw new Error('The notes were not indexed');
  }
  const noteReads: NoteRead[] = [];
  for (const path of paths) {
    noteReads.push(await readNote(path));
    if (noteReads.length % PROGRESS_EVERY === 0) {
      console.log(`live-surfaces-oracle: ${String(noteReads.length)} of ${String(paths.length)} notes`);
    }
  }
  const paneCounts: Record<string, number> = {};
  const panes = new Map<string, PaneRead>();
  for (const target of LIVE_SURFACE_TARGETS) {
    const pane = await readPane(target);
    panes.set(target.path, pane);
    paneCounts[target.path] = pane.count;
  }
  await renameTargets(false);
  const renamedBatches = await Promise.all(batches(paths).map(async (batch) => readTexts(batch)));
  const renamedTexts = renamedBatches.flat();
  await renameTargets(true);
  const roundTripBatches = await Promise.all(batches(paths).map(async (batch) => readTexts(batch)));
  const roundTripTexts = roundTripBatches.flat();
  const processReads: ProcessRead[] = [];
  for (const batch of batches(notes)) {
    processReads.push(...await processNotes(batch));
  }
  console.log('live-surfaces-oracle: Backlinks, renames and front matter read');

  const reads: LiveSurfaceRead[] = documents.map((document, index) => {
    const path = paths[index] ?? '';
    const noteRead = noteReads[index];
    const processRead = processReads[index];
    if (noteRead === undefined || processRead === undefined) {
      throw new Error(`No read of ${path}`);
    }
    const backlinks: Record<string, LiveSurfaceBacklinks> = {};
    for (const target of LIVE_SURFACE_TARGETS) {
      const api = noteRead.api[target.path];
      const pane = panes.get(target.path)?.results[path] ?? null;
      if (api !== undefined || pane !== null) {
        backlinks[target.path] = { api: api ?? [], pane };
      }
    }
    return {
      ...document,
      backlinks,
      cache: noteRead.cache,
      cacheAfterOpen: noteRead.cacheAfterOpen,
      outline: noteRead.outline,
      processedText: processRead.text,
      processError: processRead.error,
      renamedText: renamedTexts[index] ?? '',
      resolvedLinks: noteRead.resolvedLinks,
      roundTripText: roundTripTexts[index] ?? '',
      unresolvedLinks: noteRead.unresolvedLinks
    };
  });
  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, `live-surfaces-obsidian-${meta.appVersion ?? 'unknown'}.json`);
  const oracleFile: LiveSurfaceFile = { meta, paneCounts, reads };
  // Left out of dprint (`dprint.json`), which refuses the file: a cached `original` the app cut inside an astral
  // character holds a lone surrogate, which `JSON.stringify` writes as an escape dprint does not accept.
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  console.log(`live-surfaces-oracle: ${String(reads.length)} notes written to ${outFile}`);
} finally {
  await disposeAsync(conn);
}
