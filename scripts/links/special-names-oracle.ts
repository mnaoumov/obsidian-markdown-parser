/**
 * @file
 *
 * The special note name oracle: writes every name of `SPECIAL_NAMES` (`src/oracle/links/special-names.ts`) on disk, straight
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
 * With `--android` it reads the same surfaces in Obsidian on an Android device or emulator instead (`scripts/capture/android-vault.ts`),
 * in a vault of the app's own storage, for `ANDROID_SPECIAL_NAMES`: the desktop's names and the ones Windows cannot store.
 * The device must be booted with Obsidian started; `--serial` picks one of several. Writes them to
 * `oracle/special-names-android-obsidian-<version>.json`.
 *
 * With `--normalization` it sweeps `NORMALIZATION_NAMES` instead: names in neither NFC nor NFD, several
 * spellings of one name at once, bare combining marks and compatibility characters. Beyond the surfaces it reads the file
 * on disk each note reads, what `getAbstractFileByPath` finds under each spelling, where links typed by hand in each
 * spelling lead, and what renaming a second file of each name between its spellings does. Writes them to
 * `oracle/special-names-normalization-obsidian-<version>.json`, or with `--android` as well on Android, to
 * `oracle/special-names-normalization-android-obsidian-<version>.json`.
 *
 * Usage: `jiti scripts/links/special-names-oracle.ts [--obsidian-version <version>] [--android [--serial <serial>]] [--normalization] [--out-dir <directory>]`.
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
  FormRenameRead,
  GraphRead,
  LookupRead,
  NormalizationRead,
  OpenRead,
  RenameCheckRead,
  RenameOntoRead,
  RenameRead,
  ShadowWriteRead,
  SpecialName,
  SpecialNameRead,
  SpecialNamesFile,
  SpecialNamesMeta,
  TypedLinkRead,
  UriRead
} from '../../src/oracle/links/special-names.ts';
import type { OracleVault } from '../capture/android-vault.ts';

import { compareCodeUnits } from '../../src/oracle/classes/score.ts';
import {
  ANDROID_RENAME_CHECK_NAMES,
  ANDROID_SPECIAL_NAMES,
  NORMALIZATION_NAMES,
  RENAME_CHECK_NAMES,
  SHADOW_EDIT_TEXT,
  SPECIAL_NAMES,
  SPECIAL_NAMES_FOLDER,
  SPECIAL_NAMES_FORMS_FOLDER,
  SPECIAL_NAMES_LINKER_FOLDER,
  SPECIAL_NAMES_MOVED_FOLDER,
  SPECIAL_NAMES_ONTO_FOLDER,
  SPECIAL_NAMES_RENAMED_FOLDER,
  SPECIAL_NAMES_TYPED_FOLDER,
  specialNameFiles,
  specialNameLinkerPath,
  specialNameLinkerText,
  specialNamePath,
  specialNameText,
  spellingsOf,
  TYPED_LINK_KINDS,
  typedLink,
  typedLinkerPath
} from '../../src/oracle/links/special-names.ts';
import {
  specialNamesAndroidOracleFileName,
  specialNamesNormalizationAndroidOracleFileName,
  specialNamesNormalizationOracleFileName,
  specialNamesOracleFileName
} from '../../src/oracle/oracle-location.ts';
import { openAndroidVault } from '../capture/android-vault.ts';
import {
  readReadingViewLink,
  readSettledSnapshot
} from './special-names-settle.ts';

interface AdapterFile {
  readonly realpath: string;
}

interface App {
  readonly commands: Commands;
  readonly fileManager: FileManager;
  readonly getObsidianUrl: (file: TFile) => string;
  readonly internalPlugins: InternalPlugins;
  readonly metadataCache: MetadataCache;
  readonly plugins: Plugins;
  readonly vault: Vault;
  readonly workspace: Workspace;
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

interface CapacitorAppInfo {
  readonly version: string;
}

interface CapacitorAppPlugin {
  readonly getInfo: () => Promise<CapacitorAppInfo>;
}

interface CapacitorGlobal {
  readonly Plugins: CapacitorPlugins;
}

interface CapacitorPlugins {
  readonly App?: CapacitorAppPlugin;
}

interface CdpConnection {
  readonly evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

interface Chooser {
  readonly values?: readonly (null | Suggestion)[];
}

interface Commands {
  readonly executeCommandById: (id: string) => boolean;
}

interface Component {
  readonly load: () => void;
  readonly unload: () => void;
}

interface ConnectToCdpOptions {
  readonly obsidianVersion?: string;
}

interface ContainerView {
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's view names its element containerEl.
  readonly containerEl: HTMLElement;
}

interface DataAdapter {
  readonly basePath: string;
  readonly files: Record<string, AdapterFile | undefined>;
}

interface EditorPosition {
  readonly ch: number;
  readonly line: number;
}

interface Electron {
  readonly ipcRenderer?: IpcRenderer;
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
  readonly exitRename: () => void;
  readonly fileItems: Record<string, ExplorerItem | undefined>;
  readonly revealInFolder: (file: TFile) => void;
  readonly saveRename: () => Promise<boolean>;
  readonly startRenameFile: (file: TFile) => Promise<void>;
}

interface FileCache {
  readonly frontmatterLinks?: readonly CachedLink[];
  readonly links?: readonly CachedLink[];
}

interface FileManager {
  readonly generateMarkdownLink: (file: TFile, sourcePath: string) => string;
  readonly renameFile: (file: TFile, newPath: string) => Promise<void>;
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
  readonly getPluginById: (id: string) => InternalPlugin;
}

interface IpcRenderer {
  readonly sendSync?: (channel: string) => string;
}

interface Leaf {
  readonly detach: () => void;
  readonly openFile: (file: TFile, openState?: OpenState) => Promise<void>;
  readonly setViewState: (state: ViewState) => Promise<void>;
  readonly view: unknown;
}

// The linker's link after a rename, and whether it resolves to the expected path.
interface LinkerRead {
  readonly link: null | string;
  readonly resolved: boolean;
}

interface MarkdownRenderer {
  readonly render: (app: App, markdown: string, element: HTMLElement, sourcePath: string, component: Component) => Promise<void>;
}

interface MarkdownView {
  readonly editor: MarkdownViewEditor;
  readonly file: null | TFile;
}

interface MarkdownViewEditor {
  readonly getValue: () => string;
  readonly setCursor: (position: EditorPosition) => void;
}

interface MetadataCache {
  readonly getBacklinksForFile: (file: TFile) => BacklinksResult;
  readonly getFileCache: (file: TFile) => FileCache | null;
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own name.
  readonly getFirstLinkpathDest: (path: string, sourcePath: string) => null | TFile;
  readonly resolvedLinks: Record<string, Record<string, number> | undefined>;
  readonly unresolvedLinks: Record<string, Record<string, number> | undefined>;
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
  readonly parseLinktext: (linktext: string) => ParsedLinktext;
}

interface OitModule {
  readonly connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface OpenState {
  readonly state: Readonly<Record<string, unknown>>;
}

interface ParsedLinktext {
  readonly path: string;
  readonly subpath: string;
}

interface Plugins {
  readonly enablePlugin: (id: string) => Promise<boolean>;
  readonly loadManifests: () => Promise<void>;
  readonly setEnable: (isEnabled: boolean) => void;
}

// What the oracle learns about a name before writing its linker.
interface Prepared {
  readonly indexed: null | string;
  readonly link: string;
}

interface ProbeGlobal {
  readonly Capacitor?: CapacitorGlobal;
  readonly electron?: Electron;
  readonly specialNamesObsidian?: ObsidianModule;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- A temporary modal is retained between serialized CDP calls and removed in finally.
  specialNamesSwitcher?: QuickSwitcherModal;
}

interface ProtocolHandler {
  readonly dispatch: (params: Record<string, string>) => void;
}

interface QuickSwitcherModal {
  readonly chooser: Chooser;
  readonly close: () => void;
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's SuggestModal names its input element inputEl.
  readonly inputEl: HTMLInputElement;
  readonly open: () => void;
}

// What one rename typed into the explorer did before the rename lands.
interface RenameTyped {
  readonly isSaved: boolean;
  readonly message: null | string;
}

interface SearchPluginInstance {
  readonly openGlobalSearch: (query: string) => void;
}

interface SearchResultDom {
  readonly resultDomLookup: Map<TFile, unknown>;
}

interface SearchView {
  readonly dom: SearchResultDom;
}

interface SetActiveLeafOptions {
  readonly focus: boolean;
}

interface Suggestion {
  readonly file?: TFile;
}

// One sweep: its names, the names it types into the rename, and its oracle file's name.
interface Sweep {
  readonly fileNameOf: (version: string) => string;
  readonly names: readonly SpecialName[];
  readonly renameCheckNames: readonly string[];
}

interface SwitcherPluginInstance {
  readonly QuickSwitcherModal: new (app: App, isSymbolMode: boolean) => QuickSwitcherModal;
}

interface TFile {
  readonly path: string;
}

interface Vault {
  readonly adapter: DataAdapter;
  readonly create: (path: string, text: string) => Promise<TFile>;
  readonly delete: (file: TFile) => Promise<void>;
  readonly getAbstractFileByPath: (path: string) => null | TFile;
  readonly getFileByPath: (path: string) => null | TFile;
  readonly getFiles: () => TFile[];
  readonly getName: () => string;
  readonly modify: (file: TFile, text: string) => Promise<void>;
  readonly read: (file: TFile) => Promise<string>;
  readonly setConfig: (key: string, value: unknown) => void;
}

interface ViewState {
  readonly type: string;
}

interface Workspace {
  readonly getActiveFile: () => null | TFile;
  readonly getLeaf: (isNewLeaf: boolean) => Leaf;
  readonly getLeavesOfType: (type: string) => Leaf[];
  readonly leftSplit: WorkspaceSidedock;
  readonly protocolHandler: ProtocolHandler;
  readonly revealLeaf: (leaf: Leaf) => Promise<void>;
  readonly setActiveLeaf: (leaf: Leaf, options: SetActiveLeafOptions) => void;
}

interface WorkspaceSidedock {
  readonly expand: () => void;
}

const JSON_INDENT = 2;
const WRITE_PAUSE_MS = 15;
const POLL_MS = 500;
const MAX_POLLS = 120;
const REWRITE_EVERY = 4;
// A rename's link update, a search, a rename typed into the explorer: polled every 200 ms for up to 4 s.
const SETTLE_POLL_MS = 200;
const SETTLE_POLLS = 20;
const REVEAL_POLL_MS = 100;
const REVEAL_POLLS = 20;
// Other surface delays: an embed, a URL's leaf, the graph.
const EMBED_MS = 400;
const URI_MS = 300;
const GRAPH_MS = 2000;
const OPEN_LINK_MS = 500;
const FOLLOW_POLLS = 8;
const WIKILINK_CURSOR_CH = 3;
const MARKDOWN_LINK_CURSOR_CH = 1;
const SWITCHER_MAX_OFFERS = 50;
const PLUGIN_ID = 'special-names-probe';
const ANDROID_VAULT_NAME = 'special-names-oracle';
const RENAME_CHECK_NOTE = `${SPECIAL_NAMES_FOLDER}/rename-check.md`;
// The first rename typed after the explorer opens is neither validated nor saved, whatever its name, so this one goes
// first and is not read.
const RENAME_WARM_UP_NAME = 'r-s';
const NO_BREAK_SPACE_PATTERN = /\u{A0}/gu;
const here = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    'android': { type: 'boolean' },
    'normalization': { type: 'boolean' },
    'obsidian-version': { type: 'string' },
    'out-dir': { type: 'string' },
    'serial': { type: 'string' }
  }
});

const isAndroid = values.android === true;
const isNormalization = values.normalization === true;
const { fileNameOf, names, renameCheckNames } = sweepOf(isAndroid, isNormalization);
// The connection is disposed by hand: `await using` needs a tslib helper this repo does not install.
const conn = isAndroid
  ? await openAndroidVault<ObsidianGlobals>(values.serial === undefined ? { vaultName: ANDROID_VAULT_NAME } : { serial: values.serial, vaultName: ANDROID_VAULT_NAME })
  : await openDesktopVault(values['obsidian-version']);

// Opens the linker in Reading view and clicks its link: the link path the cache holds, the anchor's `data-href`, and the
// note the click opened, or `null` where none did.
async function clickInReadingView(linkerPath: string): Promise<Pick<TypedLinkRead, 'cached' | 'href' | 'opened'>> {
  return await readReadingViewLink(linkerPath, {
    clickAnchor: async () =>
      await conn.evalInObsidian({
        callback: ({ app, linkerPath: path }) => {
          const leaf = app.workspace.getLeavesOfType('markdown').find((candidate) => (candidate.view as MarkdownView).file?.path === path);
          if (leaf === undefined) {
            throw new Error(`No Reading-view leaf for ${path}`);
          }
          const anchor = (leaf.view as ContainerView).containerEl.querySelector<HTMLElement>(':scope .markdown-preview-view a.internal-link');
          if (anchor === null) {
            return null;
          }
          const linker = app.vault.getFileByPath(path);
          const read = {
            cached: linker === null ? null : app.metadataCache.getFileCache(linker)?.links?.[0]?.link ?? null,
            href: anchor.dataset['href'] ?? null
          };
          anchor.click();
          return read;
        },
        input: { linkerPath }
      }),
    open: async () => {
      await conn.evalInObsidian({
        callback: async ({ app, linkerPath: path }) => {
          const linker = app.vault.getFileByPath(path);
          if (linker === null) {
            throw new Error(`No ${path}`);
          }
          const leaf = app.workspace.getLeaf(true);
          await leaf.openFile(linker, { state: { mode: 'preview' } });
          await app.workspace.revealLeaf(leaf);
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        input: { linkerPath }
      });
    },
    readOpened: async () =>
      await conn.evalInObsidian({
        callback: ({ app, linkerPath: path }) => {
          const active = app.workspace.getActiveFile()?.path ?? null;
          return active === path ? null : active;
        },
        input: { linkerPath }
      })
  });
}

// Opens the linker in the editor and runs "Follow link under cursor" with the cursor at `cursorCh` of its link: the
// editor follows the note's own text, not the cache. Returns the note it opened, or `null` where none opened.
async function followInEditor(linkerPath: string, cursorCh: number): Promise<null | string> {
  return await conn.evalInObsidian({
    callback: async ({ app, cursorCh: ch, linkerPath: path, openMs, polls }) => {
      const linker = app.vault.getFileByPath(path);
      if (linker === null) {
        throw new Error(`No ${path}`);
      }
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(linker, { state: { mode: 'source', source: false } });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      (leaf.view as MarkdownView).editor.setCursor({ ch, line: 0 });
      app.commands.executeCommandById('editor:follow-link');
      // A slow device can take longer than one wait to open the note, or to create it first.
      for (let poll = 0; poll < polls && app.workspace.getActiveFile()?.path === path; poll++) {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, openMs);
        });
      }
      const followed = app.workspace.getActiveFile()?.path ?? null;
      return followed === path ? null : followed;
    },
    input: { cursorCh, linkerPath, openMs: OPEN_LINK_MS, polls: FOLLOW_POLLS }
  });
}

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

// The vault of an owned desktop Obsidian, its files written and read with Node's file system.
async function openDesktopVault(obsidianVersion: string | undefined): Promise<OracleVault<ObsidianGlobals>> {
  const oitPath = join(execSync('npm root -g').toString().trim(), 'obsidian-integration-testing/dist/lib/esm/index.mjs');
  // eslint-disable-next-line no-restricted-syntax -- obsidian-integration-testing is installed globally, so its path is only known at run time.
  const oit = await import(pathToFileURL(oitPath).href) as OitModule;
  const cdp = await oit.connectToCdp(obsidianVersion === undefined ? {} : { obsidianVersion });
  const basePath = await cdp.evalInObsidian({ callback: ({ app }) => app.vault.adapter.basePath });
  return {
    evalInObsidian: async (params) => await cdp.evalInObsidian(params),
    mkdir: async (paths): Promise<void> => {
      for (const path of paths) {
        mkdirSync(join(basePath, path), { recursive: true });
      }
      await Promise.resolve();
    },
    readText: async (path): Promise<string> => {
      await Promise.resolve();
      return readFileSync(join(basePath, path), 'utf-8');
    },
    [Symbol.asyncDispose]: async (): Promise<void> => {
      await cdp[Symbol.asyncDispose]();
    },
    writeFiles: async (files, paths): Promise<void> => {
      for (const path of paths) {
        mkdirSync(dirname(join(basePath, path)), { recursive: true });
        writeFileSync(join(basePath, path), files.get(path) ?? '');
        await pause(WRITE_PAUSE_MS);
      }
    }
  };
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
    callback: ({ app, linkerPaths, noteNames, paths }) =>
      noteNames.map((name, index) => {
        const ownPath = paths[index] ?? '';
        const file = app.vault.getFiles().find((candidate) => app.vault.adapter.files[candidate.path]?.realpath === ownPath) ?? null;
        return {
          indexed: file?.path ?? null,
          link: file === null ? `[[${name}]]` : app.fileManager.generateMarkdownLink(file, linkerPaths[index] ?? '')
        };
      }),
    input: {
      linkerPaths: names.map((_name, index) => linkerPathOf(index)),
      noteNames: names.map(({ name }) => name),
      paths: names.map(({ name }) => specialNamePath(name))
    }
  });
}

// The note's text, its explorer title, opening it, its backlinks and where the linker's body and properties links lead.
async function readBasic(indexed: null | string, linkerPath: string): Promise<BasicRead> {
  const explorer = await readExplorer(indexed);
  const read = await conn.evalInObsidian({
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
        return { ...links, hasBacklink: false, open: null, text: null };
      }
      const text = await vault.read(file);
      const leaf = workspace.getLeaf(true);
      await leaf.openFile(file);
      const view = leaf.view as MarkdownView;
      const open = { hasText: view.editor.getValue() === text, path: view.file?.path ?? null };
      leaf.detach();
      return {
        ...links,
        hasBacklink: metadataCache.getBacklinksForFile(file).data.has(sourcePath),
        open,
        text
      };
    },
    input: { indexed, linkerPath }
  });
  return { ...read, explorer };
}

// The title the file explorer shows for the note.
async function readExplorer(indexed: null | string): Promise<null | string> {
  return await conn.evalInObsidian({
    callback: async ({ app, indexed: notePath, revealPollMs, revealPolls }) => {
      const file = notePath === null ? null : app.vault.getFileByPath(notePath);
      const explorer = app.workspace.getLeavesOfType('file-explorer')[0]?.view as ExplorerView | undefined;
      if (file === null || explorer === undefined) {
        return null;
      }
      // The mobile explorer draws an item's title only while its drawer is open, and a moment after the reveal.
      app.workspace.leftSplit.expand();
      explorer.revealInFolder(file);
      for (let poll = 0; poll < revealPolls && explorer.fileItems[file.path]?.innerEl.textContent === ''; poll++) {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, revealPollMs);
        });
      }
      return explorer.fileItems[file.path]?.innerEl.textContent ?? null;
    },
    input: { indexed, revealPollMs: REVEAL_POLL_MS, revealPolls: REVEAL_POLLS }
  });
}

// Renames the second file of the name at `index` to each other spelling of the name and back to its own, through
// `fileManager.renameFile`, and reads the note after each.
async function readFormRenames(index: number): Promise<FormRenameRead[]> {
  const specialName = names[index];
  if (specialName === undefined) {
    throw new Error(`No name at ${String(index)}`);
  }
  const spellings = spellingsOf(specialName);
  const own = spellings.find(({ text }) => text === specialName.name);
  const targets = [...spellings.filter(({ text }) => text !== specialName.name), ...own === undefined ? [] : [own]];
  const reads: FormRenameRead[] = [];
  let current = normalizedPathIn(SPECIAL_NAMES_FORMS_FOLDER, specialName.name);
  for (const target of targets) {
    const refusal = await renameTo(current, `${SPECIAL_NAMES_FORMS_FOLDER}/${target.text}.md`);
    await pause(SETTLE_POLL_MS);
    const read = await conn.evalInObsidian({
      callback: ({ app, path }) => {
        const file = app.vault.getFileByPath(path);
        return { path: file?.path ?? null, realpath: file === null ? null : app.vault.adapter.files[file.path]?.realpath ?? null };
      },
      input: { path: normalizedPathIn(SPECIAL_NAMES_FORMS_FOLDER, target.text) }
    });
    reads.push({ ...target, ...read, refusal });
    current = read.path ?? current;
  }
  return reads;
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
    input: { linkerPaths: names.map((_name, index) => linkerPathOf(index)), prepared }
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

// What `getAbstractFileByPath` finds under each spelling of the name's path.
async function readLookups(index: number): Promise<LookupRead[]> {
  const specialName = names[index];
  if (specialName === undefined) {
    throw new Error(`No name at ${String(index)}`);
  }
  const spellings = spellingsOf(specialName);
  const found = await conn.evalInObsidian({
    callback: ({ app, paths }) => paths.map((path) => app.vault.getAbstractFileByPath(path)?.path ?? null),
    input: { paths: spellings.map(({ text }) => specialNamePath(text)) }
  });
  return spellings.map((spelling, spellingIndex) => ({ ...spelling, found: found[spellingIndex] ?? null }));
}

// Every surface of one name but search, the graph and the renames.
async function readName(index: number, prepared: Prepared): Promise<NameRead> {
  const name = names[index]?.name ?? '';
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

// The file on disk the note at `path` reads, or `null` with no note.
async function readRealpath(path: null | string): Promise<null | string> {
  if (path === null) {
    return null;
  }
  return await conn.evalInObsidian({
    callback: ({ app, path: notePath }) => app.vault.adapter.files[notePath]?.realpath ?? null,
    input: { path }
  });
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
  // Android refuses some names a file can arrive with, so the rename back can be refused too.
  const backRefusal = await renameTo(newPath, indexed);
  if (backRefusal !== null) {
    return { backLink: backRefusal, backResolved: false, link: away.link, resolved: away.resolved };
  }
  const back = await settleLinker(linkerPath, indexed);
  return { backLink: back.link, backResolved: back.resolved, link: away.link, resolved: away.resolved };
}

// Types each name into the file explorer's rename of one note, and reads whether it saved and what it showed.
async function readRenameChecks(): Promise<RenameCheckRead[]> {
  const reads: RenameCheckRead[] = [];
  for (const name of [RENAME_WARM_UP_NAME, ...renameCheckNames]) {
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
    callback: ({ app, folder, otherFolders }) => {
      const view = app.workspace.getLeavesOfType('search')[0]?.view as SearchView | undefined;
      return view === undefined
        ? []
        : Array.from(view.dom.resultDomLookup.keys(), (file) => file.path)
          .filter((path) => path.startsWith(`${folder}/`) && otherFolders.every((other) => !path.startsWith(`${other}/`)));
    },
    input: { folder: SPECIAL_NAMES_FOLDER, otherFolders: [SPECIAL_NAMES_LINKER_FOLDER, SPECIAL_NAMES_ONTO_FOLDER, SPECIAL_NAMES_FORMS_FOLDER, SPECIAL_NAMES_TYPED_FOLDER] }
  });
}

// Edits the one note each shadowed name shares with its partner, through the vault, and reads both files on disk.
async function readShadowWrites(): Promise<ShadowWriteRead[]> {
  const reads: ShadowWriteRead[] = [];
  for (const { name, shadows } of names) {
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
    reads.push({ name, nameText: await conn.readText(specialNamePath(name)), partner: shadows, partnerText: await conn.readText(specialNamePath(shadows)) });
  }
  return reads;
}

// The files the quick switcher offers for `typed`.
async function readSwitcher(typed: string): Promise<string[]> {
  await conn.evalInObsidian({
    callback: ({ app, typed: query }) => {
      const QuickSwitcher = app.internalPlugins.getPluginById('switcher').instance.QuickSwitcherModal;
      const modal = new QuickSwitcher(app, false);
      // eslint-disable-next-line unicorn/no-global-object-property-assignment -- Serialized callbacks cannot share a closure; retain only this probe's modal until finally.
      (globalThis as ProbeGlobal & typeof globalThis).specialNamesSwitcher = modal;
      modal.open();
      modal.inputEl.value = query;
      modal.inputEl.dispatchEvent(new Event('input'));
    },
    input: { typed }
  });
  try {
    // Keep the complete order, including empty offers. A short unchanged prefix can precede an async update.
    return await readSettledSnapshot(`quick switcher: ${typed}`, async () =>
      await conn.evalInObsidian({
        callback: ({ maxOffers }) => {
          const modal = (globalThis as ProbeGlobal & typeof globalThis).specialNamesSwitcher;
          if (modal === undefined) {
            throw new Error('No quick switcher probe');
          }
          return (modal.chooser.values ?? []).flatMap((value) => (value?.file === undefined ? [] : [value.file.path])).slice(0, maxOffers);
        },
        input: { maxOffers: SWITCHER_MAX_OFFERS }
      }));
  } finally {
    await conn.evalInObsidian({
      callback: () => {
        const probe = globalThis as ProbeGlobal & typeof globalThis;
        probe.specialNamesSwitcher?.close();
        delete probe.specialNamesSwitcher;
      }
    });
  }
}

// The hand-typed links to the name at `index`, one linker each: where `resolvedLinks` maps each, and what
// `unresolvedLinks` holds where it maps none.
async function readTypedLinks(index: number): Promise<TypedLinkRead[]> {
  const specialName = names[index];
  if (specialName === undefined) {
    throw new Error(`No name at ${String(index)}`);
  }
  const typed = spellingsOf(specialName).flatMap((spelling, spellingIndex) => TYPED_LINK_KINDS.map((kind) => ({ ...spelling, kind, link: typedLink(kind, spelling.text), linkerPath: typedLinkerPath(index, spellingIndex, kind) })));
  const reads: TypedLinkRead[] = [];
  for (const { form, kind, link, linkerPath, text } of typed) {
    const before = await conn.evalInObsidian({ callback: ({ app }) => app.vault.getFiles().map((file) => file.path) });
    const clicked = await clickInReadingView(linkerPath);
    // Inside the link's path for a wikilink, inside its text for a markdown link.
    const followed = await followInEditor(linkerPath, kind === 'wikilink' ? WIKILINK_CURSOR_CH : MARKDOWN_LINK_CURSOR_CH);
    const after = await conn.evalInObsidian({
      callback: async ({ app, before: paths, linkerPath: path }) => {
        for (const leaf of app.workspace.getLeavesOfType('markdown')) {
          leaf.detach();
        }
        const existing = new Set(paths);
        const created = app.vault.getFiles().filter((file) => !existing.has(file.path));
        for (const file of created) {
          await app.vault.delete(file);
        }
        return {
          created: created.map((file) => file.path),
          resolved: Object.keys(app.metadataCache.resolvedLinks[path] ?? {})[0] ?? null,
          unresolved: Object.keys(app.metadataCache.unresolvedLinks[path] ?? {})[0] ?? null
        };
      },
      input: { before, linkerPath }
    });
    reads.push({ ...clicked, ...after, followed, form, kind, link, text });
  }
  return reads;
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

// Read through the whole settle window: a cached success can precede a delayed rename update or removal from the index.
async function settleLinker(linkerPath: string, path: string): Promise<LinkerRead> {
  return await readSettledSnapshot(`rename: ${linkerPath} -> ${path}`, async () => await readLinker(linkerPath, path));
}

// Where the oracle is read: the app's version comes from Electron on desktop and from Capacitor on mobile.
async function setUp(): Promise<SpecialNamesMeta> {
  return await conn.evalInObsidian({
    callback: async ({ app }) => {
      const { Capacitor: capacitor, electron } = globalThis as ProbeGlobal & typeof globalThis;
      const info = await capacitor?.Plugins.App?.getInfo();
      const appVersion = electron?.ipcRenderer?.sendSync?.('version') ?? info?.version ?? null;
      return { appVersion, userAgent: navigator.userAgent, vault: app.vault.getName() };
    }
  });
}

// The names the sweep writes, the names it types into the rename, and its oracle file's name.
function sweepOf(isAndroidSweep: boolean, isNormalizationSweep: boolean): Sweep {
  if (isNormalizationSweep) {
    return { fileNameOf: isAndroidSweep ? specialNamesNormalizationAndroidOracleFileName : specialNamesNormalizationOracleFileName, names: NORMALIZATION_NAMES, renameCheckNames: [] };
  }
  return isAndroidSweep
    ? { fileNameOf: specialNamesAndroidOracleFileName, names: ANDROID_SPECIAL_NAMES, renameCheckNames: ANDROID_RENAME_CHECK_NAMES }
    : { fileNameOf: specialNamesOracleFileName, names: SPECIAL_NAMES, renameCheckNames: RENAME_CHECK_NAMES };
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
      for (const shown of document.querySelectorAll('.tooltip, .notice')) {
        shown.remove();
      }
      await explorer.startRenameFile(file);
      const titleElement = explorer.fileItems[file.path]?.innerEl;
      titleElement?.setText(typed);
      titleElement?.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, settleMs);
      });
      const tooltip = document.querySelector('.tooltip')?.textContent ?? null;
      const isSaved = await explorer.saveRename();
      explorer.exitRename();
      // Mobile shows the message as a notice when the rename is saved or refused.
      const message = tooltip ?? document.querySelector('.notice')?.textContent ?? null;
      return { isSaved, message };
    },
    input: { name, notePath: RENAME_CHECK_NOTE, settleMs: SETTLE_POLL_MS }
  });
}

// Waits until the app has indexed every path, and resolved its links where `isSource` asks for it; returns the paths it
// still has not after the bound, or throws where `isEveryRequired`.
async function waitIndexed(files: ReadonlyMap<string, string>, paths: readonly string[], isSource: boolean, isEveryRequired: boolean): Promise<string[]> {
  let missing: string[] = [];
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    missing = await conn.evalInObsidian({
      callback: ({ app, isSource: isSourceNote, paths: notePaths }) =>
        notePaths.filter((path) => {
          const file = app.vault.getFileByPath(path);
          return !(file !== null && app.metadataCache.getFileCache(file) !== null && (!isSourceNote || app.metadataCache.resolvedLinks[path] !== undefined));
        }),
      input: { isSource, paths }
    });
    if (missing.length === 0) {
      return missing;
    }
    if (poll % REWRITE_EVERY === REWRITE_EVERY - 1) {
      await conn.writeFiles(files, missing);
    }
    await pause(POLL_MS);
  }
  if (isEveryRequired) {
    throw new Error(`The app did not index ${missing.join(', ')}`);
  }
  return missing;
}

try {
  const meta = await setUp();
  // A name in a folder is renamed onto in a folder of the same name, which a rename does not create.
  const ontoFolders = names.flatMap(({ name }) => (name.includes('/') ? [`${SPECIAL_NAMES_ONTO_FOLDER}/${name.slice(0, name.lastIndexOf('/'))}`] : []));
  const normalizationFolders = isNormalization ? [SPECIAL_NAMES_FORMS_FOLDER, SPECIAL_NAMES_TYPED_FOLDER] : [];
  await conn.mkdir([
    SPECIAL_NAMES_FOLDER,
    SPECIAL_NAMES_LINKER_FOLDER,
    SPECIAL_NAMES_ONTO_FOLDER,
    SPECIAL_NAMES_RENAMED_FOLDER,
    SPECIAL_NAMES_MOVED_FOLDER,
    ...ontoFolders,
    ...normalizationFolders
  ]);
  const pluginDirectory = `.obsidian/plugins/${PLUGIN_ID}`;
  const pluginFiles = new Map([
    [`${pluginDirectory}/main.js`, 'const obsidian = require(\'obsidian\');\nmodule.exports = class extends obsidian.Plugin { onload() { window.specialNamesObsidian = obsidian; } };\n'],
    [
      `${pluginDirectory}/manifest.json`,
      JSON.stringify({ author: 'special names oracle', description: 'Hands the obsidian module to the oracle.', id: PLUGIN_ID, minAppVersion: '1.0.0', name: 'Special names probe', version: '1.0.0' })
    ]
  ]);
  await conn.writeFiles(pluginFiles, pluginFiles.keys());

  // The vault keeps the last of two shadowing files it sees, so the shadowed names go first and their partners win.
  const files = specialNameFiles(names);
  const order = names.filter(({ shadows }) => shadows !== undefined).map(({ name }) => specialNamePath(name));
  // The normalization sweep's second file of each name it renames between spellings, in a folder of its own.
  const formNames = isNormalization ? names.filter((specialName) => specialName.shadows === undefined && spellingsOf(specialName).length > 1) : [];
  for (const { name } of formNames) {
    files.set(`${SPECIAL_NAMES_FORMS_FOLDER}/${name}.md`, `snform${String(names.findIndex((candidate) => candidate.name === name))}q\n`);
  }
  for (const path of files.keys()) {
    if (!order.includes(path)) {
      order.push(path);
    }
  }
  await conn.writeFiles(files, order);
  const expected = new Set<string>();
  for (const { name } of names) {
    if (!name.startsWith('.')) {
      expected.add(normalizedPath(name));
    }
  }
  for (const { name } of formNames) {
    expected.add(normalizedPathIn(SPECIAL_NAMES_FORMS_FOLDER, name));
  }
  // A name the app does not index is a finding, read as one, not a failure of the oracle.
  const unindexed = await waitIndexed(files, [...expected], false, false);
  await prepareApp();
  const renameChecks = renameCheckNames.length === 0 ? [] : await readRenameChecks();
  console.log(`special-names-oracle: ${String(files.size)} notes written, ${unindexed.length === 0 ? 'all' : `all but ${unindexed.join(', ')}`} indexed, ${String(renameChecks.length)} renames typed`);

  const prepared = await prepareNames();
  const linkers = new Map<string, string>();
  const sources: string[] = [];
  for (const [index, { link }] of prepared.entries()) {
    linkers.set(linkerPathOf(index), specialNameLinkerText(link));
    linkers.set(`${SPECIAL_NAMES_ONTO_FOLDER}/P${String(index)}.md`, specialNameText(index));
    linkers.set(`${SPECIAL_NAMES_ONTO_FOLDER}/M${String(index)}.md`, `[[P${String(index)}]]\n`);
    sources.push(linkerPathOf(index), `${SPECIAL_NAMES_ONTO_FOLDER}/M${String(index)}.md`);
    const spellings = isNormalization ? spellingsOf(names[index] ?? { group: 'control', name: '' }) : [];
    for (const [spellingIndex, { text }] of spellings.entries()) {
      for (const kind of TYPED_LINK_KINDS) {
        linkers.set(typedLinkerPath(index, spellingIndex, kind), `${typedLink(kind, text)}\n`);
        sources.push(typedLinkerPath(index, spellingIndex, kind));
      }
    }
  }
  await conn.writeFiles(linkers, linkers.keys());
  await waitIndexed(linkers, sources, true, true);
  console.log('special-names-oracle: linkers written and resolved');

  const byName: Record<string, SpecialNameRead> = {};
  const reads = [];
  for (const [index, preparedName] of prepared.entries()) {
    reads.push({ ...await readName(index, preparedName), search: await readSearch(specialNameText(index).trim()) });
  }
  const graph = await readGraph(prepared);
  // Before the renames: once a note a hidden file shadows is renamed away, it cannot always come back.
  const shadowWrites = await readShadowWrites();
  // What the normalization sweep reads before any rename moves a file. Following the links goes last of the reads: after
  // it, rendering an embed can hang.
  const beforeRenames = new Map<string, Pick<NormalizationRead, 'lookups' | 'realpath' | 'typedLinks'>>();
  if (isNormalization) {
    for (const [index, { name }] of names.entries()) {
      beforeRenames.set(name, { lookups: await readLookups(index), realpath: await readRealpath(prepared[index]?.indexed ?? null), typedLinks: await readTypedLinks(index) });
    }
  }
  for (const [index, { name }] of names.entries()) {
    const { indexed } = prepared[index] ?? { indexed: null };
    const read = reads[index];
    const graphRead = graph[index];
    if (read === undefined || graphRead === undefined) {
      throw new Error(`Missing read for ${name}`);
    }
    // The move goes first: where the rename back is refused, the note stays renamed.
    const move = indexed === null ? null : await readRename(indexed, linkerPathOf(index), `${SPECIAL_NAMES_MOVED_FOLDER}/${indexed.slice(indexed.lastIndexOf('/') + 1)}`);
    const rename = await readRename(indexed, linkerPathOf(index), `${SPECIAL_NAMES_RENAMED_FOLDER}/R${String(index)}.md`);
    byName[name] = { ...read, graph: graphRead, move, rename, renameOnto: await readRenameOnto(index, name) };
  }
  let normalization: Record<string, NormalizationRead> | undefined;
  if (isNormalization) {
    normalization = {};
    for (const [index, specialName] of names.entries()) {
      const before = beforeRenames.get(specialName.name);
      if (before === undefined) {
        throw new Error(`Missing normalization read for ${specialName.name}`);
      }
      normalization[specialName.name] = {
        ...before,
        formRenames: null,
        ontoRealpath: await readRealpath(normalizedPathIn(SPECIAL_NAMES_ONTO_FOLDER, specialName.name)),
        realpathAfterRenames: await readRealpath(prepared[index]?.indexed ?? null)
      };
    }
  }
  if (normalization !== undefined) {
    for (const { name } of formNames) {
      const read = normalization[name];
      if (read !== undefined) {
        normalization[name] = { ...read, formRenames: await readFormRenames(names.findIndex((candidate) => candidate.name === name)) };
      }
    }
  }
  console.log('special-names-oracle: surfaces read');

  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, fileNameOf(meta.appVersion ?? 'unknown'));
  const oracleFile: SpecialNamesFile = { meta, ...normalization !== undefined && { normalization }, reads: byName, renameChecks, shadowWrites };
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  console.log(`special-names-oracle: ${String(names.length)} names written to ${outFile}`);
} finally {
  await conn[Symbol.asyncDispose]();
}
