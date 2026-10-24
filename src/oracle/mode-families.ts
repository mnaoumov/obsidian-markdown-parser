/**
 * @file
 *
 * The families the judge's differences fall into, each told by the minimal note `reduceDifference` leaves and the
 * difference it keeps. A family is a known bug (one of the forum issues), a behaviour the editor shows by design, a
 * quirk of the reading view's parser that the spec and quirk probe oracles already measure, or a new candidate. The
 * first family that matches a difference takes it, so the more specific ones come first.
 */

import type {
  ModeDifferenceKey,
  ModeSide
} from './mode-judge.ts';

import { parseDifferenceKey } from './mode-judge.ts';

/**
 * A family of differences.
 */
export interface ModeFamily {
  /**
   * The family id.
   */
  readonly id: string;

  /**
   * The forum issue that reports it, as in `EDITING_MODES_VS_READING_VIEW_SAMPLES`, for a known family.
   */
  readonly issue?: string;

  /**
   * What it is.
   */
  readonly kind: ModeFamilyKind;

  /**
   * Whether a difference belongs to it.
   */
  readonly matches: (key: ModeDifferenceKey, reduced: string) => boolean;

  /**
   * The behaviour, in one sentence.
   */
  readonly note: string;
}

/**
 * What a family is.
 */
export type ModeFamilyKind =
  /**
  A candidate bug no forum issue reports yet.
   */
  | 'candidate'
  /**
  The editor's line tokenizer styles a mark it has not seen closed yet, while it is being typed.
   */
  | 'expected'
  /**
  A forum issue already reports it.
   */
  | 'known'
  /**
  The reading view departs from CommonMark where the editor follows it; the spec and quirk probe oracles measure it.
   */
  | 'quirk';

// Lines that each open with a run of backticks that nothing on the line closes.
const UNCLOSED_CODE_MARKS = /^(?:`+[^`\n]*(?:\n|$))+$/u;

function isKey(key: ModeDifferenceKey, side: ModeSide, facts: RegExp): boolean {
  return key.side === side && facts.test(key.fact);
}

/**
 * The families, the most specific first.
 */
