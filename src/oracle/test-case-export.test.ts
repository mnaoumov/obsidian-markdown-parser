import {
  describe,
  expect,
  it
} from 'vitest';

import type { ForumIssueFile } from './forum-issues.ts';
import type { QuirkProbeFile } from './quirk-probes.ts';
import type { SpecOracleFile } from './spec-oracle-file.ts';
import type { WorkerMetadataOracleFile } from './worker-metadata.ts';

import {
  forumIssueOracleFileName,
  quirkProbeOracleFileName,
  readOracleFile,
  specOracleFileName,
  workerMetadataOracleFileName
} from './oracle-location.ts';
import { QUIRK_PROBES } from './quirk-probes.ts';
import {
  classSetsOf,
  lineStartsOf
} from './score.ts';
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
const SUITES = buildTestCaseSuites(SPEC, PROBES, WORKER, FORUM);
const SPEC_CASES = [...SUITES.commonmark.cases, ...SUITES.gfm.cases];
const ALL_SUITES = [
  SUITES.commonmark,
  SUITES.commonmarkDepartures,
  SUITES.gfm,
  SUITES.gfmDepartures,
  SUITES.quirks,
  SUITES.metadata,
  SUITES.editorVsReadingView,
  SUITES.metadataCacheIssues
];
const EDITOR_VS_READING_VIEW_CASES = 14;
const METADATA_ISSUE_CASES = 10;
const EXPECTED_METADATA_CASES = 6;
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
    expect(SUITES.quirks.cases).toHaveLength(QUIRK_PROBES.length);
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

  it('keep in the departure files the full files\' cases the reading view departs on, unchanged, and nothing else', () => {
    const departing = new Set(readingViewDifferences(SPEC));
    for (const [full, subset] of [[SUITES.commonmark, SUITES.commonmarkDepartures], [SUITES.gfm, SUITES.gfmDepartures]] as const) {
      expect(subset.cases).toEqual(full.cases.filter((testCase) => departing.has(exampleKey(testCase))));
      expect(subset.cases.every((testCase) => testCase.departures?.some((departure) => departure.name !== SOFT_LINE_BREAKS) === true)).toBe(true);
    }
    expect(SUITES.commonmarkDepartures.cases.length + SUITES.gfmDepartures.cases.length).toBe(departing.size);
  });

  it('carry the default line breaks\' HTML on exactly the examples it changes', () => {
    const changed = SPEC_CASES.filter((testCase) => testCase.obsidianHtmlSoftBreaksAsHard !== undefined).map((testCase) => exampleKey(testCase));
    expect(new Set(changed)).toEqual(new Set(strictLineBreakDifferences(SPEC)));
  });

  it('hold the forum issues: the editor and reading view disagreements, and the metadata cache faults', () => {
    expect(SUITES.editorVsReadingView.cases).toHaveLength(EDITOR_VS_READING_VIEW_CASES);
    expect(new Set(SUITES.editorVsReadingView.cases.map((testCase) => testCase.issue))).toEqual(new Set([...Array.from({ length: 8 }, (_, index) => `issue-${String(index + 5)}`), 'issue-existing-50661']));
    expect(SUITES.metadataCacheIssues.cases).toHaveLength(METADATA_ISSUE_CASES);
    expect(new Set(SUITES.metadataCacheIssues.cases.map((testCase) => testCase.issue))).toEqual(new Set(['issue-1', 'issue-2', 'issue-3', 'issue-4']));
    expect(SUITES.metadataCacheIssues.cases.filter((testCase) => testCase.expectedMetadata !== undefined)).toHaveLength(EXPECTED_METADATA_CASES);
  });

  it('give each editor case its lines with the classes the editor\'s tree gives each character and line', () => {
    for (const testCase of SUITES.editorVsReadingView.cases) {
      expect(testCase.editorLines.map((line) => line.text).join('\n')).toBe(testCase.markdown);
      const read = FORUM.reads.find((candidate) => candidate.markdown === testCase.markdown);
      const fromTree = classSetsOf(testCase.markdown, read?.nodes ?? []);
      const starts = lineStartsOf(testCase.markdown);
      const tok = Array.from({ length: testCase.markdown.length }, () => new Set<string>());
      for (const [index, line] of testCase.editorLines.entries()) {
        for (const token of line.tokens) {
          for (let column = token.from; column < token.to; column++) {
            for (const cls of token.classes) {
              tok[(starts[index] ?? 0) + column]?.add(cls);
            }
          }
        }
      }
      expect(testCase.editorLines.map((line) => new Set(line.lineClasses))).toEqual(fromTree.line);
      expect(tok).toEqual(fromTree.tok);
    }
  });

  it('expect of the metadata issues what the worker gives once the fault is out', () => {
    const byId = new Map(SUITES.metadataCacheIssues.cases.map((testCase) => [testCase.id, testCase]));
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
