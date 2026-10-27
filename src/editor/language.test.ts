import type { Language } from '@codemirror/language';
import type { Parser } from '@lezer/common';

import {
  ensureSyntaxTree,
  ParseContext,
  syntaxTree
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  NodeProp,
  Tree,
  TreeFragment
} from '@lezer/common';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { ClassSets } from '../oracle/classes/score.ts';
import type {
  OracleFile,
  OracleNode
} from '../oracle/oracle-file.ts';
import type { EditorClassOptions } from './highlight.ts';

import {
  classSetsOf,
  compareCodeUnits,
  toNodes
} from '../oracle/classes/score.ts';
import {
  CLASS_ORACLE_SEEDS,
  classOracleFileName,
  CORPUS_TEST_TIMEOUT_MS,
  MAIN_CLASS_ORACLE_SEED,
  oracleObsidianVersion,
  readOracleFile
} from '../oracle/oracle-location.ts';
import { highlight } from './highlight.ts';
import {
  createEditorClassLanguage,
  editorClassLanguage,
  lineClassesProperty
} from './language.ts';
import { reusedLength } from './tree-reuse.ts';

const TINY_CHUNK_SIZE = 1;
const SMALL_CHUNK_SIZE = 16;
const RANDOM_EDITS = 400;
const RANDOM_DOCUMENT_LINES = 300;
const MAX_DELETE = 4;
const SUFFIX_REUSE_SHARE = 0.75;
const PARSED_AGAIN_SHARE = 0.25;
const PRNG_MULTIPLIER = 1_103_515_245;
const PRNG_INCREMENT = 12_345;
const PRNG_MODULUS = 2 ** 31;
const PARSE_TIMEOUT_MS = 1e9;
const PADDING = ' '.repeat(40);
// How far the host keeps from an edited fragment's edge, as `StreamLanguage` does.
const OPEN_EDGE_MARGIN = 25;
const FILLER_LINES = 10;
// `TreeFragment.applyChanges` drops a fragment shorter than 128 characters, so a case needs text before it to reuse.
const FILLER = `${Array.from({ length: FILLER_LINES }, (_, index) => `filler line ${String(index)} with some words in it`).join('\n')}\n\n`;
// `ParseContext`, whose constructor its types declare private.
const editorParseContext: unknown = ParseContext;

/*
 * The documents each oracle still disagrees on: the host must give the live editor's tree node for node, so text the
 * editor renders as one span renders as one span here too.
 */
const KNOWN_DIFFERENCES = new Map<string, readonly string[]>(CLASS_ORACLE_SEEDS.map((seed) => [classOracleFileName(seed), []]));

interface ApplyEditParams {
  readonly edit: Edit;
  readonly language: Language;
  readonly text: string;
  readonly tree: Tree;
}

interface Edit {
  readonly from: number;
  readonly insert: string;
  readonly to: number;
}

/*
 * `ParseContext` as `@codemirror/language` drives it inside an editor, through members its types leave out: an
 * `EditorView` makes one with its viewport, which a test without a DOM cannot.
 */
interface EditorParseContext {
  readonly skipped: readonly ParseRange[];
  readonly tree: Tree;
  readonly work: (until: number) => boolean;
}

type EditorParseContextConstructor = new (
  parser: Parser,
  state: EditorState,
  fragments: readonly TreeFragment[],
  tree: Tree,
  treeLength: number,
  viewport: ParseRange,
  skipped: readonly ParseRange[],
  scheduleOn: null
) => EditorParseContext;

interface ParseRange {
  readonly from: number;
  readonly to: number;
}

interface Reparse {
  readonly resumedAt: number;
  readonly text: string;
  readonly tree: Tree;
}

function applyEdit(params: ApplyEditParams): Reparse {
  const { edit, language, text, tree } = params;
  const newText = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
    { fromA: edit.from, fromB: edit.from, toA: edit.to, toB: edit.from + edit.insert.length }
  ]);
  const partial = language.parser.startParse(newText, fragments);
  const resumedAt = partial.parsedPos;
  for (;;) {
    const done = partial.advance();
    if (done) {
      return { resumedAt, text: newText, tree: done };
    }
  }
}

function encodeClassSets(sets: ClassSets): string {
  return JSON.stringify([sortedSets(sets.line), sortedSets(sets.tok)]);
}

function hostedClassSets(text: string): ClassSets {
  return classSetsOf(text, treeNodes(parse(editorClassLanguage, text)));
}

function lineNodeAt(tree: Tree, from: number): string | undefined {
  return treeNodes(tree).find((node) => node[0] === from)?.[3];
}

