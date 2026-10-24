/**
 * @file
 *
 * The reads of an owned Obsidian instance driven over CDP (`obsidian-integration-testing`, installed globally) that the
 * forum issue and editing mode oracles share: the editor's tree (as `scripts/oracle.ts` reads it), the reading view's DOM
 * with `strictLineBreaks: true` (normalized as `scripts/spec-oracle.ts` normalizes it), the metadata worker's
 * `CachedMetadata`, and Source mode's and Live Preview's `.cm-content` as the user sees it: the note gets an empty last
 * line that holds the cursor, so Live Preview shows no source for the selection, and that line is left out of the HTML,
 * read once the DOM stops changing, so math has rendered.
 */

/// <reference lib="dom.iterable" />

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { OracleNode } from '../src/oracle/oracle-file.ts';
import type { SpecOracleMeta } from '../src/oracle/spec-oracle-file.ts';

/**
 * Source mode's and Live Preview's DOM of a note.
 */
export interface EditingModeRead {
  /**
   * Live Preview's `.cm-content` inner HTML.
   */
  readonly livePreviewHtml: string;

  /**
   * Source mode's `.cm-content` inner HTML.
   */
  readonly sourceModeHtml: string;
}

/**
 * A connection to an owned Obsidian, set up for the reads.
 */
export interface ObsidianReader {
  /**
   * Closes the connection, which kills the owned instance.
   */
  readonly dispose: () => Promise<void>;

  /**
   * Where the instance runs.
   */
  readonly meta: SpecOracleMeta;

  /**
   * Source mode's and Live Preview's DOM of a note.
   */
  readonly readEditingModes: (text: string) => Promise<EditingModeRead>;

  /**
   * The reading view's DOM and the worker's metadata of a note.
   */
  readonly readRendered: (text: string) => Promise<RenderRead>;

  /**
   * The editor's tree of a note, read until it stops changing.
   */
  readonly readUntilStable: (text: string) => Promise<TreeRead>;
}

/**
 * The reading view's DOM and the worker's metadata of a note.
 */
export interface RenderRead {
  /**
   * The reading view's DOM with `strictLineBreaks: true`, normalized.
   */
  readonly html: string;

  /**
   * The worker's `CachedMetadata`, or `null` where it threw.
   */
  readonly metadata: unknown;
}

/**
 * The editor's tree of a note.
 */
export interface TreeRead {
  /**
   * The tree, in pre-order, without the root.
   */
  readonly nodes: OracleNode[];

  /**
   * The text the editor parsed.
   */
  readonly text: string;
}
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

/**
 * Connects to an owned Obsidian and sets it up for the reads: a plugin that hands out `@codemirror/language`, the note
 * the reads use, open in Source mode, and the lazily loaded sub-modes and MathJax warmed up.
 *
 * @param obsidianVersion - The Obsidian version to launch, or the installed one.
 * @param notePath - The vault path of the note the reads use.
 * @returns The reader.
 */
