/**
 * @file
 *
 * Where Obsidian reads the CommonMark and GFM spec examples differently from the specs, measured by
 * `scripts/spec-oracle.ts`, and why.
 *
 * {@link SPEC_DIFFERENCES} explains every example on which the reading view's HTML differs from the spec's, with
 * `strictLineBreaks: true`, and every example that `strictLineBreaks: false`, the app's default, changes. Each entry is
 * one behaviour:
 *
 * - `quirk`: Obsidian's parser reads valid markdown differently. The metadata worker runs the same parser: its sections
 *   agree with the reading view's blocks on every example but the few {@link WORKER_SECTION_MISMATCHES}. A quirk that
 *   is a flag of `ObsidianQuirkFlags` names it, and one that is not says why.
 * - `syntax`: a flag of `ObsidianSyntaxFlags`, which the `obsidian` preset turns on.
 * - `rendering`: the reading view changes the parser's HTML after the parse: its HTML sanitizer, and its embeds.
 * - `comparison`: the spec's HTML holds an unclosed inline tag, which the browser closes and repeats when it reads it,
 *   so it differs from the reading view's DOM where the two parses agree.
 */

import type { ObsidianQuirkFlags } from '../syntax/options.ts';
import type {
  SpecOracleExample,
  SpecOracleFile,
  SpecOracleRead
} from './spec-oracle-file.ts';

/**
 * One behaviour behind a difference between Obsidian and the specs.
 */
export interface SpecDifference {
  /**
   * The behaviour, with the examples that show each part of it.
   */
  readonly behaviour: string;

  /**
   * The CommonMark examples it changes.
   */
  readonly commonmark: readonly number[];

  /**
   * The quirk flag that reproduces it, for a quirk that is one.
   */
  readonly flag?: keyof ObsidianQuirkFlags;

  /**
   * The GFM extension examples it changes.
   */
  readonly gfm?: readonly number[];

  /**
   * What kind of difference it is.
   */
  readonly kind: 'comparison' | 'quirk' | 'rendering' | 'syntax';

  /**
   * A short name.
   */
  readonly name: string;

  /**
   * For a quirk that is no flag: why not.
   */
  readonly notAFlag?: string;
}

interface CachedMetadataSection {
  readonly type: string;
}

interface CachedMetadataSections {
  readonly sections?: readonly CachedMetadataSection[];
}

const INLINE_ALGORITHM = 'Each adapter reads inline content with its own delimiter and bracket algorithm, which no extension point changes: reproducing it needs Obsidian\'s inline algorithm in place of the adapter\'s.';

/* eslint-disable no-magic-numbers -- The spec example numbers are the data. */
/**
 * Every behaviour behind a difference between Obsidian 1.14.4 and the spec examples.
 */
