import {
  describe,
  expect,
  it
} from 'vitest';

import type { RemarkNode } from './types.ts';

import { parseRemark } from './parse.ts';

function inlineOf(markdown: string): unknown[] {
  const [paragraph] = parseRemark(markdown).children;
  return paragraph && 'children' in paragraph ? paragraph.children.map((node) => withoutPositions(node)) : [];
}

function listItemIds(node: RemarkNode): (string | undefined)[] {
  const ids = node.type === 'listItem' ? [node.id] : [];
  return 'children' in node ? [...ids, ...node.children.flatMap((child) => listItemIds(child))] : ids;
}

function withoutPositions(node: RemarkNode): Record<string, unknown> {
  const { position: _position, ...rest } = node;
  return 'children' in node ? { ...rest, children: node.children.map((child) => withoutPositions(child)) } : rest;
}

describe('the Obsidian syntax of parseRemark', () => {
  it('reads none of it when asked not to', () => {
    const [paragraph] = parseRemark('a #t [[l]]', { shouldReadObsidianSyntax: false }).children;
    expect(paragraph && 'children' in paragraph ? paragraph.children.map((node) => node.type) : []).toEqual(['text', 'linkReference', 'text']);
  });

  it('gives an internal link or an embed its target, alias and the text it shows', () => {
    expect(inlineOf(String.raw`[[a#b|c]] ![[ x#y ]] [[d\]]`)).toEqual([
      { alias: 'c', displayText: 'c', target: 'a#b', type: 'internalLink' },
      { type: 'text', value: ' ' },
      { alias: null, displayText: 'x > y', target: 'x#y', type: 'embed' },
      { type: 'text', value: ' ' },
      { alias: null, displayText: 'd\\', target: 'd', type: 'internalLink' }
    ]);
  });

  it('gives a tag its name, a highlight its color and inline math its form', () => {
    expect(inlineOf('#a/b ==🟢x== $y$ $$z$$')).toEqual([
      { name: 'a/b', type: 'tag' },
      { type: 'text', value: ' ' },
      { children: [{ type: 'text', value: 'x' }], color: 'green', type: 'highlight' },
      { type: 'text', value: ' ' },
      { display: false, type: 'inlineMath', value: 'y' },
      { type: 'text', value: ' ' },
      { display: true, type: 'inlineMath', value: 'z' }
    ]);
  });

  it('reads the syntax inside a comment, and an inline footnote\'s content as inline markdown', () => {
    expect(inlineOf('%%#t%% ^[*n*]')).toEqual([
      { children: [{ name: 't', type: 'tag' }], type: 'obsidianComment', value: '#t' },
      { type: 'text', value: ' ' },
      { children: [{ children: [{ type: 'text', value: 'n' }], type: 'emphasis' }], type: 'inlineFootnote' }
    ]);
  });

  it('leaves a reference to no definition as the text of its label, lowercased', () => {
    expect(inlineOf('a[^B]')).toEqual([{ type: 'text', value: 'a' }, { type: 'text', value: 'b' }]);
    expect(inlineOf('a[^B]\n\n[^b]: c')).toEqual([{ type: 'text', value: 'a' }, { identifier: 'b', label: 'B', type: 'footnoteReference' }]);
  });

  it('attaches block ids to their blocks and list items', () => {
    const [paragraph, list] = parseRemark('p ^a\n\n^b\n\n- i ^c\n  - j ^d').children;
    expect(paragraph?.id).toBe('b');
    expect(list?.id).toBeUndefined();
    expect(list ? listItemIds(list) : []).toEqual(['c', 'd']);
  });

  it('reads front matter at the very start of the document only', () => {
    expect(parseRemark('---\na: 1\n---\nb').children.map((node) => node.type)).toEqual(['yaml', 'paragraph']);
    expect(parseRemark('\n---\na: 1\n---\nb').children.map((node) => node.type)).toEqual(['thematicBreak', 'heading', 'paragraph']);
  });

  it('reads comment and math blocks, and footnote definitions in any container', () => {
    expect(parseRemark('%%\na\n%%\n$$\nb\n$$\n> [^c]: d').children.map((node) => withoutPositions(node))).toEqual([
      { children: [{ type: 'text', value: '\na\n' }], type: 'obsidianCommentBlock', value: '\na\n' },
      { type: 'math', value: 'b' },
      {
        callout: null,
        children: [{ children: [{ children: [{ type: 'text', value: 'd' }], type: 'paragraph' }], identifier: 'c', label: 'c', type: 'footnoteDefinition' }],
        type: 'blockquote'
      }
    ]);
  });
});
