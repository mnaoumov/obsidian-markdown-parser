/**
 * @file
 *
 * The special note name oracle: writes every name of `SPECIAL_NAMES` (`src/oracle/special-names.ts`) on disk, straight
 * into the vault of an owned Obsidian driven over CDP (`obsidian-integration-testing`, installed globally), never
 * through the app. For each name it writes a linker note holding the wikilink `generateMarkdownLink` writes for it, as a
 * link, an embed and a properties link, and reads what every vault surface does with the note: the index, the file
 * explorer, opening it, the quick switcher, search, the body link, backlinks, the graph view, the embed, the properties
 * link, `obsidian://open` with the URL "Copy Obsidian URL" writes, a rename and a move with their link updates, and
 * renaming a plainly named note onto the name. It also types a few names into the file explorer's rename, to see what
 * the current build refuses, and edits the one note two shadowing files share. Writes them to
 * `oracle/special-names-obsidian-<version>.json`.
 *
 * `MarkdownRenderer`, `Component` and `parseLinktext` come from the `obsidian` module, which only a plugin can import,
 * so the oracle writes a one-line plugin into the vault that hands it over. Every wait is done from Node between short
 * calls into the app, since one call is capped at 30 s.
 *
 * Usage: `jiti scripts/special-names-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 */

/// <reference lib="dom.iterable" />

import { execSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
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
  GraphRead,
  OpenRead,
  RenameCheckRead,
  RenameOntoRead,
  RenameRead,
  ShadowWriteRead,
  SpecialNameRead,
  SpecialNamesFile,
  SpecialNamesMeta,
  UriRead
} from '../src/oracle/special-names.ts';

import { specialNamesOracleFileName } from '../src/oracle/oracle-location.ts';
import { compareCodeUnits } from '../src/oracle/score.ts';
import {
  RENAME_CHECK_NAMES,
  SHADOW_EDIT_TEXT,
  SPECIAL_NAMES,
  SPECIAL_NAMES_FOLDER,
  SPECIAL_NAMES_LINKER_FOLDER,
  SPECIAL_NAMES_MOVED_FOLDER,
  SPECIAL_NAMES_ONTO_FOLDER,
  SPECIAL_NAMES_RENAMED_FOLDER,
  specialNameFiles,
  specialNameLinkerPath,
  specialNameLinkerText,
  specialNamePath,
  specialNameText
} from '../src/oracle/special-names.ts';

interface AdapterFile {
  readonly realpath: string;
}

interface App {
  fileManager: FileManager;
  getObsidianUrl: (file: TFile) => string;
  internalPlugins: InternalPlugins;
  metadataCache: MetadataCache;
  plugins: Plugins;
  vault: Vault;
  workspace: Workspace;
}

interface BacklinksResult {
  readonly data: Map<string, unknown>;
}

// What the oracle reads of a name in one eval: everything but the embed, the switcher, the URL, search, the graph and
// the renames.
interface BasicRead {
  readonly explorer: null | string;
  readonly hasBacklink: boolean;
  readonly linkResolved: boolean;
  readonly open: null | OpenRead;
  readonly property: boolean;
  readonly text: null | string;
}

interface CachedLink {
  readonly link: string;
}

interface CdpConnection {
  [Symbol.asyncDispose]: () => Promise<void>;
  evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
}

interface Chooser {
  readonly values?: readonly (null | Suggestion)[];
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
  readonly files: Record<string, AdapterFile | undefined>;
}

interface Electron {
  ipcRenderer?: IpcRenderer;
}

interface EvalInObsidianParams<Input extends object, Result> {
  readonly callback: (input: Input & ObsidianGlobals) => Promise<Result> | Result;
  readonly input?: Input;
}

interface ExplorerItem {
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's file explorer item names its title element innerEl.
  readonly innerEl: HTMLElement;
}

