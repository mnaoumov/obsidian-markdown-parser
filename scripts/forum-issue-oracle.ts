/**
 * @file
 *
 * The forum issue oracle: runs every document of `forumIssueDocuments()` (`src/oracle/forum-issues.ts`) through an owned
 * Obsidian instance driven over CDP (`obsidian-integration-testing`, installed globally), and writes its editor's tree
 * (as `scripts/oracle.ts` reads it), its reading view's DOM with `strictLineBreaks: true` (normalized as
 * `scripts/spec-oracle.ts` normalizes it) and its metadata worker's `CachedMetadata` to
 * `oracle/forum-issues-obsidian-<version>.json`. For the samples where the editing modes and the reading view disagree it
 * also reads Source mode's and Live Preview's `.cm-content` as the user sees it: the note gets an empty last line that
 * holds the cursor, so Live Preview shows no source for the selection, and that line is left out of the HTML, read once
 * the DOM stops changing, so math has rendered.
 *
 * Usage: `jiti scripts/forum-issue-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 */

/// <reference lib="dom.iterable" />

import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/dprint';
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
  ForumIssueFile,
  ForumIssueRead
} from '../src/oracle/forum-issues.ts';
import type { OracleNode } from '../src/oracle/oracle-file.ts';
import type { SpecOracleMeta } from '../src/oracle/spec-oracle-file.ts';

import {
  EDITING_MODES_VS_READING_VIEW_SAMPLES,
  forumIssueDocuments
} from '../src/oracle/forum-issues.ts';

interface App {
  metadataCache: MetadataCache;
  plugins: Plugins;
  vault: Vault;
  workspace: Workspace;
}

interface CdpConnection extends AsyncDisposable {
  evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
}

interface CmLanguage {
  ensureSyntaxTree: (state: EditorState, upto: number, timeout: number) => SyntaxTree;
}

interface CodeMirrorEditor {
  state: unknown;
}

interface Component {
  load: () => void;
  unload: () => void;
}

interface ConnectToCdpOptions {
  readonly obsidianVersion?: string;
}

interface DataAdapter {
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<void>;
  write: (path: string, data: string) => Promise<void>;
}

interface EditingModeRead {
  readonly livePreviewHtml: string;
  readonly sourceModeHtml: string;
}

interface Editor {
  cm: CodeMirrorEditor;
  focus: () => void;
  lastLine: () => number;
  setCursor: (position: EditorPosition) => void;
  setValue: (text: string) => void;
}

interface EditorPosition {
  ch: number;
  line: number;
}

interface EditorState {
  // eslint-disable-next-line unicorn/name-replacements -- CodeMirror's `EditorState` names its text `doc`.
  doc: EditorText;
}

interface EditorText {
  length: number;
  toString: () => string;
}

interface Electron {
  ipcRenderer?: IpcRenderer;
}

interface ElectronGlobal {
  electron?: Electron;
}

interface EvalInObsidianParams<Input extends object, Result> {
  readonly callback: (input: Input & ObsidianGlobals) => Promise<Result> | Result;
  readonly input?: Input;
}

interface IpcRenderer {
  sendSync?: (channel: string) => string;
}

interface Leaf {
  setViewState: (state: unknown) => Promise<void>;
  view: MarkdownView;
}

interface MarkdownRenderer {
  render: (app: App, markdown: string, element: HTMLElement, sourcePath: string, component: Component) => Promise<void>;
}

interface MarkdownView {
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's View names its element containerEl.
  containerEl: HTMLElement;
  editor: Editor;
}

interface MetadataCache {
  computeMetadataAsync: (data: ArrayBuffer) => Promise<unknown>;
}

interface NodeType {
  name: string;
}

interface ObsidianGlobals {
  app: App;
  obsidianModule: ObsidianModule;
}

interface ObsidianModule {
  Component: new () => Component;
  MarkdownRenderer: MarkdownRenderer;
}

