/**
 * @file
 *
 * Compares the micromark adapter or the markdown-it plugin with the `@lezer/markdown` extensions on the documents of
 * oracle files, construct by construct: all are built on the rules in `src/syntax/spec.ts`, so a difference is a place
 * where the parsers' block structure reads a document differently.
 *
 * Usage:
 * - `jiti scripts/oracles/adapter-diff.ts [--adapter micromark|markdown-it] [--oracle <file>]...`: per construct, the documents
 *   that use it and those that agree. The adapter defaults to micromark.
 * - `jiti scripts/oracles/adapter-diff.ts --construct <name> --examples <n>`: the first `n` disagreements of one construct.
 */

import type { Token } from 'markdown-it';

import {
  parse,
  postprocess,
  preprocess
} from 'micromark';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { OracleFile } from '../../src/oracle/oracle-file.ts';
import type { ObsidianNodeName } from '../../src/syntax/spec.ts';

import { obsidianParser } from '../../src/syntax/lezer/lezer.ts';
import {
  getObsidianTokenRange,
  obsidianNodeNameOf,
  parseMarkdownIt
} from '../../src/syntax/markdown-it/markdown-it.ts';
import {
  isObsidianNodeName,
  ObsidianNode
} from '../../src/syntax/spec.ts';
import { micromarkObsidianMarkdown } from '../../src/syntax/unified/micromark.ts';

type Spans = Map<ObsidianNodeName, string[]>;

const DEFAULT_ORACLES = [
  'oracle/obsidian-1.14.5-seed-12345.json',
  'oracle/obsidian-1.14.5-seed-777.json',
  'oracle/obsidian-1.14.5-seed-4242.json',
  'oracle/obsidian-1.14.5-seed-2026.json',
  'oracle/obsidian-1.14.5-seed-9001.json',
  'oracle/obsidian-1.14.5-seed-2718.json',
  'oracle/obsidian-1.14.5-seed-31337.json'
];
const NAME_COLUMN_WIDTH = 22;
const COUNT_COLUMN_WIDTH = 7;
const SHOWN_SPANS = 10;
// The group of the documents where Lezer's node takes the document's final line break and the adapter's stops before it.
const FINAL_LINE_BREAK = 'final line break';

// Each construct is compared with its parts: the marks, labels and names inside it.
const CONSTRUCTS: Readonly<Record<string, readonly ObsidianNodeName[]>> = {
  'block id': [ObsidianNode.BlockId, ObsidianNode.BlockIdMark],
  'callout': [ObsidianNode.Callout, ObsidianNode.CalloutMark, ObsidianNode.CalloutType, ObsidianNode.CalloutFold, ObsidianNode.CalloutTitle],
  'comment': [ObsidianNode.Comment, ObsidianNode.CommentBlock, ObsidianNode.CommentMark],
  'footnote definition': [ObsidianNode.FootnoteDefinition],
  'footnote reference': [ObsidianNode.FootnoteReference, ObsidianNode.FootnoteLabel],
  'front matter': [ObsidianNode.FrontMatter, ObsidianNode.FrontMatterMark, ObsidianNode.FrontMatterContent],
  'highlight': [ObsidianNode.Highlight, ObsidianNode.HighlightMark],
  'inline footnote': [ObsidianNode.InlineFootnote],
  'internal link': [
    ObsidianNode.InternalLink,
    ObsidianNode.Embed,
    ObsidianNode.InternalLinkMark,
    ObsidianNode.InternalLinkPath,
    ObsidianNode.InternalLinkSubpath,
    ObsidianNode.InternalLinkAliasMark,
    ObsidianNode.InternalLinkAlias
  ],
  'math': [ObsidianNode.InlineMath, ObsidianNode.MathBlock, ObsidianNode.MathMark],
  'tag': [ObsidianNode.Tag, ObsidianNode.TagMark, ObsidianNode.TagName],
  'task': [ObsidianNode.Task, ObsidianNode.TaskMarker]
};

const { values } = parseArgs({
  options: {
    adapter: { default: 'micromark', type: 'string' },
    construct: { type: 'string' },
    examples: { default: '5', type: 'string' },
    oracle: { multiple: true, type: 'string' }
  }
});

function add(spans: Spans, name: ObsidianNodeName, from: number, to: number): void {
  const list = spans.get(name) ?? [];
  list.push(`${String(from)}-${String(to)}`);
  spans.set(name, list);
}

/*
 * An unclosed block or front matter at the end of a document that ends with a line break: Lezer reads the empty last
 * line as part of it, and the adapter ends it before that line break.
 */
function isOnlyFinalLineBreak(text: string, lezer: string, adapter: string): boolean {
  return text.endsWith('\n') && lezer.split(`-${String(text.length)}`).join(`-${String(text.length - 1)}`) === adapter;
}

