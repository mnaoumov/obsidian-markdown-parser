/* eslint-disable import-x/no-nodejs-modules -- The test runs in Node and reads the spec oracle from disk. */
import { micromark } from 'micromark';
import { gfmAutolinkLiteralHtml } from 'micromark-extension-gfm-autolink-literal';
import { gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { gfmTableHtml } from 'micromark-extension-gfm-table';
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
import type {
  SpecOracleFile,
  SpecOracleRead
} from './spec-oracle-file.ts';

import { parseWithLinkReferences } from '../syntax/lezer-commonmark.ts';
import { renderLezerHtml } from '../syntax/lezer-html.ts';
import { createObsidianParser } from '../syntax/lezer.ts';
import { createObsidianMarkdownIt } from '../syntax/markdown-it.ts';
import { micromarkQuirksHtml } from '../syntax/micromark-quirks.ts';
import { createMicromarkObsidianMarkdown } from '../syntax/micromark.ts';
import {
  OBSIDIAN_QUIRKS,
  resolveObsidianQuirks
} from '../syntax/options.ts';
import {
  exampleKey,
  readingViewDifferences,
  SPEC_DIFFERENCES,
  specDifferenceKeys,
  strictLineBreakDifferences,
  WORKER_SECTION_MISMATCHES,
  workerSectionMismatches
} from './spec-quirks.ts';

type Adapter = 'lezer' | 'markdown-it' | 'micromark';

const ORACLE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle', 'spec-obsidian-1.14.4.json');
const ORACLE = JSON.parse(readFileSync(ORACLE_PATH, 'utf-8')) as SpecOracleFile;
const ADAPTERS: readonly Adapter[] = ['lezer', 'markdown-it', 'micromark'];
const TAG_RE = /<(?<name>[a-z][\da-z]*)(?<attributes>(?:\s+[^\s/=>]+(?:="[^"]*")?)*)\s*\/?>/gu;
const TAG_PARTS_RE = /<(?<name>[a-z][\da-z]*)(?<attributes>(?:\s+[^\s/=>]+(?:="[^"]*")?)*)\s*\/?>/u;
const ATTRIBUTE_RE = /[^\s/=>]+(?:="[^"]*")?/gu;
const BETWEEN_TAGS_RE = />\s+</gu;
const TARGET_ATTRIBUTE_RE = /^(?<name>href|src)="(?<value>[^"]*)"$/u;

/*
 * The examples of each flag on which the flag alone does not give Obsidian's reading view, because another of its
 * quirks shows there too.
 * - htmlBlock 148, 171: the reading view's DOM reads the raw HTML: it adds `<tbody>`, drops the line ending after `<pre>`,
 *   and holds the HTML after `<textarea>` as its text. The blocks are the reading view's.
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
  looseList: [],
  setextHeading: ['commonmark:82', 'commonmark:84'],
  softLineBreak: [...[28, 81, 82, 84, 95, 187, 196, 210, 222, 224, 241, 384, 432, 494, 552, 625].map((example) => `commonmark:${String(example)}`), 'gfm:199']
};
function compareKeys(a: string, b: string): number {
  return a.localeCompare(b);
}

function decodeTarget(attribute: string): string {
  const groups = TARGET_ATTRIBUTE_RE.exec(attribute)?.groups;
  if (!groups) {
    return attribute;
  }
  try {
    return `${groups['name'] ?? ''}="${decodeURI(groups['value'] ?? '')}"`;
  } catch {
    // A target that is not valid percent-encoding is compared as it is, as the oracle compares it.
    return attribute;
  }
}

function exampleRead(key: string): SpecOracleRead {
  const read = ORACLE.examples.find((candidate) => exampleKey(candidate) === key);
  if (!read) {
    throw new Error(`The oracle holds no example ${key}`);
  }
  return read;
}

// HTML as the DOM serializes it: tags without their `/`, attributes in name order, and text quotes and spaces as such.
// Link targets are decoded, as the oracle decodes them.
function normalizeHtml(html: string): string {
  return html
    .replaceAll(TAG_RE, (tag) => normalizeTag(tag))
    .replaceAll('&quot;', '"')
    .replaceAll('&nbsp;', ' ')
    .replaceAll(BETWEEN_TAGS_RE, '><')
    .trim();
}

function normalizeTag(tag: string): string {
  const groups = TAG_PARTS_RE.exec(tag)?.groups;
  const attributes = (groups?.['attributes']?.match(ATTRIBUTE_RE) ?? []).map((attribute) => decodeTarget(attribute));
  return `<${[groups?.['name'] ?? '', ...attributes.toSorted(compareKeys)].join(' ')}>`;
}

// A CommonMark example renders with the `commonmark` preset, and a GFM one with the `gfm` preset.
function render(adapter: Adapter, quirk: keyof ObsidianQuirkFlags, preset: 'commonmark' | 'gfm'): (markdown: string) => string {
  const options = { preset, [quirk]: OBSIDIAN_QUIRKS[quirk] } as const;
  switch (adapter) {
    case 'lezer': {
      const parser = createObsidianParser(options);
      return (markdown) => renderLezerHtml(markdown, parseWithLinkReferences(parser, markdown), resolveObsidianQuirks(options));
    }
    case 'markdown-it': {
      const md = createObsidianMarkdownIt(options);
      return (markdown) => md.render(markdown);
    }
    case 'micromark': {
      const extensions = createMicromarkObsidianMarkdown(options);
      return (markdown) => micromark(markdown, { allowDangerousHtml: true, extensions, htmlExtensions: [gfmTableHtml(), gfmStrikethroughHtml(), gfmAutolinkLiteralHtml(), micromarkQuirksHtml] });
    }
    default: {
      throw new Error('Unknown adapter');
    }
  }
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
    expect(differing).toEqual(NOT_REPRODUCED[quirk]);
  });
});
