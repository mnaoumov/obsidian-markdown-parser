/**
 * @file
 *
 * The link parity oracle: writes every file of `linkParityTargetFiles()` (`src/oracle/links/link-parity.ts`) on disk, straight
 * into the vault of an owned Obsidian driven over CDP (`obsidian-integration-testing`, installed globally), never
 * through the app. It asks the app to write the links of the cases Obsidian writes, through `generateMarkdownLink` and
 * the editor's link autocomplete, in both formats, then writes each case's link into a note of its own, also on disk.
 * For every note it reads the cached link, the first link Reading view renders, and where each leads by the app's own
 * `parseLinktext`, `getFirstLinkpathDest` and `resolveSubpath`; for every heading collision, which heading a link to the
 * second one reaches. Writes them to `oracle/link-parity-obsidian-<version>.json`.
 *
 * `parseLinktext`, `resolveSubpath`, `MarkdownRenderer` and `Component` come from the `obsidian` module, which only a
 * plugin can import, so the oracle writes a one-line plugin into the vault that hands it over.
 *
 * Usage: `jiti scripts/links/link-parity-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 */

/// <reference lib="dom.iterable" />

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
  HeadingCollision,
  HeadingCollisionRead,
  LinkParityCase,
  LinkParityFile,
  LinkParityRead,
  LinkResolutionRead,
  LinkSubpathRead,
  RenderedLinkRead
} from '../../src/oracle/links/link-parity.ts';
import type { SpecOracleMeta } from '../../src/oracle/spec/spec-oracle-file.ts';

import {
  HEADING_COLLISIONS,
  LINK_PARITY_FOLDER,
  linkParityCasePath,
  linkParityCases,
  linkParityCollisionPath,
  linkParityTargetFiles
} from '../../src/oracle/links/link-parity.ts';
import { linkParityOracleFileName } from '../../src/oracle/oracle-location.ts';

interface App {
  fileManager: FileManager;
  metadataCache: MetadataCache;
  plugins: Plugins;
  vault: Vault;
  workspace: Workspace;
}

interface BlockCache {
  readonly id: string;
}

interface CachedLink {
  readonly displayText?: string;
  readonly link: string;
}

interface CdpConnection {
  [Symbol.asyncDispose]: () => Promise<void>;
  evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
}

interface Component {
  load: () => void;
  unload: () => void;
}

interface ConnectToCdpOptions {
  readonly obsidianVersion?: string;
}

interface DataAdapter {
  readonly basePath: string;
}

interface Editor {
  getValue: () => string;
  setCursor: (position: EditorPosition) => void;
  setValue: (text: string) => void;
}

interface EditorPosition {
  readonly ch: number;
  readonly line: number;
}

interface EditorSuggest {
  context: unknown;
  getSuggestions: (context: unknown) => Promise<Suggestion[]> | Suggestion[];
  onTrigger: (cursor: EditorPosition, editor: Editor, file: TFile) => null | object;
  selectSuggestion: (item: Suggestion, event: KeyboardEvent) => void;
}

interface EditorSuggests {
  readonly suggests: readonly EditorSuggest[];
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
  readonly headings?: readonly HeadingCache[];
  readonly links?: readonly CachedLink[];
}

interface FileManager {
  generateMarkdownLink: (file: TFile, sourcePath: string, subpath?: string, alias?: string) => string;
}

interface HeadingCache {
  readonly heading: string;
}

interface IpcRenderer {
  sendSync?: (channel: string) => string;
}

interface Leaf {
  getViewState: () => ViewState;
  openFile: (file: TFile) => Promise<void>;
  setViewState: (state: ViewState) => Promise<void>;
  readonly view: MarkdownView;
}

interface Linktext {
  readonly path: string;
  readonly subpath: string;
}

interface MarkdownRenderer {
  render: (app: App, markdown: string, element: HTMLElement, sourcePath: string, component: Component) => Promise<void>;
}

interface MarkdownView {
  readonly editor: Editor;
  readonly file: null | TFile;
}

interface MetadataCache {
  getFileCache: (file: TFile) => FileCache | null;
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own name.
  getFirstLinkpathDest: (path: string, sourcePath: string) => null | TFile;
  readonly resolvedLinks: Record<string, Record<string, number> | undefined>;
}

