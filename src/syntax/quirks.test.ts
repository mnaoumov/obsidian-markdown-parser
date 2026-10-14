import type { List } from 'mdast';

import { micromark } from 'micromark';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { ObsidianSyntaxOptions } from './options.ts';

import { parseWithLinkReferences } from './lezer-commonmark.ts';
import { renderLezerHtml } from './lezer-html.ts';
import { createObsidianParser } from './lezer.ts';
import { hasBlankLineInside } from './loose-list.ts';
import { createObsidianMarkdownIt } from './markdown-it.ts';
import { parseMdast } from './mdast.ts';
import { micromarkQuirksHtml } from './micromark-quirks.ts';
import { createMicromarkObsidianMarkdown } from './micromark.ts';
import { OBSIDIAN_QUIRKS } from './options.ts';

type Adapter = 'lezer' | 'markdown-it' | 'micromark';

const ADAPTERS: readonly Adapter[] = ['lezer', 'markdown-it', 'micromark'];
const SELF_CLOSING_RE = /\s*\/>/gu;
const BETWEEN_TAGS_RE = />\n</gu;

const SETEXT_AND_EMPTY_ITEMS: ObsidianSyntaxOptions = { emptyListItem: 'interrupts-paragraph', preset: 'commonmark', setextHeading: 'single-line' };
const EMPTY_ITEMS: ObsidianSyntaxOptions = { emptyListItem: 'interrupts-paragraph', preset: 'commonmark' };
const SINGLE_LINE_SETEXT: ObsidianSyntaxOptions = { preset: 'commonmark', setextHeading: 'single-line' };
const LOOSE_LISTS: ObsidianSyntaxOptions = { looseList: 'blank-line-anywhere', preset: 'commonmark' };
const HARD_BREAKS: ObsidianSyntaxOptions = { preset: 'commonmark', softLineBreak: 'hard-break' };

function render(adapter: Adapter, options: ObsidianSyntaxOptions, markdown: string): string {
  let html: string;
  switch (adapter) {
    case 'lezer': {
      html = renderLezerHtml(markdown, parseWithLinkReferences(createObsidianParser(options), markdown), { looseList: options.looseList });
      break;
    }
    case 'markdown-it': {
      html = createObsidianMarkdownIt(options).render(markdown);
      break;
    }
    case 'micromark': {
      html = micromark(markdown, { extensions: createMicromarkObsidianMarkdown(options), htmlExtensions: [micromarkQuirksHtml] });
      break;
    }
    default: {
      throw new Error('Unknown adapter');
    }
  }
  return html.replaceAll(SELF_CLOSING_RE, '>').replaceAll(BETWEEN_TAGS_RE, '><').trim();
}

