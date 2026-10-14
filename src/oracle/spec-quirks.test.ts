/* eslint-disable import-x/no-nodejs-modules -- The test runs in Node and reads the spec oracle from disk. */
import { readFileSync } from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules -- Only the fixture imports above need Node. */
import {
  describe,
  expect,
  it
} from 'vitest';

import type { ObsidianQuirkFlags } from '../syntax/options.ts';
import type { Adapter } from './render-html.ts';
import type {
  SpecOracleFile,
  SpecOracleRead
} from './spec-oracle-file.ts';
import type { SpecDifference } from './spec-quirks.ts';

import { renderRemarkHtml } from '../remark/html.ts';
import { parseRemark } from '../remark/parse.ts';
import { OBSIDIAN_QUIRKS } from '../syntax/options.ts';
import {
  ADAPTERS,
  compareKeys,
  htmlRenderer,
  isExpressible,
  normalizeHtml
} from './render-html.ts';
import {
  exampleKey,
  readingViewDifferences,
  SPEC_DIFFERENCES,
  specDifferenceKeys,
  strictLineBreakDifferences,
  WORKER_SECTION_MISMATCHES,
  workerSectionMismatches
} from './spec-quirks.ts';

const ORACLE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle', 'spec-obsidian-1.14.4.json');
const ORACLE = JSON.parse(readFileSync(ORACLE_PATH, 'utf-8')) as SpecOracleFile;
/*
 * The examples of each flag on which the flag alone does not give Obsidian's reading view, because another of its
 * quirks shows there too.
 * - htmlBlock 148, 171: the reading view's DOM reads the raw HTML: it adds `<tbody>`, drops the line ending after `<pre>`,
 *   and holds the HTML after `<textarea>` as its text. The blocks are the reading view's.
 * - listItem 278, 280: the paragraph keeps its leading whitespace.
 * - setextHeading 82, 84: the paragraph keeps its leading whitespace.
 * - softLineBreak 28: character references; 81, 82, 84, 95: setext headings; 187, 494: unclosed tags in the spec;
 *   196, 210: link reference definitions; 222, 224: leading whitespace; 241: trailing whitespace; 384, 432: emphasis;
 *   552: links; 625: HTML comments; GFM 199: tables.
 */
const NOT_REPRODUCED: Readonly<Record<keyof ObsidianQuirkFlags, readonly string[]>> = {
  autolink: [],
  characterReference: [],
  emptyListItem: [],
  gfmTable: [],
  htmlBlock: ['commonmark:148', 'commonmark:171'],
  htmlComment: [],
  linkDefinition: [],
  listItem: ['commonmark:278', 'commonmark:280'],
  looseList: [],
  setextHeading: ['commonmark:82', 'commonmark:84'],
  softLineBreak: [...[28, 81, 82, 84, 95, 187, 196, 210, 222, 224, 241, 384, 432, 494, 552, 625].map((example) => `commonmark:${String(example)}`), 'gfm:199']
};
/*
 * The examples on which the `remark-parse` 8 engine does not give the reading view's DOM. Its parse is the reading
 * view's on every one of them; what differs comes after the parse.
 * - ENGINE_RAW_HTML: the browser re-reads raw HTML. It closes the tags left open, adds `<tbody>`, decodes character
 *   references in attributes and folds their whitespace, and drops stray end tags.
 * - ENGINE_COMPARISON: the spec's HTML holds an unclosed tag, which the browser closes (the comparison rows).
 * - ENGINE_RENDERED: the reading view's sanitizer and embeds (the rendering rows).
 * Every example of the syntax rows is the reading view's: the engine reads the Obsidian syntax.
 */
const ENGINE_RAW_HTML = [21, 31, 149, 151, 152, 155, 156, 157, 158, 160, 165, 171, 174, 175, 181, 184, 190, 191, 623].map((example) => `commonmark:${String(example)}`);
const ENGINE_COMPARISON = [148, 187, 344, 494, 630, 631, 642, 643].map((example) => `commonmark:${String(example)}`);
const ENGINE_RENDERED = [
  ...[150, 163, 169, 170, 172, 173, 176, 177, 178, 179, 180, 182, 183, 201, 308, 309, 491, 572, 579, 613, 614, 615, 616, 617, 628, 629].map((example) => `commonmark:${String(example)}`),
  'gfm:652'
];

