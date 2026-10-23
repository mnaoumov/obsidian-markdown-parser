import {
  describe,
  expect,
  it
} from 'vitest';

import type { ObsidianQuirkFlags } from '../syntax/options.ts';
import type {
  QuirkProbeFile,
  QuirkProbeRead
} from './quirk-probes.ts';
import type { Adapter } from './render-html.ts';

import { renderRemarkHtml } from '../remark/html.ts';
import { parseRemark } from '../remark/parse.ts';
import {
  OBSIDIAN_QUIRK_FLAGS,
  OBSIDIAN_QUIRKS
} from '../syntax/options.ts';
import {
  CORPUS_TEST_TIMEOUT_MS,
  quirkProbeOracleFileName,
  readOracleFile
} from './oracle-location.ts';
import { QUIRK_PROBES } from './quirk-probes.ts';
import {
  ADAPTERS,
  compareKeys,
  htmlRenderer,
  normalizeHtml
} from './render-html.ts';

const ORACLE = readOracleFile(quirkProbeOracleFileName()) as QuirkProbeFile;

interface FlaggedProbe extends QuirkProbeRead {
  readonly quirk: keyof ObsidianQuirkFlags;
}

function isFlagged(probe: QuirkProbeRead): probe is FlaggedProbe {
  return (OBSIDIAN_QUIRK_FLAGS as readonly string[]).includes(probe.quirk);
}

const FLAGGED = ORACLE.probes.filter(isFlagged);
const UNFLAGGED = ORACLE.probes.filter((probe) => !isFlagged(probe));
// Every quirk flag at Obsidian's behaviour, but line endings, which the oracle reads with `strictLineBreaks: true`.
const ALL_QUIRKS: ObsidianQuirkFlags = { ...OBSIDIAN_QUIRKS, softLineBreak: 'line-ending' };

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

/*
 * The probes of a quirk that is no flag on which every adapter, with every quirk flag on, does not give the reading
 * view's DOM. The same in each adapter: Obsidian's inline algorithm, tabs, lazy quote lines and paragraph whitespace.
 */
const UNFLAGGED_NOT_REPRODUCED = [
  'foo_bar_baz __a__b',
  '*a **b* c**',
  '**a *b** c*',
  '*a `*` b*',
  '*a <span title="*">x</span>',
  '*[a*](b)',
  '*a <http://x/*> b*',
  '***a***',
  '**a* *b**',
  'a ** b ** c',
  '_(a)_ *(*a*)*',
  '[a [b](c)](d)',
  '![a [b](c)][d]\n\n[d]: d.jpg',
  '[a `]` b](c)',
  '[a <http://x/]> b](c)',
  '[ a ] [A]\n\n[a]: /u',
  '[a]\n\n[ a ]: /u',
  '``a`b`` ``` a ``',
  '![*a* `b` [c](d)][e]\n\n[e]: e.jpg',
  '![a ![b][c]][d]\n\n[c]: c.jpg\n[d]: d.jpg',
  '>\ta',
  '>\t\tcode',
  '\tcode\n \tcode',
  '- a\n\n\t\tb',
  '-\t\ta',
  '> a\n>\nb',
  '> ```\na',
  '> a\n    b',
  '>     code\nb',
  '  a',
  ' a\n b',
  'a\t',
  '   a\n   b',
  '> \ta'
];

// The browser drops the end tag the engine's raw HTML leaves without its start tag.
const ENGINE_RAW_HTML = ['*a <span title="*">x</span>'];

describe('the quirk probe oracle', () => {
  it('holds every probe, in order', () => {
    expect(ORACLE.probes.map((probe) => probe.markdown)).toEqual(QUIRK_PROBES.map((probe) => probe.markdown));
  });
});

describe.each(ADAPTERS)('%s with the quirk flag of each probe', (adapter) => {
  it('reproduces the reading view on the probes', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const differing = FLAGGED.filter((probe) => {
      const toHtml = htmlRenderer(adapter, { preset: probe.preset, [probe.quirk]: OBSIDIAN_QUIRKS[probe.quirk] });
      return normalizeHtml(toHtml(probe.markdown)) !== normalizeHtml(probe.html);
    }).map((probe) => probe.markdown);
    expect(differing.toSorted(compareKeys)).toEqual(NOT_REPRODUCED[adapter].toSorted(compareKeys));
  });

  it('does not reproduce the quirks that are no flag', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const differing = UNFLAGGED.filter((probe) => {
      const toHtml = htmlRenderer(adapter, { preset: probe.preset, ...ALL_QUIRKS });
      return normalizeHtml(toHtml(probe.markdown)) !== normalizeHtml(probe.html);
    }).map((probe) => probe.markdown);
    expect(differing.toSorted(compareKeys)).toEqual(UNFLAGGED_NOT_REPRODUCED.toSorted(compareKeys));
  });
});

describe('the remark-parse 8 engine', () => {
  it('reproduces the reading view on every probe but the rendered ones and raw HTML, the quirks that are no flag included', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const differing = ORACLE.probes
      .filter((probe) => normalizeHtml(renderRemarkHtml(parseRemark(probe.markdown))) !== normalizeHtml(probe.html))
      .map((probe) => probe.markdown);
    expect(differing.toSorted(compareKeys)).toEqual([...RENDERED, ...ENGINE_RAW_HTML].toSorted(compareKeys));
  });
});
