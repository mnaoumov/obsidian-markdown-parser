/**
 * @file
 *
 * Judges where Obsidian's editing modes and its reading view read a note differently. Both editing modes run the
 * editor's class tokenizer, and the reading view and the metadata worker run `remark-parse` 8, so each side is read
 * into the same facts: per character, whether it is code, math, a comment, a highlight, strong, emphasis,
 * strikethrough, an internal link, a tag or front matter; per line, its heading level, quote depth, whether it is in a
 * list, a task, a table or a thematic break. A difference is a fact one side has and the other lacks.
 *
 * Whitespace is not compared, since the editor gives a space between two tokens the classes of either, and nor is
 * anything but the comment itself inside a comment either side reads, where the editor styles markdown the reading view
 * hides.
 */

import type { RemarkNode } from '../../remark/types.ts';
import type { ClassSets } from '../classes/score.ts';
import type { OracleNode } from '../oracle-file.ts';

import { highlight } from '../../editor/highlight.ts';
import { parseRemark } from '../../remark/parse.ts';
import {
  classSetsOf,
  compareCodeUnits,
  lineStartsOf,
  toNodes
} from '../classes/score.ts';
import { minimizeNote } from '../ddmin.ts';
import { oracleObsidianVersion } from '../oracle-location.ts';

/**
 * A fact of one character.
 */
export type CharacterFact =
  | 'code'
  | 'comment'
  | 'em'
  | 'frontMatter'
  | 'highlight'
  | 'internalLink'
  | 'math'
  | 'strikethrough'
  | 'strong'
  | 'tag';

/**
 * A fact of one line: `heading-<level>`, `quote-<depth>` or one of the others.
 */
export type LineFact = 'list' | 'table' | 'task' | 'thematicBreak' | `heading-${string}` | `quote-${string}`;

/**
 * One difference: a fact one side has on a run of characters or lines and the other lacks.
 */
export interface ModeDifference {
  /**
   * The fact.
   */
  readonly fact: CharacterFact | LineFact;

  /**
   * The first character offset or line index of the run.
   */
  readonly from: number;

  /**
   * Whether the fact is a line's.
   */
  readonly isLine: boolean;

  /**
   * The side that has it.
   */
  readonly side: ModeSide;

  /**
   * Whether a run of characters crosses a line break.
   */
  readonly spansLines: boolean;

  /**
   * The character offset or line index past the run.
   */
  readonly to: number;
}

/**
 * A difference's key parsed: its side and fact, and whether its run of characters crosses a line break.
 */
export interface ModeDifferenceKey {
  /**
   * The fact.
   */
  readonly fact: string;

  /**
   * Whether the run crosses a line break.
   */
  readonly isMultiline: boolean;

  /**
   * The side that has it.
   */
  readonly side: ModeSide;
}

/**
 * The facts of one side.
 */
export interface ModeFacts {
  /**
   * The facts of each character.
   */
  readonly characters: readonly ReadonlySet<CharacterFact>[];

  /**
   * The facts of each line.
   */
  readonly lines: readonly ReadonlySet<LineFact>[];
}

/**
 * The side of a difference that has the fact.
 */
export type ModeSide = 'editor' | 'readingView';

/**
 * The character facts, in the order a difference's signature lists them.
 */
export const CHARACTER_FACTS: readonly CharacterFact[] = ['code', 'comment', 'em', 'frontMatter', 'highlight', 'internalLink', 'math', 'strikethrough', 'strong', 'tag'];

const CHARACTER_FACT_CLASSES: readonly (readonly [CharacterFact, readonly string[]])[] = [
  ['code', ['inline-code', 'hmd-codeblock', 'hmd-indented-code', 'formatting-code', 'formatting-code-block']],
  ['em', ['em']],
  ['frontMatter', ['hmd-frontmatter']],
  ['highlight', ['highlight']],
  ['internalLink', ['hmd-internal-link', 'hmd-embed']],
  ['math', ['math']],
  ['strikethrough', ['strikethrough']],
  ['strong', ['strong']],
  ['tag', ['hashtag']]
];

const CONTAINER_FACTS: readonly CharacterFact[] = ['code', 'frontMatter'];

const MULTILINE_MARK = '+';

const INTERNAL_LINK_BRACKETS = {
  embed: ['![['.length, ']]'.length],
  internalLink: ['[['.length, ']]'.length]
} as const;

const KEY_PARTS = 2;