export async function connectObsidianReader(obsidianVersion: string | undefined, notePath: string): Promise<ObsidianReader> {
  const oitPath = join(execSync('npm root -g').toString().trim(), 'obsidian-integration-testing/dist/lib/esm/index.mjs');
  // eslint-disable-next-line no-restricted-syntax -- obsidian-integration-testing is installed globally, so its path is only known at run time.
  const oit = await import(pathToFileURL(oitPath).href) as OitModule;
  // The connection is disposed by hand: `await using` needs a tslib helper this repo does not install.
  const conn = await oit.connectToCdp(obsidianVersion === undefined ? {} : { obsidianVersion });

  // Source mode's and Live Preview's DOM of `text`, each read once it has not changed for a few polls, so math has rendered.
  async function readEditingModes(text: string): Promise<EditingModeRead> {
    const sourceModeHtml = await readMode(text, true);
    const livePreviewHtml = await readMode(text, false);
    // `readTree` reads the editor in Source mode, as `setUp` left it.
    await readMode(text, true);
    return { livePreviewHtml, sourceModeHtml };
  }

  // One mode's DOM, in an eval of its own: a DOM that never settles takes the polls' cap, which three modes in one eval overran.
  async function readMode(text: string, isSourceMode: boolean): Promise<string> {
    return await conn.evalInObsidian({
      callback: async ({ app, isSource, notePath: note, text: markdown }) => {
        // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback runs inside Obsidian, which sees nothing outside it.
        async function sleep(ms: number): Promise<void> {
          await new Promise((resolve) => {
            globalThis.setTimeout(resolve, ms);
          });
        }
        const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
        await leaf.setViewState({ state: { file: note, mode: 'source', source: isSource }, type: 'markdown' });
        const { editor } = leaf.view;
        editor.setValue(`${markdown}\n`);
        editor.setCursor({ ch: 0, line: editor.lastLine() });
        editor.focus();
        const content = leaf.view.containerEl.querySelector('.cm-content');
        if (content === null) {
          throw new Error('The markdown view has no .cm-content');
        }
        const POLL_MS = 100;
        const MAX_POLLS = 100;
        const STABLE_POLLS = 5;
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
      },
      input: { isSource: isSourceMode, notePath, text }
    });
  }

  async function readRendered(text: string): Promise<RenderRead> {
    return await conn.evalInObsidian({
      callback: async ({ app, notePath: note, obsidianModule, text: markdown }) => {
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
            // The reading view gives every footnote id a random suffix per render, so the read would change on every run.
            for (const name of ['data-footnote-id', 'href', 'id']) {
              const value = node.getAttribute(name);
              if (value !== null) {
                node.setAttribute(name, value.replace(/(?<=^#?fn(?:ref)?-.+)-[0-9a-f]{16}$/u, ''));
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
        await obsidianModule.MarkdownRenderer.render(app, markdown, element, note, component);
        await sleep(RENDER_SETTLE_MS);
        const html = normalize(element);
        component.unload();
        app.vault.setConfig('strictLineBreaks', false);
        const metadata = await app.metadataCache.computeMetadataAsync(new TextEncoder().encode(markdown).buffer) ?? null;
        return { html, metadata };
      },
      input: { notePath, text }
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
      callback: async ({ app, notePath: note }) => {
        const pluginDirectory = '.obsidian/plugins/oracle-cm-language';
        await app.vault.adapter.mkdir(pluginDirectory);
        await app.vault.adapter.write(`${pluginDirectory}/manifest.json`, JSON.stringify({ author: 'oracle', description: 'oracle', id: 'oracle-cm-language', minAppVersion: '1.0.0', name: 'oracle', version: '0.0.1' }));
        await app.vault.adapter.write(`${pluginDirectory}/main.js`, 'const { Plugin } = require(\'obsidian\');\nmodule.exports = class extends Plugin { onload() { window.__oracleCmLanguage = require(\'@codemirror/language\'); } };\n');
        await app.plugins.setEnable(true);
        await app.plugins.loadManifests();
        await app.plugins.enablePlugin('oracle-cm-language');
        if (!await app.vault.adapter.exists(note)) {
          await app.vault.create(note, '');
        }
        // The reading view reads `strictLineBreaks` only once a markdown view is open.
        const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
        await leaf.setViewState({ state: { file: note, mode: 'source', source: true }, type: 'markdown' });
        const { electron } = globalThis as ElectronGlobal & typeof globalThis;
        return { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent };
      },
      input: { notePath }
    });
  }

  try {
    const meta = await setUp();
    // As `scripts/oracle.ts` warms up the lazily loaded sub-modes.
    await readUntilStable('$x$ and $$y$$\n$$\n\\frac{a}{b}\n$$\n');
    // Math is typeset by MathJax, which loads on first use.
    await readEditingModes('$x$\n');
    return { dispose: async () => conn[Symbol.asyncDispose](), meta, readEditingModes, readRendered, readUntilStable };
  } catch (error) {
    await conn[Symbol.asyncDispose]();
    throw error;
  }
}
