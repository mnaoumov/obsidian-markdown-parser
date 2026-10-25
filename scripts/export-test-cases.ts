/**
 * @file
 *
 * Writes the pinned oracles as plain JSON test cases another project can keep next to its own tests
 * (`src/oracle/test-case-export.ts`): the CommonMark and GFM spec examples, each as an `-all` file and a `-failing` one
 * with the examples Obsidian departs on, the quirk probes Obsidian departs from a reference implementation on
 * (`commonmark-no-spec-failing.json`, `gfm-no-spec-failing.json`), the metadata worker documents as
 * `metadata-cache-all.json` and `metadata-cache-failing.json` with the forum issues' samples, the editing mode oracle's
 * `live-preview-and-source-mode-vs-reading-view-all.json` and the forum issues' and judged samples'
 * `live-preview-and-source-mode-vs-reading-view-failing.json`, and a `README.md` that describes them. Nothing of this
 * repository's code goes into the folder.
 *
 * It empties the folder first, so a file an earlier export wrote under another name cannot linger beside its successor.
 * It refuses to when the folder holds anything an export does not write: a subfolder, or a file other than `*.json`
 * and `README.md`.
 *
 * Usage: `jiti scripts/export-test-cases.ts [--out <directory>]`. The folder defaults to `dist/test-cases`.
 */

