/* eslint-disable import-x/no-nodejs-modules -- The installed commonmark.js names its version in its package.json. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules -- Only the imports above need Node. */
import {
  describe,
  expect,
  it
} from 'vitest';

import type { QuirkProbeFile } from './quirk-probes.ts';
import type { GfmReferenceFile } from './reference-html.ts';
import type { SpecOracleFile } from './spec-oracle-file.ts';

import {
  CORPUS_TEST_TIMEOUT_MS,
  PINNED_ORACLE_DIRECTORY,
  quirkProbeOracleFileName,
  readOracleFile,
  specOracleFileName
} from '../oracle-location.ts';
import { normalizeHtml } from '../render-html.ts';
import {
  COMMONMARK_REFERENCE_IMPLEMENTATION,
  GFM_REFERENCE_FILE_NAME,
  GFM_REFERENCE_VERSION,
  gfmReferenceHtml,
  renderCommonMarkReference,
  throughDom
} from './reference-html.ts';
import { exampleKey } from './spec-quirks.ts';

const SPEC = readOracleFile(specOracleFileName()) as SpecOracleFile;
const PROBES = readOracleFile(quirkProbeOracleFileName()) as QuirkProbeFile;
const GFM_REFERENCE = readOracleFile(GFM_REFERENCE_FILE_NAME, PINNED_ORACLE_DIRECTORY) as GfmReferenceFile;
const COMMONMARK_EXAMPLES = 652;
const GFM_EXAMPLES = 22;

// Where the app's Chromium serializes a DOM other than the HTML standard does: two processing instructions it keeps as
// such, and an attribute value holding `<` and `>`, which it escapes.
const DOM_SERIALIZATION_DIFFERENCES = ['commonmark:180', 'commonmark:616', 'commonmark:627'];

interface PackageJson {
  readonly version: string;
}

describe('the reference implementations', () => {
  it('give commonmark.js at the version the export names, and it passes every CommonMark 0.31.2 example', () => {
    const packagePath = join(PINNED_ORACLE_DIRECTORY, '..', 'node_modules', 'commonmark', 'package.json');
    const { version } = JSON.parse(readFileSync(packagePath, 'utf-8')) as PackageJson;
    expect(COMMONMARK_REFERENCE_IMPLEMENTATION).toBe(`commonmark.js@${version}`);
    const examples = SPEC.examples.filter((example) => example.suite === 'commonmark');
    expect(examples).toHaveLength(COMMONMARK_EXAMPLES);
    expect(examples.filter((example) => renderCommonMarkReference(example.markdown) !== example.specHtml).map((example) => exampleKey(example))).toEqual([]);
  }, CORPUS_TEST_TIMEOUT_MS);

  it('give cmark-gfm 0.29.0.gfm.13, which passes every GFM 0.29.0.gfm.13 extension example', () => {
    expect(GFM_REFERENCE.meta.implementation).toBe(`cmark-gfm@${GFM_REFERENCE_VERSION}`);
    const examples = SPEC.examples.filter((example) => example.suite === 'gfm');
    expect(examples).toHaveLength(GFM_EXAMPLES);
    expect(examples.filter((example) => gfmReferenceHtml(GFM_REFERENCE, example.markdown) !== example.specHtml).map((example) => exampleKey(example))).toEqual([]);
  });

  it('give cmark-gfm\'s HTML for every GFM quirk probe', () => {
    const gfmProbes = PROBES.probes.filter((candidate) => candidate.preset === 'gfm');
    for (const probe of gfmProbes) {
      expect(() => gfmReferenceHtml(GFM_REFERENCE, probe.markdown)).not.toThrow();
    }
  });

  it('put HTML through a DOM as the spec oracle puts the spec\'s HTML through the app\'s', () => {
    const differing = SPEC.examples.filter((example) => normalizeHtml(throughDom(example.specHtml)) !== normalizeHtml(example.specDom)).map((example) => exampleKey(example));
    expect(differing).toEqual(DOM_SERIALIZATION_DIFFERENCES);
    // So no probe's reference HTML is one the difference touches.
    const outputs = PROBES.probes.map((probe) => probe.preset === 'commonmark' ? renderCommonMarkReference(probe.markdown) : gfmReferenceHtml(GFM_REFERENCE, probe.markdown));
    expect(outputs.filter((html) => html.includes('<?') || /\w="[^"]*[<>]/u.test(html))).toEqual([]);
  });
});
