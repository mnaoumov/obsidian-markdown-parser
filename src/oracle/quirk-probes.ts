/**
 * @file
 *
 * Documents beyond the spec examples that show the quirk flags' rules, read from a live Obsidian by
 * `scripts/quirk-probe-oracle.ts` into `oracle/quirk-probes-obsidian-<version>.json`. `gfmTable` and `listItem` were
 * measured on them; the others check what the flags read against the reading view. The probes of an
 * {@link UnflaggedQuirk} measure what no flag reproduces.
 */

import type { ObsidianQuirkFlags } from '../syntax/options.ts';
import type { SpecOracleMeta } from './spec-oracle-file.ts';

/**
 * A document that shows a quirk, and the preset it is read with.
 */
export interface QuirkProbe {
  /**
   * The document.
   */
  readonly markdown: string;

  /**
   * The preset: `gfm` for a table, `commonmark` otherwise.
   */
  readonly preset: 'commonmark' | 'gfm';

  /**
   * The quirk it shows: a flag, or a quirk that is no flag.
   */
  readonly quirk: keyof ObsidianQuirkFlags | UnflaggedQuirk;
}

/**
 * A quirk probe file.
 */
export interface QuirkProbeFile {
  /**
   * Where the probes were read.
   */
  readonly meta: SpecOracleMeta;

  /**
   * The probes, as Obsidian read them.
   */
  readonly probes: readonly QuirkProbeRead[];
}

/**
 * A probe as Obsidian read it.
 */
export interface QuirkProbeRead extends QuirkProbe {
  /**
   * The reading view's DOM with `strictLineBreaks: true`, normalized as `scripts/spec-oracle.ts` normalizes it.
   */
  readonly html: string;

  /**
   * The metadata worker's sections, each as `<type>@<first line>-<last line>`.
   */
  readonly sections: readonly string[];
}

/**
 * A quirk that no flag reproduces, since each adapter reads it inside its own inline algorithm or container handling:
 * code span runs, emphasis, image descriptions, lazy quote lines, links, tabs and paragraph whitespace.
 */
export type UnflaggedQuirk = 'codeSpan' | 'emphasis' | 'image' | 'lazyQuote' | 'link' | 'tab' | 'whitespace';

/**
 * The probes.
 */
