/**
 * @file
 *
 * Compares the micromark adapter with the `@lezer/markdown` extensions on the documents of oracle files, construct by
 * construct: both are built on the rules in `src/syntax/spec.ts`, so a difference is a place where the two parsers'
 * block structure reads a document differently.
 *
 * Usage:
 * - `jiti scripts/adapter-diff.ts [--oracle <file>]...`: per construct, the documents that use it and those that agree.
 * - `jiti scripts/adapter-diff.ts --construct <name> --examples <n>`: the first `n` disagreements of one construct.
 */

import {
  parse,
  postprocess,
  preprocess
} from 'micromark';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { OracleFile } from '../src/oracle/oracle-file.ts';
import type { ObsidianNodeName } from '../src/syntax/spec.ts';

import { obsidianParser } from '../src/syntax/lezer.ts';
import { micromarkObsidianMarkdown } from '../src/syntax/micromark.ts';
import {
  isObsidianNodeName,
  ObsidianNode
} from '../src/syntax/spec.ts';

type Spans = Map<ObsidianNodeName, string[]>;

const DEFAULT_ORACLES = [
  'oracle/obsidian-1.14.4-seed-12345.json',
  'oracle/obsidian-1.14.4-seed-777.json',
  'oracle/obsidian-1.14.4-seed-4242.json',
  'oracle/obsidian-1.14.4-seed-2026.json',
  'oracle/obsidian-1.14.4-seed-9001.json',
  'oracle/obsidian-1.14.4-seed-2718.json',
  'oracle/obsidian-1.14.4-seed-31337.json'
];
const NAME_COLUMN_WIDTH = 22;
const COUNT_COLUMN_WIDTH = 7;
const SHOWN_SPANS = 10;
// The group of the documents where Lezer's node takes the document's final line break and micromark's stops before it.
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
 * line as part of it, and micromark ends it before that line break.
 */
function isOnlyFinalLineBreak(text: string, lezer: string, micromark: string): boolean {
  return text.endsWith('\n') && lezer.split(`-${String(text.length)}`).join(`-${String(text.length - 1)}`) === micromark;
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

function spansOf(spans: Spans, names: readonly ObsidianNodeName[]): string {
  return names.map((name) => `${name}: ${(spans.get(name) ?? []).join(' ')}`).join('; ');
}

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
    const micromark = micromarkSpans(document.text);
    let isIdentical = true;
    for (const [construct, names] of Object.entries(CONSTRUCTS)) {
      const score = scores.get(construct);
      const expected = spansOf(lezer, names);
      const actual = spansOf(micromark, names);
      if (!score || names.every((name) => !lezer.has(name) && !micromark.has(name))) {
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
        const micromarkList = (micromark.get(name) ?? []).slice(0, SHOWN_SPANS).join(' ');
        if (lezerList !== micromarkList) {
          console.log(`${name}\n  lezer:     ${lezerList}\n  micromark: ${micromarkList}`);
        }
      }
      console.log(document.text);
    }
    if (isIdentical) {
      identical++;
    }
  }
}

console.log(`${String(identical)} of ${String(documents)} documents give the same Obsidian nodes in both adapters.`);
console.log(`${'construct'.padEnd(NAME_COLUMN_WIDTH)}${'docs'.padStart(COUNT_COLUMN_WIDTH)}${'agree'.padStart(COUNT_COLUMN_WIDTH)}`);
for (const [name, score] of scores) {
  const sets = [...score.failing].toSorted((a, b) => b[1] - a[1]).map(([set, count]) => `${set} ${String(count)}`).join(', ');
  console.log(`${name.padEnd(NAME_COLUMN_WIDTH)}${String(score.using).padStart(COUNT_COLUMN_WIDTH)}${String(score.agreeing).padStart(COUNT_COLUMN_WIDTH)}  ${sets}`);
}