interface ExplorerView {
  exitRename: () => void;
  readonly fileItems: Record<string, ExplorerItem | undefined>;
  revealInFolder: (file: TFile) => void;
  saveRename: () => Promise<boolean>;
  startRenameFile: (file: TFile) => Promise<void>;
}

interface FileCache {
  readonly frontmatterLinks?: readonly CachedLink[];
  readonly links?: readonly CachedLink[];
}

interface FileManager {
  generateMarkdownLink: (file: TFile, sourcePath: string) => string;
  renameFile: (file: TFile, newPath: string) => Promise<void>;
}

interface GraphLink {
  readonly source: GraphNode;
  readonly target: GraphNode;
}

interface GraphNode {
  readonly id: string;
}

interface GraphRenderer {
  readonly links: readonly GraphLink[];
  readonly nodes: readonly GraphNode[];
}

interface GraphView {
  readonly renderer: GraphRenderer;
}

interface InternalPlugin {
  readonly instance: SearchPluginInstance & SwitcherPluginInstance;
}

interface InternalPlugins {
  getPluginById: (id: string) => InternalPlugin;
}

interface IpcRenderer {
  sendSync?: (channel: string) => string;
}

interface Leaf {
  detach: () => void;
  openFile: (file: TFile) => Promise<void>;
  setViewState: (state: ViewState) => Promise<void>;
  readonly view: unknown;
}

// The linker's link after a rename, and whether it resolves to the expected path.
interface LinkerRead {
  readonly link: null | string;
  readonly resolved: boolean;
}

interface MarkdownRenderer {
  render: (app: App, markdown: string, element: HTMLElement, sourcePath: string, component: Component) => Promise<void>;
}

interface MarkdownView {
  readonly editor: MarkdownViewEditor;
  readonly file: null | TFile;
}

interface MarkdownViewEditor {
  getValue: () => string;
}

interface MetadataCache {
  getBacklinksForFile: (file: TFile) => BacklinksResult;
  getFileCache: (file: TFile) => FileCache | null;
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own name.
  getFirstLinkpathDest: (path: string, sourcePath: string) => null | TFile;
  readonly resolvedLinks: Record<string, Record<string, number> | undefined>;
}

// Every surface of one name but search, the graph and the renames.
interface NameRead extends BasicRead {
  readonly embed: boolean;
  readonly indexed: null | string;
  readonly link: string;
  readonly switcher: readonly string[];
  readonly uri: null | UriRead;
}

interface ObsidianGlobals {
  readonly app: App;
}

interface ObsidianModule {
  readonly Component: new () => Component;
  readonly MarkdownRenderer: MarkdownRenderer;
  parseLinktext: (linktext: string) => ParsedLinktext;
}

