/**
 * @file
 *
 * The spec oracle: runs every CommonMark 0.31.2 example and every GFM extension example through an owned Obsidian
 * instance driven over CDP (`obsidian-integration-testing`, installed globally), and writes what each of its three
 * parsers made of it to `oracle/spec-obsidian-<version>.json`:
 *
 * - `editor`: the editor's syntax tree, read as `scripts/capture/oracle.ts` reads it.
 * - `metadata`: the metadata worker's `CachedMetadata`, from `app.metadataCache.computeMetadataAsync`.
 * - `html` and `htmlStrict`: the reading view's DOM, rendered by `MarkdownRenderer.render`, with the app's default
 *   `strictLineBreaks: false` and with `strictLineBreaks: true`.
 *
 * `src/oracle/spec/spec-quirks.ts` compares them with the spec.
 *
 * Usage: `jiti scripts/capture/spec-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 */

/// <reference lib="dom.iterable" />

import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/dprint';
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
  SpecOracleExample,
  SpecOracleFile,
  SpecOracleRead
} from '../../src/oracle/spec/spec-oracle-file.ts';

interface AbstractFile {
  path: string;
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
  setValue: (text: string) => void;
}

interface EditorRead {
  readonly nodes: RawNode[];
  readonly text: string;
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
  readonly callback: (input: Input & ObsidianGlobals) => Promise<Result>;
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

type RawNode = [from: number, to: number, depth: number, name: string];

interface SpecExample {
  readonly example: number;
  readonly extensions?: readonly string[];
  readonly html: string;
  readonly markdown: string;
  readonly section: string;
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
  getAbstractFileByPath: (path: string) => unknown;
  setConfig: (name: string, value: unknown) => void;
}

interface Workspace {
  getLeaf: (shouldCreateNewLeaf: boolean) => Leaf;
  getMostRecentLeaf: () => Leaf | null;
}

// Small enough that one eval stays well under the 30-second cap of an eval, on a busy machine too.
const BATCH_SIZE = 10;
const here = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    'obsidian-version': { type: 'string' },
    'out-dir': { type: 'string' }
  }
});
const obsidianVersion = values['obsidian-version'];

function readExamples(suite: SpecOracleExample['suite'], fileName: string): SpecOracleExample[] {
  const examples = JSON.parse(readFileSync(join(here, '..', 'spec', fileName), 'utf-8')) as SpecExample[];
  return examples
    .filter((example) => suite === 'commonmark' || example.extensions !== undefined)
    .map((example) => ({ example: example.example, html: example.html, markdown: example.markdown, section: example.section, suite }));
}

const examples = [...readExamples('commonmark', 'commonmark-0.31.2.json'), ...readExamples('gfm', 'gfm-0.29.0.gfm.13.json')];

const oitPath = join(execSync('npm root -g').toString().trim(), 'obsidian-integration-testing/dist/lib/esm/index.mjs');
// eslint-disable-next-line no-restricted-syntax -- obsidian-integration-testing is installed globally, so its path is only known at run time.
const oit = await import(pathToFileURL(oitPath).href) as OitModule;

