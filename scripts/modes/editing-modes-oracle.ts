/**
 * @file
 *
 * The editing mode oracle: runs every document of `editingModesDocuments()` (`src/oracle/modes/editing-modes.ts`) through an
 * owned Obsidian instance driven over CDP (`scripts/capture/obsidian-reads.ts`), and writes its editor's tree, Source mode's,
 * Live Preview's and the reading view's DOM and its metadata worker's `CachedMetadata` to
 * `oracle/editing-modes-obsidian-<version>.json`.
 *
 * Usage: `jiti scripts/modes/editing-modes-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
 * Add `--checkpoint <file>` to save each completed read, `--resume <file>` to continue one, and
 * `--max-documents <count>` to capture a bounded batch without writing an incomplete final oracle.
 */

import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/dprint';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type {
  EditingModesFile,
  EditingModesRead
} from '../../src/oracle/modes/editing-modes.ts';

import { validateEditingModesCheckpoint } from '../../src/oracle/modes/editing-modes-checkpoint.ts';
import { editingModesDocuments } from '../../src/oracle/modes/editing-modes.ts';
import { connectObsidianReader } from '../capture/obsidian-reads.ts';

const JSON_INDENT = 2;
const PROGRESS_EVERY = 50;
const here = join(dirname(fileURLToPath(import.meta.url)), '..');

await main();

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'checkpoint': { type: 'string' },
      'max-documents': { type: 'string' },
      'obsidian-version': { type: 'string' },
      'out-dir': { type: 'string' },
      'resume': { type: 'string' }
    }
  });

  const checkpointPath = values.checkpoint ?? values.resume;
  const maxDocuments = values['max-documents'] === undefined ? Infinity : Number(values['max-documents']);
  if (values['max-documents'] !== undefined && (checkpointPath === undefined || maxDocuments <= 0 || !Number.isSafeInteger(maxDocuments))) {
    throw new Error('--max-documents requires a positive integer and --checkpoint or --resume');
  }
  const saved = values.resume === undefined ? undefined : JSON.parse(readFileSync(values.resume, 'utf-8')) as EditingModesFile;

  const reader = await connectObsidianReader(values['obsidian-version'], 'editing-modes.md');

  try {
    const documents = editingModesDocuments();
    const reads: EditingModesRead[] = saved === undefined ? [] : [...validateEditingModesCheckpoint({ checkpoint: saved, documents, meta: reader.meta })];
    // Sub-modes learn from their first reads. Restore that initialization order without repeating the DOM settling.
    for (const document of documents.slice(0, reads.length)) {
      const tree = await reader.readUntilStable(document.markdown);
      if (tree.text !== document.markdown) {
        throw new Error(`The editor rewrote checkpoint document ${document.id}`);
      }
    }
    const end = Math.min(documents.length, reads.length + maxDocuments);
    console.log(`editing-modes-oracle: resuming at ${String(reads.length)} of ${String(documents.length)}`);
    for (const document of documents.slice(reads.length, end)) {
      const tree = await reader.readUntilStable(document.markdown);
      if (tree.text !== document.markdown) {
        throw new Error(`The editor rewrote ${JSON.stringify(document.markdown)} to ${JSON.stringify(tree.text)}`);
      }
      const rendered = await reader.readRendered(document.markdown);
      const editingModes = await reader.readEditingModes(document.markdown);
      reads.push({ ...document, html: rendered.html, metadata: rendered.metadata, nodes: tree.nodes, ...editingModes });
      if (checkpointPath !== undefined) {
        mkdirSync(dirname(checkpointPath), { recursive: true });
        const temporaryPath = join(dirname(checkpointPath), `editing-modes-checkpoint-${String(process.pid)}.tmp`);
        writeFileSync(temporaryPath, `${JSON.stringify({ meta: reader.meta, reads })}\n`);
        renameSync(temporaryPath, checkpointPath);
      }
      if (reads.length % PROGRESS_EVERY === 0) {
        console.log(`editing-modes-oracle: ${String(reads.length)} of ${String(documents.length)}`);
      }
    }
    if (reads.length < documents.length) {
      console.log(`editing-modes-oracle: checkpoint saved at ${String(reads.length)} of ${String(documents.length)}; final oracle not written`);
      return;
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
}