describe.each(ADAPTERS)('%s', (adapter) => {
  describe('setextHeading: single-line', () => {
    it.each([
      ['Foo\n===\n', '<h1>Foo</h1>'],
      ['   Foo\n---\n', '<h2>Foo</h2>'],
      ['Foo\n===  \n', '<p>Foo\n===</p>'],
      ['Foo\nbar\n===\nbaz\n', '<p>Foo\nbar\n===\nbaz</p>'],
      ['Foo\n --\n', '<p>Foo\n--</p>'],
      ['> Foo\n> ===\n', '<blockquote><h1>Foo</h1></blockquote>'],
      ['> Foo\n>  ===\n', '<blockquote><p>Foo\n===</p></blockquote>'],
      ['- Foo\n  ---\n', '<ul><li><h2>Foo</h2></li></ul>']
    ])('reads %j', (markdown, html) => {
      expect(render(adapter, SINGLE_LINE_SETEXT, markdown)).toBe(html);
    });
  });

  describe('emptyListItem: interrupts-paragraph', () => {
    it.each([
      ['Foo\n+\n', '<p>Foo</p><ul><li></li></ul>'],
      ['Foo\n1)\n', '<p>Foo</p><ol><li></li></ol>'],
      ['Foo\n2.\n', '<p>Foo\n2.</p>'],
      ['Foo\n-\n', '<h2>Foo</h2>'],
      ['Foo\n- \n', '<h2>Foo</h2>'],
      ['Foo\nbar\n-\n', '<h2>Foo\nbar</h2>']
    ])('reads %j with multi-line setext headings', (markdown, html) => {
      expect(render(adapter, EMPTY_ITEMS, markdown)).toBe(html);
    });

    it.each([
      ['Foo\n-\n', '<h2>Foo</h2>'],
      ['Foo\n- \n', '<p>Foo</p><ul><li></li></ul>'],
      ['Foo\n  -\n', '<p>Foo</p><ul><li></li></ul>'],
      ['Foo\nbar\n-\n', '<p>Foo\nbar</p><ul><li></li></ul>']
    ])('reads %j with single-line setext headings', (markdown, html) => {
      expect(render(adapter, SETEXT_AND_EMPTY_ITEMS, markdown)).toBe(html);
    });
  });

  describe('looseList: blank-line-anywhere', () => {
    it.each([
      ['- a\n  ```\n  b\n\n  c\n  ```\n- d\n', '<ul><li><p>a</p><pre><code>b\n\nc\n</code></pre></li><li><p>d</p></li></ul>'],
      ['> - a\n>\n>   b\n', '<blockquote><ul><li><p>a</p><p>b</p></li></ul></blockquote>'],
      ['> - a\n>   > b\n>   >\n>   > c\n> - d\n', '<blockquote><ul><li>a\n<blockquote><p>b</p><p>c</p></blockquote></li><li>d</li></ul></blockquote>'],
      ['- a\n- b\n\nc\n', '<ul><li>a</li><li>b</li></ul><p>c</p>']
    ])('reads %j', (markdown, html) => {
      expect(render(adapter, LOOSE_LISTS, markdown)).toBe(html);
    });
  });

  describe('softLineBreak: hard-break', () => {
    it.each([
      ['a\nb\n', '<p>a<br>\nb</p>'],
      ['a \nb\n', '<p>a<br>\nb</p>'],
      ['a\t\nb\n', '<p>a<br>\nb</p>'],
      ['a  \nb\n', '<p>a<br>\nb</p>'],
      ['a\\\nb\n', '<p>a<br>\nb</p>'],
      ['`a\nb`\n', '<p><code>a b</code></p>'],
      ['[a\nb](c)\n', '<p><a href="c">a<br>\nb</a></p>']
    ])('reads %j', (markdown, html) => {
      expect(render(adapter, HARD_BREAKS, markdown)).toBe(html);
    });
  });
});

describe('parseMdast with quirks', () => {
  it('spreads the list items a blank line inside makes loose', () => {
    const root = parseMdast('- a\n  ```\n  b\n\n  c\n  ```\n- d\n', LOOSE_LISTS);
    const [list] = root.children as List[];
    expect(list?.children.map((item) => item.spread)).toEqual([true, false]);
  });

  it('leaves the list items as CommonMark spreads them without the quirk', () => {
    const root = parseMdast('- a\n  ```\n  b\n\n  c\n  ```\n- d\n', { preset: 'commonmark' });
    const [list] = root.children as List[];
    expect(list?.children.map((item) => item.spread)).toEqual([false, false]);
  });

  it('reads a soft line break as a hard one', () => {
    const root = parseMdast('a\nb\n', HARD_BREAKS);
    const [paragraph] = root.children;
    expect(paragraph).toMatchObject({ children: [{ type: 'text', value: 'a' }, { type: 'break' }, { type: 'text', value: 'b' }], type: 'paragraph' });
  });

  it('reads every quirk with the obsidian preset', () => {
    const root = parseMdast('Foo\nbar\n---\n', { ...OBSIDIAN_QUIRKS });
    expect(root.children.map((node) => node.type)).toEqual(['paragraph', 'thematicBreak']);
  });
});

describe('hasBlankLineInside', () => {
  it.each([
    ['- a\n\n  b', 0, true],
    ['- a\n  b\n', 0, false],
    ['- a\n\n', 0, false],
    ['- a\n>\n> b', 1, true],
    ['- a\n> >\n> > b', 1, false]
  ])('reads %j inside %i quotes', (source, quoteDepth, isLoose) => {
    expect(hasBlankLineInside(source, quoteDepth)).toBe(isLoose);
  });
});
