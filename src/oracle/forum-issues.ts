/**
 * @file
 *
 * The samples of the parser issues reported on the Obsidian forum, read from a live Obsidian by
 * `scripts/forum-issue-oracle.ts` into `oracle/forum-issues-obsidian-<version>.json`: the editor's tree, the reading
 * view's DOM and the metadata worker's `CachedMetadata` of each. Two kinds are kept: the places where the editor and the
 * reading view read the same note differently, and the notes whose metadata the worker drops or misplaces. The issues
 * where the reading view departs from CommonMark are spec examples, which the spec oracle already holds.
 */

import type { OracleNode } from './oracle-file.ts';
import type { SpecOracleMeta } from './spec-oracle-file.ts';

/**
 * A note on which the editor and the reading view disagree.
 */
export interface EditorVsReadingViewSample {
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
   * The issue, `issue-<n>` in the order of the summary sent to the Obsidian team.
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

interface WithSections {
  readonly blocks?: Record<string, BlockCache>;
  readonly sections?: readonly Section[];
}

const FORUM = 'https://forum.obsidian.md/t/';

/**
 * The notes on which the editor and the reading view disagree: issues 5 to 12 of the summary, and the issue of topic
 * 50661.
 */
export const EDITOR_VS_READING_VIEW_SAMPLES: readonly EditorVsReadingViewSample[] = [
  {
    forumUrl: `${FORUM}119746`,
    id: 'issue-5-1',
    issue: 'issue-5',
    markdown: 'a ===marked=== b\n',
    note: 'The editor reads each `===` run as one highlight mark and highlights `marked`; the reading view highlights `=marked` and leaves the last `=` as text.'
  },
  {
    forumUrl: `${FORUM}119746`,
    id: 'issue-5-2',
    issue: 'issue-5',
    markdown: 'a ==>x== b\n',
    note: 'The editor opens no highlight before `>`; the reading view highlights `>x`.'
  },
  {
    forumUrl: `${FORUM}119746`,
    id: 'issue-5-3',
    issue: 'issue-5',
    markdown: 'a ==> next step== b\n',
    note: 'The editor opens no highlight before `>`; the reading view highlights `> next step`.'
  },
  {
    forumUrl: `${FORUM}119752`,
    id: 'issue-6-1',
    issue: 'issue-6',
    markdown: 'a %%open\n\n# Heading\n\ntext\n',
    note: 'The editor runs a `%%` opened mid-line and never closed as a comment to the end of the note; the reading view, as the help documents, makes no comment of it and shows the heading and `text`.'
  },
  {
    forumUrl: `${FORUM}119752`,
    id: 'issue-6-2',
    issue: 'issue-6',
    markdown: 'text %% inline\n%%\nafter\n\n# Heading\n',
    note: 'The editor closes the comment opened mid-line at the `%%` of the next line and shows `after` and the heading; the reading view opens a block comment at that line, which hides the rest of the note.'
  },
  {
    forumUrl: `${FORUM}119755`,
    id: 'issue-7-1',
    issue: 'issue-7',
    markdown: 'Cost is $$5 or more.\n\n- item\n\n> quote\n\nLater text with $$ in it.\n',
    note: 'The editor keeps a `$$` left open in a paragraph open as math over the list and the quote, up to the next `$$`; the reading view shows four ordinary blocks with literal `$$`.'
  },
  {
    forumUrl: `${FORUM}119756`,
    id: 'issue-8-1',
    issue: 'issue-8',
    markdown: 'Run ``npm install\n--save-dev`` first.\n',
    note: 'The editor ends a code span opened by two backticks at the end of its line and opens a new one at the closer; the reading view shows one code span across the line break.'
  },
  {
    forumUrl: `${FORUM}119757`,
    id: 'issue-9-1',
    issue: 'issue-9',
    markdown: '[Area $\\pi r^2$](https://example.com)\n',
    note: 'The editor opens no math inside a markdown link\'s text; the reading view renders it.'
  },
  {
    forumUrl: `${FORUM}119758`,
    id: 'issue-10-1',
    issue: 'issue-10',
    markdown: '$a$ is the first line.\n\n$b$\n---\n',
    note: 'The editor reads `$b$` and `---` as a line and a horizontal rule once an earlier line started with math; the reading view and the worker read a level 2 heading.'
  },
  {
    forumUrl: `${FORUM}119759`,
    id: 'issue-11-1',
    issue: 'issue-11',
    markdown: '> - [ ] quoted task\n> - [x] done quoted task\n\n- [ ] normal task\n',
    note: 'The editor styles the task markers of the quoted items as links, not as tasks; the reading view and the worker read all three items as tasks.'
  },
  {
    forumUrl: `${FORUM}119760`,
    id: 'issue-12-1',
    issue: 'issue-12',
    markdown: '> ```\n> code\n\nParagraph after the quote, with a [[link]] and a #tag.\n',
    note: 'The editor keeps a fence left open in a quote open after the quote, so the next paragraph is code; the reading view ends the code block with the quote and the worker indexes the link and the tag.'
  },
  {
    forumUrl: `${FORUM}119760`,
    id: 'issue-12-2',
    issue: 'issue-12',
    markdown: '- ```\n  code\n\nParagraph after the list, with a [[link]] and a #tag.\n',
    note: 'The editor keeps a fence left open in a list item open after the item, so the next paragraph is code; the reading view ends the code block with the item and the worker indexes the link and the tag.'
  },
  {
    forumUrl: `${FORUM}50661`,
    id: 'issue-existing-50661-1',
    issue: 'issue-existing-50661',
    markdown: '    $x^2$ is code\n',
    note: 'The editor reads a line indented four spaces that starts with math as math; the reading view reads an indented code block.'
  },
  {
    forumUrl: `${FORUM}50661/2`,
    id: 'issue-existing-50661-2',
    issue: 'issue-existing-50661',
    markdown: '    $$x\nparagraph\n\nmore\n',
    note: 'The editor opens display math at an indented `$$x` and runs it over the next lines; the reading view shows one line of code and two paragraphs.'
  }
];

/**
 * The notes whose metadata the worker drops or misplaces: issues 1 to 4 of the summary.
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