interface OitModule {
  connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface ParsedLinktext {
  readonly path: string;
  readonly subpath: string;
}

interface Plugins {
  enablePlugin: (id: string) => Promise<boolean>;
  loadManifests: () => Promise<void>;
  setEnable: (isEnabled: boolean) => void;
}

// What the oracle learns about a name before writing its linker.
interface Prepared {
  readonly indexed: null | string;
  readonly link: string;
}

interface ProbeGlobal {
  readonly electron?: Electron;
  readonly specialNamesObsidian?: ObsidianModule;
}

interface ProtocolHandler {
  dispatch: (params: Record<string, string>) => void;
}

interface QuickSwitcherModal {
  readonly chooser: Chooser;
  close: () => void;
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's SuggestModal names its input element inputEl.
  readonly inputEl: HTMLInputElement;
  open: () => void;
}

// What one rename typed into the explorer did before the rename lands.
interface RenameTyped {
  readonly isSaved: boolean;
  readonly message: null | string;
}

interface SearchPluginInstance {
  openGlobalSearch: (query: string) => void;
}

interface SearchResultDom {
  readonly resultDomLookup: Map<TFile, unknown>;
}

interface SearchView {
  readonly dom: SearchResultDom;
}

interface SetUpRead {
  readonly basePath: string;
  readonly meta: SpecialNamesMeta;
}

interface Suggestion {
  readonly file?: TFile;
}

interface SwitcherPluginInstance {
  readonly QuickSwitcherModal: new (app: App, isSymbolMode: boolean) => QuickSwitcherModal;
}

interface TFile {
  readonly path: string;
}

interface Vault {
  readonly adapter: DataAdapter;
  create: (path: string, text: string) => Promise<TFile>;
  getFileByPath: (path: string) => null | TFile;
  getFiles: () => TFile[];
  getName: () => string;
  modify: (file: TFile, text: string) => Promise<void>;
  read: (file: TFile) => Promise<string>;
  setConfig: (key: string, value: unknown) => void;
}

interface ViewState {
  readonly type: string;
}

interface Workspace {
  getActiveFile: () => null | TFile;
  getLeaf: (isNewLeaf: boolean) => Leaf;
  getLeavesOfType: (type: string) => Leaf[];
  readonly protocolHandler: ProtocolHandler;
}

const JSON_INDENT = 2;
const WRITE_PAUSE_MS = 15;
const POLL_MS = 500;
const MAX_POLLS = 120;
const REWRITE_EVERY = 4;
// A rename's link update, a search, a rename typed into the explorer: polled every 200 ms for up to 4 s.
const SETTLE_POLL_MS = 200;
const SETTLE_POLLS = 20;
// What a view needs to render before it is read: the switcher's suggestions, an embed, a URL's leaf, the graph.
const SWITCHER_MS = 300;
const EMBED_MS = 400;
const URI_MS = 300;
const GRAPH_MS = 2000;
const SWITCHER_MAX_OFFERS = 50;
const PLUGIN_ID = 'special-names-probe';
const RENAME_CHECK_NOTE = `${SPECIAL_NAMES_FOLDER}/rename-check.md`;
// The first rename typed after the explorer opens is neither validated nor saved, whatever its name, so this one goes
// first and is not read.
const RENAME_WARM_UP_NAME = 'r-s';
const NO_BREAK_SPACE_PATTERN = /\u{A0}/gu;
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

// Whether the linker's embed, rendered as Reading view renders it, shows the note's text.
async function isEmbedShown(link: string, linkerPath: string, text: string): Promise<boolean> {
  return await conn.evalInObsidian({
    callback: async ({ app, embedMs, link: wikilink, linkerPath: sourcePath, text: noteText }) => {
      const obsidian = (globalThis as ProbeGlobal & typeof globalThis).specialNamesObsidian;
      if (obsidian === undefined) {
        throw new Error('The obsidian module was not handed over');
      }
      const element = document.createElement('div');
      document.body.append(element);
      const component = new obsidian.Component();
      component.load();
      await obsidian.MarkdownRenderer.render(app, `!${wikilink}`, element, sourcePath, component);
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, embedMs);
      });
      const isShown = element.textContent.includes(noteText.trim());
      component.unload();
      element.remove();
      return isShown;
    },
    input: { embedMs: EMBED_MS, link, linkerPath, text }
  });
}

// Renames the rename check note back to its own path, and says whether it had been renamed.
async function isRenamedBack(): Promise<boolean> {
  return await conn.evalInObsidian({
    callback: async ({ app, notePath }) => {
      const file = app.vault.getFiles().find((candidate) => candidate.path.startsWith(`${notePath.slice(0, notePath.lastIndexOf('/'))}/r`) && candidate.path !== notePath);
      if (file === undefined || app.vault.getFileByPath(notePath) !== null) {
        return false;
      }
      await app.fileManager.renameFile(file, notePath);
      return true;
    },
    input: { notePath: RENAME_CHECK_NOTE }
  });
}

function linkerPathOf(index: number): string {
  return specialNameLinkerPath(index);
}

// The path the vault indexes a name under: it makes a no-break space a space and composes the name (NFC).
function normalizedPath(name: string): string {
  return specialNamePath(name.normalize('NFC').replaceAll(NO_BREAK_SPACE_PATTERN, ' '));
}

