/**
 * @file
 *
 * The samples of the parser issues reported on the Obsidian forum, read from a live Obsidian by
 * `scripts/forum-issue-oracle.ts` into `oracle/forum-issues-obsidian-<version>.json`: the editor's tree, the reading
 * view's DOM and the metadata worker's `CachedMetadata` of each, and Source mode's and Live Preview's DOM of the first
 * kind. Two kinds are kept: the places where the editing modes (Source mode and Live Preview) and the reading view read
 * the same note differently, and the notes whose metadata the worker drops or misplaces. The issues
 * where the reading view departs from CommonMark are spec examples, which the spec oracle already holds.
 */

import type { OracleNode } from './oracle-file.ts';
import type { SpecOracleMeta } from './spec-oracle-file.ts';

/**
 * An editing mode, as Obsidian's UI names them: Source mode and Live Preview.
 */
export type EditingMode = 'livePreview' | 'sourceMode';

/**
 * A note that Obsidian's editing modes and its reading view read differently.
 */
export interface EditorVsReadingViewSample {
  /**
   * The editing modes that disagree with the reading view on it.
   */
  readonly differsIn: readonly EditingMode[];

  /**
   * The forum topic that reports it.
   */
  readonly forumUrl: string;

  /**
   * The case id, `<issue>-<sample>`.
   */
  readonly id: string;

  /**
   * The issue: `issue-<n>` in the order of the summary sent to the Obsidian team, or `issue-existing-<topic>` for an
   * issue a forum topic had already reported.
   */
  readonly issue: string;

  /**
   * The note.
   */
  readonly markdown: string;

  /**
   * The disagreement, in one sentence.
   */
  readonly note: string;
}

/**
 * The forum issue oracle file.
 */
export interface ForumIssueFile {
  /**
   * Where the documents were read.
   */
  readonly meta: SpecOracleMeta;

  /**
   * Every document of {@link forumIssueDocuments}, as Obsidian read it.
   */
  readonly reads: readonly ForumIssueRead[];
}

/**
 * A document as Obsidian read it.
 */
export interface ForumIssueRead {
  /**
   * The reading view's DOM with `strictLineBreaks: true`, normalized as `scripts/spec-oracle.ts` normalizes it.
   */
  readonly html: string;

  /**
   * Live Preview's `.cm-content` inner HTML, read with the cursor on an empty line appended to the note, and that line
   * left out; read for the samples of {@link EDITOR_VS_READING_VIEW_SAMPLES} only.
   */
  readonly livePreviewHtml?: string;

  /**
   * The document.
   */
  readonly markdown: string;

  /**
   * The metadata worker's `CachedMetadata`, or `null` where the worker threw.
   */
  readonly metadata: unknown;

  /**
   * The editor's tree, in pre-order, without the root, as `scripts/oracle.ts` reads it.
   */
  readonly nodes: readonly OracleNode[];

  /**
   * Source mode's `.cm-content` inner HTML, read as {@link livePreviewHtml} is.
   */
  readonly sourceModeHtml?: string;
}

/**
 * A note whose metadata the worker drops or misplaces.
 */
export interface MetadataIssueSample {
  /**
   * The metadata the note should have, from the worker's metadata of the note and of {@link standIn}; absent where what
   * the note should give is not clear.
   */
  readonly expectedOf?: (actual: unknown, standIn: unknown) => unknown;

  /**
   * The forum topic that reports it.
   */
  readonly forumUrl: string;

  /**
   * The case id, `<issue>-<sample>`.
   */
  readonly id: string;

  /**
   * The issue: `issue-<n>` in the order of the summary sent to the Obsidian team, or `issue-topic-<topic>` for an issue
   * reported after the summary.
   */
  readonly issue: string;

  /**
   * The note.
   */
  readonly markdown: string;

  /**
   * What goes wrong, in one sentence.
   */
  readonly note: string;

  /**
   * A note of the same length without the trigger, whose metadata {@link expectedOf} starts from.
   */
  readonly standIn?: string;
}

