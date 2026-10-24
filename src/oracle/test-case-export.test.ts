import {
  describe,
  expect,
  it
} from 'vitest';

import type { EditingModesFile } from './editing-modes.ts';
import type { ForumIssueFile } from './forum-issues.ts';
import type { QuirkProbeFile } from './quirk-probes.ts';
import type { GfmReferenceFile } from './reference-html.ts';
import type { SpecOracleFile } from './spec-oracle-file.ts';
import type { WorkerMetadataOracleFile } from './worker-metadata.ts';

import { JUDGED_SAMPLES } from './mode-judge-samples.ts';
import {
  editingModesOracleFileName,
  forumIssueOracleFileName,
  PINNED_ORACLE_DIRECTORY,
  quirkProbeOracleFileName,
  readOracleFile,
  specOracleFileName,
  workerMetadataOracleFileName
} from './oracle-location.ts';
import { QUIRK_PROBES } from './quirk-probes.ts';
import {
  GFM_REFERENCE_FILE_NAME,
  gfmReferenceHtml,
  isSameAsReference,
  renderCommonMarkReference
} from './reference-html.ts';
import {
  exampleKey,
  readingViewDifferences,
  SPEC_DIFFERENCES,
  specDifferenceKeys,
  strictLineBreakDifferences
} from './spec-quirks.ts';
import { buildTestCaseSuites } from './test-case-export.ts';

const SPEC = readOracleFile(specOracleFileName()) as SpecOracleFile;
const PROBES = readOracleFile(quirkProbeOracleFileName()) as QuirkProbeFile;
const WORKER = readOracleFile(workerMetadataOracleFileName()) as WorkerMetadataOracleFile;
const FORUM = readOracleFile(forumIssueOracleFileName()) as ForumIssueFile;
const GFM_REFERENCE = readOracleFile(GFM_REFERENCE_FILE_NAME, PINNED_ORACLE_DIRECTORY) as GfmReferenceFile;
const EDITING_MODES = readOracleFile(editingModesOracleFileName()) as EditingModesFile;
const SUITES = buildTestCaseSuites(SPEC, PROBES, WORKER, FORUM, GFM_REFERENCE, EDITING_MODES);
const SPEC_CASES = [...SUITES.commonmark.cases, ...SUITES.gfm.cases];
const ALL_SUITES = [
  SUITES.commonmark,
  SUITES.commonmarkFailing,
  SUITES.gfm,
  SUITES.gfmFailing,
  SUITES.commonmarkNoSpecFailing,
  SUITES.gfmNoSpecFailing,
  SUITES.metadata,
  SUITES.livePreviewAndSourceModeVsReadingView,
  SUITES.livePreviewAndSourceModeVsReadingViewAll,
  SUITES.metadataFailing
];
const FORUM_EDITING_MODE_CASES = 14;
const METADATA_ISSUE_CASES = 10;
const EXPECTED_METADATA_CASES = 6;
const WORKER_THROWS_ON_BLANK_LINK_DESTINATION = 17;
const WORKER_THROWS_ON_HAS_OWN_PROPERTY_KEY = 14;
const QUIRK_PROBE_COUNT = 169;
const COMMONMARK_NO_SPEC_FAILING_CASES = 70;
const GFM_NO_SPEC_FAILING_CASES = 27;
const SOFT_LINE_BREAKS = 'soft line breaks are hard';

interface IdentifiedCase {
  readonly id: string;
}

function ids(cases: readonly IdentifiedCase[]): Set<string> {
  return new Set(cases.map((testCase) => testCase.id));
}

