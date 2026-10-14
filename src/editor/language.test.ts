import type { Language } from '@codemirror/language';
import type { Tree } from '@lezer/common';

import {
  ensureSyntaxTree,
  syntaxTree
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { TreeFragment } from '@lezer/common';
/* eslint-disable import-x/no-nodejs-modules -- The suite runs in Node and reads the oracle fixtures from disk. */
import { readFileSync } from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules -- Only the fixture imports above need Node. */
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  OracleFile,
  OracleNode
} from '../oracle/oracle-file.ts';
import type { ClassSets } from '../oracle/score.ts';

import {
  classSetsOf,
  compareCodeUnits,
  toNodes
} from '../oracle/score.ts';
import { highlight } from './highlight.ts';
import {
  createEditorClassLanguage,
  editorClassLanguage,
  lineClassesProperty
} from './language.ts';

const ORACLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle');
const TINY_CHUNK_SIZE = 1;
const SMALL_CHUNK_SIZE = 16;
const RANDOM_EDITS = 400;
const RANDOM_DOCUMENT_LINES = 300;
const MAX_DELETE = 4;
const PRNG_MULTIPLIER = 1_103_515_245;
const PRNG_INCREMENT = 12_345;
const PRNG_MODULUS = 2 ** 31;
const PARSE_TIMEOUT_MS = 1e9;
const PADDING = ' '.repeat(40);
const FILLER_LINES = 10;
// `TreeFragment.applyChanges` drops a fragment shorter than 128 characters, so a case needs text before it to reuse.
const FILLER = `${Array.from({ length: FILLER_LINES }, (_, index) => `filler line ${String(index)} with some words in it`).join('\n')}\n\n`;

/*
 * The documents each oracle still disagrees on, as in `highlight.test.ts`: the host must give the live editor's classes
 * wherever the tokenizer does.
 */
const KNOWN_DIFFERENCES = new Map<string, readonly string[]>([
  ['obsidian-1.14.4-seed-12345.json', []],
  ['obsidian-1.14.4-seed-2026.json', []],
  ['obsidian-1.14.4-seed-2718.json', []],
  ['obsidian-1.14.4-seed-31337.json', []],
  ['obsidian-1.14.4-seed-4242.json', []],
  ['obsidian-1.14.4-seed-777.json', []],
  ['obsidian-1.14.4-seed-9001.json', []]
]);

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

function parse(language: Language, text: string): Tree {
  return language.parser.parse(text);
}

function readOracle(name: string): OracleFile {
  return JSON.parse(readFileSync(join(ORACLE_DIR, name), 'utf-8')) as OracleFile;
}

function sortedSets(sets: readonly ReadonlySet<string>[]): string[][] {
  return sets.map((set) => [...set].toSorted(compareCodeUnits));
}

function tokenizerClassSets(text: string): ClassSets {
  return classSetsOf(text, toNodes(highlight(text)));
}

// The tree in the oracle's encoding: pre-order, without the root, as `scripts/oracle.ts` reads the live editor's.
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
    it(`should match the live editor's tree on every document of ${name} but the known differences`, () => {
      const differing: string[] = [];
      for (const document of readOracle(name).docs) {
        const hosted = encodeClassSets(hostedClassSets(document.text));
        expect(hosted).toBe(encodeClassSets(tokenizerClassSets(document.text)));
        if (hosted !== encodeClassSets(classSetsOf(document.text, document.nodes))) {
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

  it('should give the same tree after random edits as a fresh parse', () => {
    const oracle = readOracle('obsidian-1.14.4-seed-12345.json');
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
    for (let step = 0; step < RANDOM_EDITS; step++) {
      const from = random(text.length + 1);
      const to = Math.min(text.length, from + random(MAX_DELETE));
      const insert = pieces[random(pieces.length)] ?? '';
      const result = applyEdit({ edit: { from, insert, to }, language, text, tree });
      expect(treeNodes(result.tree)).toEqual(treeNodes(parse(language, result.text)));
      if (result.resumedAt > 0) {
        resumed++;
      }
      ({ text, tree } = result);
    }
    expect(resumed).toBeGreaterThan(RANDOM_EDITS / 2);
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