const REMARK_CHARACTER_FACTS: Readonly<Partial<Record<RemarkNode['type'], CharacterFact>>> = {
  code: 'code',
  delete: 'strikethrough',
  embed: 'internalLink',
  emphasis: 'em',
  highlight: 'highlight',
  inlineCode: 'code',
  inlineMath: 'math',
  internalLink: 'internalLink',
  math: 'math',
  obsidianComment: 'comment',
  obsidianCommentBlock: 'comment',
  strong: 'strong',
  tag: 'tag',
  yaml: 'frontMatter'
};

interface CollectRunsParams {
  readonly count: number;
  readonly differences: ModeDifference[];
  readonly factsOf: (index: number, side: ModeSide) => null | ReadonlySet<CharacterFact | LineFact>;
  readonly isLine: boolean;
  readonly spansLines: (from: number, to: number) => boolean;
}

interface OpenRun {
  readonly fact: CharacterFact | LineFact;
  readonly from: number;
  readonly side: ModeSide;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The judge extends the end of the current run as adjacent characters match.
  to: number;
}

/**
 * The key of one difference: its side and fact, with a `+` for a run of characters that crosses a line break.
 *
 * @param difference - The difference.
 * @returns The key, such as `editor:math` or `editor:code+`.
 */
export function differenceKey(difference: ModeDifference): string {
  return `${difference.side}:${difference.fact}${difference.spansLines ? MULTILINE_MARK : ''}`;
}

/**
 * The facts of the editing modes, from the editor's classes.
 *
 * @param text - The note.
 * @param nodes - The editor's tree, as the class-span oracle holds it.
 * @returns The facts.
 */
export function editorFacts(text: string, nodes: readonly OracleNode[]): ModeFacts {
  return editorFactsOf(text, classSetsOf(text, nodes));
}

/**
 * The facts of the editing modes, from class sets.
 *
 * @param text - The note.
 * @param sets - The editor's classes.
 * @returns The facts.
 */
export function editorFactsOf(text: string, sets: ClassSets): ModeFacts {
  const characters = Array.from({ length: text.length }, () => new Set<CharacterFact>());
  const inComment = commentOffsets(sets);
  for (const [index, classes] of sets.tok.entries()) {
    const facts = characters[index];
    if (facts === undefined) {
      continue;
    }
    for (const [fact, names] of CHARACTER_FACT_CLASSES) {
      if (names.some((name) => classes.has(name))) {
        facts.add(fact);
      }
    }
    if (inComment.has(index)) {
      facts.add('comment');
    }
  }
  const starts = lineStartsOf(text);
  const lines = sets.line.map((classes, line) => {
    const facts = new Set<LineFact>();
    // A heading indented by a space has its token classes and no line class.
    const lineEnd = (starts[line + 1] ?? text.length + 1) - 1;
    const isCodeBlockLine = classes.has('HyperMD-codeblock');
    const tokenClasses = isCodeBlockLine ? [] : sets.tok.slice(starts[line] ?? 0, lineEnd).flatMap((set) => [...set]);
    const headerClasses = tokenClasses.filter((className) => /^header-\d$/u.test(className)).map((className) => `HyperMD-${className}`);
    for (const name of [...classes, ...headerClasses]) {
      const heading = /^HyperMD-header-(?<level>\d)$/u.exec(name)?.groups?.['level'];
      if (heading !== undefined) {
        facts.add(`heading-${heading}`);
      }
      const quote = /^HyperMD-quote-(?<depth>\d+)$/u.exec(name)?.groups?.['depth'];
      if (quote !== undefined) {
        facts.add(`quote-${quote}`);
      }
    }
    if (classes.has('HyperMD-list-line')) {
      facts.add('list');
    }
    if (classes.has('HyperMD-task-line')) {
      facts.add('task');
    }
    if ([...classes].some((name) => name.startsWith('HyperMD-table-row'))) {
      facts.add('table');
    }
    if (classes.has('HyperMD-hr')) {
      facts.add('thematicBreak');
    }
    return facts;
  });
  return { characters, lines };
}

/**
 * The differences between the two sides' facts.
 *
 * @param text - The note.
 * @param editor - The editing modes' facts.
 * @param readingView - The reading view's facts.
 * @returns The differences, character runs first, each kind in document order.
 */
