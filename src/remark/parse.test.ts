import {
  describe,
  expect,
  it
} from 'vitest';

import type { RemarkNode } from './types.ts';

import { parseRemark } from './parse.ts';

function blocksOf(markdown: string): unknown[] {
  return parseRemark(markdown).children.map((node) => withoutPositions(node));
}

function withoutPositions(node: RemarkNode): Record<string, unknown> {
  const { position: _position, ...rest } = node;
  return 'children' in node ? { ...rest, children: node.children.map((child) => withoutPositions(child)) } : rest;
}

describe('parseRemark', () => {
  it('gives every node its position, with the column each of its later lines starts at', () => {
    const tree = parseRemark('> a\n> b');
    const [quote] = tree.children;
    expect(quote?.position).toEqual({ end: { column: 4, line: 2, offset: 7 }, indent: [1], start: { column: 1, line: 1, offset: 0 } });
    const [paragraph] = quote && 'children' in quote ? quote.children : [];
    expect(paragraph?.position).toEqual({ end: { column: 4, line: 2, offset: 7 }, indent: [3], start: { column: 3, line: 1, offset: 2 } });
    expect(tree.position).toEqual({ end: { column: 4, line: 2, offset: 7 }, start: { column: 1, line: 1, offset: 0 } });
  });

  it('reads past a byte order mark and counts offsets over CRLF line endings', () => {
    const [paragraph] = parseRemark('\u{FEFF}a\r\nb').children;
    expect(paragraph?.position?.start).toEqual({ column: 2, line: 1, offset: 1 });
    expect(paragraph?.position?.end).toEqual({ column: 2, line: 2, offset: 5 });
  });

  it('gives an empty document an empty root', () => {
    expect(parseRemark('')).toEqual({ children: [], position: { end: { column: 1, line: 1, offset: 0 }, start: { column: 1, line: 1, offset: 0 } }, type: 'root' });
  });

  describe('Obsidian\'s blockquote', () => {
    it('reads a callout header off the first line and tokenizes the rest of that line as the title', () => {
      expect(blocksOf('> [!Note|meta]- Title *x*\n> body')).toEqual([
        {
          callout: { data: 'meta', fold: '-', type: 'note' },
          children: [
            { children: [{ type: 'text', value: 'Title ' }, { children: [{ type: 'text', value: 'x' }], type: 'emphasis' }], type: 'paragraph' },
            { children: [{ type: 'text', value: 'body' }], type: 'paragraph' }
          ],
          type: 'blockquote'
        }
      ]);
    });

    it('trims and lowercases the callout type and joins its words with dashes', () => {
      expect(blocksOf('> [! My  Type ]\n> b')).toEqual([
        { callout: { data: '', fold: '', type: 'my-type' }, children: [{ children: [{ type: 'text', value: 'b' }], type: 'paragraph' }], type: 'blockquote' }
      ]);
    });

    it('reads no callout off a later line', () => {
      expect(blocksOf('> a\n> [!note]')[0]).toMatchObject({ callout: null, type: 'blockquote' });
    });
  });

  describe('Obsidian\'s list', () => {
    it('makes a task of any character between the brackets', () => {
      const [list] = blocksOf('- [?] a\n- [ ] b\n- [x] c\n- c');
      expect(list).toMatchObject({
        children: [
          { checked: true, checklist: '?' },
          { checked: false, checklist: ' ' },
          { checked: true, checklist: 'x' },
          { checked: null, checklist: null }
        ]
      });
    });

    it('strips an item\'s indentation past its lazy lines', () => {
      expect(blocksOf('- a\n  b\nc\n  d')).toEqual([
        {
          children: [{ checked: null, checklist: null, children: [{ children: [{ type: 'text', value: 'a\nb\nc\nd' }], type: 'paragraph' }], spread: false, type: 'listItem' }],
          ordered: false,
          spread: false,
          start: null,
          type: 'list'
        }
      ]);
      expect(blocksOf('1. a\n\n      code\nlazy')[0]).toMatchObject({
        children: [{ children: [{ type: 'paragraph' }, { children: [{ type: 'text', value: '  code\nlazy' }], type: 'paragraph' }] }]
      });
    });
  });

  describe('Obsidian\'s table', () => {
    it('ends at a row whose leading pipe differs from the first row\'s', () => {
      expect(blocksOf('| a |\n| - |\nb | c')).toEqual([
        { align: [null], children: [{ children: [{ children: [{ type: 'text', value: 'a' }], padding: { end: 1, start: 1 }, type: 'tableCell' }], type: 'tableRow' }], type: 'table' },
        { children: [{ type: 'text', value: 'b | c' }], type: 'paragraph' }
      ]);
      expect(blocksOf('a | b\n- | -\n| c | d').map((node) => (node as RemarkNode).type)).toEqual(['table', 'paragraph']);
    });

    it('reads the whitespace around each cell as its padding, and makes a cell of whitespace before the first pipe', () => {
      expect(blocksOf('| a  |b|\n|:-|-:|')[0]).toMatchObject({
        align: ['left', 'right'],
        children: [{ children: [{ padding: { end: 2, start: 1 } }, { padding: { end: 0, start: 0 } }] }]
      });
      expect(blocksOf('  | a |\n  | - |')[0]).toMatchObject({
        children: [{ children: [{ children: [], padding: { end: 0, start: 2 } }, { padding: { end: 1, start: 1 } }] }]
      });
    });
  });

  describe('the inline algorithm', () => {
    it('matches emphasis first come, first served, with no flanking rules', () => {
      expect(blocksOf('*a **b* c**')).toEqual([
        { children: [{ children: [{ type: 'text', value: 'a **b' }], type: 'emphasis' }, { type: 'text', value: ' c**' }], type: 'paragraph' }
      ]);
    });

    it('keeps the whitespace a paragraph starts with, and the text after a hard break', () => {
      expect(blocksOf('  a')).toEqual([{ children: [{ type: 'text', value: '  a' }], type: 'paragraph' }]);
      expect(blocksOf('a\\\n   b')).toEqual([{ children: [{ type: 'text', value: 'a' }, { type: 'break' }, { type: 'text', value: '   b' }], type: 'paragraph' }]);
    });

    it('reuses the last character reference for one that is none, in a link destination', () => {
      expect(blocksOf('[x](&amp;&foo)')).toEqual([
        { children: [{ children: [{ type: 'text', value: 'x' }], title: null, type: 'link', url: '&&' }], type: 'paragraph' }
      ]);
    });

    it('reads references whether or not a definition exists', () => {
      expect(blocksOf('[b][c] [d][]')).toEqual([
        {
          children: [
            { children: [{ type: 'text', value: 'b' }], identifier: 'c', label: 'c', referenceType: 'full', type: 'linkReference' },
            { type: 'text', value: ' ' },
            { children: [{ type: 'text', value: 'd' }], identifier: 'd', label: 'd', referenceType: 'collapsed', type: 'linkReference' }
          ],
          type: 'paragraph'
        }
      ]);
    });

    it('reads autolinks, literal URLs and email addresses with their text alone', () => {
      expect(blocksOf('<https://a.b/*c*> www.x.y/z*a* a@b.cd')).toEqual([
        {
          children: [
            { children: [{ type: 'text', value: 'https://a.b/*c*' }], title: null, type: 'link', url: 'https://a.b/*c*' },
            { type: 'text', value: ' ' },
            // eslint-disable-next-line unicorn/prefer-https -- A literal URL without a scheme gets http://.
            { children: [{ type: 'text', value: 'www.x.y/z*a' }], title: null, type: 'link', url: 'http://www.x.y/z*a' },
            { type: 'text', value: '* ' },
            { children: [{ type: 'text', value: 'a@b.cd' }], title: null, type: 'link', url: 'mailto:a@b.cd' }
          ],
          type: 'paragraph'
        }
      ]);
    });
  });
});
