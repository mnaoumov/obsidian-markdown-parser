/**
 * @file
 *
 * One readable note per candidate family the judge found (`mode-families.ts`): each is a minimal note
 * `reduceDifference` left, written out so a reader sees the construct, and checked to keep a difference of its family.
 * `scripts/editing-modes-oracle.ts` reads them from a live Obsidian, so each disagreement is confirmed on the real editor
 * before it is reported.
 */

import type { EditingMode } from './forum-issues.ts';

/**
 * A note on which the judge finds a candidate family.
 */
export interface JudgedSample {
  /**
   * The editing modes that disagree with the reading view on it.
   */
  readonly differsIn: readonly EditingMode[];

  /**
   * The family, an id of `MODE_FAMILIES`.
   */
  readonly family: string;

  /**
   * The case id, `judged-<family>`.
   */
  readonly id: string;

  /**
   * The note.
   */
  readonly markdown: string;

  /**
   * The disagreement, in one sentence.
   */
  readonly note: string;
}

// Both editing modes run the same parse, so a disagreement of its shows in both.
const BOTH_EDITING_MODES: readonly EditingMode[] = ['livePreview', 'sourceMode'];

function sample(family: string, markdown: string, note: string): JudgedSample {
  return { differsIn: BOTH_EDITING_MODES, family, id: `judged-${family}`, markdown, note };
}

/**
 * The samples, one per candidate family.
 */
export const JUDGED_SAMPLES: readonly JudgedSample[] = [
  sample('unclosed-front-matter', '---\n[[Note]] and #tag\n', 'The editor reads a first line `---` that no later line closes as front matter to the end of the note; the reading view shows a thematic break, the link and the tag.'),
  sample('fence-in-quote-nested-quote', '> ```\n>> code\n> ```\n', 'Inside a fence opened in a quote, the editor reads `>>` as a nested quote; the reading view shows `> code` as code.'),
  sample('html-block-ends-at-line', '</div>\n[[Note]] and #tag\n', 'The editor ends the HTML block at `</div>` and styles the link and the tag; the reading view runs the block to the next empty line and shows the line as raw text.'),
  sample('empty-list-item', '- a\n-\n- b\n', 'The editor reads the `-` alone on its line as text; the reading view reads an empty list item between the two others.'),
  sample('lazy-line-after-empty-quote-line', '> quote\n>\n    code\n', 'After the empty quote line the editor carries the quote onto the indented line; the reading view ends the quote and shows an indented code block.'),
  sample('tag-after-mark', '*#tag* and ==#tag==\n', 'The editor reads no tag right after the `*` or the `==`; the reading view and the worker read both tags.'),
  sample('heading-in-quote', '> # Heading\n', 'The editor gives the heading in the quote no heading classes; the reading view and the worker read a level 1 heading.'),
  sample('block-on-list-item-first-line', '- > quote\n', 'The editor reads no quote opened on the list item\'s first line; the reading view shows a quote in the item.'),
  sample('table-with-empty-cells', '||\n|-|\n', 'The editor reads no table whose header row holds only an empty cell; the reading view shows a table.'),
  sample('line-after-indented-code', '    code\n[[Note]] and #tag\n', 'The editor styles no link or tag on the line right after the indented code; the reading view shows a paragraph with both.'),
  sample('unfinished-html-tag', '<span\n# Heading\n', 'The editor reads the line after the unfinished `<span` as part of the tag; the reading view shows a paragraph and a heading.'),
  sample('ordered-item-interrupts-paragraph', 'text\n2. item\n', 'The editor reads `2. item` as a list item that interrupts the paragraph; the reading view, as CommonMark, keeps it in the paragraph, since only an item numbered 1 interrupts one.'),
  sample('highlight-across-lines', '==a\n==b==\n', 'The editor highlights `a` to the end of the line and `b` on its own; the reading view pairs the first `==` with the last and highlights `a ==b` across the line break.'),
  sample('indented-code-in-container', '-     code\n', 'The editor reads the list item\'s text as text; the reading view, as CommonMark, reads five spaces after the marker as an indented code block in the item.'),
  sample('inline-html-before-internal-link', '<u>[[Note]]</u>\n', 'The editor styles no internal link right after the `<u>` tag; the reading view shows the link underlined.'),
  sample('one-dash-setext-underline', 'Heading\n-\n', 'The editor reads the `-` as text; the reading view, as CommonMark, reads a level 2 heading.'),
  sample('highlight-closer-after-space', '==a ==b==\n', 'The editor closes the highlight at the `==` after the space; the reading view highlights `a ==b`.'),
  sample('four-dollars', '$$$$\ntext\n', 'The editor reads `$$$$` as empty display math and `text` as text; the reading view opens a math block at `$$$$` that runs to the end of the note.'),
  sample('inline-math-across-lines', '$a\nb$\n', 'The editor reads no math; the reading view renders `a b` as math across the line break.'),
  sample('triple-backtick-mid-line', 'text ```code\n\n# Heading\n', 'The editor runs the unclosed ```` ``` ```` as inline code over the empty line and the heading to the end of the note; the reading view shows a paragraph with literal backticks and a heading.'),
  sample('brackets-in-internal-link', '[[[[Note]]\n', 'The two sides take different `[` runs as the link\'s opening: the reading view keeps one `[` as text and links to `[Note`, where the editor styles another span as the link.'),
  sample('line-after-empty-list-item', '-\n\n    text\n', 'After the empty list item and the empty line, the editor reads the indented line as code; the reading view reads it as a paragraph of the empty item.'),
  sample('setext-in-quote', '> Heading\n> ---\n', 'The editor reads `---` in the quote as a thematic break; the reading view, as CommonMark, reads a level 2 heading.'),
  sample('indented-fence-closer', '```\ncode\n ```\n# Heading\n', 'The editor does not close the fence at ` ``` `, so the heading is code; the reading view, as CommonMark, closes it and shows the heading.'),
  sample('fence-info-with-backtick', '~~~a`\ncode\n~~~\n', 'The editor opens no fence at `~~~a``; the reading view, as CommonMark, shows a code block.'),
  sample('setext-under-special-line', '[1]:\n---\n', 'The editor reads `---` under `[1]:` as a thematic break; the reading view reads a level 2 heading, since `[1]:` without a destination is no definition.'),
  sample('indented-code-after-block', '***\n    code\n', 'The editor reads the indented line after the thematic break as text; the reading view reads an indented code block.'),
  sample('emphasis-around-inline-html', '*<b>bold</b>*\n', 'The editor reads no emphasis around the inline HTML; the reading view shows it in italics.'),
  sample('math-across-table-cells', '| $a | b$ |\n|---|---|\n', 'The editor pairs the `$` of the first cell with the `$` of the second into one math span; the reading view keeps each cell\'s `$` as text.')
];
