/* eslint-disable import-x/no-nodejs-modules -- The test runs in Node and reads the probe oracle from disk. */
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

import type { QuirkProbeFile } from './quirk-probes.ts';
import type { Adapter } from './render-html.ts';

import { OBSIDIAN_QUIRKS } from '../syntax/options.ts';
import { QUIRK_PROBES } from './quirk-probes.ts';
import {
  ADAPTERS,
  compareKeys,
  htmlRenderer,
  normalizeHtml
} from './render-html.ts';

const ORACLE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle', 'quirk-probes-obsidian-1.14.4.json');
const ORACLE = JSON.parse(readFileSync(ORACLE_PATH, 'utf-8')) as QuirkProbeFile;

// The reading view's sanitizer or DOM changes the parser's HTML: it drops comments, `<meta>`, a `javascript:` link's
// target and stray end tags, and closes and moves what is left open.
const RENDERED = [
  '<javascript://x> <foo:bar> <a/b://c>',
  '<div>\n  \nfoo',
  'foo\n</pre>',
  'foo\n<textarea>',
  '<textarea>foo',
  'foo\n<meta>',
  'foo\n<search>',
  '<meta>\nfoo\n\nbar',
  'a <!-- b - c --> d',
  'a <!----> b'
];
// A link title reads its character references as inline content does, which the `characterReference` flag leaves out.
const TITLE_REFERENCES = ['[&nbsp](/u "&copy t")'];
// The paragraph keeps the whitespace its first line starts with.
const LEADING_WHITESPACE = [
  ' | a |\n| - |',
  '| a | b |\n|-|-|\n  | c | d |',
  '- a\n\n     b',
  '- a\n\n    b',
  '-   a\n\n     b',
  '-\n  foo',
  '-\n\n  foo',
  '-\n\n\n  foo',
  '-\n    baz',
  '- a\n\n b'
];
// A row of a table without a leading pipe that opens a container ends the table in `@lezer/markdown` and micromark.
const CONTAINER_ROWS = ['a | b\n- | -\n| c | d', 'a | b\n- | -\nc | d', 'a |\n- |', 'a | b |\n- | - |', 'a|b\n-|-\n> q|x', 'a|b\n-|-\n- l|x'];
// `@lezer/markdown` also ends a paragraph, and so the table, at a heading; and its list items follow CommonMark.
const LEZER_ONLY = [
  'a|b\n-|-\n# h|x',
  ' -    one\n\n     two',
  '1234567890. x',
  '12345678901234. x',
  '- a\n - b\n  - c\n   - d\n    - e\n     - f',
  '1. a\n\n  2. b\n\n    3. c',
  '1. a\n    2. b',
  '-\n      baz',
  '-\n     baz'
];

/*
 * The probes on which an adapter, with the probe's quirk flag, does not give the reading view's DOM, and why. Every
 * structure the flags read matches the reading view's but in `CONTAINER_ROWS` and `LEZER_ONLY`.
 */
const NOT_REPRODUCED: Readonly<Record<Adapter, readonly string[]>> = {
  'lezer': [...RENDERED, ...TITLE_REFERENCES, ...LEADING_WHITESPACE, ...CONTAINER_ROWS, ...LEZER_ONLY],
  'markdown-it': [...RENDERED, ...TITLE_REFERENCES, ...LEADING_WHITESPACE],
  'micromark': [...RENDERED, ...TITLE_REFERENCES, ...LEADING_WHITESPACE, ...CONTAINER_ROWS]
};

describe('the quirk probe oracle', () => {
  it('holds every probe, in order', () => {
    expect(ORACLE.probes.map((probe) => probe.markdown)).toEqual(QUIRK_PROBES.map((probe) => probe.markdown));
  });
});

describe.each(ADAPTERS)('%s with the quirk flag of each probe', (adapter) => {
  it('reproduces the reading view on the probes', () => {
    const differing = ORACLE.probes.filter((probe) => {
      const toHtml = htmlRenderer(adapter, { preset: probe.preset, [probe.quirk]: OBSIDIAN_QUIRKS[probe.quirk] });
      return normalizeHtml(toHtml(probe.markdown)) !== normalizeHtml(probe.html);
    }).map((probe) => probe.markdown);
    expect(differing.toSorted(compareKeys)).toEqual(NOT_REPRODUCED[adapter].toSorted(compareKeys));
  });
});