export const MODE_FAMILIES: readonly ModeFamily[] = [
  {
    id: 'highlight-equals-run',
    issue: 'issue-5',
    kind: 'known',
    matches: (key, reduced) => key.fact === 'highlight' && /[=]=[=>]/u.test(reduced),
    note: 'A highlight mark next to a third `=` or a `>` pairs differently.'
  },
  {
    id: 'math-in-link-text',
    issue: 'issue-9',
    kind: 'known',
    matches: (key, reduced) => (key.side === 'readingView' && key.fact === 'math') && /\[[^\]\n]*\$/u.test(reduced),
    note: 'The editor opens no math inside a markdown link\'s text.'
  },
  {
    id: 'quoted-task',
    issue: 'issue-11',
    kind: 'known',
    matches: (key, reduced) => isKey(key, 'readingView', /^(?:task|list)$/u) && /^>+ ?[-*+] \[.\]/mu.test(reduced),
    note: 'The editor reads a task marker in a quoted list item as a link.'
  },
  {
    id: 'fence-left-open-in-container',
    issue: 'issue-12',
    kind: 'known',
    matches: (_key, reduced) => /^(?:>+ ?|\s*(?:[-*+]|\d+[.)]) +)+(?:```|~~~)/mu.test(reduced) && !/^>+(?:```|~~~)[^\n]*\n>>/mu.test(reduced),
    note: 'A fence left open in a quote or a list item stays open after it in the editor.'
  },
  {
    id: 'indented-math',
    issue: 'issue-existing-50661',
    kind: 'known',
    matches: (_key, reduced) => /^(?: {4,}|\t)\$/mu.test(reduced),
    note: 'The editor reads math at the start of an indented code line.'
  },
  {
    id: 'comment-opened-mid-line',
    issue: 'issue-6',
    kind: 'known',
    matches: (key, reduced) => key.fact === 'comment' && /(?:[^\n%]|^)%%[^\n]*(?:\n|$)/u.test(reduced) && /[^\n]%%|%%%/u.test(reduced),
    note: 'A `%%` opened mid-line runs to the end of the note in the editor, and closes at a later line\'s `%%` where the reading view opens a block comment.'
  },
  {
    id: 'setext-after-math-line',
    issue: 'issue-10',
    kind: 'known',
    matches: (key, reduced) => /^(?:heading-\d|thematicBreak)$/u.test(key.fact) && /^\$/mu.test(reduced) && /(?:\n|\$) *-+ *$/u.test(reduced) && !reduced.includes('$$'),
    note: 'Once a line has started with math, the editor reads a setext underline as a thematic break.'
  },
  {
    id: 'four-dollars',
    kind: 'candidate',
    matches: (_key, reduced) => reduced.includes('$$$$'),
    note: 'A line `$$$$` is empty display math in the editor and opens a math block in the reading view.'
  },
  {
    id: 'math-left-open',
    issue: 'issue-7',
    kind: 'known',
    matches: (_key, reduced) => reduced.includes('$$') && !/^(?: {4}|\t)\S[^\n]*\n\$\$/mu.test(reduced),
    note: 'A `$$` left open stays open as math over the next blocks in the editor.'
  },
  {
    id: 'code-span-across-lines',
    issue: 'issue-8',
    kind: 'known',
    matches: (key, reduced) => key.fact === 'code' && /(?<!`)(?<run>`+)(?!`)[^`\n]*\n[^`]*(?<!`)\k<run>(?!`)/u.test(reduced) && !/^(?:```|~~~)/mu.test(reduced),
    note: 'The editor ends a code span at the end of its line; the reading view runs it across the line break.'
  },
  {
    id: 'code-span-pairing',
    kind: 'quirk',
    matches: (key, reduced) => (key.side === 'readingView' && key.fact === 'code') && /(?<!`)``(?!`)[^`]*(?<!`)`(?!`)/u.test(reduced),
    note: 'The reading view pairs a run of backticks with a shorter run into a code span, where CommonMark keeps both as text.'
  },
  {
    id: 'unclosed-inline-mark',
    kind: 'expected',
    matches: (key, reduced) =>
      (isKey(key, 'editor', /^(?:em|highlight|strikethrough|strong)$/u) && !/[<$]|^---/u.test(reduced))
      || (isKey(key, 'editor', /^code$/u) && UNCLOSED_CODE_MARKS.test(reduced) && !/^`{3}/u.test(reduced))
      || (key.side === 'readingView' && /^`[^`\n]*$/u.test(reduced)),
    note: 'The editor styles an emphasis, highlight or strikethrough mark it has not seen closed, or one the reading view does not pair, up to the end of its paragraph, and a code mark up to the end of its line, as it is typed.'
  },
  {
    id: 'unclosed-front-matter',
    kind: 'candidate',
    matches: (_key, reduced) => /^---(?:\n|$)/u.test(reduced) && !/\n---[ \t]*(?:\n|$)/u.test(reduced),
    note: 'A note opening with a `---` line that no later `---` closes is front matter to its end in the editor and a thematic break in the reading view.'
  },
  {
    id: 'fence-in-quote-nested-quote',
    kind: 'candidate',
    matches: (key, reduced) => /^quote-\d$/u.test(key.fact) && /^>+(?:```|~~~)[^\n]*\n>>/mu.test(reduced),
    note: 'Inside a fence opened in a quote, the editor reads a deeper `>` as a nested quote where the reading view reads code.'
  },
  {
    id: 'indented-fence-closer',
    kind: 'candidate',
    matches: (_key, reduced) => /^(?:```|~~~)[^\n]*\n {1,3}(?:```|~~~)/mu.test(reduced),
    note: 'The editor does not close a fence at a closing fence indented by up to three spaces.'
  },
  {
    id: 'fence-info-with-backtick',
    kind: 'candidate',
    matches: (_key, reduced) => /^~~~[^`\n]*`/mu.test(reduced),
    note: 'The editor opens no tilde fence whose info string holds a backtick, which CommonMark and the reading view read as a fence.'
  },
  {
    id: 'triple-backtick-mid-line',
    kind: 'candidate',
    matches: (key, reduced) => (key.side === 'readingView' || (key.fact === 'code' && key.isMultiline)) && /^[^\n]*[^\s`]```|^```[^`\n]*`/mu.test(reduced),
    note: 'A run of three backticks that opens no fence, after other text on a line or before an info string holding a backtick, and is left unclosed, makes the rest of the note inline code in the editor.'
  },
  {
    id: 'html-block-ends-at-line',
    kind: 'candidate',
    matches: (key, reduced) => key.side === 'editor' && /^<\/?[A-Za-z][^\n]*\n/mu.test(reduced),
    note: 'The editor ends at its own line an HTML block that the reading view runs on to the next empty line, so the editor styles markdown the reading view shows as raw HTML.'
  },
  {
    id: 'unfinished-html-tag',
    kind: 'candidate',
    matches: (key, reduced) => key.side === 'readingView' && /<[A-Za-z!/][^\n>]*(?:\n|$)/u.test(reduced),
    note: 'The editor reads the rest of a line and the next lines after an unfinished HTML tag as the tag, so it styles none of their markdown.'
  },
  {
    id: 'inline-html-before-internal-link',
    kind: 'candidate',
    matches: (key, reduced) => (key.side === 'readingView' && key.fact === 'internalLink') && /<[a-z]+>\[\[/u.test(reduced),
    note: 'The editor styles no internal link right after an inline HTML tag.'
  },
  {
    id: 'lazy-line-after-empty-quote-line',
    kind: 'candidate',
    matches: (key, reduced) => isKey(key, 'editor', /^(?:quote-\d|thematicBreak)$/u) && /^>+\s*\n/mu.test(reduced),
    note: 'After an empty quote line the editor carries the quote onto the next line, which the reading view reads as a block of its own.'
  },
  {
    id: 'block-on-list-item-first-line',
    kind: 'candidate',
    matches: (key, reduced) => key.side === 'readingView' && /^\s*(?:>+ ?)*(?:[-*+]|\d+[.)])[ \t]+(?:>|\*\*\*|[-*+] |#)/mu.test(reduced),
    note: 'The editor reads no quote, thematic break, heading or nested list item opened on a list item\'s first line.'
  },
  {
    id: 'heading-in-quote',
    kind: 'candidate',
    matches: (key, reduced) => isKey(key, 'readingView', /^heading-\d$/u) && /^>+ ?#/mu.test(reduced),
    note: 'The editor gives a heading in a quote no heading classes.'
  },
  {
    id: 'tag-after-mark',
    kind: 'candidate',
    matches: (key, reduced) => (key.side === 'readingView' && key.fact === 'tag') && /[*=`_~]#|\[[^\]\n]*#/u.test(reduced),
    note: 'The editor reads no tag right after an emphasis, highlight or code mark, or after an unclosed `[`.'
  },
  {
    id: 'ordered-item-interrupts-paragraph',
    kind: 'candidate',
    matches: (key, reduced) => isKey(key, 'editor', /^(?:list|task)$/u) && /\S\n(?!1[.)])\d+[.)] /u.test(reduced),
    note: 'In the editor an ordered list item not numbered 1 interrupts a paragraph, which CommonMark and the reading view keep going.'
  },
  {
    id: 'empty-list-item',
    kind: 'candidate',
    matches: (key, reduced) => ((key.side === 'readingView' && key.fact === 'list') && /^(?:[-*+]|\d+[.)])$/mu.test(reduced)) || (isKey(key, 'editor', /^heading-\d$/u) && /^[-*+]\n/u.test(reduced)),
    note: 'The editor reads a list marker alone on its line as text; the reading view reads an empty list item.'
  },
  {
    id: 'one-dash-setext-underline',
    kind: 'candidate',
    matches: (key, reduced) => (key.side === 'readingView' && key.fact === 'heading-2') && reduced.endsWith('\n-'),
    note: 'The editor reads a setext underline of one `-` as an empty list item; the reading view reads a heading.'
  },
  {
    id: 'setext-in-quote',
    kind: 'candidate',
    matches: (key, reduced) => ((key.side === 'editor' && key.fact === 'thematicBreak') || (key.side === 'readingView' && key.fact === 'heading-2')) && /^>[^\n]+\n>-+$/mu.test(reduced),
    note: 'The editor reads a setext underline in a quote as a thematic break; the reading view reads a heading.'
  },
  {
    id: 'setext-under-special-line',
    kind: 'candidate',
    matches: (key, reduced) => (key.side === 'editor' && key.fact === 'thematicBreak') && /(?:^|\n)(?:\[[^\]\n]*\]:|\^|\|| \t)[^\n]*\n---$/u.test(reduced),
    note: 'The editor reads a `---` under a paragraph line that opens like a definition, a block id or a table row as a thematic break; the reading view reads a heading.'
  },
  {
    id: 'setext-heading',
    kind: 'quirk',
    matches: (key, reduced) => (isKey(key, 'editor', /^heading-\d$/u) || isKey(key, 'readingView', /^(?:heading-\d|thematicBreak)$/u)) && /\n *(?:-+|=+)[ \t]*$/u.test(reduced),
    note: 'The reading view takes only a paragraph\'s last line into a setext heading and no indented underline, where CommonMark and the editor take the whole paragraph.'
  },
  {
    id: 'lazy-quote',
    kind: 'quirk',
    matches: (key, reduced) => isKey(key, 'readingView', /^quote-\d$/u) && /^>{2,}[^\n]*\n|^>+\s*\n/mu.test(reduced),
    note: 'The reading view continues a quote lazily where CommonMark does not: a nested quote on a less deep quote line, and a quote on the line after an empty quote line.'
  },
  {
    id: 'emphasis-pairing',
    kind: 'quirk',
    matches: (key, reduced) => isKey(key, 'readingView', /^(?:em|strong)$/u) && !/[<$]/u.test(reduced),
    note: 'The reading view pairs `*` and `_` runs by remark-parse 8\'s rules, not CommonMark\'s.'
  },
  {
    id: 'indented-code-in-container',
    kind: 'candidate',
    matches: (_key, reduced) => /^(?:>|[-*+]|\d+[.)]) {5,}\S/mu.test(reduced),
    note: 'The editor reads no indented code in a quote or a list item, opened by five spaces after the marker.'
  },
  {
    id: 'tab-indentation',
    kind: 'quirk',
    matches: (_key, reduced) => /^(?:>|[-*+]|\d+[.)]) ?\t| \t\S|^#\t|\*\*\*\t/mu.test(reduced),
    note: 'A tab after a quote or list marker, or among indentation, counts differently: the reading view expands it by remark-parse 8\'s rules.'
  },
  {
    id: 'line-after-indented-code',
    kind: 'candidate',
    matches: (_key, reduced) => /^(?: {4}|\t)\S[^\n]*\n\S/mu.test(reduced),
    note: 'On the line right after an indented code line, the editor opens no math or comment block and styles no internal link, tag or math.'
  },
  {
    id: 'line-after-empty-list-item',
    kind: 'candidate',
    matches: (key, reduced) => key.side === 'editor' && /^\s*(?:[-*+]|\d+[.)]) ?\n\n?(?: {4,}|\t)/mu.test(reduced),
    note: 'A line indented four or more after an empty list item is a list item or code in the editor and neither in the reading view.'
  },
  {
    id: 'indented-code-after-block',
    kind: 'candidate',
    matches: (key, reduced) => (key.side === 'readingView' && key.fact === 'code') && /^[^\n]+\n(?: {4}|\t)\S/mu.test(reduced),
    note: 'The editor reads no indented code right after a thematic break or another block that is no paragraph.'
  },
  {
    id: 'inline-math-across-lines',
    kind: 'candidate',
    matches: (_key, reduced) => /\$[^$\n]*\n[^$]*\$/u.test(reduced),
    note: 'The editor ends inline math at the end of its line; the reading view runs it across the line break.'
  },
  {
    id: 'highlight-across-lines',
    kind: 'candidate',
    matches: (key, reduced) => (key.side === 'readingView' && key.fact === 'highlight') && /[=]=[^=\n]*\n[^=]*==/u.test(reduced),
    note: 'The editor ends a highlight at the end of its line; the reading view runs it across the line break.'
  },
  {
    id: 'highlight-closer-after-space',
    kind: 'candidate',
    matches: (key, reduced) => (key.side === 'readingView' && key.fact === 'highlight') && /[=]=\S[^=\n]* ==\S/u.test(reduced),
    note: 'The editor closes a highlight at a `==` after a space; the reading view does not, and pairs it with a later one.'
  },
  {
    id: 'table-with-empty-cells',
    kind: 'candidate',
    matches: (key, reduced) => key.fact === 'table' || ((key.side === 'editor' && key.fact === 'list') && reduced.includes('\n- |')),
    note: 'A table whose header row holds only empty cells or a single pipe, or whose delimiter row opens with `- `, is a table on one side and none on the other.'
  },
  {
    id: 'math-across-table-cells',
    kind: 'candidate',
    matches: (key, reduced) => key.fact === 'math' && /^\|?[^\n]*\$[^\n$]*\|[^\n$]*\$[^\n]*\n\|?\s*:?-/mu.test(reduced),
    note: 'In a table row, the editor pairs `$` marks from two cells into one math span.'
  },
  {
    id: 'emphasis-around-inline-html',
    kind: 'candidate',
    matches: (key, reduced) => isKey(key, 'readingView', /^(?:em|strong)$/u) && /[*_]<|>[*_]/u.test(reduced),
    note: 'The editor reads no emphasis that opens or closes next to an inline HTML tag.'
  },
  {
    id: 'brackets-in-internal-link',
    kind: 'candidate',
    matches: (key, reduced) => key.fact === 'internalLink' && /\[\[[^\]\n]*[[|]/u.test(reduced),
    note: 'An internal link whose target holds a `[` or a `|` in a table cell is one on one side and none on the other.'
  },
  {
    id: 'comment-block-edge',
    kind: 'candidate',
    matches: (_key, reduced) => reduced.includes('%%'),
    note: 'Where a comment block starts or ends next to a quote, a list item or indentation, the editor and the reading view take different lines into it.'
  }
];

/**
 * The family a difference belongs to.
 *
 * @param key - The difference, as `differenceKey` gives it.
 * @param reduced - The minimal note that keeps it.
 * @returns The family, or `null` for one no family takes.
 */
export function familyOf(key: string, reduced: string): ModeFamily | null {
  const parsed = parseDifferenceKey(key);
  return MODE_FAMILIES.find((family) => family.matches(parsed, reduced)) ?? null;
}