interface BlockCache {
  readonly id: string;
  readonly position: SectionPosition;
}

interface Link {
  readonly original: string;
  readonly position: LinkPosition;
}

interface LinkPoint {
  readonly col: number;
  readonly line: number;
  readonly offset: number;
}

interface LinkPosition {
  readonly end: LinkPoint;
  readonly start: LinkPoint;
}

interface Section {
  readonly id?: string;
  readonly position: SectionPosition;
  readonly type: string;
}

interface SectionPoint {
  readonly offset: number;
}

interface SectionPosition {
  readonly end: SectionPoint;
  readonly start: SectionPoint;
}

interface WithFrontmatter {
  readonly frontmatter?: Record<string, unknown>;
}

interface WithLinks {
  readonly links?: readonly Link[];
}

interface WithSections {
  readonly blocks?: Record<string, BlockCache>;
  readonly sections?: readonly Section[];
}

const FORUM = 'https://forum.obsidian.md/t/';

// The worker places a link on a block comment's opening line as if the comment's `%%` were not there.
const COMMENT_MARK_LENGTH = '%%'.length;

// Both editing modes run the same parse, so a disagreement of its shows in both.
const BOTH_EDITING_MODES: readonly EditingMode[] = ['livePreview', 'sourceMode'];

/**
 * The notes that the editing modes and the reading view read differently: issues 5 to 12 of the summary, and the issue
 * of topic 50661.
 */
export const EDITOR_VS_READING_VIEW_SAMPLES: readonly EditorVsReadingViewSample[] = [
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119746`,
    id: 'issue-5-1',
    issue: 'issue-5',
    markdown: 'a ===marked=== b\n',
    note: 'The editor reads each `===` run as one highlight mark and highlights `marked`; the reading view highlights `=marked` and leaves the last `=` as text.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119746`,
    id: 'issue-5-2',
    issue: 'issue-5',
    markdown: 'a ==>x== b\n',
    note: 'The editor opens no highlight before `>`; the reading view highlights `>x`.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119746`,
    id: 'issue-5-3',
    issue: 'issue-5',
    markdown: 'a ==> next step== b\n',
    note: 'The editor opens no highlight before `>`; the reading view highlights `> next step`.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119752`,
    id: 'issue-6-1',
    issue: 'issue-6',
    markdown: 'a %%open\n\n# Heading\n\ntext\n',
    note: 'The editor runs a `%%` opened mid-line and never closed as a comment to the end of the note; the reading view, as the help documents, makes no comment of it and shows the heading and `text`.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119752`,
    id: 'issue-6-2',
    issue: 'issue-6',
    markdown: 'text %% inline\n%%\nafter\n\n# Heading\n',
    note: 'The editor closes the comment opened mid-line at the `%%` of the next line and shows `after` and the heading; the reading view opens a block comment at that line, which hides the rest of the note.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119755`,
    id: 'issue-7-1',
    issue: 'issue-7',
    markdown: 'Cost is $$5 or more.\n\n- item\n\n> quote\n\nLater text with $$ in it.\n',
    note: 'The editor keeps a `$$` left open in a paragraph open as math over the list and the quote, up to the next `$$`; the reading view shows four ordinary blocks with literal `$$`.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119756`,
    id: 'issue-8-1',
    issue: 'issue-8',
    markdown: 'Run ``npm install\n--save-dev`` first.\n',
    note: 'The editor ends a code span opened by two backticks at the end of its line and opens a new one at the closer; the reading view shows one code span across the line break.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119757`,
    id: 'issue-9-1',
    issue: 'issue-9',
    markdown: '[Area $\\pi r^2$](https://example.com)\n',
    note: 'The editor opens no math inside a markdown link\'s text; the reading view renders it.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119758`,
    id: 'issue-10-1',
    issue: 'issue-10',
    markdown: '$a$ is the first line.\n\n$b$\n---\n',
    note: 'The editor reads `$b$` and `---` as a line and a horizontal rule once an earlier line started with math; the reading view and the worker read a level 2 heading.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119759`,
    id: 'issue-11-1',
    issue: 'issue-11',
    markdown: '> - [ ] quoted task\n> - [x] done quoted task\n\n- [ ] normal task\n',
    note: 'The editor styles the task markers of the quoted items as links, not as tasks; the reading view and the worker read all three items as tasks.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119760`,
    id: 'issue-12-1',
    issue: 'issue-12',
    markdown: '> ```\n> code\n\nParagraph after the quote, with a [[link]] and a #tag.\n',
    note: 'The editor keeps a fence left open in a quote open after the quote, so the next paragraph is code; the reading view ends the code block with the quote and the worker indexes the link and the tag.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}119760`,
    id: 'issue-12-2',
    issue: 'issue-12',
    markdown: '- ```\n  code\n\nParagraph after the list, with a [[link]] and a #tag.\n',
    note: 'The editor keeps a fence left open in a list item open after the item, so the next paragraph is code; the reading view ends the code block with the item and the worker indexes the link and the tag.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}50661`,
    id: 'issue-existing-50661-1',
    issue: 'issue-existing-50661',
    markdown: '    $x^2$ is code\n',
    note: 'The editor reads a line indented four spaces that starts with math as math; the reading view reads an indented code block.'
  },
  {
    differsIn: BOTH_EDITING_MODES,
    forumUrl: `${FORUM}50661/2`,
    id: 'issue-existing-50661-2',
    issue: 'issue-existing-50661',
    markdown: '    $$x\nparagraph\n\nmore\n',
    note: 'The editor opens display math at an indented `$$x` and runs it over the next lines; the reading view shows one line of code and two paragraphs.'
  }
];