export const QUIRK_PROBES: readonly QuirkProbe[] = [
  { markdown: '<http://a?b&copy=1&amp;c>', preset: 'commonmark', quirk: 'autolink' },
  { markdown: '<a:/b://c> <http://> <a@b> <x@> <MAILTO:a@b>', preset: 'commonmark', quirk: 'autolink' },
  { markdown: '<javascript://x> <foo:bar> <a/b://c>', preset: 'commonmark', quirk: 'autolink' },
  { markdown: '&copyx; &#128; &#x41 &AMP &notit; &#1; *&lt*', preset: 'commonmark', quirk: 'characterReference' },
  { markdown: '[&nbsp](/u "&copy t")', preset: 'commonmark', quirk: 'characterReference' },
  { markdown: '| a | b |\n:-: | -:\nc | d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n| :-: | -: |\nc | d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a | b\n| - | - |\nc | d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a | b\n- | -\n| c | d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a | b\n- | -\nc | d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n| - |\n| c |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a |\n| - | - |\n| c | d | e |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|\n|-|', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a\n|-|', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a |\n- |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a |\n- |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a\n| -', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n - | - \nc', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'x\n| a | b |\n| - | - |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n| - | - |\n> q', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n| - | - |\n- l', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n| - | - |\n`x|y`', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| f\\|oo |\n| - |\n| `\\|` |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|b|\n|-|-|\n|c\\|d|e|', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: ' | a |\n| - |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a |\n | - |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '   | a |\n   | - |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|\n|:|', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|b|\n|-||', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|b|\n|-| |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-\nc', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a | b\n--- | ---\n\\| c | d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n| - | - |\n|', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n| - | - |\n||', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-\nc|d|e', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|b|\n|-|-|\n| c |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b\n| - | -\n| c | d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a | b |\n- | - |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n|-|-|\n  | c | d |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '> | a | b |\n> | - | - |\n> | c | d |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| `a|b` | c |\n| - | - |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a | b |\n| -- | :-- |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|b|\n|---|---|\n|c|d|\n    |e|f|', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-\n> q|x', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-\n# h|x', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-\n- l|x', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-\n    c|d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '- a|b\n  -|-\n  c|d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-\n\nc|d', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '| a |\n|-:|\n| b |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n:-:|-\n', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: 'a|b\n-|-|-', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|\n|-|\n| x \\| y |', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '|a|\n|- -|', preset: 'gfm', quirk: 'gfmTable' },
  { markdown: '<div>\n  \nfoo', preset: 'commonmark', quirk: 'htmlBlock' },
  { markdown: 'foo\n</pre>', preset: 'commonmark', quirk: 'htmlBlock' },
  { markdown: 'foo\n<textarea>', preset: 'commonmark', quirk: 'htmlBlock' },
  { markdown: '<textarea>foo', preset: 'commonmark', quirk: 'htmlBlock' },
  { markdown: 'foo\n<meta>', preset: 'commonmark', quirk: 'htmlBlock' },
  { markdown: 'foo\n<search>', preset: 'commonmark', quirk: 'htmlBlock' },
  { markdown: '<meta>\nfoo\n\nbar', preset: 'commonmark', quirk: 'htmlBlock' },
  { markdown: 'a <!-- b -- c --> d', preset: 'commonmark', quirk: 'htmlComment' },
  { markdown: 'a <!-- b - c --> d', preset: 'commonmark', quirk: 'htmlComment' },
  { markdown: 'a <!---> b', preset: 'commonmark', quirk: 'htmlComment' },
  { markdown: 'a <!--->--> b', preset: 'commonmark', quirk: 'htmlComment' },
  { markdown: 'a <!----> b', preset: 'commonmark', quirk: 'htmlComment' },
  { markdown: '[a]: /u "t\nx"\n\n[a]', preset: 'commonmark', quirk: 'linkDefinition' },
  { markdown: '[b]: /u\n---\n[b]', preset: 'commonmark', quirk: 'linkDefinition' },
  { markdown: '[c]:\n  /u\n  (t)\n\n[c]', preset: 'commonmark', quirk: 'linkDefinition' },
  { markdown: '> [d]: /u\n> "t" z\n\n[d]', preset: 'commonmark', quirk: 'linkDefinition' },
  { markdown: '[e]: <>x\n\n[e]', preset: 'commonmark', quirk: 'linkDefinition' },
  { markdown: '[a[b]: /u\n\n[a[b]', preset: 'commonmark', quirk: 'linkDefinition' },
  { markdown: ' -    one\n\n     two', preset: 'commonmark', quirk: 'listItem' },
  { markdown: ' -    one\n     two', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n\n     b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n\n    b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '-   a\n\n     b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '1234567890. x', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '12345678901234. x', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n - b\n  - c\n   - d\n    - e\n     - f', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n    - b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n     - b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '1. a\n\n  2. b\n\n    3. c', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '1. a\n    2. b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '-\n  foo', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '-\n\n  foo', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '-\n\n\n  foo', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '-\n      baz', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '-\n     baz', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '-\n    baz', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n\n\n  b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '* a\n- b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n* b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '1. a\n2) b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n  > q\n- b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '10. a\n    b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n\n      code', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n\n        code', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\nb', preset: 'commonmark', quirk: 'listItem' },
  { markdown: '- a\n\n b', preset: 'commonmark', quirk: 'listItem' },
  { markdown: 'a*b*c a_b_c', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: 'foo_bar_baz __a__b', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '*foo*bar **foo**bar', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '*a **b* c**', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '**a *b** c*', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '*a `*` b*', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '*a <span title="*">x</span>', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '*[a*](b)', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '*a <http://x/*> b*', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '***a***', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '*a**b*', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '* a *', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: 'x *a\n* b', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '**a* *b**', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '_a *b_ c*', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: 'a ** b ** c', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '_(a)_ *(*a*)*', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '"*a*" ."_b_".', preset: 'commonmark', quirk: 'emphasis' },
  { markdown: '*a ~~b* c~~', preset: 'gfm', quirk: 'emphasis' },
  { markdown: '~~a *b~~ c*', preset: 'gfm', quirk: 'emphasis' },
  { markdown: '[a [b](c)](d)', preset: 'commonmark', quirk: 'link' },
  { markdown: '![a [b](c)][d]\n\n[d]: d.jpg', preset: 'commonmark', quirk: 'link' },
  { markdown: '[![a][b]](c)\n\n[b]: b.jpg', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a](<b c>) [a](b c)', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a]( b ) [a](b "t" )', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a `]` b](c)', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a <b>]</b>](c)', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a <http://x/]> b](c)', preset: 'commonmark', quirk: 'link' },
  { markdown: String.raw`[a](b\)c) [a](b(c)d) [a](b((c))d)`, preset: 'commonmark', quirk: 'link' },
  { markdown: '[a](b)(c) [a](b)[c]', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a][b] [a] [b] [b][]\n\n[b]: /u', preset: 'commonmark', quirk: 'link' },
  { markdown: '[ a ] [A]\n\n[a]: /u', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a]\n\n[ a ]: /u', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a](b \'t\') [a](b (t)) [a](b "t)', preset: 'commonmark', quirk: 'link' },
  { markdown: '[a\nb](c) [a](\nb\n)', preset: 'commonmark', quirk: 'link' },
  { markdown: '[*a](b*)', preset: 'commonmark', quirk: 'link' },
  { markdown: '``a`b`` ``` a ``', preset: 'commonmark', quirk: 'codeSpan' },
  { markdown: '`a``b` `` `a` ``', preset: 'commonmark', quirk: 'codeSpan' },
  { markdown: '` a ` `  ` ` `', preset: 'commonmark', quirk: 'codeSpan' },
  { markdown: '``a\nb`` `a\\`b`', preset: 'commonmark', quirk: 'codeSpan' },
  { markdown: '```a`` b```', preset: 'commonmark', quirk: 'codeSpan' },
  { markdown: '![*a* `b` [c](d)][e]\n\n[e]: e.jpg', preset: 'commonmark', quirk: 'image' },
  { markdown: '![a\\*b &amp; c][e]\n\n[e]: e.jpg', preset: 'commonmark', quirk: 'image' },
  { markdown: '![a ![b][c]][d]\n\n[c]: c.jpg\n[d]: d.jpg', preset: 'commonmark', quirk: 'image' },
  { markdown: '-\ta', preset: 'commonmark', quirk: 'tab' },
  { markdown: '>\ta', preset: 'commonmark', quirk: 'tab' },
  { markdown: '>\t\tcode', preset: 'commonmark', quirk: 'tab' },
  { markdown: '\tcode\n \tcode', preset: 'commonmark', quirk: 'tab' },
  { markdown: '- a\n\n\tb', preset: 'commonmark', quirk: 'tab' },
  { markdown: '- a\n\n\t\tb', preset: 'commonmark', quirk: 'tab' },
  { markdown: '1.\ta\n\n\tb', preset: 'commonmark', quirk: 'tab' },
  { markdown: '-\t\ta', preset: 'commonmark', quirk: 'tab' },
  { markdown: '> a\nb', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '> a\n>\nb', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '> - a\nb', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '> ```\na', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '> a\n    b', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '>> a\nb', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '- > a\nb', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '> a\n- b', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '> a\n\nb', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '>     code\nb', preset: 'commonmark', quirk: 'lazyQuote' },
  { markdown: '  a', preset: 'commonmark', quirk: 'whitespace' },
  { markdown: 'a  \nb', preset: 'commonmark', quirk: 'whitespace' },
  { markdown: ' a\n b', preset: 'commonmark', quirk: 'whitespace' },
  { markdown: 'a\t', preset: 'commonmark', quirk: 'whitespace' },
  { markdown: '   a\n   b', preset: 'commonmark', quirk: 'whitespace' },
  { markdown: '> \ta', preset: 'commonmark', quirk: 'whitespace' }
];