interface OitModule {
  connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface OracleGlobal {
  __oracleCmLanguage: CmLanguage;
}

interface Plugins {
  enablePlugin: (id: string) => Promise<void>;
  loadManifests: () => Promise<void>;
  setEnable: (isEnabled: boolean) => Promise<void>;
}

interface RenderRead {
  readonly html: string;
  readonly metadata: unknown;
}

interface SyntaxTree {
  cursor: () => TreeCursor;
}

interface TreeCursor {
  firstChild: () => boolean;
  from: number;
  nextSibling: () => boolean;
  parent: () => boolean;
  to: number;
  type: NodeType;
}

interface TreeRead {
  readonly nodes: OracleNode[];
  readonly text: string;
}

interface Vault {
  adapter: DataAdapter;
  create: (path: string, data: string) => Promise<unknown>;
  setConfig: (name: string, value: unknown) => void;
}

interface Workspace {
  getLeaf: (shouldCreateNewLeaf: boolean) => Leaf;
  getMostRecentLeaf: () => Leaf | null;
}

const MAX_READS = 20;
const SETTLE_MS = 30;
const PARSE_TIMEOUT_MS = 10_000;
const JSON_INDENT = 2;
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

// Source mode's and Live Preview's DOM of `text`, each read once it has not changed for a few polls, so math has rendered.
async function readEditingModes(text: string): Promise<EditingModeRead> {
  return await conn.evalInObsidian({
    callback: async ({ app, text: markdown }) => {
      const POLL_MS = 100;
      const MAX_POLLS = 100;
      const STABLE_POLLS = 5;
      // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback runs inside Obsidian, which sees nothing outside it.
      async function sleep(ms: number): Promise<void> {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });
      }
      async function readMode(isSourceMode: boolean): Promise<string> {
        const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
        await leaf.setViewState({ state: { file: 'forum-issue.md', mode: 'source', source: isSourceMode }, type: 'markdown' });
        const { editor } = leaf.view;
        editor.setValue(`${markdown}\n`);
        editor.setCursor({ ch: 0, line: editor.lastLine() });
        editor.focus();
        const content = leaf.view.containerEl.querySelector('.cm-content');
        if (content === null) {
          throw new Error('The markdown view has no .cm-content');
        }
        let last = '';
        let stablePolls = 0;
        for (let polls = 0; polls < MAX_POLLS && stablePolls < STABLE_POLLS; polls++) {
          await sleep(POLL_MS);
          const html = content.getHTML();
          stablePolls = html === last ? stablePolls + 1 : 0;
          last = html;
        }
        const clone = content.cloneNode(true) as HTMLElement;
        const cursorLine = clone.lastElementChild;
        if (cursorLine?.matches('.cm-line.cm-active') !== true || cursorLine.getHTML() !== '<br>') {
          throw new Error(`The appended line is not the last of ${JSON.stringify(markdown)}`);
        }
        cursorLine.remove();
        return clone.getHTML();
      }
      const sourceModeHtml = await readMode(true);
      const livePreviewHtml = await readMode(false);
      // `readTree` reads the editor in Source mode, as `setUp` left it.
      await readMode(true);
      return { livePreviewHtml, sourceModeHtml };
    },
    input: { text }
  });
}

async function readRendered(text: string): Promise<RenderRead> {
  return await conn.evalInObsidian({
    callback: async ({ app, obsidianModule, text: markdown }) => {
      const RENDER_SETTLE_MS = 30;
      // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback runs inside Obsidian, which sees nothing outside it.
      async function sleep(ms: number): Promise<void> {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });
      }
      // As `scripts/spec-oracle.ts` normalizes the reading view's DOM.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback runs inside Obsidian, which sees nothing outside it.
      function normalize(element: HTMLElement): string {
        const DROPPED_ATTRIBUTES = ['aria-label', 'data-heading', 'data-href', 'data-tooltip-position', 'dir', 'referrerpolicy', 'rel', 'target'];
        const DROPPED_CLASSES = ['external-link', 'internal-link', 'is-loaded', 'language-none'];
        for (const button of element.querySelectorAll(':scope button.copy-code-button')) {
          button.remove();
        }
        for (const code of element.querySelectorAll(':scope pre > code')) {
          const codeText = code.textContent;
          code.textContent = codeText;
          code.parentElement?.removeAttribute('class');
        }
        for (const node of element.querySelectorAll(':scope *')) {
          for (const name of DROPPED_ATTRIBUTES) {
            node.removeAttribute(name);
          }
          node.classList.remove(...DROPPED_CLASSES);
          if (node.getAttribute('class') === '') {
            node.removeAttribute('class');
          }
          for (const name of ['href', 'src']) {
            const value = node.getAttribute(name);
            if (value !== null) {
              try {
                node.setAttribute(name, decodeURI(value));
              } catch {
                // A target that is not valid percent-encoding is compared as it is.
              }
            }
          }
          const attributes = [...node.attributes].map((attribute) => [attribute.name, attribute.value] as const);
          for (const [name] of attributes) {
            node.removeAttribute(name);
          }
          const sorted = attributes.toSorted(([a], [b]) => a.localeCompare(b));
          for (const [name, value] of sorted) {
            node.setAttribute(name, value);
          }
        }
        return element.getHTML();
      }
      app.vault.setConfig('strictLineBreaks', true);
      const element = document.createElement('div');
      const component = new obsidianModule.Component();
      component.load();
      await obsidianModule.MarkdownRenderer.render(app, markdown, element, 'forum-issue.md', component);
      await sleep(RENDER_SETTLE_MS);
      const html = normalize(element);
      component.unload();
      app.vault.setConfig('strictLineBreaks', false);
      const metadata = await app.metadataCache.computeMetadataAsync(new TextEncoder().encode(markdown).buffer) ?? null;
      return { html, metadata };
    },
    input: { text }
  });
}

