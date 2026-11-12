/**
 * @file
 *
 * The class-span oracle: reads the live editor's syntax tree for every corpus document from an owned Obsidian
 * instance driven over CDP (`obsidian-integration-testing`, installed globally), and writes it to
 * `oracle/obsidian-<version>-<seed>.json`.
 *
 * Node names in the editor's tree are its CSS class tokens joined by `_`: a node that spans a whole line carries the
 * line classes (rendered on `.cm-line`), its children the token classes (rendered as `cm-<token>`).
 *
 * The editor loads some sub-modes lazily (sTeX for math among them), so the script first opens a warm-up document
 * that uses every one of them, and it re-reads each document's tree until two reads agree.
 *
 * Usage: `jiti scripts/capture/oracle.ts [--per-set 300] [--seed 12345] [--obsidian-version <version>] [--out-dir <directory>]`.
 */

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
  OracleDocument,
  OracleFile
} from '../../src/oracle/oracle-file.ts';

import { buildCorpus } from '../../src/oracle/classes/corpus.ts';

interface AbstractFile {
  readonly path: string;
}

interface App {
  readonly plugins: Plugins;
  readonly vault: Vault;
  readonly workspace: Workspace;
}

interface CdpConnection extends AsyncDisposable {
  readonly evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
}

interface CmLanguage {
  readonly ensureSyntaxTree: (state: EditorState, upto: number, timeout: number) => SyntaxTree;
}

interface CodeMirrorEditor {
  readonly state: unknown;
}

interface ConnectToCdpOptions {
  readonly obsidianVersion?: string;
}

interface DataAdapter {
  readonly exists: (path: string) => Promise<boolean>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly write: (path: string, data: string) => Promise<void>;
}

interface Editor {
  readonly cm: CodeMirrorEditor;
  readonly setValue: (text: string) => void;
}

interface EditorState {
  // eslint-disable-next-line unicorn/name-replacements -- CodeMirror's `EditorState` names its text `doc`.
  readonly doc: EditorText;
}

interface EditorText {
  readonly length: number;
  readonly toString: () => string;
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

interface IpcRenderer {
  readonly sendSync?: (channel: string) => string;
}

interface Leaf {
  readonly setViewState: (state: unknown) => Promise<void>;
  readonly view: MarkdownView;
}

interface MarkdownView {
  readonly editor: Editor;
}

interface NodeType {
  readonly name: string;
}

interface ObsidianGlobals {
  readonly app: App;
}

interface OitModule {
  readonly connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface OracleGlobal {
  readonly __oracleCmLanguage: CmLanguage;
}

interface Plugins {
  readonly enablePlugin: (id: string) => Promise<void>;
  readonly loadManifests: () => Promise<void>;
  readonly setEnable: (isEnabled: boolean) => Promise<void>;
}

type RawNode = [from: number, to: number, depth: number, name: string];

interface ReadResult extends TreeRead {
  readonly reads: number;
}

interface SyntaxTree {
  readonly cursor: () => TreeCursor;
}

interface TreeCursor {
  readonly firstChild: () => boolean;
  readonly from: number;
  readonly nextSibling: () => boolean;
  readonly parent: () => boolean;
  readonly to: number;
  readonly type: NodeType;
}

interface TreeRead {
  readonly nodes: RawNode[];
  readonly text: string;
}

interface Vault {
  readonly adapter: DataAdapter;
  readonly create: (path: string, data: string) => Promise<unknown>;
  readonly getAbstractFileByPath: (path: string) => unknown;
}

interface Workspace {
  readonly getLeaf: (shouldCreateNewLeaf: boolean) => Leaf;
  readonly getMostRecentLeaf: () => Leaf | null;
}

const MAX_READS = 20;
const MAX_CAPPED_ATTEMPTS = 3;
const SETTLE_MS = 30;
const PARSE_TIMEOUT_MS = 10_000;
const PROGRESS_EVERY = 250;
const here = join(dirname(fileURLToPath(import.meta.url)), '..');

// Obsidian-integration-testing's error for an eval its cap killed, known by name: the global install is not typed here.
function isEvalCapExceeded(error: unknown): boolean {
  return error instanceof Error && (error.name === 'EvalCapExceededError' || error.constructor.name === 'EvalCapExceededError');
}

const { values } = parseArgs({
  options: {
    'obsidian-version': { type: 'string' },
    'out-dir': { type: 'string' },
    'per-set': { default: '300', type: 'string' },
    'seed': { default: '12345', type: 'string' }
  }
});
const perSet = Number(values['per-set']);
const seed = Number(values.seed);
const obsidianVersion = values['obsidian-version'];

const oitPath = join(execSync('npm root -g').toString().trim(), 'obsidian-integration-testing/dist/lib/esm/index.mjs');
// eslint-disable-next-line no-restricted-syntax -- obsidian-integration-testing is installed globally, so its path is only known at run time.
const oit = await import(pathToFileURL(oitPath).href) as OitModule;

const corpus = buildCorpus({ perSet, seed });
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

