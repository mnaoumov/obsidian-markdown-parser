/**
 * @file
 *
 * The forum issue oracle: runs every document of `forumIssueDocuments()` (`src/oracle/forum-issues.ts`) through an owned
 * Obsidian instance driven over CDP (`scripts/obsidian-reads.ts`), and writes its editor's tree, its reading view's DOM
 * with `strictLineBreaks: true` and its metadata worker's `CachedMetadata` to `oracle/forum-issues-obsidian-<version>.json`.
 * For the samples where the editing modes and the reading view disagree it also reads Source mode's and Live Preview's
 * `.cm-content` as the user sees it.
 *
 * Usage: `jiti scripts/forum-issue-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]`.
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
  ForumIssueFile,
  ForumIssueRead
} from '../src/oracle/forum-issues.ts';

import {
  EDITOR_VS_READING_VIEW_SAMPLES,
  forumIssueDocuments
} from '../src/oracle/forum-issues.ts';
import { connectObsidianReader } from './obsidian-reads.ts';

const JSON_INDENT = 2;
const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    'obsidian-version': { type: 'string' },
    'out-dir': { type: 'string' }
  }
});

const reader = await connectObsidianReader(values['obsidian-version'], 'forum-issue.md');

try {
  const editingModeSamples = new Set(EDITOR_VS_READING_VIEW_SAMPLES.map((sample) => sample.markdown));
  const reads: ForumIssueRead[] = [];
  for (const markdown of forumIssueDocuments()) {
    const tree = await reader.readUntilStable(markdown);
    if (tree.text !== markdown) {
      throw new Error(`The editor rewrote ${JSON.stringify(markdown)} to ${JSON.stringify(tree.text)}`);
    }
    const rendered = await reader.readRendered(markdown);
    const editingModes = editingModeSamples.has(markdown) ? await reader.readEditingModes(markdown) : {};
    reads.push({ html: rendered.html, markdown, metadata: rendered.metadata, nodes: tree.nodes, ...editingModes });
  }
  const outDirectory = values['out-dir'] ?? join(here, '..', 'oracle');
  mkdirSync(outDirectory, { recursive: true });
  const outFile = join(outDirectory, `forum-issues-obsidian-${reader.meta.appVersion ?? 'unknown'}.json`);
  const oracleFile: ForumIssueFile = { meta: reader.meta, reads };
  writeFileSync(outFile, `${JSON.stringify(oracleFile, null, JSON_INDENT)}\n`);
  // The repository's dprint check covers `oracle/`, and its layout matches `JSON.stringify`'s only by chance.
  await format({ paths: [outFile] });
  console.log(`forum-issue-oracle: ${String(reads.length)} documents written to ${outFile}`);
} finally {
  await reader.dispose();
}