export const SPEC_DIFFERENCES: readonly SpecDifference[] = [
  {
    behaviour: 'A setext heading\'s text is one line, and its underline starts its line and ends with its marker. A paragraph of more lines keeps a `===` line as text (81, 82), and a `---` line after it is a thematic break (95). An indented underline (84, 86) is text or a thematic break.',
    commonmark: [81, 82, 84, 86, 95],
    flag: 'setextHeading',
    kind: 'quirk',
    name: 'single-line setext headings'
  },
  {
    behaviour: 'An empty list item interrupts a paragraph: `*` (285, 367) and `1.` (285) open a list.',
    commonmark: [285, 367],
    flag: 'emptyListItem',
    kind: 'quirk',
    name: 'empty list items interrupt paragraphs'
  },
  {
    behaviour: 'A list is loose when a blank line anywhere inside it is followed by more of it: in a nested list (307, 319) or in fenced code (318).',
    commonmark: [307, 318, 319],
    flag: 'looseList',
    kind: 'quirk',
    name: 'loose lists'
  },
  {
    behaviour: 'With `strictLineBreaks: false`, the app\'s default, every line ending inside a paragraph is a hard line break.',
    commonmark: [
      14,
      25,
      28,
      37,
      46,
      49,
      70,
      81,
      82,
      84,
      87,
      88,
      95,
      104,
      105,
      106,
      113,
      138,
      145,
      187,
      196,
      210,
      213,
      217,
      220,
      222,
      223,
      224,
      228,
      229,
      230,
      232,
      233,
      241,
      243,
      247,
      250,
      251,
      253,
      254,
      286,
      287,
      288,
      290,
      291,
      292,
      293,
      304,
      334,
      384,
      394,
      405,
      423,
      432,
      490,
      494,
      505,
      543,
      552,
      556,
      587,
      621,
      625,
      648,
      649
    ],
    flag: 'softLineBreak',
    gfm: [199],
    kind: 'quirk',
    name: 'soft line breaks are hard'
  },
  {
    behaviour: 'A tab is not expanded to its tab stop: `  \\t` is no code indentation (2), a tab after a container marker gives code no columns (5, 6, 7), a tab-indented marker is not nested (9), and tabs between thematic break markers make a list (11).',
    commonmark: [2, 5, 6, 7, 9, 11],
    kind: 'quirk',
    name: 'tabs',
    notAFlag: 'Each adapter measures indentation in its own line reader (`Line.countIndent`, micromark\'s virtual spaces, markdown-it\'s `sCount`), which no extension point reaches.'
  },
  {
    behaviour: 'A named character reference needs no `;` (`&nbsp`, `&copy`), and a numeric one past the last code point is U+FFFD.',
    commonmark: [28, 29],
    kind: 'quirk',
    name: 'character references',
    notAFlag: 'Not done yet: each adapter can read references with an inline parser of its own.'
  },
  {
    behaviour: 'A paragraph keeps the whitespace its first line starts with (222, 224, 252, 255, 275, 276), also after a list marker (278, 280).',
    commonmark: [82, 84, 222, 224, 252, 255, 275, 276, 278, 280],
    kind: 'quirk',
    name: 'leading whitespace',
    notAFlag: 'The trees keep the whitespace\'s range, not its text, and HTML collapses it. Only a renderer would show it.'
  },
  {
    behaviour: 'A paragraph keeps the whitespace its last line ends with (226, 645), and a quote line of nothing but spaces after `>` continues its paragraph (241).',
    commonmark: [226, 241, 645],
    kind: 'quirk',
    name: 'trailing whitespace',
    notAFlag: 'The trees keep the whitespace\'s range, not its text, and HTML collapses it. Only a renderer would show it.'
  },
  {
    behaviour: 'Fenced code that runs to the end of the document keeps the document\'s last line ending as an empty last line.',
    commonmark: [127, 137, 139],
    kind: 'quirk',
    name: 'unclosed fenced code',
    notAFlag: 'The code block\'s range is the same; only its text, which renderers take from the source, differs.'
  },
  {
    behaviour: 'A lazy line continues a quote after an empty `>` line (249) and inside fenced code (237). A line indented four or more columns ends the quote as code (238), and a lazy line with a setext underline below it is a heading after the quote (93).',
    commonmark: [93, 237, 238, 249],
    kind: 'quirk',
    name: 'lazy quote lines',
    notAFlag: 'Lazy continuation is decided inside each adapter\'s container handling (`@lezer/markdown`\'s block context, micromark\'s document tokenizer, markdown-it\'s blockquote rule), which no extension point reaches.'
  },
  {
    behaviour: 'A link reference definition\'s title is on its own line or none (196, 210), `<>` is no destination (200), a title with an escaped quote is no title (202), and a setext underline below a definition makes it a heading (216).',
    commonmark: [196, 200, 202, 210, 216],
    kind: 'quirk',
    name: 'link reference definitions',
    notAFlag: 'Each adapter reads definitions in its own paragraph handling (`@lezer/markdown`\'s link reference leaf parser, micromark\'s content construct, markdown-it\'s reference rule). Not done yet.'
  },
  {
    behaviour: 'List items: a marker indented four or more columns, but less than the item\'s content, opens a sibling item (312, 313); a paragraph indented less than the content column after a blank line stays in the item (257); an ordered marker takes ten or more digits (266); an item that starts with an empty line keeps an indented paragraph after a blank line (280), and its content starts a column further left (278).',
    commonmark: [257, 266, 278, 280, 312, 313],
    kind: 'quirk',
    name: 'list item structure',
    notAFlag: 'List item continuation is internal to `@lezer/markdown`, as for example 280 in the CommonMark suite. micromark and markdown-it need their list constructs replaced. Not done yet.'
  },
  {
    behaviour: '`<textarea>` opens no raw HTML block (171), as in CommonMark 0.30, and a `</pre>` line ends a paragraph (148).',
    commonmark: [148, 171],
    flag: 'htmlBlock',
    kind: 'quirk',
    name: 'HTML block kinds'
  },
  {
    behaviour: 'An HTML comment follows CommonMark 0.30: `--` inside one (625), `<!-->` and `<!--->` (626) are text.',
    commonmark: [625, 626],
    flag: 'htmlComment',
    kind: 'quirk',
    name: 'HTML comments'
  },
  {
    behaviour: 'A code span\'s opening backtick run closes at a shorter run, leaving the rest of the opener as text (347).',
    commonmark: [347],
    kind: 'quirk',
    name: 'code span runs',
    notAFlag: INLINE_ALGORITHM
  },
  {
    behaviour: 'Emphasis has its own delimiter rules: no flanking checks (351, 352, 353, 354, 358, 359, 366, 368, 371, 379, 380, 383, 384, 385, 391, 392, 397, 398), `_` opens and closes inside words (360, 362, 375, 386, 387, 388, 400, 401, 402), delimiters pair first come first served, not by the rule of three or by nesting (369, 373, 389, 407, 408, 409, 413, 414, 415, 416, 417, 418, 425, 426, 427, 432, 437, 439, 443, 444, 445, 446, 447, 449, 451, 455, 456, 457, 458, 459, 464, 465, 466, 467, 468, 470, 471, 472), and emphasis is matched before code spans (341, 478, 479), raw HTML (475, 476, 477), autolinks (480, 481) and link brackets (419, 473, 474, 521, 534, 564), and in an email address (GFM 631).',
    commonmark: [
      341,
      351,
      352,
      353,
      354,
      358,
      359,
      360,
      362,
      366,
      368,
      369,
      371,
      373,
      375,
      379,
      380,
      383,
      384,
      385,
      386,
      387,
      388,
      389,
      391,
      392,
      397,
      398,
      400,
      401,
      402,
      407,
      408,
      409,
      413,
      414,
      415,
      416,
      417,
      418,
      419,
      425,
      426,
      427,
      432,
      437,
      439,
      443,
      444,
      445,
      446,
      447,
      449,
      451,
      455,
      456,
      457,
      458,
      459,
      464,
      465,
      466,
      467,
      468,
      470,
      471,
      472,
      473,
      474,
      475,
      476,
      477,
      478,
      479,
      480,
      481,
      521,
      534,
      564
    ],
    gfm: [631],
    kind: 'quirk',
    name: 'emphasis',
    notAFlag: INLINE_ALGORITHM
  },
  {
    behaviour: 'Links: a link may hold a link (518, 519, 532, 533), link brackets are matched before code spans (342, 525, 537), raw HTML (524, 536) and autolinks (526, 538), a reference label matches without its backslash escapes (545), may hold brackets (546, 547) or only whitespace (552), `[foo][bar][baz]` pairs from the end (569, 571), a pointy destination may end with `\\>` (493), and Unicode whitespace separates a title (507).',
    commonmark: [342, 493, 507, 518, 519, 524, 525, 526, 532, 533, 536, 537, 538, 545, 546, 547, 552, 569, 571],
    kind: 'quirk',
    name: 'links',
    notAFlag: INLINE_ALGORITHM
  },
  {
    behaviour: 'An image\'s description is its source text, markup included.',
    commonmark: [520, 573, 574, 575, 576, 577, 585, 589],
    kind: 'quirk',
    name: 'image descriptions',
    notAFlag: 'The trees hold the description\'s inline nodes as CommonMark does; only the HTML takes its text from them.'
  },
  {
    behaviour: 'An autolink takes only some schemes (598, 601), an email autolink may hold a backslash (606), and a `mailto:` autolink shows its address without the scheme (597).',
    commonmark: [597, 598, 601, 606],
    kind: 'quirk',
    name: 'autolinks',
    notAFlag: 'Not done yet: each adapter reads autolinks with its own construct.'
  },
  {
    behaviour: 'Tables: a delimiter row without edge pipes under a header with them makes none (199), `\\|` in a code span keeps its backslash (200), a line without a pipe ends the table (202), and a delimiter row with fewer cells than the header still makes one (203).',
    commonmark: [],
    gfm: [199, 200, 202, 203],
    kind: 'quirk',
    name: 'tables',
    notAFlag: 'Not done yet: each adapter takes its table extension from its own package.'
  },
  {
    behaviour: 'An `ftp://` address is no bare URL, as for `@lezer/markdown`, micromark and github.com today.',
    commonmark: [],
    gfm: [628],
    kind: 'quirk',
    name: 'ftp addresses',
    notAFlag: 'Every adapter already reads it so (`docs/spec-suites.md`).'
  },
  {
    behaviour: 'No tag filter: `<title>` and the other disallowed tags are raw HTML.',
    commonmark: [],
    gfm: [652],
    kind: 'quirk',
    name: 'tag filter',
    notAFlag: 'The tag filter is a step of rendering, which every adapter leaves to the renderer.'
  },
  {
    behaviour: 'The `obsidian` preset\'s syntax flags: `tag` (64), `frontMatter` (96, 98), `internalLink` (548, 559, 590) and `autolinkLiteral` (602, 608, 611, 612).',
    commonmark: [64, 96, 98, 548, 559, 590, 602, 608, 611, 612],
    kind: 'syntax',
    name: 'Obsidian syntax'
  },
  {
    behaviour: 'The reading view\'s HTML sanitizer removes `<script>`, `<style>`, comments, processing instructions, declarations, CDATA, elements it does not know and their attributes.',
    commonmark: [150, 163, 169, 170, 172, 173, 176, 177, 178, 179, 180, 182, 183, 201, 308, 309, 491, 613, 614, 615, 616, 617, 628, 629],
    gfm: [652],
    kind: 'rendering',
    name: 'HTML sanitizer'
  },
  {
    behaviour: 'An image whose target is no URL is an embed of a vault file, which renders no title (572, 579) and no empty description (581).',
    commonmark: [572, 579, 581],
    kind: 'rendering',
    name: 'embeds'
  },
  {
    behaviour: 'The spec\'s HTML holds an unclosed tag, which the browser closes and repeats when it reads it.',
    commonmark: [148, 187, 344, 476, 477, 494, 630, 631, 642, 643],
    kind: 'comparison',
    name: 'unclosed tags in the spec'
  }
];
/* eslint-enable no-magic-numbers -- The data ends here. */

