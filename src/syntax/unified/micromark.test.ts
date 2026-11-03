/* eslint-disable import-x/no-nodejs-modules -- The suite runs in Node and reads an oracle fixture from disk. */
import type { Event } from 'micromark-util-types';

import {
  parse,
  postprocess,
  preprocess
} from 'micromark';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules -- Only the fixture imports above need Node. */
import {
  describe,
  expect,
  it
} from 'vitest';

import type { OracleFile } from '../../oracle/oracle-file.ts';
import type { OutlineEntry } from '../conformance.ts';

import {
  classOracleFileName,
  CORPUS_TEST_TIMEOUT_MS,
  MAIN_CLASS_ORACLE_SEED,
  oracleDirectory
} from '../../oracle/oracle-location.ts';
import { CONFORMANCE_CASES } from '../conformance.ts';
import { obsidianParser } from '../lezer/lezer.ts';
import {
  isObsidianNodeName,
  ObsidianNode as N
} from '../spec.ts';
import { micromarkObsidianMarkdown } from './micromark.ts';

const ORACLE_FILE = join(oracleDirectory(), classOracleFileName(MAIN_CLASS_ORACLE_SEED));
// The documents of the oracle file on which the two adapters give the same Obsidian nodes. `docs/syntax.md` explains
// the rest, and `scripts/oracles/adapter-diff.ts` shows them.
const AGREEING_DOCUMENTS = 4068;

function eventsOf(markdown: string): Event[] {
  return postprocess(parse({ extensions: [...micromarkObsidianMarkdown] }).document().write(preprocess()(markdown, undefined, true)));
}

function lezerSpansOf(markdown: string): string[] {
  const spans: string[] = [];
  obsidianParser.parse(markdown).iterate({
    enter(node) {
      if (isObsidianNodeName(node.name)) {
        spans.push(`${node.name} ${String(node.from)}-${String(node.to)}`);
      }
    }
  });
  return spans.toSorted((a, b) => a.localeCompare(b));
}

function micromarkSpansOf(markdown: string): string[] {
  const spans: string[] = [];
  for (const [kind, token] of eventsOf(markdown)) {
    if (kind === 'enter' && isObsidianNodeName(token.type)) {
      spans.push(`${token.type} ${String(token.start.offset)}-${String(token.end.offset)}`);
    }
  }
  return spans.toSorted((a, b) => a.localeCompare(b));
}

function outlineOf(markdown: string): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  for (const [kind, token] of eventsOf(markdown)) {
    if (kind === 'enter' && isObsidianNodeName(token.type)) {
      outline.push([token.type, markdown.slice(token.start.offset, token.end.offset)]);
    }
  }
  return outline;
}

describe('micromarkObsidianSyntax', () => {
  for (const testCase of CONFORMANCE_CASES) {
    it(`should pass the conformance case: ${testCase.name}`, () => {
      expect(outlineOf(testCase.markdown)).toEqual(testCase.expected);
    });
  }

  it('should cover the quote markers of the lines an inline comment or math spans', () => {
    expect(outlineOf('> a %%one\n> two%% $$x\n> y$$')).toEqual([
      [N.Comment, '%%one\n> two%%'],
      [N.CommentMark, '%%'],
      [N.CommentMark, '%%'],
      [N.InlineMath, '$$x\n> y$$'],
      [N.MathMark, '$$'],
      [N.MathMark, '$$']
    ]);
  });

  it('should let a task cover every line of its paragraph, and read the lines as inline content', () => {
    expect(outlineOf('> - [ ] one\n>   two #tag')).toEqual([[N.Task, '[ ] one\n>   two #tag'], [N.TaskMarker, '[ ]'], [N.Tag, '#tag'], [N.TagMark, '#'], [
      N.TagName,
      'tag'
    ]]);
  });

  it('should give front matter content over several lines, and run unclosed front matter to the end', () => {
    expect(outlineOf('---\na: 1\n\nb: 2\n---')).toEqual([[N.FrontMatter, '---\na: 1\n\nb: 2\n---'], [N.FrontMatterMark, '---'], [
      N.FrontMatterContent,
      'a: 1\n\nb: 2'
    ], [N.FrontMatterMark, '---']]);
    expect(outlineOf('---\na: 1\n# b')).toEqual([[N.FrontMatter, '---\na: 1\n# b'], [N.FrontMatterMark, '---'], [N.FrontMatterContent, 'a: 1\n# b']]);
  });

  it('should not read a highlight delimiter inside a code span', () => {
    expect(outlineOf('==a `==` b==')).toEqual([[N.Highlight, '==a `==` b=='], [N.HighlightMark, '=='], [N.HighlightMark, '==']]);
  });

  it('should read `[^label]: url` in a quote as a footnote reference, not a link reference definition', () => {
    expect(outlineOf('> [^2]: https://example.com')).toEqual([[N.FootnoteReference, '[^2]'], [N.FootnoteMark, '[^'], [N.FootnoteLabel, '2'], [
      N.FootnoteMark,
      ']'
    ]]);
  });

  it('should end a callout without a title before a lazy line, and continue one with a title', () => {
    expect(outlineOf('> [!note]\nlazy')[0]).toEqual([N.Callout, '> [!note]']);
    expect(outlineOf('> [!note] Title\nlazy')[0]).toEqual([N.Callout, '> [!note] Title\nlazy']);
  });

  it('should agree with the @lezer/markdown extensions on the oracle documents', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const oracle = JSON.parse(readFileSync(ORACLE_FILE, 'utf-8')) as OracleFile;
    const agreeing = oracle.docs.filter((document) => lezerSpansOf(document.text).join('\n') === micromarkSpansOf(document.text).join('\n'));
    expect(agreeing).toHaveLength(AGREEING_DOCUMENTS);
  });
});