// The connection is disposed by hand: `await using` needs a tslib helper this repo does not install.
const conn = await oit.connectToCdp(obsidianVersion === undefined ? {} : { obsidianVersion });
try {
  const meta = await conn.evalInObsidian({
    callback: async ({ app }) => {
      // `@codemirror/language` is only reachable through the module map Obsidian hands to plugins.
      const pluginDirectory = '.obsidian/plugins/oracle-cm-language';
      await app.vault.adapter.mkdir(pluginDirectory);
      await app.vault.adapter.write(`${pluginDirectory}/manifest.json`, JSON.stringify({ author: 'oracle', description: 'oracle', id: 'oracle-cm-language', minAppVersion: '1.0.0', name: 'oracle', version: '0.0.1' }));
      await app.vault.adapter.write(`${pluginDirectory}/main.js`, 'const { Plugin } = require(\'obsidian\');\nmodule.exports = class extends Plugin { onload() { window.__oracleCmLanguage = require(\'@codemirror/language\'); } };\n');
      await app.plugins.setEnable(true);
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin('oracle-cm-language');
      if (!await app.vault.adapter.exists('oracle.md')) {
        await app.vault.create('oracle.md', '');
      }
      const { electron } = globalThis as ElectronGlobal & typeof globalThis;
      return { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent };
    }
  });

  const results: SpecOracleRead[] = [];
  for (let start = 0; start < examples.length; start += BATCH_SIZE) {
    const batch = examples.slice(start, start + BATCH_SIZE);
    const out = await conn.evalInObsidian({
      callback: async ({ app, docs, obsidianModule }) => {
        const MAX_READS = 20;
        const SETTLE_MS = 30;
        const PARSE_TIMEOUT_MS = 10_000;
        const language = (globalThis as OracleGlobal & typeof globalThis).__oracleCmLanguage;
        const file = app.vault.getAbstractFileByPath('oracle.md');
        const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
        await leaf.setViewState({ state: { file: (file as AbstractFile).path, mode: 'source', source: true }, type: 'markdown' });
        async function sleep(ms: number): Promise<void> {
          await new Promise((resolve) => {
            globalThis.setTimeout(resolve, ms);
          });
        }
        function readOnce(): RawNode[] {
          const state = leaf.view.editor.cm.state as EditorState;
          const tree = language.ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
          const nodes: RawNode[] = [];
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
                return nodes;
              }
              depth--;
            }
          }
        }
        async function readEditor(text: string): Promise<EditorRead> {
          leaf.view.editor.setValue(text);
          let last = JSON.stringify(readOnce());
          // Re-read until the tree stops changing: a lazily loaded sub-mode re-highlights after the first read.
          for (let reads = 1; reads < MAX_READS; reads++) {
            await sleep(SETTLE_MS);
            const next = JSON.stringify(readOnce());
            if (next === last) {
              break;
            }
            last = next;
          }
          return { nodes: JSON.parse(last) as RawNode[], text: (leaf.view.editor.cm.state as EditorState).doc.toString() };
        }
        /*
         * Takes off what the reading view adds to the HTML the parser made: the copy button and the syntax highlighting
         * of code blocks, the attributes it puts on headings, links and blocks, and the classes of internal and external
         * links. Link targets are compared decoded, since the spec percent-encodes them and the reading view does not,
         * and every element's attributes are put in name order.
         */
        // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback runs inside Obsidian, which sees nothing outside it.
        function normalize(element: HTMLElement): string {
          const DROPPED_ATTRIBUTES = ['aria-label', 'data-heading', 'data-href', 'data-tooltip-position', 'dir', 'referrerpolicy', 'rel', 'target'];
          const DROPPED_CLASSES = ['external-link', 'internal-link', 'is-loaded', 'language-none'];
          const buttons = element.querySelectorAll(':scope button.copy-code-button');
          for (const button of buttons) {
            button.remove();
          }
          // An image whose target is no URL becomes an embed of a vault file: it is put back as the image it was.
          const embeds = element.querySelectorAll(':scope span.internal-embed');
          for (const embed of embeds) {
            const image = document.createElement('img');
            for (const name of ['alt', 'src']) {
              const value = embed.getAttribute(name);
              if (value !== null) {
                image.setAttribute(name, value);
              }
            }
            embed.replaceWith(image);
          }
          const codes = element.querySelectorAll(':scope pre > code');
          for (const code of codes) {
            const text = code.textContent;
            code.textContent = text;
            code.parentElement?.removeAttribute('class');
          }
          const nodes = element.querySelectorAll(':scope *');
          for (const node of nodes) {
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
        async function render(text: string, isStrict: boolean): Promise<string> {
          app.vault.setConfig('strictLineBreaks', isStrict);
          const element = document.createElement('div');
          const component = new obsidianModule.Component();
          component.load();
          await obsidianModule.MarkdownRenderer.render(app, text, element, 'oracle.md', component);
          await sleep(SETTLE_MS);
          const html = normalize(element);
          component.unload();
          return html;
        }
        // The spec's HTML goes through the same DOM, so both sides are serialized the same way.
        function domHtml(html: string): string {
          const element = document.createElement('div');
          element.innerHTML = html;
          return normalize(element);
        }
        const reads = [];
        for (const { markdown: text, specHtml } of docs) {
          const editor = await readEditor(text);
          const metadata = await app.metadataCache.computeMetadataAsync(new TextEncoder().encode(text).buffer);
          const html = await render(text, false);
          const htmlStrict = await render(text, true);
          reads.push({ editor, html, htmlStrict, metadata, specDom: domHtml(specHtml) });
        }
        app.vault.setConfig('strictLineBreaks', false);
        return reads;
      },
      input: { docs: batch.map((example) => ({ markdown: example.markdown, specHtml: example.html })) }
    });
    for (const [index, example] of batch.entries()) {
      const read = out[index];
      if (!read) {
        throw new Error(`No oracle result for ${example.suite} ${String(example.example)}`);
      }
      results.push({
        ...example,
        editorNodes: read.editor.nodes,
        html: read.html,
        htmlStrict: read.htmlStrict,
        metadata: read.metadata,
        specDom: read.specDom,
        specHtml: example.html,
        ...(read.editor.text !== example.markdown && { editorText: read.editor.text })
      });
    }
    process.stderr.write(`spec-oracle: ${String(results.length)}/${String(examples.length)}\n`);
  }

  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const version = meta.appVersion ?? 'unknown';
  const outFile = join(outDirectory, `spec-obsidian-${version}.json`);
  const oracleFile: SpecOracleFile = { examples: results, meta };
  writeFileSync(outFile, `${JSON.stringify(oracleFile)}\n`);
  // The repository's dprint check covers `oracle/`, and its layout is not `JSON.stringify`'s.
  await format({ paths: [outFile] });
  console.log(`spec-oracle: ${String(results.length)} examples written to ${outFile}`);
} finally {
  await conn[Symbol.asyncDispose]();
}
