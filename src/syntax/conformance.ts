/**
 * @file
 *
 * The conformance corpus of the Obsidian syntax, shared by every adapter.
 *
 * Each case is a document and the outline of the Obsidian nodes an adapter must find in it: the nodes of
 * {@link ObsidianNode} in document order (parents before their children), each with the text it covers. Nodes of plain
 * markdown are not part of the outline, so the corpus means the same to every parser ecosystem.
 */

import type { ObsidianNodeName } from './spec.ts';

import { ObsidianNode as N } from './spec.ts';

/**
 * One conformance case.
 */
export interface ConformanceCase {
  /**
   * The Obsidian nodes the document holds, in document order.
   */
  readonly expected: readonly OutlineEntry[];

  /**
   * The document.
   */
  readonly markdown: string;

  /**
   * What the case checks.
   */
  readonly name: string;
}

/**
 * One node of an outline: its name and the text it covers.
 */
export type OutlineEntry = readonly [name: ObsidianNodeName, text: string];

/**
 * The conformance cases.
 */
export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
  {
    expected: [[N.InternalLink, '[[Note]]'], [N.InternalLinkMark, '[['], [N.InternalLinkPath, 'Note'], [N.InternalLinkMark, ']]']],
    markdown: 'a [[Note]] b',
    name: 'internal link'
  },
  {
    expected: [
      [N.InternalLink, '[[Note#Heading|shown]]'],
      [N.InternalLinkMark, '[['],
      [N.InternalLinkPath, 'Note'],
      [N.InternalLinkSubpath, '#Heading'],
      [N.InternalLinkAliasMark, '|'],
      [N.InternalLinkAlias, 'shown'],
      [N.InternalLinkMark, ']]']
    ],
    markdown: '[[Note#Heading|shown]]',
    name: 'internal link with a subpath and an alias'
  },
  {
    expected: [[N.InternalLink, '[[#^block]]'], [N.InternalLinkMark, '[['], [N.InternalLinkSubpath, '#^block'], [N.InternalLinkMark, ']]']],
    markdown: '[[#^block]]',
    name: 'internal link to a block in the same note'
  },
  {
    expected: [[N.Embed, '![[image.png|200]]'], [N.InternalLinkMark, '![['], [N.InternalLinkPath, 'image.png'], [N.InternalLinkAliasMark, '|'], [
      N.InternalLinkAlias,
      '200'
    ], [N.InternalLinkMark, ']]']],
    markdown: '![[image.png|200]]',
    name: 'embed'
  },
  {
    expected: [],
    markdown: '[[a]b]] and [[open\nclose]]',
    name: 'internal link content holds no ] and no line break'
  },
  {
    expected: [],
    markdown: '`[[code]]` and \\[[escaped]]',
    name: 'no internal link in code or after an escape'
  },
  {
    expected: [[N.Tag, '#tag'], [N.TagMark, '#'], [N.TagName, 'tag'], [N.Tag, '#nested/tag-1_x'], [N.TagMark, '#'], [N.TagName, 'nested/tag-1_x']],
    markdown: '#tag and #nested/tag-1_x.',
    name: 'tags end at punctuation'
  },
  {
    expected: [[N.Tag, '#été'], [N.TagMark, '#'], [N.TagName, 'été']],
    markdown: 'word#no #123 #été',
    name: 'a tag follows whitespace, and is not digits only'
  },
  {
    expected: [],
    markdown: '# Heading\n\n## Two',
    name: 'a heading mark is no tag'
  },
  {
    expected: [[N.Highlight, '==marked text=='], [N.HighlightMark, '=='], [N.HighlightMark, '==']],
    markdown: 'a ==marked text== b',
    name: 'highlight'
  },
  {
    expected: [],
    markdown: 'a == b == c and x === y',
    name: 'a highlight opens before a non-space, and a run of three is text'
  },
  {
    expected: [[N.Comment, '%%hidden [[link]]%%'], [N.CommentMark, '%%'], [N.CommentMark, '%%']],
    markdown: 'a %%hidden [[link]]%% b',
    name: 'inline comment hides the syntax inside it'
  },
  {
    expected: [[N.Comment, '%%open\nto the end'], [N.CommentMark, '%%']],
    markdown: 'a %%open\nto the end',
    name: 'an unclosed comment runs to the end of its paragraph'
  },
  {
    expected: [[N.CommentBlock, '%%\nhidden\n\n#not-a-tag\n%%'], [N.CommentMark, '%%'], [N.CommentMark, '%%']],
    markdown: '%%\nhidden\n\n#not-a-tag\n%%\nafter',
    name: 'comment block spans blank lines'
  },
  {
    expected: [[N.Comment, '%% inline\n%%'], [N.CommentMark, '%%'], [N.CommentMark, '%%']],
    markdown: 'text %% inline\n%%',
    name: 'a %% line closes the comment its paragraph left open'
  },
  {
    expected: [[N.InlineMath, '$x^2$'], [N.MathMark, '$'], [N.MathMark, '$'], [N.InlineMath, '$$y$$'], [N.MathMark, '$$'], [N.MathMark, '$$']],
    markdown: 'a $x^2$ b $$y$$',
    name: 'inline math'
  },
  {
    expected: [],
    markdown: 'costs $5 and $ 6 and 7 $',
    name: 'inline math opens before a non-space and closes after one'
  },
  {
    expected: [[N.MathBlock, '$$\na\n\nb\n$$'], [N.MathMark, '$$'], [N.MathMark, '$$']],
    markdown: '$$\na\n\nb\n$$',
    name: 'math block spans blank lines'
  },
  {
    expected: [
      [N.Callout, '> [!tip] Title\n> $$\n> x\n> $$'],
      [N.CalloutMark, '[!tip]'],
      [N.CalloutType, 'tip'],
      [N.CalloutTitle, 'Title'],
      [N.MathBlock, '$$\n> x\n> $$'],
      [N.MathMark, '$$'],
      [N.MathMark, '$$']
    ],
    markdown: '> [!tip] Title\n> $$\n> x\n> $$',
    name: 'math block in a callout'
  },
  {
    expected: [[N.FootnoteReference, '[^1]'], [N.FootnoteMark, '[^'], [N.FootnoteLabel, '1'], [N.FootnoteMark, ']']],
    markdown: 'text[^1] more',
    name: 'footnote reference'
  },
  {
    expected: [[N.InlineFootnote, '^[an *inline* note]'], [N.FootnoteMark, '^['], [N.FootnoteMark, ']']],
    markdown: 'text^[an *inline* note]',
    name: 'inline footnote'
  },
  {
    expected: [[N.FootnoteDefinition, '[^note]: The text\n    continued'], [N.FootnoteMark, '[^'], [N.FootnoteLabel, 'note'], [N.FootnoteMark, ']:']],
    markdown: '[^note]: The text\n    continued\n\nafter',
    name: 'footnote definition with an indented continuation'
  },
  {
    expected: [
      [N.FootnoteDefinition, '[^1]: one'],
      [N.FootnoteMark, '[^'],
      [N.FootnoteLabel, '1'],
      [N.FootnoteMark, ']:'],
      [N.FootnoteDefinition, '[^2]: two'],
      [N.FootnoteMark, '[^'],
      [N.FootnoteLabel, '2'],
      [N.FootnoteMark, ']:']
    ],
    markdown: '[^1]: one\n[^2]: two',
    name: 'a definition ends the one before it'
  },
  {
    expected: [[N.FootnoteReference, '[^2]'], [N.FootnoteMark, '[^'], [N.FootnoteLabel, '2'], [N.FootnoteMark, ']']],
    markdown: '> [^2]: in a quote',
    name: 'a definition must open its line, so in a quote it is a reference'
  },
  {
    expected: [[N.BlockId, '^block-1'], [N.BlockIdMark, '^']],
    markdown: 'A paragraph ^block-1',
    name: 'block id'
  },
  {
    expected: [],
    markdown: 'not ^an id\n^under_score',
    name: 'a block id ends its line and holds letters, digits and dashes'
  },
  {
    expected: [
      [N.Callout, '> [!warning]- Be **careful**\n> Body'],
      [N.CalloutMark, '[!warning]-'],
      [N.CalloutType, 'warning'],
      [N.CalloutFold, '-'],
      [N.CalloutTitle, 'Be **careful**']
    ],
    markdown: '> [!warning]- Be **careful**\n> Body',
    name: 'callout with a fold sign and a title'
  },
  {
    expected: [[N.Callout, '> [!note]\n> Body'], [N.CalloutMark, '[!note]'], [N.CalloutType, 'note']],
    markdown: '> [!note]\n> Body',
    name: 'callout without a title'
  },
  {
    expected: [[N.Callout, '> [!info] Title\nlazy'], [N.CalloutMark, '[!info]'], [N.CalloutType, 'info'], [N.CalloutTitle, 'Title']],
    markdown: '> [!info] Title\nlazy',
    name: 'a lazy line continues the callout'
  },
  {
    expected: [],
    markdown: '> quote\n> [!note] not a callout',
    name: 'a callout marker opens only a quote'
  },
  {
    expected: [[N.Task, '[ ] open'], [N.TaskMarker, '[ ]'], [N.Task, '[x] done'], [N.TaskMarker, '[x]'], [N.Task, '[?] custom'], [N.TaskMarker, '[?]']],
    markdown: '- [ ] open\n- [x] done\n1. [?] custom',
    name: 'task markers hold any character'
  },
  {
    expected: [],
    markdown: '[ ] not in a list\n- [ab] two characters\n- [x]',
    name: 'a task marker opens a list item and is followed by whitespace'
  },
  {
    expected: [[N.FrontMatter, '---\ntags: [a]\n---'], [N.FrontMatterMark, '---'], [N.FrontMatterContent, 'tags: [a]'], [N.FrontMatterMark, '---']],
    markdown: '---\ntags: [a]\n---\n# Title',
    name: 'front matter'
  },
  {
    expected: [[N.FrontMatter, '---\n---'], [N.FrontMatterMark, '---'], [N.FrontMatterMark, '---']],
    markdown: '---\n---\ntext',
    name: 'empty front matter'
  },
  {
    expected: [],
    markdown: 'text\n---\na: 1\n---',
    name: 'front matter opens only on the first line'
  },
  {
    expected: [
      [N.InternalLink, String.raw`[[a\|b]]`],
      [N.InternalLinkMark, '[['],
      [N.InternalLinkPath, 'a'],
      [N.InternalLinkAliasMark, String.raw`\|`],
      [N.InternalLinkAlias, 'b'],
      [
        N.InternalLinkMark,
        ']]'
      ],
      [N.Tag, '#t'],
      [N.TagMark, '#'],
      [N.TagName, 't']
    ],
    markdown: '| x | y |\n| - | - |\n| [[a\\|b]] | #t |',
    name: 'internal link with an escaped alias pipe, and a tag, in a table'
  }
];