export function factDifferences(text: string, editor: ModeFacts, readingView: ModeFacts): ModeDifference[] {
  const differences: ModeDifference[] = [];
  function isInComment(index: number): boolean {
    return editor.characters[index]?.has('comment') === true || readingView.characters[index]?.has('comment') === true;
  }
  collectRuns({
    count: text.length,
    differences,
    factsOf: (index, side) => {
      if (/\s/u.test(text[index] ?? '')) {
        return null;
      }
      const facts = side === 'editor' ? editor.characters[index] : readingView.characters[index];
      if (facts === undefined) {
        return new Set<CharacterFact>();
      }
      if (isInComment(index)) {
        return new Set<CharacterFact>([...facts].filter((fact) => fact === 'comment'));
      }
      // Inside code or front matter both sides read, the editor styles what a sub-mode sees and the reading view nothing.
      for (const container of CONTAINER_FACTS) {
        if (editor.characters[index]?.has(container) && readingView.characters[index]?.has(container)) {
          return new Set<CharacterFact>([container]);
        }
      }
      return facts;
    },
    isLine: false,
    spansLines: (from, to) => text.slice(from, to).includes('\n')
  });
  const starts = lineStartsOf(text);
  collectRuns({
    count: starts.length,
    differences,
    factsOf: (line, side) => {
      const start = starts[line] ?? 0;
      const end = (starts[line + 1] ?? text.length + 1) - 1;
      const lineText = text.slice(start, end);
      if (lineText.trim() === '') {
        return null;
      }
      const first = start + lineText.search(/\S/u);
      const isCodeOnBothSides = Boolean(editor.characters[first]?.has('code') && readingView.characters[first]?.has('code'));
      if (isCodeOnBothSides || isInComment(first)) {
        return null;
      }
      return (side === 'editor' ? editor.lines[line] : readingView.lines[line]) ?? new Set<LineFact>();
    },
    isLine: true,
    spansLines: () => false
  });
  return differences;
}

/**
 * Judges a note: the differences between its editing modes and its reading view.
 *
 * @param text - The note.
 * @param nodes - The editor's tree, as the class-span oracle holds it.
 * @returns The differences.
 */
export function judgeModes(text: string, nodes: readonly OracleNode[]): ModeDifference[] {
  return factDifferences(text, editorFacts(text, nodes), readingViewFacts(text));
}

/**
 * Judges a note on the class tokenizer's prediction of the editor, which is the editor's own on every oracle document.
 *
 * @param text - The note.
 * @returns The differences.
 */
export function judgeModesPredicted(text: string): ModeDifference[] {
  const lines = highlight(text, { obsidianVersion: oracleObsidianVersion() });
  return judgeModes(text, toNodes(lines));
}

/**
 * Parses a key {@link differenceKey} gave.
 *
 * @param key - The key.
 * @returns Its parts.
 */
export function parseDifferenceKey(key: string): ModeDifferenceKey {
  const [side = '', fact = ''] = key.split(':', KEY_PARTS);
  const isMultiline = fact.endsWith(MULTILINE_MARK);
  return { fact: isMultiline ? fact.slice(0, -MULTILINE_MARK.length) : fact, isMultiline, side: side === 'editor' ? 'editor' : 'readingView' };
}

/**
 * The facts of the reading view, from the `remark-parse` 8 tree.
 *
 * @param text - The note.
 * @returns The facts.
 */
export function readingViewFacts(text: string): ModeFacts {
  const characters = Array.from({ length: text.length }, () => new Set<CharacterFact>());
  const starts = lineStartsOf(text);
  const lines = starts.map(() => new Set<LineFact>());
  function walk(node: RemarkNode, quoteDepth: number): void {
    const fact = REMARK_CHARACTER_FACTS[node.type];
    // The editor gives an internal link's brackets only the link's formatting classes, so they are no part of it here either.
    const brackets = node.type === 'internalLink' || node.type === 'embed' ? INTERNAL_LINK_BRACKETS[node.type] : [0, 0] as const;
    const from = (node.position?.start.offset ?? 0) + brackets[0];
    const to = (node.position?.end.offset ?? 0) - brackets[1];
    if (fact !== undefined) {
      for (let index = from; index < to; index++) {
        characters[index]?.add(fact);
      }
    }
    const depth = addLineFacts(node, lines, quoteDepth);
    if ('children' in node) {
      for (const child of node.children) {
        walk(child, depth);
      }
    }
  }

  walk(parseRemark(text), 0);
  return { characters, lines };
}

