/**
 * @file
 *
 * Turns a CommonMark-style `spec.txt` into the JSON test file the CommonMark project publishes as `spec.json`: one
 * entry per example, with its markdown, the HTML it renders to, its number, its lines and its section. It reads the
 * examples the way the spec's own `spec_tests.py` does, so the CommonMark spec gives back the published `spec.json`
 * byte for byte. The GFM spec marks the examples of its extensions, and each entry lists them in `extensions`; the
 * examples it marks `disabled` keep their number and are left out, as in `cmark-gfm`'s runner.
 *
 * Usage: `jiti scripts/spec-json.ts <spec.txt> <out.json>`.
 */

import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import { parseArgs } from 'node:util';

interface SpecExample {
  end_line: number;
  example: number;
  extensions?: string[];
  html: string;
  markdown: string;
  section: string;
  start_line: number;
}

const FENCE_LENGTH = 32;
const JSON_INDENT = 2;
const FENCE = '`'.repeat(FENCE_LENGTH);
const EXAMPLE_FENCE = `${FENCE} example`;
const HEADER_RE = /^#+ /u;
const TAB_ARROW_RE = /→/gu;

const State = {
  Html: 'html',
  Markdown: 'markdown',
  Text: 'text'
} as const;

type State = typeof State[keyof typeof State];

function main(): void {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [input, output] = positionals;
  if (input === undefined || output === undefined) {
    throw new Error('Usage: jiti scripts/spec-json.ts <spec.txt> <out.json>');
  }
  const examples = readExamples(readFileSync(input, 'utf-8'));
  writeFileSync(output, `${JSON.stringify(examples, null, JSON_INDENT)}\n`);
  console.log(`${String(examples.length)} examples written to ${output}`);
}

function readExamples(spec: string): SpecExample[] {
  const examples: SpecExample[] = [];
  let state: State = State.Text;
  let section = '';
  let extensions: string[] = [];
  let markdownLines: string[] = [];
  let htmlLines: string[] = [];
  let startLine = 0;
  let exampleNumber = 0;
  const lines = spec.split('\n');
  // `spec_tests.py` reads lines with their line ending, so a file's last line holds no line of its own.
  if (lines.at(-1) === '') {
    lines.pop();
  }
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (state === State.Text && HEADER_RE.test(line)) {
      section = line.replace(HEADER_RE, '').trim();
    }
    if (trimmed.startsWith(EXAMPLE_FENCE)) {
      state = State.Markdown;
      extensions = trimmed.slice(EXAMPLE_FENCE.length).split(' ').filter((name) => name !== '');
    } else if (trimmed === FENCE && state === State.Html) {
      state = State.Text;
      exampleNumber++;
      if (!extensions.includes('disabled')) {
        // The keys go in the order of the published `spec.json`.
        /* eslint-disable perfectionist/sort-objects, camelcase -- The output must match the published file byte for byte. */
        examples.push({
          markdown: markdownLines.join(''),
          html: htmlLines.join(''),
          example: exampleNumber,
          start_line: startLine,
          end_line: lineNumber,
          section,
          ...(extensions.length > 0) && { extensions }
        });
        /* eslint-enable perfectionist/sort-objects, camelcase -- Only the entry above keeps the published names and order. */
      }
      startLine = 0;
      markdownLines = [];
      htmlLines = [];
    } else if (trimmed === '.') {
      state = State.Html;
    } else if (state === State.Markdown) {
      if (startLine === 0) {
        startLine = lineNumber - 1;
      }
      markdownLines.push(`${line.replaceAll(TAB_ARROW_RE, '\t')}\n`);
    } else if (state === State.Html) {
      htmlLines.push(`${line.replaceAll(TAB_ARROW_RE, '\t')}\n`);
    }
  }
  return examples;
}

main();
