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
  readingViewDifferences,
  SPEC_DIFFERENCES,
  strictLineBreakDifferences
} from './spec-quirks.ts';
import { buildTestCaseSuites } from './test-case-export.ts';

const SPEC = readOracleFile(specOracleFileName()) as SpecOracleFile;
const PROBES = readOracleFile(quirkProbeOracleFileName()) as QuirkProbeFile;
const WORKER = readOracleFile(workerMetadataOracleFileName()) as WorkerMetadataOracleFile;
const SUITES = buildTestCaseSuites(SPEC, PROBES, WORKER);

interface IdentifiedCase {
  readonly id: string;
}

function ids(cases: readonly IdentifiedCase[]): Set<string> {
  return new Set(cases.map((testCase) => testCase.id));
}

describe('the exported test cases', () => {
  it('hold every document of each oracle once, under an id unique in its suite', () => {
    expect(SUITES.spec.cases).toHaveLength(SPEC.examples.length);
    expect(SUITES.quirks.cases).toHaveLength(QUIRK_PROBES.length);
    expect(SUITES.metadata.cases).toHaveLength(WORKER.docs.length);
    for (const suite of [SUITES.spec, SUITES.quirks, SUITES.metadata]) {
      expect(ids(suite.cases).size).toBe(suite.cases.length);
    }
  });

  it('give every spec example the reading view departs on, and only those, its departures', () => {
    const departing = SUITES.spec.cases.filter((testCase) => testCase.departures?.some((departure) => departure.name !== 'soft line breaks are hard') === true).map((testCase) => testCase.id.replace('-', ':'));
    expect(new Set(departing)).toEqual(new Set(readingViewDifferences(SPEC)));
    const withDepartures = SUITES.spec.cases.filter((testCase) => testCase.departures !== undefined).length;
    const listed = new Set(SPEC_DIFFERENCES.flatMap((difference) => [...difference.commonmark.map((n) => `commonmark-${String(n)}`), ...(difference.gfm ?? []).map((n) => `gfm-${String(n)}`)]));
    expect(withDepartures).toBe(listed.size);
  });

  it('carry the default line breaks\' HTML on exactly the examples it changes', () => {
    const changed = SUITES.spec.cases.filter((testCase) => testCase.obsidianHtmlSoftBreaksAsHard !== undefined).map((testCase) => testCase.id.replace('-', ':'));
    expect(new Set(changed)).toEqual(new Set(strictLineBreakDifferences(SPEC)));
  });

  it('state one Obsidian version, the oracles\'', () => {
    for (const suite of [SUITES.spec, SUITES.quirks, SUITES.metadata]) {
      expect(suite.obsidianVersion).toBe(WORKER.meta.appVersion);
      expect(new Set(suite.cases.map((testCase) => testCase.obsidianVersion))).toEqual(new Set([suite.obsidianVersion]));
    }
  });
});