// The path the vault indexes `name` under in `folder`.
function normalizedPathIn(folder: string, name: string): string {
  return `${folder}/${name.normalize('NFC').replaceAll(NO_BREAK_SPACE_PATTERN, ' ')}.md`;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// Enables the plugin that hands the `obsidian` module over, and sets the link settings the reads assume.
async function prepareApp(): Promise<void> {
  await conn.evalInObsidian({
    callback: async ({ app, pluginId }) => {
      app.plugins.setEnable(true);
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin(pluginId);
      app.vault.setConfig('newLinkFormat', 'shortest');
      app.vault.setConfig('useMarkdownLinks', false);
      app.vault.setConfig('alwaysUpdateLinks', true);
    },
    input: { pluginId: PLUGIN_ID }
  });
}

// For every name: the note whose file is the name's own, and the link Obsidian writes for it from its linker.
async function prepareNames(): Promise<Prepared[]> {
  return await conn.evalInObsidian({
    callback: ({ app, linkerPaths, names, paths }) =>
      names.map((name, index) => {
        const ownPath = paths[index] ?? '';
        const file = app.vault.getFiles().find((candidate) => app.vault.adapter.files[candidate.path]?.realpath === ownPath) ?? null;
        return {
          indexed: file?.path ?? null,
          link: file === null ? `[[${name}]]` : app.fileManager.generateMarkdownLink(file, linkerPaths[index] ?? '')
        };
      }),
    input: {
      linkerPaths: SPECIAL_NAMES.map((_name, index) => linkerPathOf(index)),
      names: SPECIAL_NAMES.map(({ name }) => name),
      paths: SPECIAL_NAMES.map(({ name }) => specialNamePath(name))
    }
  });
}

// The note's text, its explorer title, opening it, its backlinks and where the linker's body and properties links lead.
async function readBasic(indexed: null | string, linkerPath: string): Promise<BasicRead> {
  return await conn.evalInObsidian({
    callback: async ({ app, indexed: notePath, linkerPath: sourcePath }) => {
      const obsidian = (globalThis as ProbeGlobal & typeof globalThis).specialNamesObsidian;
      if (obsidian === undefined) {
        throw new Error('The obsidian module was not handed over');
      }
      const { metadataCache, vault, workspace } = app;
      const linker = vault.getFileByPath(sourcePath);
      const linkerCache = linker === null ? null : metadataCache.getFileCache(linker);
      function isNoteLink(link: string | undefined): boolean {
        return link !== undefined && notePath !== null && metadataCache.getFirstLinkpathDest(obsidian?.parseLinktext(link).path ?? '', sourcePath)?.path === notePath;
      }
      const links = { linkResolved: isNoteLink(linkerCache?.links?.[0]?.link), property: isNoteLink(linkerCache?.frontmatterLinks?.[0]?.link) };
      const file = notePath === null ? null : vault.getFileByPath(notePath);
      if (file === null) {
        return { ...links, explorer: null, hasBacklink: false, open: null, text: null };
      }
      const text = await vault.read(file);
      const explorer = workspace.getLeavesOfType('file-explorer')[0]?.view as ExplorerView | undefined;
      explorer?.revealInFolder(file);
      const leaf = workspace.getLeaf(true);
      await leaf.openFile(file);
      const view = leaf.view as MarkdownView;
      const open = { hasText: view.editor.getValue() === text, path: view.file?.path ?? null };
      leaf.detach();
      return {
        ...links,
        explorer: explorer?.fileItems[file.path]?.innerEl.textContent ?? null,
        hasBacklink: metadataCache.getBacklinksForFile(file).data.has(sourcePath),
        open,
        text
      };
    },
    input: { indexed, linkerPath }
  });
}

// The graph view's nodes, and whether each linker's link is an edge to its note.
async function readGraph(prepared: readonly Prepared[]): Promise<GraphRead[]> {
  await conn.evalInObsidian({
    callback: async ({ app }) => {
      await app.workspace.getLeaf(true).setViewState({ type: 'graph' });
    }
  });
  await pause(GRAPH_MS);
  return await conn.evalInObsidian({
    callback: ({ app, linkerPaths, prepared: preparedNames }) => {
      const [leaf] = app.workspace.getLeavesOfType('graph');
      if (leaf === undefined) {
        throw new Error('No graph view');
      }
      const { renderer } = leaf.view as GraphView;
      const nodes = new Set(renderer.nodes.map((node) => node.id));
      const edges = new Set(renderer.links.map((link) => `${link.source.id}\n${link.target.id}`));
      leaf.detach();
      return preparedNames.map(({ indexed }, index) => ({
        edge: indexed !== null && edges.has(`${linkerPaths[index] ?? ''}\n${indexed}`),
        node: indexed !== null && nodes.has(indexed)
      }));
    },
    input: { linkerPaths: SPECIAL_NAMES.map((_name, index) => linkerPathOf(index)), prepared }
  });
}

// The linker's first body link, and whether `resolvedLinks` maps the linker to `path`.
async function readLinker(linkerPath: string, path: string): Promise<LinkerRead> {
  return await conn.evalInObsidian({
    callback: async ({ app, linkerPath: sourcePath, path: notePath }) => {
      const linker = app.vault.getFileByPath(sourcePath);
      const text = linker === null ? '' : await app.vault.read(linker);
      const body = text.split('---\n').at(-1) ?? '';
      return {
        link: /\[\[[^\n]*\]\]/.exec(body)?.[0] ?? null,
        resolved: (app.metadataCache.resolvedLinks[sourcePath]?.[notePath] ?? 0) > 0
      };
    },
    input: { linkerPath, path }
  });
}

// Every surface of one name but search, the graph and the renames.
async function readName(index: number, prepared: Prepared): Promise<NameRead> {
  const name = SPECIAL_NAMES[index]?.name ?? '';
  const linkerPath = linkerPathOf(index);
  const basic = await readBasic(prepared.indexed, linkerPath);
  return {
    ...basic,
    embed: basic.text !== null && await isEmbedShown(prepared.link, linkerPath, basic.text),
    indexed: prepared.indexed,
    link: prepared.link,
    // A user types the name as the vault shows it, composed.
    switcher: await readSwitcher(name.normalize('NFC')),
    uri: prepared.indexed === null ? null : await readUri(prepared.indexed)
  };
}

// Renames the note to `newPath` and back, through `fileManager.renameFile`, and reads its linker after each.
async function readRename(indexed: null | string, linkerPath: string, newPath: string): Promise<null | RenameRead> {
  if (indexed === null) {
    return null;
  }
  const refusal = await renameTo(indexed, newPath);
  if (refusal !== null) {
    return { backLink: null, backResolved: false, link: refusal, resolved: false };
  }
  const away = await settleLinker(linkerPath, newPath);
  await renameTo(newPath, indexed);
  const back = await settleLinker(linkerPath, indexed);
  return { backLink: back.link, backResolved: back.resolved, link: away.link, resolved: away.resolved };
}

// Types each name into the file explorer's rename of one note, and reads whether it saved and what it showed.
async function readRenameChecks(): Promise<RenameCheckRead[]> {
  const reads: RenameCheckRead[] = [];
  for (const name of [RENAME_WARM_UP_NAME, ...RENAME_CHECK_NAMES]) {
    const typed = await typeRename(name);
    let isSaved = false;
    for (let poll = 0; !isSaved && typed.isSaved && poll < SETTLE_POLLS; poll++) {
      await pause(SETTLE_POLL_MS);
      isSaved = await isRenamedBack();
    }
    if (name !== RENAME_WARM_UP_NAME) {
      reads.push({ message: typed.message, name, saved: isSaved });
    }
  }
  return reads;
}

// Renames the plainly named note at `index` in the onto folder to `name`, and reads the link its linker holds then.
async function readRenameOnto(index: number, name: string): Promise<RenameOntoRead> {
  const newPath = `${SPECIAL_NAMES_ONTO_FOLDER}/${name}.md`;
  const refusal = await renameTo(`${SPECIAL_NAMES_ONTO_FOLDER}/P${String(index)}.md`, newPath);
  if (refusal !== null) {
    return { link: refusal, resolved: false };
  }
  const read = await settleLinker(`${SPECIAL_NAMES_ONTO_FOLDER}/M${String(index)}.md`, normalizedPathIn(SPECIAL_NAMES_ONTO_FOLDER, name));
  return { link: read.link, resolved: read.resolved };
}

// The sweep's notes a global search for `token` found, once two polls in a row agree on a non-empty list.
async function readSearch(token: string): Promise<string[]> {
  await conn.evalInObsidian({
    callback: ({ app, token: query }) => {
      app.internalPlugins.getPluginById('global-search').instance.openGlobalSearch(query);
    },
    input: { token }
  });
  let paths: string[] = [];
  for (let poll = 0; poll < SETTLE_POLLS; poll++) {
    await pause(SETTLE_POLL_MS);
    const next = await readSearchResults();
    if (next.length > 0 && next.join('\n') === paths.join('\n')) {
      break;
    }
    paths = next;
  }
  return paths.toSorted(compareCodeUnits);
}

async function readSearchResults(): Promise<string[]> {
  return await conn.evalInObsidian({
    callback: ({ app, folder }) => {
      const view = app.workspace.getLeavesOfType('search')[0]?.view as SearchView | undefined;
      return view === undefined
        ? []
        : Array.from(view.dom.resultDomLookup.keys(), (file) => file.path)
          .filter((path) => path.startsWith(`${folder}/`) && !path.startsWith(`${folder}/linkers/`) && !path.startsWith(`${folder}/onto/`));
    },
    input: { folder: SPECIAL_NAMES_FOLDER }
  });
}

// Edits the one note each shadowed name shares with its partner, through the vault, and reads both files on disk.
async function readShadowWrites(basePath: string): Promise<ShadowWriteRead[]> {
  const reads: ShadowWriteRead[] = [];
  for (const { name, shadows } of SPECIAL_NAMES) {
    if (shadows === undefined) {
      continue;
    }
    await conn.evalInObsidian({
      callback: async ({ app, path, text }) => {
        const file = app.vault.getFileByPath(path);
        if (file === null) {
          throw new Error(`No ${path}`);
        }
        await app.vault.modify(file, text);
      },
      input: { path: normalizedPath(shadows), text: SHADOW_EDIT_TEXT }
    });
    await pause(POLL_MS);
    const namePath = join(basePath, specialNamePath(name));
    const partnerPath = join(basePath, specialNamePath(shadows));
    reads.push({ name, nameText: readFileSync(namePath, 'utf-8'), partner: shadows, partnerText: readFileSync(partnerPath, 'utf-8') });
  }
  return reads;
}

// The files the quick switcher offers for `typed`.
async function readSwitcher(typed: string): Promise<string[]> {
  return await conn.evalInObsidian({
    callback: async ({ app, maxOffers, switcherMs, typed: query }) => {
      const QuickSwitcher = app.internalPlugins.getPluginById('switcher').instance.QuickSwitcherModal;
      const modal = new QuickSwitcher(app, false);
      modal.open();
      modal.inputEl.value = query;
      modal.inputEl.dispatchEvent(new Event('input'));
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, switcherMs);
      });
      const offered = (modal.chooser.values ?? []).flatMap((value) => (value?.file === undefined ? [] : [value.file.path])).slice(0, maxOffers);
      modal.close();
      return offered;
    },
    input: { maxOffers: SWITCHER_MAX_OFFERS, switcherMs: SWITCHER_MS, typed }
  });
}