describe('the exported test cases', () => {
  it('hold every document of each oracle once, under an id unique in its suite', () => {
    expect(SPEC_CASES.map((testCase) => exampleKey(testCase))).toEqual(SPEC.examples.map((read) => exampleKey(read)));
    expect(SUITES.commonmark.cases.every((testCase) => testCase.suite === 'commonmark')).toBe(true);
    expect(SUITES.gfm.cases.every((testCase) => testCase.suite === 'gfm')).toBe(true);
    expect(SUITES.metadata.cases).toHaveLength(WORKER.docs.length);
    for (const suite of ALL_SUITES) {
      expect(ids(suite.cases).size).toBe(suite.cases.length);
    }
  });

  it('give every spec example the reading view departs on, and only those, its departures', () => {
    const departing = SPEC_CASES.filter((testCase) => testCase.departures?.some((departure) => departure.name !== SOFT_LINE_BREAKS) === true).map((testCase) => exampleKey(testCase));
    expect(new Set(departing)).toEqual(new Set(readingViewDifferences(SPEC)));
    const withDepartures = SPEC_CASES.filter((testCase) => testCase.departures !== undefined).length;
    const listed = new Set(SPEC_DIFFERENCES.flatMap((difference) => specDifferenceKeys(difference)));
    expect(withDepartures).toBe(listed.size);
  });

  it('keep in the failing files the full files\' cases the reading view departs on, unchanged, and nothing else', () => {
    const departing = new Set(readingViewDifferences(SPEC));
    for (const [full, subset] of [[SUITES.commonmark, SUITES.commonmarkFailing], [SUITES.gfm, SUITES.gfmFailing]] as const) {
      expect(subset.cases).toEqual(full.cases.filter((testCase) => departing.has(exampleKey(testCase))));
      expect(subset.cases.every((testCase) => testCase.departures?.some((departure) => departure.name !== SOFT_LINE_BREAKS) === true)).toBe(true);
    }
    expect(SUITES.commonmarkFailing.cases.length + SUITES.gfmFailing.cases.length).toBe(departing.size);
  });

  it('keep in the no-spec files the quirk probes the reading view departs from the reference implementation on, with its HTML', () => {
    const files = [
      { preset: 'commonmark', render: renderCommonMarkReference, suite: SUITES.commonmarkNoSpecFailing },
      { preset: 'gfm', render: (markdown: string): string => gfmReferenceHtml(GFM_REFERENCE, markdown), suite: SUITES.gfmNoSpecFailing }
    ] as const;
    for (const { preset, render, suite } of files) {
      const departing = PROBES.probes.filter((probe) => probe.preset === preset && !isSameAsReference(probe.html, render(probe.markdown)));
      expect(suite.cases.map((testCase) => testCase.markdown)).toEqual(departing.map((probe) => probe.markdown));
      expect(suite.cases.every((testCase) => testCase.referenceHtml === render(testCase.markdown))).toBe(true);
    }
    expect(SUITES.commonmarkNoSpecFailing.referenceImplementation).toBe('commonmark.js@0.31.2');
    expect(SUITES.gfmNoSpecFailing.referenceImplementation).toBe('cmark-gfm@0.29.0.gfm.13');
    expect(SUITES.commonmarkNoSpecFailing.cases).toHaveLength(COMMONMARK_NO_SPEC_FAILING_CASES);
    expect(SUITES.gfmNoSpecFailing.cases).toHaveLength(GFM_NO_SPEC_FAILING_CASES);
    expect(QUIRK_PROBES).toHaveLength(QUIRK_PROBE_COUNT);
  });

  it('carry the default line breaks\' HTML on exactly the examples it changes', () => {
    const changed = SPEC_CASES.filter((testCase) => testCase.obsidianReadingViewHtmlSoftBreaksAsHard !== undefined).map((testCase) => exampleKey(testCase));
    expect(new Set(changed)).toEqual(new Set(strictLineBreakDifferences(SPEC)));
  });

  it('hold the forum issues: the editing modes\' disagreements with Reading view, and the metadata cache faults', () => {
    expect(SUITES.livePreviewAndSourceModeVsReadingView.cases).toHaveLength(FORUM_EDITING_MODE_CASES + JUDGED_SAMPLES.length);
    expect(new Set(SUITES.livePreviewAndSourceModeVsReadingView.cases.map((testCase) => testCase.issue))).toEqual(new Set([...Array.from({ length: 8 }, (_, index) => `issue-${String(index + 5)}`), 'issue-existing-50661', 'judged']));
    const samples = SUITES.metadataFailing.cases.filter((testCase) => testCase.id.startsWith('issue-'));
    expect(samples).toHaveLength(METADATA_ISSUE_CASES);
    expect(new Set(samples.map((testCase) => testCase.issue))).toEqual(new Set(['issue-1', 'issue-2', 'issue-3', 'issue-4']));
    expect(SUITES.metadataFailing.cases.filter((testCase) => testCase.expectedMetadata !== undefined)).toHaveLength(EXPECTED_METADATA_CASES);
  });

  it('keep in the failing metadata file every worker document the worker threw on, unchanged, each under the issue of its trigger', () => {
    const throws = SUITES.metadata.cases.filter((testCase) => testCase.metadata === null);
    const failing = SUITES.metadataFailing.cases.slice(0, throws.length);
    expect(failing.map(({ id, markdown, metadata, obsidianVersion }) => ({ id, markdown, metadata, obsidianVersion }))).toEqual(throws);
    expect(SUITES.metadataFailing.cases).toHaveLength(throws.length + METADATA_ISSUE_CASES);
    expect(failing.filter((testCase) => testCase.issue === 'issue-1')).toHaveLength(WORKER_THROWS_ON_BLANK_LINK_DESTINATION);
    expect(failing.filter((testCase) => testCase.issue === 'issue-2')).toHaveLength(WORKER_THROWS_ON_HAS_OWN_PROPERTY_KEY);
  });

  it('give each editing mode case Source mode, Live Preview and Reading view, with one Source mode line per markdown line', () => {
    for (const testCase of SUITES.livePreviewAndSourceModeVsReadingView.cases) {
      const read = testCase.issue === 'judged' ? EDITING_MODES.reads.find((candidate) => candidate.id === testCase.id) : FORUM.reads.find((candidate) => candidate.markdown === testCase.markdown);
      expect(testCase.obsidianSourceModeHtml).toBe(read?.sourceModeHtml);
      expect(testCase.obsidianLivePreviewHtml).toBe(read?.livePreviewHtml);
      expect(testCase.obsidianReadingViewHtml).toBe(read?.html);
      expect(testCase.obsidianSourceModeHtml.match(/<div class="cm-line[ "]/gu)).toHaveLength(testCase.markdown.split('\n').length);
      expect(testCase.differsIn.length).toBeGreaterThan(0);
    }
  });

  it('hold in the all file every editing mode read and forum sample, and every failing case unchanged under its id', () => {
    const all = SUITES.livePreviewAndSourceModeVsReadingViewAll.cases;
    expect(all).toHaveLength(EDITING_MODES.reads.length + FORUM_EDITING_MODE_CASES);
    const byId = new Map(all.map((testCase) => [testCase.id, testCase]));
    for (const testCase of SUITES.livePreviewAndSourceModeVsReadingView.cases) {
      const full = byId.get(testCase.id);
      expect([full?.markdown, full?.obsidianSourceModeHtml, full?.obsidianLivePreviewHtml, full?.obsidianReadingViewHtml]).toEqual([testCase.markdown, testCase.obsidianSourceModeHtml, testCase.obsidianLivePreviewHtml, testCase.obsidianReadingViewHtml]);
    }
  });

  it('expect of the metadata issues what the worker gives once the fault is out', () => {
    const byId = new Map(SUITES.metadataFailing.cases.map((testCase) => [testCase.id, testCase]));
    for (const id of ['issue-1-1', 'issue-1-2', 'issue-2-1', 'issue-2-2']) {
      expect(byId.get(id)?.metadata).toBeNull();
      expect(byId.get(id)?.expectedMetadata).toMatchObject({ headings: [{ heading: 'Heading' }], links: [{ link: 'Target' }], tags: [{ tag: '#tag' }] });
    }
    expect(byId.get('issue-1-1')?.expectedMetadata).toMatchObject({ frontmatter: { k: '[text]()' } });
    // eslint-disable-next-line unicorn/name-replacements -- `obj` is the property name in the note as the forum reported it.
    expect(byId.get('issue-2-2')?.expectedMetadata).toMatchObject({ frontmatter: { obj: { hasOwnProperty: 1 } } });
    for (const id of ['issue-3-1', 'issue-3-2']) {
      expect(byId.get(id)?.expectedMetadata).toMatchObject({ sections: [{ type: 'paragraph' }, ...id === 'issue-3-1' ? [{ id: 'abc', type: 'footnoteDefinition' }] : []] });
    }
  });

  it('state one Obsidian version, the oracles\'', () => {
    for (const suite of ALL_SUITES) {
      expect(suite.obsidianVersion).toBe(WORKER.meta.appVersion);
      expect(new Set(suite.cases.map((testCase) => testCase.obsidianVersion))).toEqual(new Set([suite.obsidianVersion]));
    }
  });
});
