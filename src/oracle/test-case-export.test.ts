import {
  describe,
  expect,
  it
} from 'vitest';

import type { QuirkProbeFile } from './quirk-probes.ts';
import type { SpecOracleFile } from './spec-oracle-file.ts';
import type { WorkerMetadataOracleFile } from './worker-metadata.ts';

import {
  quirkProbeOracleFileName,
  readOracleFile,
  specOracleFileName,
  workerMetadataOracleFileName
} from './oracle-location.ts';
import { QUIRK_PROBES } from './quirk-probes.ts';
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
const SUITES = buildTestCaseSuites(SPEC, PROBES, WORKER);
const SPEC_CASES = [...SUITES.commonmark.cases, ...SUITES.gfm.cases];
const ALL_SUITES = [SUITES.commonmark, SUITES.commonmarkDepartures, SUITES.gfm, SUITES.gfmDepartures, SUITES.quirks, SUITES.metadata];
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

  it('state one Obsidian version, the oracles\'', () => {
    for (const suite of ALL_SUITES) {
      expect(suite.obsidianVersion).toBe(WORKER.meta.appVersion);
      expect(new Set(suite.cases.map((testCase) => testCase.obsidianVersion))).toEqual(new Set([suite.obsidianVersion]));
    }
  });
});