interface ObsidianGlobals {
  readonly app: App;
}

interface ObsidianModule {
  readonly Component: new () => Component;
  readonly MarkdownRenderer: MarkdownRenderer;
  parseLinktext: (linktext: string) => Linktext;
  resolveSubpath: (cache: FileCache | null, subpath: string) => null | SubpathResult;
}

interface OitModule {
  connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface Plugins {
  enablePlugin: (id: string) => Promise<boolean>;
  loadManifests: () => Promise<void>;
  setEnable: (isEnabled: boolean) => void;
}

interface ProbeGlobal {
  readonly electron?: Electron;
  readonly linkParityObsidian?: ObsidianModule;
}

interface RenderRead {
  readonly count: number;
  readonly first: null | RenderedLinkRead;
}

interface SetUpRead {
  readonly basePath: string;
  readonly meta: SpecOracleMeta;
}

interface SubpathResult {
  readonly block?: BlockCache;
  readonly current?: HeadingCache;
  readonly type: 'block' | 'heading';
}

interface Suggestion {
  readonly file?: TFile;
  readonly heading?: HeadingCache | string;
  readonly type: string;
}

interface TFile {
  readonly path: string;
}

interface TriggeredSuggest {
  readonly suggest: EditorSuggest;
  readonly suggestions: readonly Suggestion[];
}

interface Vault {
  readonly adapter: DataAdapter;
  getFileByPath: (path: string) => null | TFile;
  getFiles: () => TFile[];
  read: (file: TFile) => Promise<string>;
  setConfig: (key: string, value: unknown) => void;
}

interface ViewState {
  readonly state?: Record<string, unknown>;
  readonly type: string;
}

interface Workspace {
  readonly editorSuggest: EditorSuggests;
  getLeaf: (isNewLeaf: boolean) => Leaf;
  getLeavesOfType: (type: string) => Leaf[];
}

const JSON_INDENT = 2;
const READ_BATCH = 25;
const WRITE_BATCH = 10;
const WRITE_PAUSE_MS = 15;
const POLL_MS = 500;
const MAX_POLLS = 120;
const REWRITE_EVERY = 4;
const PLUGIN_ID = 'link-parity-probe';
// The note the autocomplete types into.
const EDITOR_NOTE = `${LINK_PARITY_FOLDER}/editor.md`;
const here = join(dirname(fileURLToPath(import.meta.url)), '..');

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

// The links the editor's autocomplete writes when the case's suggestion is picked, by case id.
async function autocompleteLinks(cases: readonly LinkParityCase[]): Promise<Record<string, string>> {
  return await conn.evalInObsidian({
    callback: async ({ app, cases: autocompleteCases, editorNote }) => {
      const view = app.workspace.getLeavesOfType('markdown').find((leaf) => leaf.view.file?.path === editorNote)?.view;
      if (view === undefined || view.file === null) {
        throw new Error('No editor');
      }
      const { editor, file: source } = view;
      // The first suggester the typed text triggers, with its suggestions.
      async function trigger(typed: string): Promise<null | TriggeredSuggest> {
        const cursor = { ch: typed.length, line: 0 };
        for (const suggest of app.workspace.editorSuggest.suggests) {
          editor.setValue(typed);
          editor.setCursor(cursor);
          const context = suggest.onTrigger(cursor, editor, source);
          if (context !== null) {
            suggest.context = { ...context, editor, file: source };
            return { suggest, suggestions: await suggest.getSuggestions(suggest.context) };
          }
        }
        return null;
      }
      const links: Record<string, string> = {};
      for (const linkCase of autocompleteCases) {
        const { request } = linkCase;
        if (request?.typed === undefined) {
          throw new Error(`Nothing to type for ${linkCase.id}`);
        }
        app.vault.setConfig('useMarkdownLinks', linkCase.format === 'markdown');
        const triggered = await trigger(request.typed);
        const picked = triggered?.suggestions.find((suggestion) => {
          if (suggestion.file?.path !== request.target) {
            return false;
          }
          if (request.heading === undefined) {
            return suggestion.type === 'file';
          }
          const heading = typeof suggestion.heading === 'string' ? suggestion.heading : suggestion.heading?.heading;
          return suggestion.type === 'heading' && heading === request.heading;
        });
        if (triggered === null) {
          links[linkCase.id] = '<<no suggester>>';
        } else if (picked === undefined) {
          links[linkCase.id] = `<<not offered among ${String(triggered.suggestions.length)}>>`;
        } else {
          triggered.suggest.selectSuggestion(picked, new KeyboardEvent('keydown', { key: 'Enter' }));
          links[linkCase.id] = editor.getValue();
        }
      }
      app.vault.setConfig('useMarkdownLinks', false);
      return links;
    },
    input: { cases, editorNote: EDITOR_NOTE }
  });
}

// The links `generateMarkdownLink` writes, by case id.
async function generateLinks(cases: readonly LinkParityCase[]): Promise<Record<string, string>> {
  return await conn.evalInObsidian({
    callback: ({ app, cases: apiCases, folder }) => {
      const links: Record<string, string> = {};
      for (const linkCase of apiCases) {
        const { request } = linkCase;
        const file = request === undefined ? null : app.vault.getFileByPath(request.target);
        app.vault.setConfig('useMarkdownLinks', linkCase.format === 'markdown');
        links[linkCase.id] = file === null || request === undefined
          ? '<<no file>>'
          : app.fileManager.generateMarkdownLink(file, `${folder}/${linkCase.id}.md`, request.subpath ?? '', request.alias ?? '');
      }
      app.vault.setConfig('useMarkdownLinks', false);
      return links;
    },
    input: { cases, folder: LINK_PARITY_FOLDER }
  });
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// Enables the plugin that hands the `obsidian` module over, and opens the editor the autocomplete types into. Returns
// the paths the vault indexed.
async function prepareApp(): Promise<string[]> {
  return await conn.evalInObsidian({
    callback: async ({ app, editorNote, folder, pluginId }) => {
      app.plugins.setEnable(true);
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin(pluginId);
      app.vault.setConfig('newLinkFormat', 'shortest');
      app.vault.setConfig('useMarkdownLinks', false);
      const file = app.vault.getFileByPath(editorNote);
      if (file === null) {
        throw new Error(`No ${editorNote}`);
      }
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file);
      const viewState = leaf.getViewState();
      await leaf.setViewState({ ...viewState, state: { ...viewState.state, mode: 'source', source: true } });
      return app.vault.getFiles().map((indexedFile) => indexedFile.path).filter((path) => path.startsWith(`${folder}/`) && path !== editorNote);
    },
    input: { editorNote: EDITOR_NOTE, folder: LINK_PARITY_FOLDER, pluginId: PLUGIN_ID }
  });
}

async function readCases(ids: readonly string[]): Promise<Record<string, LinkParityRead>> {
  return await conn.evalInObsidian({
    callback: async ({ app, folder, ids: caseIds }) => {
      const obsidian = (globalThis as ProbeGlobal & typeof globalThis).linkParityObsidian;
      if (obsidian === undefined) {
        throw new Error('The obsidian module was not handed over');
      }
      const { metadataCache } = app;
      function readSubpath(destination: TFile, subpath: string): LinkSubpathRead {
        const result = obsidian?.resolveSubpath(metadataCache.getFileCache(destination), subpath) ?? null;
        if (result === null) {
          return 'unresolved';
        }
        return result.type === 'heading' ? { heading: result.current?.heading ?? '' } : { block: result.block?.id ?? null };
      }
      function resolve(link: null | string, sourcePath: string): LinkResolutionRead | null {
        if (link === null || obsidian === undefined) {
          return null;
        }
        const { path, subpath } = obsidian.parseLinktext(link);
        const destination = metadataCache.getFirstLinkpathDest(path, sourcePath);
        const sub = destination === null || subpath === '' ? null : readSubpath(destination, subpath);
        return { destination: destination?.path ?? null, path, sub, subpath };
      }
      async function render(text: string, path: string): Promise<RenderRead> {
        if (obsidian === undefined) {
          throw new Error('The obsidian module was not handed over');
        }
        const element = document.createElement('div');
        const component = new obsidian.Component();
        component.load();
        await obsidian.MarkdownRenderer.render(app, text, element, path, component);
        const anchors = [...element.querySelectorAll<HTMLAnchorElement>('a.internal-link')];
        component.unload();
        const [anchor] = anchors;
        return { count: anchors.length, first: anchor === undefined ? null : { href: anchor.dataset['href'] ?? null, text: anchor.textContent } };
      }
      const reads: Record<string, LinkParityRead> = {};
      for (const id of caseIds) {
        const path = `${folder}/${id}.md`;
        const file = app.vault.getFileByPath(path);
        if (file === null) {
          throw new Error(`No ${path}`);
        }
        const text = await app.vault.read(file);
        const cache = metadataCache.getFileCache(file);
        const links = [...cache?.links ?? [], ...cache?.embeds ?? []];
        const cached = links[0] ?? null;
        const rendered = await render(text, path);
        reads[id] = {
          anchorCount: rendered.count,
          cacheDisplay: cached?.displayText ?? null,
          cacheLink: cached?.link ?? null,
          cacheResolve: resolve(cached?.link ?? null, path),
          linkCount: links.length,
          rendered: rendered.first,
          renderedResolve: resolve(rendered.first?.href ?? null, path),
          text
        };
      }
      return reads;
    },
    input: { folder: LINK_PARITY_FOLDER, ids }
  });
}

// For each collision note: the heading its second heading's own text reaches, and the link the autocomplete writes for it.
async function readCollisions(collisions: readonly HeadingCollision[]): Promise<HeadingCollisionRead[]> {
  const paths = collisions.map((_collision, index) => linkParityCollisionPath(index));
  return await conn.evalInObsidian({
    callback: async ({ app, collisions: pairs, editorNote, paths: notePaths }) => {
      const obsidian = (globalThis as ProbeGlobal & typeof globalThis).linkParityObsidian;
      const view = app.workspace.getLeavesOfType('markdown').find((leaf) => leaf.view.file?.path === editorNote)?.view;
      if (obsidian === undefined || view === undefined || view.file === null) {
        throw new Error('The app was not prepared');
      }
      const { editor, file: source } = view;
      // The link the autocomplete writes for the second heading the note offers, or `null`.
      async function writeSecond(path: string): Promise<null | string> {
        const typed = `[[${path.slice(path.lastIndexOf('/') + 1, -'.md'.length)}#`;
        const cursor = { ch: typed.length, line: 0 };
        for (const suggest of app.workspace.editorSuggest.suggests) {
          editor.setValue(typed);
          editor.setCursor(cursor);
          const context = suggest.onTrigger(cursor, editor, source);
          if (context !== null) {
            suggest.context = { ...context, editor, file: source };
            const suggestions = await suggest.getSuggestions(suggest.context);
            const second = suggestions.filter((suggestion) => suggestion.type === 'heading' && suggestion.file?.path === path)[1];
            if (second === undefined) {
              return null;
            }
            suggest.selectSuggestion(second, new KeyboardEvent('keydown', { key: 'Enter' }));
            return editor.getValue();
          }
        }
        return null;
      }
      const reads: HeadingCollisionRead[] = [];
      for (const [index, pair] of pairs.entries()) {
        const path = notePaths[index] ?? '';
        const file = app.vault.getFileByPath(path);
        const cache = file === null ? null : app.metadataCache.getFileCache(file);
        const headings = (cache?.headings ?? []).map((heading) => heading.heading);
        function reach(subpath: string): number {
          const result = obsidian?.resolveSubpath(cache, subpath) ?? null;
          return result?.type === 'heading' ? headings.indexOf(result.current?.heading ?? '') : -1;
        }
        const wrote = await writeSecond(path);
        const autocompleteReach = wrote === null ? null : reach(obsidian.parseLinktext(wrote.replaceAll(/^\[\[|\]\]$/g, '')).subpath);
        reads.push({ ...pair, autocompleteReach, autocompleteWrote: wrote, headings, rawReach: reach(`#${pair.second}`) });
      }
      return reads;
    },
    input: { collisions, editorNote: EDITOR_NOTE, paths }
  });
}

async function setUp(): Promise<SetUpRead> {
  return await conn.evalInObsidian({
    callback: ({ app }) => {
      const { electron } = globalThis as ProbeGlobal & typeof globalThis;
      return { basePath: app.vault.adapter.basePath, meta: { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent } };
    }
  });
}

// Waits until the app has indexed every path, and resolved its links where `isSource` asks for it.
async function waitIndexed(basePath: string, files: ReadonlyMap<string, string>, paths: readonly string[], isSource: boolean): Promise<void> {
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    const missing = await conn.evalInObsidian({
      callback: ({ app, isSource: isSourceNote, paths: notePaths }) =>
        notePaths.filter((path) => {
          const file = app.vault.getFileByPath(path);
          return !(file !== null && app.metadataCache.getFileCache(file) !== null && (!isSourceNote || app.metadataCache.resolvedLinks[path] !== undefined));
        }),
      input: { isSource, paths }
    });
    if (missing.length === 0) {
      return;
    }
    if (poll % REWRITE_EVERY === REWRITE_EVERY - 1) {
      await writeOnDisk(basePath, files, missing);
    }
    await pause(POLL_MS);
  }
  throw new Error('The app did not index every file');
}

