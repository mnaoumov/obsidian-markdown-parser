/**
 * @file
 *
 * Measures the CodeMirror 6 host's parse cost on large documents: a full parse, and the re-parse after a one-character
 * edit at the start, the middle and the end, to a viewport after the edit and to the document's end, and how many
 * characters the re-parse tokenized again rather than reused.
 *
 * The documents are the oracle corpora's texts, repeated to the requested line counts.
 *
 * Usage: `jiti scripts/cm6-bench.ts [--lines <n>]... [--runs <n>]`.
 */

import type {
  PartialParse,
  Tree
} from '@lezer/common';

import { DocInput } from '@codemirror/language';
import { Text } from '@codemirror/state';
import { TreeFragment } from '@lezer/common';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { OracleFile } from '../src/oracle/oracle-file.ts';

import { editorClassLanguage } from '../src/editor/language.ts';
import { reusedLength } from '../src/editor/tree-reuse.ts';

interface EditCost {
  readonly parsedAgain: number;
  readonly resumedAt: number;
  readonly toEnd: number;
  readonly toViewport: number;
}

interface Timed<T> {
  readonly ms: number;
  readonly value: T;
}

const ORACLES = ['oracle/obsidian-1.14.4-seed-2026.json', 'oracle/obsidian-1.14.4-seed-9001.json'];
// About 60 lines of this corpus: a tall editor viewport.
const VIEWPORT_CHARS = 3000;
const TYPING_KEYSTROKES = 50;
const HALF = 0.5;
const DECIMALS = 2;

const { values } = parseArgs({
  options: {
    lines: { default: ['10000', '100000'], multiple: true, type: 'string' },
    runs: { default: '5', type: 'string' }
  }
});
const runs = Number(values.runs);

const corpusLines = ORACLES.flatMap((file) => (JSON.parse(readFileSync(file, 'utf-8')) as OracleFile).docs.flatMap((document) => [...document.text.split('\n'), '']));

function fullParse(document: Text): Tree {
  const parse = editorClassLanguage.parser.startParse(new DocInput(document));
  const tree = parseUntil(parse, Infinity);
  if (!tree) {
    throw new Error('The parse did not finish');
  }
  return tree;
}

// Inserts one character at the start of the line nearest `at`, and re-parses from the old tree's fragments.
function measureEdit(document: Text, tree: Tree, at: number): EditCost {
  const line = document.lineAt(at);
  const changed = document.replace(line.from, line.from, Text.of(['x']));
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [{ fromA: line.from, fromB: line.from, toA: line.from, toB: line.from + 1 }]);
  const viewport: number[] = [];
  const end: number[] = [];
  function startParse(): PartialParse {
    return editorClassLanguage.parser.startParse(new DocInput(changed), fragments);
  }
  const { parsedPos: resumedAt } = startParse();
  const parsedAgain = changed.length - reusedLength(tree, parseUntil(startParse(), Infinity) ?? tree);
  for (let run = 0; run < runs; run++) {
    const toViewport = timed(() => {
      const parse = startParse();
      parseUntil(parse, line.from + VIEWPORT_CHARS);
      return parse;
    });
    viewport.push(toViewport.ms);
    end.push(toViewport.ms + timed(() => parseUntil(toViewport.value, Infinity)).ms);
  }
  return { parsedAgain, resumedAt, toEnd: median(end), toViewport: median(viewport) };
}

// Types characters one after another in the middle, each re-parse resuming from the tree before it and stopping at the viewport.
function measureTyping(document: Text, tree: Tree): number {
  let current = document;
  let currentTree = tree;
  const at = document.lineAt(Math.floor(document.length * HALF)).from;
  const samples: number[] = [];
  for (let key = 0; key < TYPING_KEYSTROKES; key++) {
    const pos = at + key;
    const next = current.replace(pos, pos, Text.of(['a']));
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(currentTree), [{ fromA: pos, fromB: pos, toA: pos, toB: pos + 1 }]);
    const result = timed(() => {
      const parse = editorClassLanguage.parser.startParse(new DocInput(next), fragments);
      // Like the editor, stop at the viewport: the tree past it is parsed later, in idle time.
      parseUntil(parse, pos + VIEWPORT_CHARS);
      parse.stopAt(parse.parsedPos);
      return parseUntil(parse, Infinity);
    });
    samples.push(result.ms);
    current = next;
    currentTree = result.value ?? currentTree;
  }
  return median(samples);
}

function median(samples: readonly number[]): number {
  const sorted = samples.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length * HALF)] ?? 0;
}

function ms(value: number): string {
  return value.toFixed(DECIMALS);
}

function parseUntil(parse: PartialParse, pos: number): null | Tree {
  for (;;) {
    const done = parse.advance();
    if (done) {
      return done;
    }
    if (parse.parsedPos >= pos) {
      return null;
    }
  }
}

function repeatToLines(count: number): Text {
  const lines: string[] = [];
  while (lines.length < count) {
    lines.push(...corpusLines.slice(0, count - lines.length));
  }
  return Text.of(lines);
}

function timed<T>(run: () => T): Timed<T> {
  const start = performance.now();
  const value = run();
  return { ms: performance.now() - start, value };
}

// Warm the tokenizer and its sub-modes up before timing anything.
fullParse(repeatToLines(corpusLines.length));

console.log('| Lines | Characters | Full parse | Edit at | Resumed from | Re-parsed | To viewport | To end |');
console.log('| ----: | ---------: | ---------: | :------ | -----------: | --------: | ----------: | -----: |');
for (const lineCount of values.lines) {
  const count = Number(lineCount);
  const document = repeatToLines(count);
  const full = median(Array.from({ length: runs }, () => timed(() => fullParse(document)).ms));
  const tree = fullParse(document);
  for (const [label, at] of [['start', 0], ['middle', Math.floor(document.length * HALF)], ['end', document.length]] as const) {
    const edit = measureEdit(document, tree, at);
    console.log(
      `| ${String(count)} | ${String(document.length)} | ${ms(full)} ms | ${label} | ${String(edit.resumedAt)} | ${String(edit.parsedAgain)} | ${ms(edit.toViewport)} ms | ${ms(edit.toEnd)} ms |`
    );
  }
  console.log(`Typing ${String(TYPING_KEYSTROKES)} characters in the middle of ${String(count)} lines, re-parsing to the viewport each time: median ${ms(measureTyping(document, tree))} ms per keystroke`);
}