// Each node of the tree as its text and its name.
function nodeNames(text: string): string[] {
  return treeNodes(parse(editorClassLanguage, text)).map((node) => `${text.slice(node[0], node[1])}=${node[3]}`);
}

function parse(language: Language, text: string): Tree {
  return language.parser.parse(text);
}

function readOracle(name: string): OracleFile {
  return readOracleFile(name) as OracleFile;
}

function sortedSets(sets: readonly ReadonlySet<string>[]): string[][] {
  return sets.map((set) => [...set].toSorted(compareCodeUnits));
}

function tokenizerClassSets(text: string, options: EditorClassOptions = {}): ClassSets {
  return classSetsOf(text, toNodes(highlight(text, options)));
}

// The tree in the oracle's encoding: pre-order, without the root, as `scripts/capture/oracle.ts` reads the live editor's.
function treeNodes(tree: Tree): OracleNode[] {
  const nodes: OracleNode[] = [];
  const cursor = tree.cursor();
  let depth = 0;
  for (;;) {
    if (depth > 0) {
      nodes.push([cursor.from, cursor.to, depth, cursor.type.name]);
    }
    if (cursor.firstChild()) {
      depth++;
      continue;
    }
    while (!cursor.nextSibling()) {
      if (!cursor.parent()) {
        return nodes;
      }
      depth--;
    }
  }
}