// Dispatches the URL "Copy Obsidian URL" writes for the note, its query parsed the standard way, to `obsidian://open` in
// an empty leaf, and reads the note that leaf then shows.
async function readUri(indexed: string): Promise<UriRead> {
  const url = await conn.evalInObsidian({
    callback: ({ app, path }) => {
      const file = app.vault.getFileByPath(path);
      if (file === null) {
        throw new Error(`No ${path}`);
      }
      app.workspace.getLeaf(true);
      const params: Record<string, string> = { action: 'open' };
      const link = app.getObsidianUrl(file);
      const { searchParams } = new URL(link);
      for (const [key, value] of searchParams) {
        params[key] = value;
      }
      app.workspace.protocolHandler.dispatch(params);
      return link;
    },
    input: { path: indexed }
  });
  await pause(URI_MS);
  const opened = await conn.evalInObsidian({
    callback: ({ app }) => {
      const path = app.workspace.getActiveFile()?.path ?? null;
      for (const leaf of app.workspace.getLeavesOfType('markdown')) {
        leaf.detach();
      }
      for (const leaf of app.workspace.getLeavesOfType('empty')) {
        leaf.detach();
      }
      return path;
    }
  });
  return { opened, url };
}

// Renames `from` to `to` through `fileManager.renameFile`; returns the refusal, or `null`.
async function renameTo(from: string, to: string): Promise<null | string> {
  return await conn.evalInObsidian({
    callback: async ({ app, from: fromPath, to: toPath }) => {
      const file = app.vault.getFileByPath(fromPath);
      if (file === null) {
        return `<<no ${fromPath}>>`;
      }
      try {
        await app.fileManager.renameFile(file, toPath);
        return null;
      } catch (error) {
        return `<<refused: ${(error as Error).message}>>`;
      }
    },
    input: { from, to }
  });
}

