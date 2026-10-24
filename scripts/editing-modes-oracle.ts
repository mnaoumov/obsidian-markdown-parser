/**
 * @file
 *
 * The editing mode oracle: runs every document of `editingModesDocuments()` (`src/oracle/editing-modes.ts`) through an
 * owned Obsidian instance driven over CDP (`scripts/obsidian-reads.ts`), and writes its editor's tree, Source mode's,
 * Live Preview's and the reading view's DOM and its metadata worker's `CachedMetadata` to
 * `oracle/editing-modes-obsidian-<version>.json`.
 *
 * Usage: `jiti scripts/editing-modes-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 */

import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/dprint';
import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type {
  EditingModesFile,
  EditingModesRead
} from '../src/oracle/editing-modes.ts';

import { editingModesDocuments } from '../src/oracle/editing-modes.ts';
import { connectObsidianReader } from './obsidian-reads.ts';

const JSON_INDENT = 2;
const PROGRESS_EVERY = 50;
const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    'obsidian-version': { type: 'string' },
    'out-dir': { type: 'string' }
  }
});

const reader = await connectObsidianReader(values['obsidian-version'], 'editing-modes.md');

try {
  const documents = editingModesDocuments();
  const reads: EditingModesRead[] = [];
  for (const document of documents) {
    const tree = await reader.readUntilStable(document.markdown);
    if (tree.text !== document.markdown) {
      throw new Error(`The editor rewrote ${JSON.stringify(document.markdown)} to ${JSON.stringify(tree.text)}`);
    }
    const rendered = await reader.readRendered(document.markdown);
    const editingModes = await reader.readEditingModes(document.markdown);
    reads.push({ ...document, html: rendered.html, metadata: rendered.metadata, nodes: tree.nodes, ...editingModes });
    if (reads.length % PROGRESS_EVERY === 0) {
      console.log(`editing-modes-oracle: ${String(reads.length)} of ${String(documents.length)}`);
    }
  }
  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, `editing-modes-obsidian-${reader.meta.appVersion ?? 'unknown'}.json`);
  const oracleFile: EditingModesFile = { meta: reader.meta, reads };
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  // The repository's dprint check covers `oracle/`, and its layout matches `JSON.stringify`'s only by chance.
  await format({ paths: [outFile] });
  console.log(`editing-modes-oracle: ${String(reads.length)} documents written to ${outFile}`);
} finally {
  await reader.dispose();
}
