// Phase 0 class-span oracle: reads the live editor's syntax tree for every corpus document, in Source mode
// and in Live Preview, from an owned Obsidian instance driven over CDP (obsidian-integration-testing).
//
// Node names in the editor's tree are its CSS class tokens joined by `_`: a node that spans a whole line
// carries the line classes (rendered on `.cm-line`), its children the token classes (rendered as `cm-<token>`).
//
// usage: node phase0/oracle.mjs [perSet=300] [obsidianVersion]
// output: phase0/out/oracle.json

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

import { buildCorpus } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const perSet = Number(process.argv[2] ?? 300);
const obsidianVersion = process.argv[3];
const oit = pathToFileURL(join(execSync('npm root -g').toString().trim(), 'obsidian-integration-testing/dist/lib/esm/index.mjs')).href;
const { connectToCdp } = await import(oit);

const corpus = buildCorpus({ perSet });
await using conn = await connectToCdp(obsidianVersion ? { obsidianVersion } : {});

const meta = await conn.evalInObsidian({
  callback: async ({ app }) => {
    // `@codemirror/language` is only reachable through the module map Obsidian hands to plugins.
    const dir = '.obsidian/plugins/phase0-cm-language';
    await app.vault.adapter.mkdir(dir);
    await app.vault.adapter.write(`${dir}/manifest.json`, JSON.stringify({ author: 'phase0', description: 'phase0', id: 'phase0-cm-language', minAppVersion: '1.0.0', name: 'phase0', version: '0.0.1' }));
    await app.vault.adapter.write(`${dir}/main.js`, 'const { Plugin } = require(\'obsidian\');\nmodule.exports = class extends Plugin { onload() { window.__phase0CmLanguage = require(\'@codemirror/language\'); } };\n');
    await app.plugins.setEnable(true);
    await app.plugins.loadManifests();
    await app.plugins.enablePlugin('phase0-cm-language');
    await app.vault.create('phase0.md', '');
    return { appVersion: window.electron?.ipcRenderer?.sendSync?.('version') ?? null, userAgent: navigator.userAgent };
  }
});

const results = [];
const batchSize = 50;
for (let start = 0; start < corpus.length; start += batchSize) {
  const batch = corpus.slice(start, start + batchSize);
  const out = await conn.evalInObsidian({
    input: { docs: batch.map((d) => d.text) },
    callback: async ({ app, docs }) => {
      const L = window.__phase0CmLanguage;
      const file = app.vault.getAbstractFileByPath('phase0.md');
      const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
      const read = async (mode, text) => {
        await leaf.setViewState({ state: { file: file.path, mode: 'source', source: mode === 'source' }, type: 'markdown' });
        const editor = leaf.view.editor;
        editor.setValue(text);
        // The editor may rewrite the text it is given (ordered-list renumbering); the oracle keeps what it parsed.
        const state = editor.cm.state;
        const tree = L.ensureSyntaxTree(state, state.doc.length, 10_000);
        const nodes = [];
        const cursor = tree.cursor();
        let depth = 0;
        // Pre-order walk with depth; the root (Document) is skipped.
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
              return { nodes, text: state.doc.toString() };
            }
            depth--;
          }
        }
      };
      const res = [];
      for (const text of docs) {
        const source = await read('source', text);
        const preview = await read('preview', text);
        const same = JSON.stringify(preview) === JSON.stringify(source);
        res.push({ edited: source.text === text ? undefined : source.text, preview: same ? 'same' : preview.nodes, previewText: same || preview.text === source.text ? undefined : preview.text, source: source.nodes });
      }
      return res;
    }
  });
  for (let i = 0; i < batch.length; i++) {
    // The editor may rewrite the text it is given (ordered-list renumbering): `text` is what it parsed.
    const { edited, ...rest } = out[i];
    results.push({ ...batch[i], ...rest, ...(edited === undefined ? {} : { original: batch[i].text, text: edited }) });
  }
  process.stderr.write(`oracle: ${results.length}/${corpus.length}\n`);
}

mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(join(here, 'out', 'oracle.json'), JSON.stringify({ docs: results, meta, perSet }));
const differing = results.filter((r) => r.preview !== 'same').length;
console.log(`oracle: ${results.length} docs, Source mode and Live Preview trees differ on ${differing}`);