// The linker once `resolvedLinks` maps it to `path`, or after the settle bound.
async function settleLinker(linkerPath: string, path: string): Promise<LinkerRead> {
  let read: LinkerRead = { link: null, resolved: false };
  for (let poll = 0; poll < SETTLE_POLLS && !read.resolved; poll++) {
    await pause(SETTLE_POLL_MS);
    read = await readLinker(linkerPath, path);
  }
  return read;
}

async function setUp(): Promise<SetUpRead> {
  return await conn.evalInObsidian({
    callback: ({ app }) => {
      const { electron } = globalThis as ProbeGlobal & typeof globalThis;
      return {
        basePath: app.vault.adapter.basePath,
        meta: { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent, vault: app.vault.getName() }
      };
    }
  });
}

// Starts the explorer's rename of the rename check note, types `name`, reads the message it shows, and saves it.
async function typeRename(name: string): Promise<RenameTyped> {
  return await conn.evalInObsidian({
    callback: async ({ app, name: typed, notePath, settleMs }) => {
      const explorer = app.workspace.getLeavesOfType('file-explorer')[0]?.view as ExplorerView | undefined;
      const file = app.vault.getFileByPath(notePath) ?? await app.vault.create(notePath, 'text\n');
      if (explorer === undefined) {
        throw new Error('No file explorer');
      }
      for (const tooltip of document.querySelectorAll('.tooltip')) {
        tooltip.remove();
      }
      await explorer.startRenameFile(file);
      const titleElement = explorer.fileItems[file.path]?.innerEl;
      titleElement?.setText(typed);
      titleElement?.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, settleMs);
      });
      const message = document.querySelector('.tooltip')?.textContent ?? null;
      const isSaved = await explorer.saveRename();
      explorer.exitRename();
      return { isSaved, message };
    },
    input: { name, notePath: RENAME_CHECK_NOTE, settleMs: SETTLE_POLL_MS }
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
  for (const folder of [SPECIAL_NAMES_FOLDER, SPECIAL_NAMES_LINKER_FOLDER, SPECIAL_NAMES_ONTO_FOLDER, SPECIAL_NAMES_RENAMED_FOLDER, SPECIAL_NAMES_MOVED_FOLDER]) {
    mkdirSync(join(basePath, folder), { recursive: true });
  }
  const pluginDirectory = join(basePath, '.obsidian', 'plugins', PLUGIN_ID);
  mkdirSync(pluginDirectory, { recursive: true });
  writeFileSync(
    join(pluginDirectory, 'manifest.json'),
    JSON.stringify({ author: 'special names oracle', description: 'Hands the obsidian module to the oracle.', id: PLUGIN_ID, minAppVersion: '1.0.0', name: 'Special names probe', version: '1.0.0' })
  );
  writeFileSync(join(pluginDirectory, 'main.js'), 'const obsidian = require(\'obsidian\');\nmodule.exports = class extends obsidian.Plugin { onload() { window.specialNamesObsidian = obsidian; } };\n');

  // The vault keeps the last of two shadowing files it sees, so the shadowed names go first and their partners win.
  const files = specialNameFiles();
  const order = SPECIAL_NAMES.filter(({ shadows }) => shadows !== undefined).map(({ name }) => specialNamePath(name));
  for (const path of files.keys()) {
    if (!order.includes(path)) {
      order.push(path);
    }
  }
  await writeOnDisk(basePath, files, order);
  const expected = new Set<string>();
  for (const { name } of SPECIAL_NAMES) {
    if (!name.startsWith('.')) {
      expected.add(normalizedPath(name));
    }
  }
  await waitIndexed(basePath, files, [...expected], false);
  await prepareApp();
  const renameChecks = await readRenameChecks();
  console.log(`special-names-oracle: ${String(files.size)} notes written and indexed, ${String(renameChecks.length)} renames typed`);

  const prepared = await prepareNames();
  const linkers = new Map<string, string>();
  const sources: string[] = [];
  for (const [index, { link }] of prepared.entries()) {
    linkers.set(linkerPathOf(index), specialNameLinkerText(link));
    linkers.set(`${SPECIAL_NAMES_ONTO_FOLDER}/P${String(index)}.md`, specialNameText(index));
    linkers.set(`${SPECIAL_NAMES_ONTO_FOLDER}/M${String(index)}.md`, `[[P${String(index)}]]\n`);
    sources.push(linkerPathOf(index), `${SPECIAL_NAMES_ONTO_FOLDER}/M${String(index)}.md`);
  }
  await writeOnDisk(basePath, linkers, linkers.keys());
  await waitIndexed(basePath, linkers, sources, true);
  console.log('special-names-oracle: linkers written and resolved');

  const byName: Record<string, SpecialNameRead> = {};
  const reads = [];
  for (const [index, preparedName] of prepared.entries()) {
    reads.push({ ...await readName(index, preparedName), search: await readSearch(specialNameText(index).trim()) });
  }
  const graph = await readGraph(prepared);
  for (const [index, { name }] of SPECIAL_NAMES.entries()) {
    const { indexed } = prepared[index] ?? { indexed: null };
    const read = reads[index];
    const graphRead = graph[index];
    if (read === undefined || graphRead === undefined) {
      throw new Error(`Missing read for ${name}`);
    }
    const rename = await readRename(indexed, linkerPathOf(index), `${SPECIAL_NAMES_RENAMED_FOLDER}/R${String(index)}.md`);
    const move = indexed === null ? null : await readRename(indexed, linkerPathOf(index), `${SPECIAL_NAMES_MOVED_FOLDER}/${indexed.slice(indexed.lastIndexOf('/') + 1)}`);
    byName[name] = { ...read, graph: graphRead, move, rename, renameOnto: await readRenameOnto(index, name) };
  }
  const shadowWrites = await readShadowWrites(basePath);
  console.log('special-names-oracle: surfaces read');

  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, specialNamesOracleFileName(meta.appVersion ?? 'unknown'));
  const oracleFile: SpecialNamesFile = { meta, reads: byName, renameChecks, shadowWrites };
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  console.log(`special-names-oracle: ${String(SPECIAL_NAMES.length)} names written to ${outFile}`);
} finally {
  await conn[Symbol.asyncDispose]();
}
