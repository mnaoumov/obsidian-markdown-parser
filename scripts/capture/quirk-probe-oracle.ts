/**
 * @file
 *
 * The quirk probe oracle: runs every document of `QUIRK_PROBES` (`src/oracle/spec/quirk-probes.ts`) through an owned
 * Obsidian instance driven over CDP (`obsidian-integration-testing`, installed globally), and writes its reading view's
 * DOM, with `strictLineBreaks: true`, and its metadata worker's sections to `oracle/quirk-probes-obsidian-<version>.json`.
 * The DOM is normalized as `scripts/capture/spec-oracle.ts` normalizes it.
 *
 * Usage: `jiti scripts/capture/quirk-probe-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 */

/// <reference lib="dom.iterable" />

import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/dprint';
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
  QuirkProbeFile,
  QuirkProbeRead
} from '../../src/oracle/spec/quirk-probes.ts';
import type { SpecOracleMeta } from '../../src/oracle/spec/spec-oracle-file.ts';

import { QUIRK_PROBES } from '../../src/oracle/spec/quirk-probes.ts';

interface App {
  readonly metadataCache: MetadataCache;
  readonly vault: Vault;
  readonly workspace: Workspace;
}

interface CachedMetadataSection {
  readonly position: SectionPosition;
  readonly type: string;
}

interface CachedMetadataSections {
  readonly sections?: readonly CachedMetadataSection[];
}

interface CdpConnection extends AsyncDisposable {
  readonly evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result>) => Promise<Result>;
}

interface Component {
  readonly load: () => void;
  readonly unload: () => void;
}

interface ConnectToCdpOptions {
  readonly obsidianVersion?: string;
}

interface DataAdapter {
  readonly exists: (path: string) => Promise<boolean>;
}

interface Electron {
  readonly ipcRenderer?: IpcRenderer;
}

interface ElectronGlobal {
  readonly electron?: Electron;
}

interface EvalInObsidianParams<Input extends object, Result> {
  readonly callback: (input: Input & ObsidianGlobals) => Promise<Result>;
  readonly input?: Input;
}

interface IpcRenderer {
  readonly sendSync?: (channel: string) => string;
}

interface Leaf {
  readonly setViewState: (state: unknown) => Promise<void>;
}

interface MarkdownRenderer {
  readonly render: (app: App, markdown: string, element: HTMLElement, sourcePath: string, component: Component) => Promise<void>;
}

interface MetadataCache {
  readonly computeMetadataAsync: (data: ArrayBuffer) => Promise<unknown>;
}

interface ObsidianGlobals {
  readonly app: App;
  readonly obsidianModule: ObsidianModule;
}

interface ObsidianModule {
  readonly Component: new () => Component;
  readonly MarkdownRenderer: MarkdownRenderer;
}

interface OitModule {
  readonly connectToCdp: (options: ConnectToCdpOptions) => Promise<CdpConnection>;
}

interface ProbeBatch {
  readonly meta: SpecOracleMeta;
  readonly reads: readonly ProbeRead[];
}

interface ProbeRead {
  readonly html: string;
  readonly sections: readonly string[];
}

interface SectionPoint {
  readonly line: number;
}

interface SectionPosition {
  readonly end: SectionPoint;
  readonly start: SectionPoint;
}

interface Vault {
  readonly adapter: DataAdapter;
  readonly create: (path: string, data: string) => Promise<unknown>;
  readonly setConfig: (name: string, value: unknown) => void;
}

interface Workspace {
  readonly getLeaf: (shouldCreateNewLeaf: boolean) => Leaf;
  readonly getMostRecentLeaf: () => Leaf | null;
}

const BATCH_SIZE = 40;
const JSON_INDENT = 2;
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

async function readProbes(markdowns: readonly string[]): Promise<ProbeBatch> {
  return await conn.evalInObsidian({
    callback: async ({ app, docs, obsidianModule }) => {
      const SETTLE_MS = 30;
      async function sleep(ms: number): Promise<void> {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });
      }
      // As `scripts/capture/spec-oracle.ts` normalizes the reading view's DOM.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback runs inside Obsidian, which sees nothing outside it.
      function normalize(element: HTMLElement): string {
        const DROPPED_ATTRIBUTES = ['aria-label', 'data-heading', 'data-href', 'data-tooltip-position', 'dir', 'referrerpolicy', 'rel', 'target'];
        const DROPPED_CLASSES = ['external-link', 'internal-link', 'is-loaded', 'language-none'];
        for (const button of element.querySelectorAll(':scope button.copy-code-button')) {
          button.remove();
        }
        for (const code of element.querySelectorAll(':scope pre > code')) {
          const text = code.textContent;
          code.textContent = text;
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
      async function render(text: string, isStrict: boolean): Promise<string> {
        app.vault.setConfig('strictLineBreaks', isStrict);
        const element = document.createElement('div');
        const component = new obsidianModule.Component();
        component.load();
        await obsidianModule.MarkdownRenderer.render(app, text, element, 'probe.md', component);
        await sleep(SETTLE_MS);
        const html = normalize(element);
        component.unload();
        return html;
      }
      // The reading view reads `strictLineBreaks` only once a markdown view is open.
      if (!await app.vault.adapter.exists('probe.md')) {
        await app.vault.create('probe.md', '');
      }
      const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
      await leaf.setViewState({ state: { file: 'probe.md', mode: 'source', source: true }, type: 'markdown' });
      const reads: ProbeRead[] = [];
      for (const text of docs) {
        // As `scripts/capture/spec-oracle.ts` reads it: with the app's default first, then with `strictLineBreaks: true`.
        await render(text, false);
        const html = await render(text, true);
        const metadata = await app.metadataCache.computeMetadataAsync(new TextEncoder().encode(text).buffer) as CachedMetadataSections | null;
        const sections = (metadata?.sections ?? []).map((section) => `${section.type}@${String(section.position.start.line)}-${String(section.position.end.line)}`);
        reads.push({ html, sections });
      }
      app.vault.setConfig('strictLineBreaks', false);
      const { electron } = globalThis as ElectronGlobal & typeof globalThis;
      return { meta: { appVersion: electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent }, reads };
    },
    input: { docs: markdowns }
  });
}

try {
  // In batches, since one eval may run for only 30 seconds.
  const reads: ProbeRead[] = [];
  let meta: SpecOracleMeta = { appVersion: null, userAgent: '' };
  for (let start = 0; start < QUIRK_PROBES.length; start += BATCH_SIZE) {
    const batch = await readProbes(QUIRK_PROBES.slice(start, start + BATCH_SIZE).map((probe) => probe.markdown));
    reads.push(...batch.reads);
    meta = batch.meta;
  }

  const probes: QuirkProbeRead[] = QUIRK_PROBES.map((probe, index) => {
    const read = reads[index];
    if (!read) {
      throw new Error(`No oracle result for probe ${String(index)}`);
    }
    return { ...probe, html: read.html, sections: read.sections };
  });
  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, `quirk-probes-obsidian-${meta.appVersion ?? 'unknown'}.json`);
  const oracleFile: QuirkProbeFile = { meta, probes };
  // Indented as dprint formats it.
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  // The repository's dprint check covers `oracle/`, and its layout matches `JSON.stringify`'s only by chance.
  await format({ paths: [outFile] });
  console.log(`quirk-probe-oracle: ${String(probes.length)} probes written to ${outFile}`);
} finally {
  await disposeAsync(conn);
}