/**
 * The notes whose metadata the worker drops or misplaces: issues 1 to 4 of the summary, and the issue of topic 119821.
 */
export const METADATA_ISSUE_SAMPLES: readonly MetadataIssueSample[] = [
  {
    expectedOf: (_actual, standIn) => withFrontmatterValue(standIn, 'k', '[text]()'),
    forumUrl: `${FORUM}119745`,
    id: 'issue-1-1',
    issue: 'issue-1',
    markdown: '---\nk: "[text]()"\n---\n# Heading\n\n[[Target]] #tag\n',
    note: 'A property value that is a markdown link with an empty destination makes the worker throw, so the note has no metadata at all. The expected metadata is the worker\'s for the same note with the value `"[text]xx"`, the value put back; it holds no front matter link.',
    standIn: '---\nk: "[text]xx"\n---\n# Heading\n\n[[Target]] #tag\n'
  },
  {
    expectedOf: (_actual, standIn) => withFrontmatterValue(standIn, 'k', '[text]( )'),
    forumUrl: `${FORUM}119745`,
    id: 'issue-1-2',
    issue: 'issue-1',
    markdown: '---\nk: "[text]( )"\n---\n# Heading\n\n[[Target]] #tag\n',
    note: 'A property value that is a markdown link with a blank destination makes the worker throw, so the note has no metadata at all. The expected metadata is the worker\'s for the same note with the value `"[text]xxx"`, the value put back; it holds no front matter link.',
    standIn: '---\nk: "[text]xxx"\n---\n# Heading\n\n[[Target]] #tag\n'
  },
  {
    expectedOf: (_actual, standIn) => withFrontmatterKey(standIn, [], 'hasOwnPropertx', 'hasOwnProperty'),
    forumUrl: `${FORUM}119750`,
    id: 'issue-2-1',
    issue: 'issue-2',
    markdown: '---\nhasOwnProperty: 1\n---\n# Heading\n\n[[Target]] #tag\n',
    note: 'A property named `hasOwnProperty` makes the worker throw, so the note has no metadata at all. The expected metadata is the worker\'s for the same note with the key `hasOwnPropertx`, the key put back.',
    standIn: '---\nhasOwnPropertx: 1\n---\n# Heading\n\n[[Target]] #tag\n'
  },
  {
    expectedOf: (_actual, standIn) => withFrontmatterKey(standIn, ['obj'], 'hasOwnPropertx', 'hasOwnProperty'),
    forumUrl: `${FORUM}119750`,
    id: 'issue-2-2',
    issue: 'issue-2',
    markdown: '---\nobj:\n  hasOwnProperty: 1\n---\n# Heading\n\n[[Target]] #tag\n',
    note: 'A nested property named `hasOwnProperty` makes the worker throw, so the note has no metadata at all. The expected metadata is the worker\'s for the same note with the key `hasOwnPropertx`, the key put back.',
    standIn: '---\nobj:\n  hasOwnPropertx: 1\n---\n# Heading\n\n[[Target]] #tag\n'
  },
  {
    expectedOf: (actual) => withoutEmptySections(actual, 'abc'),
    forumUrl: `${FORUM}119754`,
    id: 'issue-3-1',
    issue: 'issue-3',
    markdown: 'Text[^1]\n\n[^1]: Note ^abc\n',
    note: 'A note with a footnote gets a zero-length `text` and a zero-length `element` section after its last block, and its block id points at that empty place. The expected metadata drops the two sections and puts the block id on the footnote definition\'s section.'
  },
  {
    expectedOf: (actual) => withoutEmptySections(actual, null),
    forumUrl: `${FORUM}119754`,
    id: 'issue-3-2',
    issue: 'issue-3',
    markdown: 'Text^[note]\n',
    note: 'A note with an inline footnote gets a zero-length `text` and a zero-length `element` section after its last block. The expected metadata drops the two sections.'
  },
  {
    forumUrl: `${FORUM}119753`,
    id: 'issue-4-1',
    issue: 'issue-4',
    markdown: '---\na: 1\n---   \ntext\n',
    note: 'The worker reads front matter closed by `---` and trailing spaces, while the editor shows no Properties block, `getFrontMatterInfo` returns `exists: false` and `processFrontMatter` adds a second front matter block; which side is right is the team\'s call, so no metadata is expected.'
  },
  {
    forumUrl: `${FORUM}119753`,
    id: 'issue-4-2',
    issue: 'issue-4',
    markdown: '---\na: 1\n---\t\ntext\n',
    note: 'The worker reads front matter closed by `---` and a tab, while the editor shows no Properties block, `getFrontMatterInfo` returns `exists: false` and `processFrontMatter` adds a second front matter block; which side is right is the team\'s call, so no metadata is expected.'
  },
  {
    forumUrl: `${FORUM}119753`,
    id: 'issue-4-3',
    issue: 'issue-4',
    markdown: '---\na: 1\n---x\ntext\n',
    note: 'The worker reads front matter closed by `---x` and a paragraph `x` after it, while the editor styles the next line as front matter, `getFrontMatterInfo` returns `exists: false` and `processFrontMatter` adds a second front matter block; which side is right is the team\'s call, so no metadata is expected.'
  },
  {
    forumUrl: `${FORUM}119753`,
    id: 'issue-4-4',
    issue: 'issue-4',
    markdown: '---\na: 1\n----\ntext\n',
    note: 'The worker reads front matter closed by `----` and an empty list item after it, while the editor styles the next line as front matter, `getFrontMatterInfo` returns `exists: false` and `processFrontMatter` adds a second front matter block; which side is right is the team\'s call, so no metadata is expected.'
  },
  {
    expectedOf: (actual) => withFirstLinkShifted(actual, COMMENT_MARK_LENGTH, '[[target]]'),
    forumUrl: `${FORUM}119821`,
    id: 'issue-topic-119821-1',
    issue: 'issue-topic-119821',
    markdown: '%% see [[target]] here\nmore\n%%\n\nafter\n',
    note: 'A link on the opening line of a `%%` block comment is placed 2 characters early, as if the `%%` were not there, so its `original` is `e [[target` and renaming `target` corrupts the line. The expected metadata moves the link 2 characters on.'
  },
  {
    expectedOf: (actual) => withFirstLinkShifted(actual, COMMENT_MARK_LENGTH, '[[target]]'),
    forumUrl: `${FORUM}119821`,
    id: 'issue-topic-119821-2',
    issue: 'issue-topic-119821',
    markdown: '- %% see [[target]] here\n  more\n  %%\n',
    note: 'A link on the opening line of a `%%` block comment in a list item is placed 2 characters early, so its `original` is `e [[target` and renaming `target` corrupts the line. The expected metadata moves the link 2 characters on.'
  },
  {
    expectedOf: (actual) => withFirstLinkShifted(actual, -1, '[[target]]'),
    forumUrl: `${FORUM}119821`,
    id: 'issue-topic-119821-3',
    issue: 'issue-topic-119821',
    markdown: '1. > [!note] T\n> ab cd [[target]] end\n',
    note: 'A link on a callout\'s unindented `>` line in a list item is placed 1 character late, so its `original` is `[target]] ` and renaming `target` corrupts the line; the same line indented under the item is placed right. The expected metadata moves the link 1 character back.'
  }
];

