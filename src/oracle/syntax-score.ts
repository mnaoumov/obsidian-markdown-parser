/**
 * @file
 *
 * Scores the Obsidian syntax tree against the classes the live editor gave the same document, construct by construct.
 *
 * The editor is the only Obsidian behaviour measured so far, so it is the reference for the tree until Phase 2 measures
 * the metadata worker. Each construct is compared on the characters (or lines) the editor marks as that construct and
 * the characters (or lines) the tree's nodes cover.
 */

import type { Tree } from '@lezer/common';

import type { ClassSets } from './score.ts';

import { obsidianParser } from '../syntax/lezer.ts';
import { ObsidianNode } from '../syntax/spec.ts';
import { lineStartsOf } from './score.ts';

/**
 * A construct the tree and the editor both mark.
 */
export interface Construct {
  /**
   * The offsets (or line indexes, for a line construct) the editor marks.
   */
  readonly editor: (sets: ClassSets, text: string) => ReadonlySet<number>;

  /**
   * Whether the construct is compared per line rather than per character.
   */
  readonly isLine: boolean;

  /**
   * The construct's name.
   */
  readonly name: string;

  /**
   * The node names whose ranges the tree marks, less the ranges of the excluded node names.
   */
  readonly nodes: readonly string[];

  /**
   * A node name the nodes must be direct children of, or `null` for nodes anywhere.
   */
  readonly within: null | string;

  /**
   * Node names inside those nodes whose characters do not count.
   */
  readonly without: readonly string[];
}

/**
 * The comparison of one construct in one document.
 */
export interface ConstructComparison {
  /**
   * How many offsets (or lines) the editor marks.
   */
  readonly editorCount: number;

  /**
   * Offsets (or lines) the tree marks and the editor does not.
   */
  readonly extra: readonly number[];

  /**
   * Offsets (or lines) the editor marks and the tree does not.
   */
  readonly missed: readonly number[];

  /**
   * How many offsets (or lines) the tree marks.
   */
  readonly treeCount: number;
}

const COMMENT = 'comment';

interface ComparedParams {
  readonly construct: Construct;
  readonly inComment: ReadonlySet<number>;
  readonly starts: readonly number[];
  readonly text: string;
}

/**
 * The constructs compared.
 */
export const CONSTRUCTS: readonly Construct[] = [
  {
    editor: (sets) => offsetsWith(sets, 'hmd-internal-link'),
    isLine: false,
    name: 'internal link',
    nodes: [ObsidianNode.InternalLink, ObsidianNode.Embed],
    within: null,
    without: [ObsidianNode.InternalLinkMark]
  },
  {
    editor: (sets) => offsetsWith(sets, 'hashtag'),
    isLine: false,
    name: 'tag',
    nodes: [ObsidianNode.Tag],
    within: null,
    without: []
  },
  {
    editor: (sets) => offsetsWith(sets, 'highlight'),
    isLine: false,
    name: 'highlight',
    nodes: [ObsidianNode.Highlight],
    within: null,
    without: []
  },
  {
    editor: commentOffsets,
    isLine: false,
    name: COMMENT,
    nodes: [ObsidianNode.Comment, ObsidianNode.CommentBlock],
    within: null,
    without: []
  },
  {
    editor: (sets) => offsetsWith(sets, 'math'),
    isLine: false,
    name: 'math',
    nodes: [ObsidianNode.InlineMath, ObsidianNode.MathBlock],
    within: null,
    without: []
  },
  {
    editor: (sets) => offsetsWith(sets, 'footref', 'inline-footnote'),
    isLine: false,
    name: 'footnote reference',
    nodes: [ObsidianNode.FootnoteReference],
    within: null,
    without: []
  },
  {
    editor: (sets) => offsetsWith(sets, 'inline-footnote'),
    isLine: false,
    name: 'inline footnote',
    nodes: [ObsidianNode.InlineFootnote],
    within: null,
    without: []
  },
  {
    editor: (sets) => offsetsWith(sets, 'blockid'),
    isLine: false,
    name: 'block id',
    nodes: [ObsidianNode.BlockId],
    within: null,
    without: []
  },
  {
    editor: (sets) => offsetsWith(sets, 'hmd-frontmatter'),
    isLine: false,
    name: 'front matter',
    nodes: [ObsidianNode.FrontMatter],
    within: null,
    without: []
  },
  {
    editor: (sets) => linesWith(sets, 'HyperMD-callout'),
    isLine: true,
    name: 'callout',
    nodes: [ObsidianNode.CalloutMark],
    within: null,
    without: []
  },
  {
    editor: footnoteDefinitionOffsets,
    isLine: false,
    name: 'footnote definition',
    nodes: [ObsidianNode.FootnoteMark, ObsidianNode.FootnoteLabel],
    within: ObsidianNode.FootnoteDefinition,
    without: []
  },
  {
    editor: (sets) => offsetsWith(sets, 'formatting-task'),
    isLine: false,
    name: 'task marker',
    nodes: [ObsidianNode.TaskMarker],
    within: null,
    without: []
  }
];