/**
 * The examples on which the worker's sections and the reading view's top-level blocks differ: raw HTML, which the
 * reading view reads into elements and its sanitizer prunes, and front matter, which it renders as hidden code.
 */
export const WORKER_SECTION_MISMATCHES: readonly string[] = [
  'commonmark:96',
  'commonmark:98',
  'commonmark:148',
  'commonmark:149',
  'commonmark:152',
  'commonmark:155',
  'commonmark:160',
  'commonmark:167',
  'commonmark:169',
  'commonmark:171',
  'commonmark:184',
  'commonmark:188',
  'commonmark:190',
  'commonmark:191'
];

const BETWEEN_TAGS_RE = />\s+</gu;
const TAG_RE = /<(?<close>\/?)(?<name>[\da-z-]+)[^>]*>/gu;
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input']);
const SECTION_OF_TAG: Readonly<Record<string, string>> = {
  blockquote: 'blockquote',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  hr: 'thematicBreak',
  ol: 'list',
  p: 'paragraph',
  pre: 'code',
  table: 'table',
  ul: 'list'
};
// The sections with no block of their own in the reading view's HTML.
const UNRENDERED_SECTIONS = new Set(['definition', 'html', 'yaml']);

/**
 * The key of an example: its suite and its number.
 *
 * @param example - The example.
 * @returns The key, `<suite>:<number>`.
 */