function lezerSpans(text: string): Spans {
  const spans: Spans = new Map();
  obsidianParser.parse(text).iterate({
    enter(node) {
      if (isObsidianNodeName(node.name)) {
        add(spans, node.name, node.from, node.to);
      }
    }
  });
  return spans;
}

function markdownItSpans(text: string): Spans {
  const spans: Spans = new Map();
  visit(parseMarkdownIt(text));
  return spans;

  function visit(tokens: readonly Token[]): void {
    for (const token of tokens) {
      const name = obsidianNodeNameOf(token);
      const range = getObsidianTokenRange(token);
      if (name && range) {
        add(spans, name, range.from, range.to);
      }
      visit(token.children ?? []);
    }
  }
}

function micromarkSpans(text: string): Spans {
  const spans: Spans = new Map();
  const events = postprocess(parse({ extensions: [...micromarkObsidianMarkdown] }).document().write(preprocess()(text, undefined, true)));
  for (const [kind, token] of events) {
    if (kind === 'enter' && isObsidianNodeName(token.type)) {
      add(spans, token.type, token.start.offset, token.end.offset);
    }
  }
  return spans;
}

function resolveAdapter(name: string): (text: string) => Spans {
  const spans = ADAPTERS[name];
  if (!spans) {
    throw new Error(`Unknown adapter: ${name}. Use one of: ${Object.keys(ADAPTERS).join(', ')}.`);
  }
  return spans;
}

function spansOf(spans: Spans, names: readonly ObsidianNodeName[]): string {
  return names.map((name) => `${name}: ${(spans.get(name) ?? []).join(' ')}`).join('; ');
}

const ADAPTERS: Readonly<Record<string, (text: string) => Spans>> = {
  'markdown-it': markdownItSpans,
  'micromark': micromarkSpans
};
const adapterName = values.adapter;
const adapterSpans = resolveAdapter(adapterName);

const scores = new Map(Object.keys(CONSTRUCTS).map((name) => [name, { agreeing: 0, failing: new Map<string, number>(), using: 0 }]));
let documents = 0;
let identical = 0;
let shown = 0;
const oracleFiles = values.oracle ?? DEFAULT_ORACLES;
for (const file of oracleFiles) {
  const oracle = JSON.parse(readFileSync(file, 'utf-8')) as OracleFile;
  for (const document of oracle.docs) {
    documents++;
    const lezer = lezerSpans(document.text);
    const adapter = adapterSpans(document.text);
    let isIdentical = true;
    for (const [construct, names] of Object.entries(CONSTRUCTS)) {
      const score = scores.get(construct);
      const expected = spansOf(lezer, names);
      const actual = spansOf(adapter, names);
      if (!score || names.every((name) => !lezer.has(name) && !adapter.has(name))) {
        continue;
      }
      score.using++;
      if (expected === actual) {
        score.agreeing++;
        continue;
      }
      isIdentical = false;
      const group = isOnlyFinalLineBreak(document.text, expected, actual) ? FINAL_LINE_BREAK : document.set;
      score.failing.set(group, (score.failing.get(group) ?? 0) + 1);
      if ((group === FINAL_LINE_BREAK) || construct !== values.construct || shown >= Number(values.examples)) {
        continue;
      }
      shown++;
      console.log(`--- ${document.id}`);
      for (const name of names) {
        const lezerList = (lezer.get(name) ?? []).slice(0, SHOWN_SPANS).join(' ');
        const adapterList = (adapter.get(name) ?? []).slice(0, SHOWN_SPANS).join(' ');
        if (lezerList !== adapterList) {
          console.log(`${name}\n  lezer:   ${lezerList}\n  adapter: ${adapterList}`);
        }
      }
      console.log(document.text);
    }
    if (isIdentical) {
      identical++;
    }
  }
}

console.log(`${String(identical)} of ${String(documents)} documents give the same Obsidian nodes in ${adapterName} and Lezer.`);
console.log(`${'construct'.padEnd(NAME_COLUMN_WIDTH)}${'docs'.padStart(COUNT_COLUMN_WIDTH)}${'agree'.padStart(COUNT_COLUMN_WIDTH)}`);
for (const [name, score] of scores) {
  const sets = [...score.failing].toSorted((a, b) => b[1] - a[1]).map(([set, count]) => `${set} ${String(count)}`).join(', ');
  console.log(`${name.padEnd(NAME_COLUMN_WIDTH)}${String(score.using).padStart(COUNT_COLUMN_WIDTH)}${String(score.agreeing).padStart(COUNT_COLUMN_WIDTH)}  ${sets}`);
}
