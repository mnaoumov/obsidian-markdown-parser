/**
 * @file
 *
 * Writes the pinned oracles as plain JSON test cases another project can keep next to its own tests
 * (`src/oracle/test-case-export.ts`): the CommonMark and GFM spec examples, each with a subset of the examples Obsidian
 * departs on, `reading-view-quirks.json`, `metadata-cache.json`, the forum issues'
 * `live-preview-and-source-mode-vs-reading-view.json` and `metadata-cache-issues.json`, and a `README.md` that describes
 * them. Nothing of this repository's code goes into the folder.
 *
 * Usage: `jiti scripts/export-test-cases.ts [--out <directory>]`. The folder defaults to `dist/test-cases`.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { ForumIssueFile } from '../src/oracle/forum-issues.ts';
import type { QuirkProbeFile } from '../src/oracle/quirk-probes.ts';
import type { SpecOracleFile } from '../src/oracle/spec-oracle-file.ts';
import type { TestCaseSuite } from '../src/oracle/test-case-export.ts';
import type { WorkerMetadataOracleFile } from '../src/oracle/worker-metadata.ts';

import {
  forumIssueOracleFileName,
  quirkProbeOracleFileName,
  readOracleFile,
  specOracleFileName,
  workerMetadataOracleFileName
} from '../src/oracle/oracle-location.ts';
import { buildTestCaseSuites } from '../src/oracle/test-case-export.ts';

const JSON_INDENT = 2;
const DEFAULT_OUT = join('dist', 'test-cases');

function main(): void {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const out = values.out ?? DEFAULT_OUT;
  const suites = buildTestCaseSuites(
    readOracleFile(specOracleFileName()) as SpecOracleFile,
    readOracleFile(quirkProbeOracleFileName()) as QuirkProbeFile,
    readOracleFile(workerMetadataOracleFileName()) as WorkerMetadataOracleFile,
    readOracleFile(forumIssueOracleFileName()) as ForumIssueFile
  );
  mkdirSync(out, { recursive: true });
  const files: [string, TestCaseSuite<unknown>][] = [
    ['commonmark-0.31.2.json', suites.commonmark],
    ['commonmark-0.31.2-departures.json', suites.commonmarkDepartures],
    ['gfm-0.29.0.gfm.13.json', suites.gfm],
    ['gfm-0.29.0.gfm.13-departures.json', suites.gfmDepartures],
    ['reading-view-quirks.json', suites.quirks],
    ['metadata-cache.json', suites.metadata],
    ['live-preview-and-source-mode-vs-reading-view.json', suites.livePreviewAndSourceModeVsReadingView],
    ['metadata-cache-issues.json', suites.metadataCacheIssues]
  ];
  for (const [name, suite] of files) {
    writeFileSync(join(out, name), `${JSON.stringify(suite, null, JSON_INDENT)}\n`);
    console.log(`${String(suite.cases.length)} cases written to ${join(out, name)}`);
  }
  writeFileSync(join(out, 'README.md'), readme(suites.commonmark.obsidianVersion, files));
  console.log(`README written to ${join(out, 'README.md')}`);
}

function readme(obsidianVersion: string, files: readonly [string, TestCaseSuite<unknown>][]): string {
  const rows = files.map(([name, suite]) => `| \`${name}\` | ${String(suite.cases.length)} |`).join('\n');
  return `# Obsidian markdown test cases

Markdown documents with what Obsidian ${obsidianVersion} gives for each, read from the live app: the HTML of Reading view, the metadata worker's \`CachedMetadata\` and, for the forum issues, the HTML of the two editing modes, Source mode and Live Preview. The spec cases also carry the CommonMark or GFM spec's HTML, so a test can expect either today's output or the spec's. Every value is the spec's or Obsidian's own output; no parser code comes with them.

| File | Cases |
| --- | --- |
${rows}

Each file is \`{ about, obsidianVersion, cases }\`, and \`about\` says how its values were read. Every case has an \`id\` unique in its file, its \`markdown\` and the \`obsidianVersion\` it was read from.

- \`commonmark-0.31.2.json\` and \`gfm-0.29.0.gfm.13.json\`: the examples of the CommonMark 0.31.2 spec and the extension examples of the GFM 0.29.0.gfm.13 spec. \`commonMarkSpecHtml\` is the spec's HTML, \`obsidianReadingViewHtml\` the reading view's with \`strictLineBreaks: true\`, \`obsidianReadingViewHtmlSoftBreaksAsHard\` the reading view's with the default \`strictLineBreaks: false\` where it differs, and \`metadata\` the worker's \`CachedMetadata\`. \`departures\` lists why the reading view differs from the spec, where it does, each with a \`kind\` (\`quirk\`, \`syntax\`, \`rendering\` or \`comparison\`), a \`name\` and the \`behaviour\`. The \`id\` is \`<suite>-<example number>\`.
- \`commonmark-0.31.2-departures.json\` and \`gfm-0.29.0.gfm.13-departures.json\`: the cases of the full file whose \`obsidianReadingViewHtml\` differs from \`commonMarkSpecHtml\`, unchanged and under the same \`id\`, for a test that wants only the places Obsidian does not follow the spec. An example whose only departure is \`soft line breaks are hard\` is not in them: its \`obsidianReadingViewHtml\` matches the spec, and only \`obsidianReadingViewHtmlSoftBreaksAsHard\`, under the app's default, differs.
- \`reading-view-quirks.json\`: documents beyond the spec that show where the reading view departs from CommonMark, each with the \`quirk\`, a \`note\` on it, \`obsidianReadingViewHtml\` (\`strictLineBreaks: true\`) and the worker's \`metadataSections\` (\`<type>@<first line>-<last line>\`, lines from 0).
- \`metadata-cache.json\`: documents and the worker's whole \`CachedMetadata\`, key order included, or \`null\` where the worker threw.
- \`live-preview-and-source-mode-vs-reading-view.json\`: notes that Source mode or Live Preview and Reading view read differently, each reported on the Obsidian forum. Each case has the \`issue\` and \`forumUrl\` it belongs to, a one-sentence \`note\`, and all three modes as the user sees them: \`obsidianSourceModeHtml\` and \`obsidianLivePreviewHtml\`, the inner HTML of the editor's \`.cm-content\` in the default theme, and \`obsidianReadingViewHtml\` (\`strictLineBreaks: true\`), with the worker's \`metadata\`, which sides with Reading view. The editing modes were read once math had rendered, with the cursor on an empty line appended to the note, so that Live Preview shows no source for the selection; that line is left out of the HTML. \`differsIn\` lists the editing modes, \`sourceMode\` and \`livePreview\`, that disagree with Reading view, so a test can pick its mode without diffing the HTML. The \`id\` is \`<issue>-<sample>\`: \`issue-5\` to \`issue-12\` follow the summary sent to the Obsidian team, and \`issue-existing-50661\` is the topic that had already reported its issue.
- \`metadata-cache-issues.json\`: notes whose metadata the worker drops or misplaces (\`issue-1\` to \`issue-4\` of the summary, each with its \`forumUrl\`): the worker's \`metadata\`, \`null\` where it threw, and \`expectedMetadata\` where what the note should give is clear, built from the worker's own output as the case's \`note\` says. The forum issues where the reading view departs from CommonMark are not repeated: they are spec examples, in the spec files.
`;
}

main();