describe('editorClassLanguage', () => {
  for (const [name, known] of KNOWN_DIFFERENCES) {
    it(`should match the live editor's tree node for node on every document of ${name} but the known differences`, { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
      const options = { obsidianVersion: oracleObsidianVersion() };
      const language = createEditorClassLanguage(options);
      const differing: string[] = [];
      for (const document of readOracle(name).docs) {
        const nodes = treeNodes(parse(language, document.text));
        expect(encodeClassSets(classSetsOf(document.text, nodes))).toBe(encodeClassSets(tokenizerClassSets(document.text, options)));
        if (JSON.stringify(nodes) !== JSON.stringify(document.nodes)) {
          differing.push(document.id);
        }
      }
      expect(differing).toEqual(known);
    });
  }

  it('should name a line node by its line classes and hold its tokens', () => {
    const tree = parse(editorClassLanguage, '# Title\n> quote');
    expect(treeNodes(tree)).toEqual([
      [0, 7, 1, 'HyperMD-header_HyperMD-header-1'],
      [0, 2, 2, 'formatting_formatting-header_formatting-header-1_header_header-1'],
      [2, 7, 2, 'header_header-1'],
      [8, 15, 1, 'HyperMD-quote_HyperMD-quote-1'],
      [8, 10, 2, 'formatting_formatting-quote_formatting-quote-1_quote_quote-1'],
      [10, 15, 2, 'quote_quote-1']
    ]);
    const cursor = tree.cursor();
    cursor.firstChild();
    expect(cursor.type.prop(lineClassesProperty)).toEqual(['HyperMD-header', 'HyperMD-header-1']);
  });

  it('should carry the classes in the node props a host passes, joined by spaces, on types of its own', () => {
    const lineClassNodeProperty = new NodeProp<string>();
    const tokenClassNodeProperty = new NodeProp<string>();
    const language = createEditorClassLanguage({ lineClassNodeProperty, tokenClassNodeProperty });
    const tree = parse(language, '# Title');
    expect(treeNodes(tree)).toEqual(treeNodes(parse(editorClassLanguage, '# Title')));
    const cursor = tree.cursor();
    cursor.firstChild();
    expect(cursor.type.prop(lineClassNodeProperty)).toBe('HyperMD-header HyperMD-header-1');
    cursor.firstChild();
    expect(cursor.type.prop(tokenClassNodeProperty)).toBe('formatting formatting-header formatting-header-1 header header-1');
    const plain = parse(editorClassLanguage, '# Title').cursor();
    plain.firstChild();
    expect(plain.type.prop(lineClassNodeProperty)).toBeUndefined();
  });

  it('should give the classes of the Obsidian version it is made for', () => {
    const text = '`a` **b**';
    const language = createEditorClassLanguage({ obsidianVersion: '1.15.0' });
    const nodes = treeNodes(parse(language, text));
    expect(nodes.map((node) => node[3])).toContain('formatting_formatting-code_formatting-code-end_inline-code');
    expect(encodeClassSets(classSetsOf(text, nodes))).toBe(encodeClassSets(tokenizerClassSets(text, { obsidianVersion: '1.15.0' })));
    expect(nodeNames(text)).toContain('`=formatting_formatting-code_inline-code');
  });

  it('should merge a token into the one before it when their classes are the same, as `StreamLanguage` does', () => {
    expect(treeNodes(parse(editorClassLanguage, '- [ ] task'))).toEqual([
      [0, 10, 1, 'HyperMD-list-line_HyperMD-list-line-1_HyperMD-task-line'],
      [0, 2, 2, 'formatting_formatting-list_formatting-list-ul_list-1'],
      [2, 5, 2, 'formatting_formatting-task_meta'],
      [5, 10, 2, 'list-1']
    ]);
  });

  it('should name a token by its classes as the editor does, duplicates and empty styles included', () => {
    // A footnote label wears its footnote style twice, and its marks once.
    expect(nodeNames('[^1]: a')).toContain('1=hmd-barelink_hmd-barelink_hmd-footnote_hmd-footnote_link');
    expect(nodeNames('[^1]: a')).toContain('[^=formatting_formatting-link_hmd-barelink_hmd-footnote_link');
    // A quote fence's tokens wear the code style once, so the next line's text is one span.
    expect(nodeNames('> ```\n<?php')).toEqual([
      '> ```=HyperMD-quote_HyperMD-quote-1',
      '> =formatting_formatting-quote_formatting-quote-1_quote_quote-1',
      '```=inline-code_quote_quote-1',
      '<?php=HyperMD-quote_HyperMD-quote-1_HyperMD-quote-lazy',
      '<?php=inline-code_quote_quote-1'
    ]);
    // The indentation continuing a footnote definition is a token with no classes.
    expect(nodeNames('[^1]: a\n    b')).toContain('    =');
    // The space after a definition's `]:` on a lazy quote line is no token.
    expect(nodeNames('> a\n[b]: /v').filter((name) => name.startsWith(' '))).toEqual([]);
  });

  it('should read the next line for a setext heading and a table', () => {
    for (const text of ['Title\n---', 'a | b\n--|--\nc | d']) {
      expect(encodeClassSets(hostedClassSets(text))).toBe(encodeClassSets(tokenizerClassSets(text)));
      expect(lineNodeAt(parse(editorClassLanguage, text), 0)).toMatch(/HyperMD-(?:header|table)/u);
    }
  });

  it('should not parse an empty last line', () => {
    const language = createEditorClassLanguage();
    expect(treeNodes(parse(language, '> a\n'))).toEqual(treeNodes(parse(language, '> a')));
    expect(parse(language, '').length).toBe(0);
  });

  it('should refuse more than one range', () => {
    expect(() => editorClassLanguage.parser.startParse('ab', [], [{ from: 0, to: 1 }, { from: 1, to: 2 }])).toThrow('exactly one range');
  });

  it('should resume after an edit from the chunks before it', () => {
    const language = createEditorClassLanguage({ chunkSize: TINY_CHUNK_SIZE });
    const text = Array.from({ length: 100 }, (_, index) => `line ${String(index)}`).join('\n');
    const at = text.indexOf('line 90');
    const result = applyEdit({ edit: { from: at, insert: 'x', to: at }, language, text, tree: parse(language, text) });
    expect(result.resumedAt).toBeGreaterThan(text.indexOf('line 80'));
    expect(result.resumedAt).toBeLessThanOrEqual(at);
    expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
  });

  it('should not reuse a line whose lookahead read the edited line', () => {
    const language = createEditorClassLanguage({ chunkSize: TINY_CHUNK_SIZE });
    const cases = [
      // Deleting the `x` turns the second line into a setext underline, which makes the first line a heading.
      `Title\n---${PADDING}x`,
      // Deleting the `x` turns the second line into a delimiter row, which makes the first line a table row.
      `a | b\n--|--${PADDING}x`
    ];
    for (const lines of cases) {
      const text = FILLER + lines;
      const at = text.length - 1;
      const result = applyEdit({ edit: { from: at, insert: '', to: text.length }, language, text, tree: parse(language, text) });
      expect(result.resumedAt).toBeGreaterThan(0);
      expect(result.resumedAt).toBeLessThanOrEqual(FILLER.length);
      expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
      expect(lineNodeAt(result.tree, FILLER.length)).toMatch(/HyperMD-(?:header|table)/u);
    }
  });

  it('should not reuse the last line when text is appended', () => {
    const language = createEditorClassLanguage({ chunkSize: TINY_CHUNK_SIZE });
    const text = `${FILLER}Title${PADDING}`;
    const result = applyEdit({ edit: { from: text.length, insert: '\n---', to: text.length }, language, text, tree: parse(language, text) });
    expect(result.resumedAt).toBeGreaterThan(0);
    expect(result.resumedAt).toBeLessThanOrEqual(FILLER.length);
    expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
    expect(lineNodeAt(result.tree, FILLER.length)).toContain('HyperMD-header');
  });

  it('should reuse the chunks after an edit once a line ends in the state it had before', () => {
    const language = createEditorClassLanguage({ chunkSize: TINY_CHUNK_SIZE });
    const text = Array.from({ length: 100 }, (_, index) => `line ${String(index)}`).join('\n');
    const tree = parse(language, text);
    for (const insert of ['x', '\n', '# ']) {
      const at = text.indexOf('line 10');
      const result = applyEdit({ edit: { from: at, insert, to: at }, language, text, tree });
      expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
      // The edit, the margin the host keeps from it and the line that margin ends in are parsed again, and nothing after.
      expect(result.text.length - reusedLength(tree, result.tree)).toBeLessThan(at - result.resumedAt + insert.length + 2 * OPEN_EDGE_MARGIN);
    }
  });

  it('should stop the parse and the chunks it reuses after an edit at the end of an editor\'s viewport', () => {
    const language = createEditorClassLanguage({ chunkSize: TINY_CHUNK_SIZE });
    const text = Array.from({ length: 100 }, (_, index) => `line ${String(index)}`).join('\n');
    const tree = parse(language, text);
    const at = text.indexOf('line 10');
    const newText = `${text.slice(0, at)}x${text.slice(at)}`;
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [{ fromA: at, fromB: at, toA: at, toB: at + 1 }]);
    const viewport = { from: 0, to: newText.indexOf('line 30') };
    // eslint-disable-next-line unicorn/name-replacements -- CodeMirror's option name.
    const state = EditorState.create({ doc: newText });
    const context = new (editorParseContext as EditorParseContextConstructor)(language.parser, state, fragments, Tree.empty, 0, viewport, [], null);
    expect(context.work(PARSE_TIMEOUT_MS)).toBe(true);
    // As `StreamLanguage`'s, the tree ends at the viewport's end, and the rest waits until it comes into view.
    expect(context.tree.length).toBe(viewport.to);
    expect(context.skipped).toEqual([{ from: viewport.to, to: newText.length }]);
    expect(treeNodes(context.tree)).toEqual(treeNodes(parse(language, newText)).filter((node) => node[0] < viewport.to));
    expect(reusedLength(tree, context.tree)).toBeGreaterThan(0);
  });

  it('should not reuse the chunks after an edit that changes the state of the lines after it', () => {
    const language = createEditorClassLanguage({ chunkSize: TINY_CHUNK_SIZE });
    const text = `${FILLER}${Array.from({ length: 50 }, (_, index) => `line ${String(index)}`).join('\n')}`;
    const tree = parse(language, text);
    const result = applyEdit({ edit: { from: FILLER.length, insert: '```\n', to: FILLER.length }, language, text, tree });
    expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
    expect(reusedLength(tree, result.tree)).toBeLessThanOrEqual(FILLER.length);
  });

  it('should not reuse the chunks inside a fenced block or a style element', () => {
    const language = createEditorClassLanguage({ chunkSize: TINY_CHUNK_SIZE });
    const body = Array.from({ length: 30 }, (_, index) => `a${String(index)} { color: red; }`).join('\n');
    const lastLine = 'the last line';
    for (const [open, close] of [['```css', '```'], ['<style>', '</style>']] as const) {
      const block = `${open}\n${body}\n${close}\n`;
      const text = `${FILLER}${block}\n${FILLER}${lastLine}`;
      const tree = parse(language, text);
      const at = FILLER.length + open.length + 1;
      const result = applyEdit({ edit: { from: at, insert: 'b', to: at }, language, text, tree });
      expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
      // Everything from the edit to the block's end is parsed again, and so is the last line, which reads the document's end.
      const blockEnd = FILLER.length + block.length + 1;
      const parsedAgain = result.text.length - reusedLength(tree, result.tree);
      expect(parsedAgain).toBeGreaterThanOrEqual(blockEnd - result.resumedAt);
      expect(parsedAgain, open).toBeLessThanOrEqual(blockEnd - result.resumedAt + lastLine.length);
    }
  });

  it('should resume before a fenced block or a style element, not inside it', () => {
    const language = createEditorClassLanguage({ chunkSize: TINY_CHUNK_SIZE });
    /*
     * The CSS mode keeps the last token's type in its closure, and a `-` it reads no token from takes that type. Resuming
     * inside the block from the earlier parse's state would run on with the type the earlier parse left there.
     */
    const body = '--v: 1\n- -\ncolor: red;\ncolor: red;';
    for (const [open, close] of [['```css', '```'], ['<style>', '</style>']] as const) {
      const text = `${FILLER}${open}\n${body}\n${close}\n${FILLER}`;
      const tree = parse(language, text);
      const at = text.lastIndexOf('d;');
      const result = applyEdit({ edit: { from: at, insert: 'b', to: at }, language, text, tree });
      expect(treeNodes(result.tree), open).toEqual(treeNodes(parse(language, result.text)));
      expect(result.resumedAt, open).toBeLessThanOrEqual(FILLER.length);
    }
  });

  it('should not go on from a reused chunk that ends inside a fenced block', () => {
    const language = createEditorClassLanguage({ chunkSize: SMALL_CHUNK_SIZE });
    /*
     * The block runs to the document's end, whose last line reads past it, so the chunks reusable after the edit stop
     * inside the block, and the parse would go on from the CSS mode the earlier parse left at the document's end.
     */
    const text = `${Array.from({ length: 12 }, (_, index) => `filler ${String(index)}`).join('\n')}\n\n\`\`\`css\nvar x = 1;\n-\nx--\nx--`;
    const tree = parse(language, text);
    // Joins two filler lines.
    const at = text.indexOf('\nfiller 9');
    const result = applyEdit({ edit: { from: at, insert: 'x', to: at + 2 }, language, text, tree });
    expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
  });

  it('should give the same tree after random edits as a fresh parse', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const oracle = readOracle(classOracleFileName(MAIN_CLASS_ORACLE_SEED));
    const pieces = ['\n', '\n\n', '-', '---', '=', '|', ' ', ' '.repeat(4), 'a', 'word', '#', '# ', '`', '```', '$', '$$', '> ', '* ', '1. ', '[[', ']]', '%%', '^id', '==', '\t'];
    let seed = 1;
    function random(n: number): number {
      seed = (seed * PRNG_MULTIPLIER + PRNG_INCREMENT) % PRNG_MODULUS;
      return seed % n;
    }
    const language = createEditorClassLanguage({ chunkSize: SMALL_CHUNK_SIZE });
    const corpusLines = oracle.docs.map((document) => document.text).join('\n').split('\n');
    let text = corpusLines.slice(0, RANDOM_DOCUMENT_LINES).join('\n');
    let tree = parse(language, text);
    let resumed = 0;
    let suffixReused = 0;
    let afterResume = 0;
    let parsedAgain = 0;
    for (let step = 0; step < RANDOM_EDITS; step++) {
      const from = random(text.length + 1);
      const to = Math.min(text.length, from + random(MAX_DELETE));
      const insert = pieces[random(pieces.length)] ?? '';
      const result = applyEdit({ edit: { from, insert, to }, language, text, tree });
      expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
      if (result.resumedAt > 0) {
        resumed++;
      }
      const reused = reusedLength(tree, result.tree);
      if (reused > result.resumedAt) {
        suffixReused++;
      }
      afterResume += result.text.length - result.resumedAt;
      parsedAgain += result.text.length - reused;
      ({ text, tree } = result);
    }
    expect(resumed).toBeGreaterThan(RANDOM_EDITS / 2);
    // Most edits reuse chunks after them, and the parses together re-tokenize a small part of what followed their resume point.
    expect(suffixReused).toBeGreaterThan(RANDOM_EDITS * SUFFIX_REUSE_SHARE);
    expect(parsedAgain).toBeLessThan(afterResume * PARSED_AGAIN_SHARE);
  });

  it('should run as an editor state\'s language', () => {
    const text = '# Title\n\nSome *text*\n\n| a | b |\n| - | - |\n| c | d |\n';
    // eslint-disable-next-line unicorn/name-replacements -- CodeMirror's option name.
    let state = EditorState.create({ doc: text, extensions: editorClassLanguage });
    expect(editorClassLanguage.isActiveAt(state, 0)).toBe(true);
    expect(ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS)).not.toBeNull();
    const changes = [{ from: 0, insert: 'x' }, { from: text.indexOf('Some'), insert: '---\n' }, { from: text.length - 1, insert: '\nTail' }];
    for (const change of changes) {
      state = state.update({ changes: change }).state;
      ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
      const fresh = parse(editorClassLanguage, state.doc.toString());
      expect(treeNodes(syntaxTree(state))).toEqual(treeNodes(fresh));
    }
  });
});