/**
 * Every document the oracle reads, each once: the samples and the stand-ins.
 *
 * @returns The documents.
 */
export function forumIssueDocuments(): string[] {
  const all = [
    ...EDITOR_VS_READING_VIEW_SAMPLES.map((sample) => sample.markdown),
    ...METADATA_ISSUE_SAMPLES.flatMap((sample) => sample.standIn === undefined ? [sample.markdown] : [sample.markdown, sample.standIn])
  ];
  return [...new Set(all)];
}

// Moves the first link `by` characters along its line and gives it the source text it then covers.
function withFirstLinkShifted(metadata: unknown, by: number, original: string): unknown {
  const { links = [] } = metadata as WithLinks;
  const [first, ...rest] = links;
  if (first === undefined) {
    throw new Error('No link to move');
  }
  function shift(point: LinkPoint): LinkPoint {
    return { ...point, col: point.col + by, offset: point.offset + by };
  }
  return {
    ...metadata as object,
    links: [{ ...first, original, position: { end: shift(first.position.end), start: shift(first.position.start) } }, ...rest]
  };
}

function withFrontmatterKey(metadata: unknown, path: readonly string[], from: string, to: string): unknown {
  function rename(value: unknown, rest: readonly string[]): unknown {
    const record = value as Record<string, unknown>;
    const [head, ...tail] = rest;
    return head === undefined ? Object.fromEntries(Object.entries(record).map(([key, entry]) => [key === from ? to : key, entry])) : { ...record, [head]: rename(record[head], tail) };
  }
  const { frontmatter } = metadata as WithFrontmatter;
  return { ...metadata as object, frontmatter: rename(frontmatter, path) };
}

function withFrontmatterValue(metadata: unknown, key: string, value: string): unknown {
  const { frontmatter } = metadata as WithFrontmatter;
  return { ...metadata as object, frontmatter: { ...frontmatter, [key]: value } };
}

// Drops the zero-length sections, and gives the block id `blockId`, when there is one, to the footnote definition.
function withoutEmptySections(metadata: unknown, blockId: null | string): unknown {
  const { blocks, sections = [] } = metadata as WithSections;
  const kept = sections.filter((section) => section.position.start.offset < section.position.end.offset);
  if (blockId === null) {
    return { ...metadata as object, sections: kept };
  }
  const definition = kept.find((section) => section.type === 'footnoteDefinition');
  if (definition === undefined) {
    throw new Error('No footnote definition to give the block id to');
  }
  return {
    ...metadata as object,
    blocks: { ...blocks, [blockId]: { id: blockId, position: definition.position } },
    sections: kept.map((section) => section === definition ? { ...section, id: blockId } : section)
  };
}