function exampleRead(key: string): SpecOracleRead {
  const read = ORACLE.examples.find((candidate) => exampleKey(candidate) === key);
  if (!read) {
    throw new Error(`The oracle holds no example ${key}`);
  }
  return read;
}

// A CommonMark example renders with the `commonmark` preset, and a GFM one with the `gfm` preset.
function render(adapter: Adapter, quirk: keyof ObsidianQuirkFlags, preset: 'commonmark' | 'gfm'): (markdown: string) => string {
  return htmlRenderer(adapter, { preset, [quirk]: OBSIDIAN_QUIRKS[quirk] });
}

describe('the spec oracle', () => {
  it('explains every example the reading view renders differently from the spec', () => {
    const explained = new Set(SPEC_DIFFERENCES.filter((difference) => difference.flag !== 'softLineBreak').flatMap((difference) => specDifferenceKeys(difference)));
    expect([...explained].toSorted(compareKeys)).toEqual(readingViewDifferences(ORACLE).toSorted(compareKeys));
  });

  it('lists every example `strictLineBreaks: false` changes under the soft line break quirk', () => {
    const softLineBreak = SPEC_DIFFERENCES.find((difference) => difference.flag === 'softLineBreak');
    expect(softLineBreak && specDifferenceKeys(softLineBreak).toSorted(compareKeys)).toEqual(strictLineBreakDifferences(ORACLE).toSorted(compareKeys));
  });

  it('finds the worker\'s sections in the reading view\'s blocks outside raw HTML and front matter', () => {
    expect(workerSectionMismatches(ORACLE)).toEqual(WORKER_SECTION_MISMATCHES);
  });

  it('gives each quirk that is a flag the reason it is one, and each other quirk the reason it is not', () => {
    for (const difference of SPEC_DIFFERENCES) {
      expect(difference.kind === 'quirk' ? (difference.flag === undefined) === (difference.notAFlag !== undefined) : difference.flag === undefined).toBe(true);
    }
  });
});

describe.each(ADAPTERS)('%s with a quirk flag', (adapter) => {
  it.each(SPEC_DIFFERENCES.filter((difference) => difference.flag !== undefined))('reproduces the reading view on the examples of $name', (difference) => {
    const quirk = difference.flag ?? 'softLineBreak';
    const renderers = { commonmark: render(adapter, quirk, 'commonmark'), gfm: render(adapter, quirk, 'gfm') };
    const differing = specDifferenceKeys(difference).filter((key) => {
      const read = exampleRead(key);
      const toHtml = renderers[read.suite];
      const obsidian = quirk === 'softLineBreak' ? read.html : read.htmlStrict;
      return normalizeHtml(toHtml(read.markdown)) !== normalizeHtml(obsidian);
    });
    expect(differing).toEqual(isExpressible(adapter, quirk) ? NOT_REPRODUCED[quirk] : specDifferenceKeys(difference));
  });
});

function keysOf(kind: SpecDifference['kind']): Set<string> {
  return new Set(SPEC_DIFFERENCES.filter((difference) => difference.kind === kind).flatMap((difference) => specDifferenceKeys(difference)));
}

describe('the remark-parse 8 engine', () => {
  it('gives the reading view\'s HTML on every example but raw HTML and the rendering and comparison rows', () => {
    const differing = ORACLE.examples
      .filter((read) => normalizeHtml(renderRemarkHtml(parseRemark(read.markdown))) !== normalizeHtml(read.htmlStrict))
      .map((read) => exampleKey(read));
    expect(differing.toSorted(compareKeys)).toEqual([...ENGINE_RAW_HTML, ...ENGINE_COMPARISON, ...ENGINE_RENDERED].toSorted(compareKeys));
  });

  it('misses only examples of the comparison and rendering rows it names, and raw HTML', () => {
    const differences = new Set(readingViewDifferences(ORACLE));
    expect(ENGINE_COMPARISON.filter((key) => !keysOf('comparison').has(key))).toEqual([]);
    expect(ENGINE_RENDERED.filter((key) => !keysOf('rendering').has(key))).toEqual([]);
    // Raw HTML the engine passes through as the reading view's parser does: on all but one, Obsidian agrees with the spec.
    expect(ENGINE_RAW_HTML.filter((key) => differences.has(key))).toEqual(['commonmark:171']);
  });
});