/**
 * Reduces a note to a minimal one that keeps a difference: delta debugging over its lines, then over its characters,
 * judged with {@link judgeModesPredicted}. A candidate keeps it when it has a difference of the same key whose line holds
 * the same facts on both sides as the first one's in the note, so the reduction keeps the construct the line is in.
 *
 * @param text - The note.
 * @param key - The difference to keep, as {@link differenceKey} gives it.
 * @returns The reduced note, `text` itself when it lacks the difference.
 */
export function reduceDifference(text: string, key: string): string {
  const causes = causesOf(text, key);
  const [cause] = causes;
  if (cause === undefined) {
    return text;
  }
  // The differing line's facts on both sides stay, so a reduction cannot drift to another mechanism with the same key.
  return minimizeNote(text, (candidate) => causesOf(candidate, key).includes(cause));
}

/**
 * The signature of a list of differences: each fact and side once, sorted.
 *
 * @param differences - The differences.
 * @returns The signature, such as `editor:math readingView:quote-1`.
 */
export function signatureOf(differences: readonly ModeDifference[]): string {
  return [...new Set(differences.map((difference) => differenceKey(difference)))].toSorted(compareCodeUnits).join(' ');
}

// Adds a block's line facts and returns the quote depth inside it.
function addLineFacts(node: RemarkNode, lines: readonly Set<LineFact>[], quoteDepth: number): number {
  const firstLine = (node.position?.start.line ?? 1) - 1;
  const lastLine = (node.position?.end.line ?? 1) - 1;
  function addToEach(fact: LineFact): void {
    for (let line = firstLine; line <= lastLine; line++) {
      lines[line]?.add(fact);
    }
  }
  let depth = quoteDepth;
  switch (node.type) {
    case 'blockquote': {
      depth++;
      for (let line = firstLine; line <= lastLine; line++) {
        lines[line]?.delete(`quote-${String(quoteDepth)}`);
      }
      addToEach(`quote-${String(depth)}`);
      break;
    }
    case 'heading': {
      addToEach(`heading-${String(node.depth)}`);
      break;
    }
    case 'listItem': {
      addToEach('list');
      if (node.checklist !== null) {
        lines[firstLine]?.add('task');
      }
      break;
    }
    case 'table': {
      addToEach('table');
      break;
    }
    case 'thematicBreak': {
      lines[firstLine]?.add('thematicBreak');
      break;
    }
    default: {
      break;
    }
  }
  return depth;
}

// The cause of each difference with the key, in document order: both sides' facts of the line it starts on.
function causesOf(text: string, key: string): string[] {
  const lines = highlight(text, { obsidianVersion: oracleObsidianVersion() });
  const editor = editorFacts(text, toNodes(lines));
  const readingView = readingViewFacts(text);
  const starts = lineStartsOf(text);
  return factDifferences(text, editor, readingView).filter((difference) => differenceKey(difference) === key).map((difference) => {
    const line = difference.isLine ? difference.from : starts.findLastIndex((start) => start <= difference.from);
    return `${lineFactsOf(editor, line)}|${lineFactsOf(readingView, line)}`;
  });
}

// Merges the indexes where one side has a fact the other lacks into runs; an index that is not compared joins no run and breaks none.
function collectRuns(params: CollectRunsParams): void {
  const { count, differences, factsOf, isLine, spansLines } = params;
  const open = new Map<string, OpenRun>();
  for (let index = 0; index < count; index++) {
    const editor = factsOf(index, 'editor');
    const readingView = factsOf(index, 'readingView');
    if (editor === null || readingView === null) {
      continue;
    }
    const present = new Set<string>();
    for (const [side, mine, theirs] of [['editor', editor, readingView], ['readingView', readingView, editor]] as const) {
      for (const fact of mine) {
        if (theirs.has(fact)) {
          continue;
        }
        const key = `${side}:${fact}`;
        present.add(key);
        const run = open.get(key);
        if (run === undefined) {
          open.set(key, { fact, from: index, side, to: index + 1 });
        } else {
          run.to = index + 1;
        }
      }
    }
    for (const [key, run] of open) {
      if (present.has(key)) {
        continue;
      }

      differences.push({ ...run, isLine, spansLines: spansLines(run.from, run.to) });
      open.delete(key);
    }
  }
  for (const run of open.values()) {
    differences.push({ ...run, isLine, spansLines: spansLines(run.from, run.to) });
  }
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

function lineFactsOf(facts: ModeFacts, line: number): string {
  return [...facts.lines[line] ?? []].toSorted(compareCodeUnits).join(',');
}