/**
 * Compares the tree of a document with the editor's classes, construct by construct.
 *
 * @param text - The document.
 * @param sets - The editor's classes.
 * @returns The comparison of each construct, by name.
 */
export function compareSyntax(text: string, sets: ClassSets): Map<string, ConstructComparison> {
  const tree = obsidianParser.parse(text);
  const starts = lineStartsOf(text);
  const result = new Map<string, ConstructComparison>();
  const inComment = commentOffsets(sets);
  for (const construct of CONSTRUCTS) {
    const params: ComparedParams = { construct, inComment, starts, text };
    const expected = new Set([...construct.editor(sets, text)].filter((n) => isCompared(params, n)));
    const actual = new Set([...treeMarks(tree, text, construct, starts)].filter((n) => isCompared(params, n)));
    result.set(construct.name, {
      editorCount: expected.size,
      extra: difference(actual, expected),
      missed: difference(expected, actual),
      treeCount: actual.size
    });
  }
  return result;
}

function commentOffsets(sets: ClassSets): Set<number> {
  const offsets = new Set<number>();
  let isInComment = false;
  for (const [index, classes] of sets.tok.entries()) {
    if (classes.has('comment-start')) {
      isInComment = true;
    }
    if (isInComment || classes.has('comment-end')) {
      offsets.add(index);
    }
    if (classes.has('comment-end') && !sets.tok[index + 1]?.has('comment-end')) {
      isInComment = false;
    }
  }
  return offsets;
}

function difference(a: ReadonlySet<number>, b: ReadonlySet<number>): number[] {
  const result: number[] = [];
  for (const n of a) {
    if (!b.has(n)) {
      result.push(n);
    }
  }
  return result;
}

function firstNonSpaceOf(text: string, from: number): number {
  let index = from;
  while (index < text.length && (text[index] === ' ' || text[index] === '\t')) {
    index++;
  }
  return index;
}

// The editor marks the label of a link reference definition like a footnote's, so only a `[^` label counts.
function footnoteDefinitionOffsets(sets: ClassSets, text: string): Set<number> {
  const offsets = new Set<number>();
  let isFootnote = false;
  for (const [index, classes] of sets.tok.entries()) {
    if (!classes.has('hmd-footnote')) {
      isFootnote = false;
      continue;
    }
    if (!sets.tok[index - 1]?.has('hmd-footnote')) {
      isFootnote = text.startsWith('[^', index);
    }
    if (isFootnote) {
      offsets.add(index);
    }
  }
  return offsets;
}

/*
 * Whitespace is not compared: the editor gives a space between two tokens of a construct the classes of either. Nor is
 * the inside of a comment, where the editor styles markdown and the tree has none.
 */
function isCompared(params: ComparedParams, n: number): boolean {
  const { construct, inComment, starts, text } = params;
  const offset = construct.isLine ? firstNonSpaceOf(text, starts[n] ?? 0) : n;
  return (construct.isLine || !/\s/u.test(text[n] ?? '')) && (construct.name === COMMENT || !inComment.has(offset));
}

function lineIndexOf(starts: readonly number[], pos: number): number {
  let index = 0;
  while (index + 1 < starts.length && (starts[index + 1] ?? 0) <= pos) {
    index++;
  }
  return index;
}

function linesWith(sets: ClassSets, cls: string): Set<number> {
  const lines = new Set<number>();
  for (const [index, classes] of sets.line.entries()) {
    if (classes.has(cls)) {
      lines.add(index);
    }
  }
  return lines;
}

function offsetsWith(sets: ClassSets, cls: string, without?: string): Set<number> {
  const offsets = new Set<number>();
  for (const [index, classes] of sets.tok.entries()) {
    if (classes.has(cls) && (without === undefined || !classes.has(without))) {
      offsets.add(index);
    }
  }
  return offsets;
}

function treeMarks(tree: Tree, text: string, construct: Construct, starts: readonly number[]): Set<number> {
  const covered = new Set<number>();
  const excluded = new Set<number>();
  let depth = 0;
  const parents: string[] = [];
  tree.iterate({
    enter(node) {
      const parent = parents.at(-1);
      parents.push(node.name);
      if (construct.nodes.includes(node.name) && (construct.within === null || parent === construct.within)) {
        depth++;
        for (let index = node.from; index < node.to; index++) {
          if (text[index] !== '\n') {
            covered.add(index);
          }
        }
      } else if (depth > 0 && construct.without.includes(node.name)) {
        for (let index = node.from; index < node.to; index++) {
          excluded.add(index);
        }
      }
    },
    leave(node) {
      parents.pop();
      if (construct.nodes.includes(node.name) && (construct.within === null || parents.at(-1) === construct.within)) {
        depth--;
      }
    }
  });
  if (!construct.isLine) {
    return new Set(difference(covered, excluded));
  }
  const lines = new Set<number>();
  for (const offset of covered) {
    lines.add(lineIndexOf(starts, offset));
  }
  return lines;
}
