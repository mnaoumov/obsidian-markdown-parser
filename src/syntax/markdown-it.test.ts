/* eslint-disable import-x/no-nodejs-modules -- The suite runs in Node and reads an oracle fixture from disk. */
import type { Token } from 'markdown-it';

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

import type { OracleFile } from '../oracle/oracle-file.ts';
import type { OutlineEntry } from './conformance.ts';

import { CONFORMANCE_CASES } from './conformance.ts';
import { obsidianParser } from './lezer.ts';
import {
  createObsidianMarkdownIt,
  getObsidianTokenRange,
  obsidianNodeNameOf,
  parseMarkdownIt
} from './markdown-it.ts';
import {
  isObsidianNodeName,
  ObsidianNode as N
} from './spec.ts';

const ORACLE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle', 'obsidian-1.14.4-seed-12345.json');
// The documents of the oracle file on which markdown-it and the @lezer/markdown extensions give the same Obsidian
// nodes. `docs/syntax.md` explains the rest, and `scripts/adapter-diff.ts` shows them.
const AGREEING_DOCUMENTS = 4086;

function allTokens(tokens: readonly Token[]): Token[] {
  return tokens.flatMap((token) => [token, ...allTokens(token.children ?? [])]);
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

function markdownItSpansOf(markdown: string): string[] {
  const spans: string[] = [];
  const tokens = allTokens(parseMarkdownIt(markdown));
  for (const token of tokens) {
    const name = obsidianNodeNameOf(token);
    const range = getObsidianTokenRange(token);
    if (name && range) {
      spans.push(`${name} ${String(range.from)}-${String(range.to)}`);
    }
  }
  return spans.toSorted((a, b) => a.localeCompare(b));
}

function outlineOf(markdown: string): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  const tokens = allTokens(parseMarkdownIt(markdown));
  for (const token of tokens) {
    const name = obsidianNodeNameOf(token);
    const range = getObsidianTokenRange(token);
    if (name && range) {
      outline.push([name, markdown.slice(range.from, range.to)]);
    }
  }
  return outline;
}

describe('markdownItObsidianSyntax', () => {
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

  it('should find the Obsidian syntax in a heading with a closing sequence and in a cell after an escaped pipe', () => {
    expect(outlineOf('# A #tag ##\n\n| a \\| b | [[x]] |\n| - | - |')).toEqual([
      [N.Tag, '#tag'],
      [N.TagMark, '#'],
      [N.TagName, 'tag'],
      [N.InternalLink, '[[x]]'],
      [N.InternalLinkMark, '[['],
      [N.InternalLinkPath, 'x'],
      [N.InternalLinkMark, ']]']
    ]);
  });

  it('should render the Obsidian syntax as HTML', () => {
    const md = createObsidianMarkdownIt();
    expect(md.render('a [[Note#H|shown]] ![[img.png]] #tag ==hi== %%hidden%% $x$ text[^1] ^[note] ^id')).toBe(
      '<p>a <a class="internal-link" href="Note#H" data-href="Note#H">shown</a> '
        + '<span class="internal-embed" src="img.png" data-href="img.png">img.png</span> '
        + '<a class="tag" href="#tag">#tag</a> <mark>hi</mark>  <span class="math math-inline">x</span> '
        + 'text<sup class="footnote-ref" data-footnote="1">1</sup> <span class="inline-footnote">note</span> </p>\n'
    );
    expect(md.render('---\na: 1\n---\n> [!Tip]- Title\n> Body\n\n- [x] done\n\n$$\nx\n$$')).toBe(
      '<div class="callout" data-callout="tip" data-callout-fold="-">\n<div class="callout-title">Title</div>\n<p>Body</p>\n</div>\n'
        + '<ul>\n<li class="task-list-item" data-task="x"><input class="task-list-item-checkbox" type="checkbox" data-task="x" checked disabled> done</li>\n</ul>\n'
        + '<div class="math math-block">x</div>\n'
    );
  });

  it('should agree with the @lezer/markdown extensions on the oracle documents', () => {
    const oracle = JSON.parse(readFileSync(ORACLE_FILE, 'utf-8')) as OracleFile;
    const agreeing = oracle.docs.filter((document) => lezerSpansOf(document.text).join('\n') === markdownItSpansOf(document.text).join('\n'));
    expect(agreeing).toHaveLength(AGREEING_DOCUMENTS);
  });
});