// One read of the editor's tree, after giving it `text` when there is one, as `scripts/oracle.ts` reads it.
async function readTree(text: null | string): Promise<string> {
  return conn.evalInObsidian({
    callback: ({ app, parseTimeout, text: newText }) => {
      const language = (globalThis as OracleGlobal & typeof globalThis).__oracleCmLanguage;
      const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
      if (newText !== null) {
        leaf.view.editor.setValue(newText);
      }
      const state = leaf.view.editor.cm.state as EditorState;
      const tree = language.ensureSyntaxTree(state, state.doc.length, parseTimeout);
      const nodes: OracleNode[] = [];
      const cursor = tree.cursor();
      let depth = 0;
      for (;;) {
        if (depth > 0) {
          nodes.push([cursor.from, cursor.to, depth, cursor.type.name]);
        }
        if (cursor.firstChild()) {
          depth++;
          continue;
        }
        while (!cursor.nextSibling()) {
          if (!cursor.parent()) {
            return JSON.stringify({ nodes, text: state.doc.toString() });
          }
          depth--;
        }
      }
    },
    input: { parseTimeout: PARSE_TIMEOUT_MS, text }
  });
}

// Re-reads until the tree stops changing, as `scripts/oracle.ts` does: a lazily loaded sub-mode re-highlights later.
async function readUntilStable(text: string): Promise<TreeRead> {
  let last = await readTree(text);
  for (let reads = 1; reads < MAX_READS; reads++) {
    await new Promise((resolve) => {
      setTimeout(resolve, SETTLE_MS);
    });
    const next = await readTree(null);
    if (next === last) {
      break;
    }
    last = next;
  }
  return JSON.parse(last) as TreeRead;
}

// As `scripts/oracle.ts` does: `@codemirror/language` is only reachable through the module map Obsidian hands to plugins.
async function setUp(): Promise<SpecOracleMeta> {
  return await conn.evalInObsidian({
    callback: async ({ app }) => {
      const pluginDirectory = '.obsidian/plugins/oracle-cm-language';
      await app.vault.adapter.mkdir(pluginDirectory);
      await app.vault.adapter.write(`${pluginDirectory}/manifest.json`, JSON.stringify({ author: 'oracle', description: 'oracle', id: 'oracle-cm-language', minAppVersion: '1.0.0', name: 'oracle', version: '0.0.1' }));
      await app.vault.adapter.write(`${pluginDirectory}/main.js`, 'const { Plugin } = require(\'obsidian\');\nmodule.exports = class extends Plugin { onload() { window.__oracleCmLanguage = require(\'@codemirror/language\'); } };\n');
      await app.plugins.setEnable(true);
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin('oracle-cm-language');
      if (!await app.vault.adapter.exists('forum-issue.md')) {
        await app.vault.create('forum-issue.md', '');
      }
      // The reading view reads `strictLineBreaks` only once a markdown view is open.
      const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
      await leaf.setViewState({ state: { file: 'forum-issue.md', mode: 'source', source: true }, type: 'markdown' });
      const { electron } = globalThis as ElectronGlobal & typeof globalThis;
      return { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent };
    }
  });
}

try {
  const meta = await setUp();
  // As `scripts/oracle.ts` warms up the lazily loaded sub-modes; these documents use only the math one.
  await readUntilStable('$x$ and $$y$$\n$$\n\\frac{a}{b}\n$$\n');
  // Math is typeset by MathJax, which loads on first use.
  await readEditingModes('$x$\n');
  const editingModeSamples = new Set(EDITING_MODES_VS_READING_VIEW_SAMPLES.map((sample) => sample.markdown));
  const reads: ForumIssueRead[] = [];
  for (const markdown of forumIssueDocuments()) {
    const tree = await readUntilStable(markdown);
    if (tree.text !== markdown) {
      throw new Error(`The editor rewrote ${JSON.stringify(markdown)} to ${JSON.stringify(tree.text)}`);
    }
    const rendered = await readRendered(markdown);
    const editingModes = editingModeSamples.has(markdown) ? await readEditingModes(markdown) : {};
    reads.push({ html: rendered.html, markdown, metadata: rendered.metadata, nodes: tree.nodes, ...editingModes });
  }
  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, `forum-issues-obsidian-${meta.appVersion ?? 'unknown'}.json`);
  const oracleFile: ForumIssueFile = { meta, reads };
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  // The repository's dprint check covers `oracle/`, and its layout matches `JSON.stringify`'s only by chance.
  await format({ paths: [outFile] });
  console.log(`forum-issue-oracle: ${String(reads.length)} documents written to ${outFile}`);
} finally {
  await conn[Symbol.asyncDispose]();
}