// The vault watcher drops files written in a burst, so every write is paced, and a file still missing is written again.
async function writeOnDisk(basePath: string, files: ReadonlyMap<string, string>, paths: Iterable<string>): Promise<void> {
  for (const path of paths) {
    writeFileSync(join(basePath, path), files.get(path) ?? '');
    await pause(WRITE_PAUSE_MS);
  }
}

try {
  const { basePath, meta } = await setUp();
  const files = linkParityTargetFiles();
  files.set(EDITOR_NOTE, '\n');
  mkdirSync(join(basePath, LINK_PARITY_FOLDER), { recursive: true });
  const pluginDirectory = join(basePath, '.obsidian', 'plugins', PLUGIN_ID);
  mkdirSync(pluginDirectory, { recursive: true });
  writeFileSync(
    join(pluginDirectory, 'manifest.json'),
    JSON.stringify({ author: 'link parity oracle', description: 'Hands the obsidian module to the oracle.', id: PLUGIN_ID, minAppVersion: '1.0.0', name: 'Link parity probe', version: '1.0.0' })
  );
  writeFileSync(join(pluginDirectory, 'main.js'), 'const obsidian = require(\'obsidian\');\nmodule.exports = class extends obsidian.Plugin { onload() { window.linkParityObsidian = obsidian; } };\n');
  await writeOnDisk(basePath, files, files.keys());
  // A no-break space in a path is made a space in the vault, so that name's file is never indexed under its own path.
  const targetPaths: string[] = [];
  for (const path of files.keys()) {
    if (!path.includes('\u{A0}')) {
      targetPaths.push(path);
    }
  }
  await waitIndexed(basePath, files, targetPaths, false);
  const indexed = await prepareApp();
  console.log(`link-parity-oracle: ${String(files.size)} targets written and indexed`);

  const cases = linkParityCases();
  const writtenLinks = await generateLinks(cases.filter((linkCase) => linkCase.writer === 'api'));
  const autocompleteCases = cases.filter((linkCase) => linkCase.writer === 'autocomplete');
  for (let start = 0; start < autocompleteCases.length; start += WRITE_BATCH) {
    Object.assign(writtenLinks, await autocompleteLinks(autocompleteCases.slice(start, start + WRITE_BATCH)));
  }
  const collisions = await readCollisions(HEADING_COLLISIONS);
  console.log('link-parity-oracle: links written by the app and heading collisions read');

  const notes = new Map<string, string>();
  const notePaths: string[] = [];
  for (const linkCase of cases) {
    notePaths.push(linkParityCasePath(linkCase.id));
    notes.set(linkParityCasePath(linkCase.id), `${linkCase.markdown ?? writtenLinks[linkCase.id] ?? '<<none>>'}\n`);
  }
  await writeOnDisk(basePath, notes, notes.keys());
  await waitIndexed(basePath, notes, cases.map((linkCase) => linkParityCasePath(linkCase.id)), true);
  const reads: Record<string, LinkParityRead> = {};
  const ids = cases.map((linkCase) => linkCase.id);
  for (let start = 0; start < ids.length; start += READ_BATCH) {
    Object.assign(reads, await readCases(ids.slice(start, start + READ_BATCH)));
  }

  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, linkParityOracleFileName(meta.appVersion ?? 'unknown'));
  const oracleFile: LinkParityFile = { collisions, indexed, meta, reads };
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  console.log(`link-parity-oracle: ${String(cases.length)} cases written to ${outFile}`);
} finally {
  await conn[Symbol.asyncDispose]();
}