export function exampleKey(example: Pick<SpecOracleExample, 'example' | 'suite'>): string {
  return `${example.suite}:${String(example.example)}`;
}

/**
 * The examples on which the reading view's HTML, with `strictLineBreaks: true`, differs from the spec's.
 *
 * @param file - The spec oracle.
 * @returns Their keys.
 */
export function readingViewDifferences(file: SpecOracleFile): string[] {
  return file.examples.filter((read) => normalizeHtml(read.htmlStrict) !== normalizeHtml(read.specDom)).map((read) => exampleKey(read));
}

/**
 * The keys of the examples a difference lists.
 *
 * @param difference - The difference.
 * @returns Their keys.
 */
export function specDifferenceKeys(difference: SpecDifference): string[] {
  return [
    ...difference.commonmark.map((example) => exampleKey({ example, suite: 'commonmark' })),
    ...(difference.gfm ?? []).map((example) => exampleKey({ example, suite: 'gfm' }))
  ];
}

/**
 * The examples whose reading view `strictLineBreaks: false`, the app's default, changes.
 *
 * @param file - The spec oracle.
 * @returns Their keys.
 */
export function strictLineBreakDifferences(file: SpecOracleFile): string[] {
  return file.examples.filter((read) => normalizeHtml(read.html) !== normalizeHtml(read.htmlStrict)).map((read) => exampleKey(read));
}

/**
 * The examples on which the worker's sections, without the ones the reading view does not render, differ from the
 * reading view's top-level blocks.
 *
 * @param file - The spec oracle.
 * @returns Their keys.
 */
export function workerSectionMismatches(file: SpecOracleFile): string[] {
  return file.examples.filter((read) => workerSections(read).join(' ') !== readingViewBlocks(read).join(' ')).map((read) => exampleKey(read));
}

function normalizeHtml(html: string): string {
  return html.replaceAll(BETWEEN_TAGS_RE, '><').trim();
}

// The sections of the reading view's top-level elements, without raw HTML.
function readingViewBlocks(read: SpecOracleRead): string[] {
  const blocks: string[] = [];
  let depth = 0;
  for (const match of read.htmlStrict.matchAll(TAG_RE)) {
    if (match.groups?.['close'] === '/') {
      depth--;
      continue;
    }
    const name = match.groups?.['name'] ?? '';
    if (depth === 0) {
      blocks.push(SECTION_OF_TAG[name] ?? 'html');
    }
    if (!VOID_TAGS.has(name)) {
      depth++;
    }
  }
  return blocks.filter((block) => block !== 'html');
}

function workerSections(read: SpecOracleRead): string[] {
  const metadata = read.metadata as CachedMetadataSections | null;
  return (metadata?.sections ?? []).map((section) => section.type).filter((type) => !UNRENDERED_SECTIONS.has(type));
}