  const WARM_UP_LANGUAGES = ['js', 'ts', 'python', 'css', 'html', 'json', 'yaml', 'bash', 'sql', 'java', 'c', 'cpp', 'csharp', 'rust', 'go', 'diff', 'markdown', 'xml', 'php', 'ruby'];
  const WARM_UP = [
    '---\na: 1\n---\n$x$ and $$y$$\n$$\n\\frac{a}{b}\n$$\n<div class="a">b</div>\n',
    ...WARM_UP_LANGUAGES.map((language) => `\`\`\`${language}\na = 1;\n\`\`\`\n`),
    '%% c %%\n'
  ].join('');

  await conn.evalInObsidian({
    callback: async ({ app }) => {
      const file = app.vault.getAbstractFileByPath('oracle.md');
      const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
      await leaf.setViewState({ state: { file: (file as AbstractFile).path, mode: 'source', source: true }, type: 'markdown' });
    }
  });

  /*
   * One read of the editor's tree, after giving it `text` when there is one. On a loaded machine a starved renderer can
   * hold one read past the eval cap, which kills that eval and leaves the app running, so the read is made again: it sets
   * the same text, so a retried read gives what the first would have.
   */
  async function readTree(text: null | string): Promise<string> {
    for (let attempt = 1;; attempt++) {
      try {
        return await readTreeOnce(text);
      } catch (error) {
        if (attempt >= MAX_CAPPED_ATTEMPTS || !isEvalCapExceeded(error)) {
          throw error;
        }
        process.stderr.write(`oracle: a read ran past the eval cap, reading again (attempt ${String(attempt + 1)} of ${String(MAX_CAPPED_ATTEMPTS)})\n`);
      }
    }
  }

  async function readTreeOnce(text: null | string): Promise<string> {
    return conn.evalInObsidian({
      callback: ({ app, parseTimeout, text: newText }) => {
        const language = (globalThis as OracleGlobal & typeof globalThis).__oracleCmLanguage;
        const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
        if (newText !== null) {
          leaf.view.editor.setValue(newText);
        }
        const state = leaf.view.editor.cm.state as EditorState;
        const tree = language.ensureSyntaxTree(state, state.doc.length, parseTimeout);
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
              return JSON.stringify({ nodes, text: state.doc.toString() });
            }
            depth--;
          }
        }
      },
      input: { parseTimeout: PARSE_TIMEOUT_MS, text }
    });
  }

  /*
   * Re-reads until the tree stops changing: a lazily loaded sub-mode re-highlights after the first read. The wait between
   * reads is Node's: a renderer whose window is not in front throttles its own timers to a second or more, which once
   * held a batch of reads past the 30-second cap of an eval.
   */
  async function readUntilStable(text: string): Promise<ReadResult> {
    let last = await readTree(text);
    let reads = 1;
    for (; reads < MAX_READS; reads++) {
      await new Promise((resolve) => {
        setTimeout(resolve, SETTLE_MS);
      });
      const next = await readTree(null);
      if (next === last) {
        break;
      }
      last = next;
    }
    return { ...(JSON.parse(last) as TreeRead), reads };
  }

  const warmUp = await readUntilStable(WARM_UP);
  process.stderr.write(`oracle: warm-up read ${String(warmUp.reads)} time(s)\n`);
  const results: OracleDocument[] = [];
  for (const document of corpus) {
    const read = await readUntilStable(document.text);
    // The editor may rewrite the text it is given (ordered-list renumbering): `text` is what it parsed.
    results.push({ ...document, nodes: read.nodes, ...(read.text !== document.text && { original: document.text, text: read.text }) });
    if (results.length % PROGRESS_EVERY === 0 || results.length === corpus.length) {
      process.stderr.write(`oracle: ${String(results.length)}/${String(corpus.length)}\n`);
    }
  }

  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const version = meta.appVersion ?? 'unknown';
  const outFile = join(outDirectory, `obsidian-${version}-seed-${String(seed)}.json`);
  const oracleFile: OracleFile = { docs: results, meta: { ...meta, perSet, seed } };
  writeFileSync(outFile, `${JSON.stringify(oracleFile)}\n`);
  // The repository's dprint check covers `oracle/`, and its layout is not `JSON.stringify`'s.
  await format({ paths: [outFile] });
  console.log(`oracle: ${String(results.length)} docs written to ${outFile}`);
} finally {
  await conn[Symbol.asyncDispose]();
}