import {
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { EditingModesFile } from '../src/oracle/editing-modes.ts';
import type { ForumIssueFile } from '../src/oracle/forum-issues.ts';
import type { QuirkProbeFile } from '../src/oracle/quirk-probes.ts';
import type { GfmReferenceFile } from '../src/oracle/reference-html.ts';
import type { SpecOracleFile } from '../src/oracle/spec-oracle-file.ts';
import type { TestCaseSuite } from '../src/oracle/test-case-export.ts';
import type { WorkerMetadataOracleFile } from '../src/oracle/worker-metadata.ts';

import {
  editingModesOracleFileName,
  forumIssueOracleFileName,
  PINNED_ORACLE_DIRECTORY,
  quirkProbeOracleFileName,
  readOracleFile,
  specOracleFileName,
  workerMetadataOracleFileName
} from '../src/oracle/oracle-location.ts';
import { GFM_REFERENCE_FILE_NAME } from '../src/oracle/reference-html.ts';
import { buildTestCaseSuites } from '../src/oracle/test-case-export.ts';

const JSON_INDENT = 2;
const DEFAULT_OUT = join('dist', 'test-cases');
const README = 'README.md';

// Empties the export folder, after checking that it holds only what an export writes.
function clearOut(out: string): void {
  mkdirSync(out, { recursive: true });
  const entries = readdirSync(out, { withFileTypes: true });
  const foreign = entries.filter((entry) => !entry.isFile() || !(entry.name.endsWith('.json') || entry.name === README));
  if (foreign.length > 0) {
    throw new Error(`Refusing to empty ${out}: it holds ${foreign.map((entry) => entry.name).join(', ')}, which no export writes`);
  }
  for (const entry of entries) {
    rmSync(join(out, entry.name));
  }
}

function main(): void {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const out = values.out ?? DEFAULT_OUT;
  const suites = buildTestCaseSuites(
    readOracleFile(specOracleFileName()) as SpecOracleFile,
    readOracleFile(quirkProbeOracleFileName()) as QuirkProbeFile,
    readOracleFile(workerMetadataOracleFileName()) as WorkerMetadataOracleFile,
    readOracleFile(forumIssueOracleFileName()) as ForumIssueFile,
    readOracleFile(GFM_REFERENCE_FILE_NAME, PINNED_ORACLE_DIRECTORY) as GfmReferenceFile,
    readOracleFile(editingModesOracleFileName()) as EditingModesFile
  );
  clearOut(out);
  const files: [string, TestCaseSuite<unknown>][] = [
    ['commonmark-spec-0.31.2-all.json', suites.commonmark],
    ['commonmark-spec-0.31.2-failing.json', suites.commonmarkFailing],
    ['gfm-spec-0.29.0.gfm.13-all.json', suites.gfm],
    ['gfm-spec-0.29.0.gfm.13-failing.json', suites.gfmFailing],
    ['commonmark-no-spec-failing.json', suites.commonmarkNoSpecFailing],
    ['gfm-no-spec-failing.json', suites.gfmNoSpecFailing],
    ['metadata-cache-all.json', suites.metadata],
    ['metadata-cache-failing.json', suites.metadataFailing],
    ['live-preview-and-source-mode-vs-reading-view-all.json', suites.livePreviewAndSourceModeVsReadingViewAll],
    ['live-preview-and-source-mode-vs-reading-view-failing.json', suites.livePreviewAndSourceModeVsReadingView]
  ];
  for (const [name, suite] of files) {
    writeFileSync(join(out, name), `${JSON.stringify(suite, null, JSON_INDENT)}\n`);
    console.log(`${String(suite.cases.length)} cases written to ${join(out, name)}`);
  }
  writeFileSync(join(out, README), readme(suites.commonmark.obsidianVersion, files));
  console.log(`README written to ${join(out, README)}`);
}

function readme(obsidianVersion: string, files: readonly [string, TestCaseSuite<unknown>][]): string {
  const rows = files.map(([name, suite]) => `| \`${name}\` | ${String(suite.cases.length)} |`).join('\n');
  return `# Obsidian markdown test cases

Markdown documents with what Obsidian ${obsidianVersion} gives for each, read from the live app: the HTML of Reading view, the metadata worker's \`CachedMetadata\` and, for the editing mode files, the HTML of the two editing modes, Source mode and Live Preview. The spec cases also carry the CommonMark or GFM spec's HTML, and the no-spec cases a reference implementation's, so a test can expect either today's output or the standard's. Every value is the spec's, a reference implementation's or Obsidian's own output; no parser code comes with them.

| File | Cases |
| --- | --- |
${rows}

Each file is \`{ about, obsidianVersion, cases }\`, plus \`referenceImplementation\` in a no-spec file, and \`about\` says how its values were read. Every case has an \`id\` unique in its file, its \`markdown\` and the \`obsidianVersion\` it was read from.

**\`-all\` and \`-failing\`.** An \`-all\` file holds every case of its source. A \`-failing\` file holds only the cases on which Obsidian does not give the expected output, unchanged and under the same \`id\` as in the \`-all\` file where there is one, for a test that wants only the places Obsidian departs. Reading view's HTML is compared with the expected HTML after putting the expected HTML through a DOM, as the app's DOM serializes Reading view, and dropping whitespace between tags in both.

**\`-spec\` and \`-no-spec\`.** A \`-spec\` file holds the spec's own examples, and the expected HTML is the spec's. A \`-no-spec\` file holds documents beyond the spec's examples, probes written to show one of Obsidian's quirks, and their expected HTML comes from a reference implementation that passes its whole spec suite, named in \`referenceImplementation\`: [commonmark.js](https://github.com/commonmark/commonmark.js), the CommonMark reference implementation, which passes all 652 examples of CommonMark 0.31.2, and [cmark-gfm](https://github.com/github/cmark-gfm), the GFM spec's own implementation, which passes all 22 of its extension examples.

- \`commonmark-spec-0.31.2-all.json\` and \`gfm-spec-0.29.0.gfm.13-all.json\`: the examples of the CommonMark 0.31.2 spec and the extension examples of the GFM 0.29.0.gfm.13 spec. \`commonMarkSpecHtml\` is the spec's HTML, \`obsidianReadingViewHtml\` the reading view's with \`strictLineBreaks: true\`, \`obsidianReadingViewHtmlSoftBreaksAsHard\` the reading view's with the default \`strictLineBreaks: false\` where it differs, and \`metadata\` the worker's \`CachedMetadata\`. \`departures\` lists why the reading view differs from the spec, where it does, each with a \`kind\` (\`quirk\`, \`syntax\`, \`rendering\` or \`comparison\`), a \`name\` and the \`behaviour\`. The \`id\` is \`<suite>-<example number>\`.
- \`commonmark-spec-0.31.2-failing.json\` and \`gfm-spec-0.29.0.gfm.13-failing.json\`: the cases of the \`-all\` file whose \`obsidianReadingViewHtml\` differs from \`commonMarkSpecHtml\`. An example whose only departure is \`soft line breaks are hard\` is not in them: its \`obsidianReadingViewHtml\` matches the spec, and only \`obsidianReadingViewHtmlSoftBreaksAsHard\`, under the app's default, differs.
- \`commonmark-no-spec-failing.json\` and \`gfm-no-spec-failing.json\`: the quirk probes, CommonMark ones and GFM table and strikethrough ones, on which \`obsidianReadingViewHtml\` (\`strictLineBreaks: true\`) differs from \`referenceHtml\`, each with the \`quirk\`, a \`note\` on it and the worker's \`metadataSections\` (\`<type>@<first line>-<last line>\`, lines from 0). The \`id\` is \`<quirk>-<probe number>\`, counted over the probes of that quirk in both files, so the numbers of the probes that agree are missing.
- \`metadata-cache-all.json\`: documents and the worker's whole \`CachedMetadata\`, key order included, or \`null\` where the worker threw.
- \`metadata-cache-failing.json\`: notes whose metadata the worker drops or misplaces, each under the forum issue it was reported as (\`issue-1\` to \`issue-4\` of the summary, or \`issue-topic-<topic>\` for one reported after it, with its \`forumUrl\`). First every document of \`metadata-cache-all.json\` the worker threw on, under the same id, then the forum samples, \`<issue>-<sample>\`. Each has the worker's \`metadata\`, \`null\` where it threw, a \`note\` on what goes wrong, and \`expectedMetadata\` where what the note should give is clear, built from the worker's own output as the \`note\` says; the documents of the full file carry none, since no stand-in of them was read. The forum issues where the reading view departs from CommonMark are not repeated: they are spec examples, in the spec files.
- \`live-preview-and-source-mode-vs-reading-view-all.json\`: notes with all three of Obsidian's views, read as in the \`-failing\` file below: a sample of generated documents covering every piece set of the generator (\`set\` names it), and every case of the \`-failing\` file under the same \`id\`. It carries no judgement: on a generated document the views may agree or not.
- \`live-preview-and-source-mode-vs-reading-view-failing.json\`: notes that Source mode or Live Preview and Reading view read differently: those reported on the Obsidian forum, each with the \`issue\` and \`forumUrl\` it belongs to, and one for each kind of disagreement found by comparing the views across generated documents, \`issue: judged\` with its \`family\` and no \`forumUrl\`, each confirmed on the live editor. Each case has a one-sentence \`note\`, and all three modes as the user sees them: \`obsidianSourceModeHtml\` and \`obsidianLivePreviewHtml\`, the inner HTML of the editor's \`.cm-content\` in the default theme, and \`obsidianReadingViewHtml\` (\`strictLineBreaks: true\`), with the worker's \`metadata\`, which sides with Reading view. The editing modes were read once math had rendered, with the cursor on an empty line appended to the note, so that Live Preview shows no source for the selection; that line is left out of the HTML. \`differsIn\` lists the editing modes, \`sourceMode\` and \`livePreview\`, that disagree with Reading view, so a test can pick its mode without diffing the HTML. The \`id\` is \`<issue>-<sample>\`: \`issue-5\` to \`issue-12\` follow the summary sent to the Obsidian team, and \`issue-existing-50661\` is the topic that had already reported its issue.
`;
}

main();
