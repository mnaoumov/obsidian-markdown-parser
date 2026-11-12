import {
  describe,
  expect,
  it
} from 'vitest';

import { parseRemark } from '../remark/parse.ts';
import { parseMetadata } from './metadata.ts';

describe('parseMetadata', () => {
  it('lists a heading of the document with its source, and none inside a quote', () => {
    const metadata = parseMetadata('# Head *x* [[a]] ^id\n\n> # quoted\n\nsetext\n===');
    expect(metadata?.headings?.map(({ heading, level }) => [heading, level])).toEqual([['Head *x* [[a]] ^id', 1], ['setext', 1]]);
    expect(metadata?.headings?.[0]?.position).toEqual({ end: { col: 20, line: 0, offset: 20 }, start: { col: 0, line: 0, offset: 0 } });
  });

  it('lists a markdown link and an image whose destination is no URL, decoded', () => {
    const metadata = parseMetadata('[t](a%20b.md) ![i|100](./p.png "T") [u](http://x) [bad](%zz)');
    expect(metadata?.links?.map(({ displayText, link, original }) => [link, original, displayText])).toEqual([['a b.md', '[t](a%20b.md)', 't']]);
    expect(metadata?.embeds?.map(({ displayText, link }) => [link, displayText])).toEqual([['./p.png', 'i|100']]);
  });

  it('gives a markdown link the text of its children, with every line break hard', () => {
    const metadata = parseMetadata('[a *b*\n`c` ![i](p.png) #t](x.md)');
    expect(metadata?.links?.[0]?.displayText).toBe('a b\nc p.png #t');
  });

  it('parses the front matter and lists the links in its strings', () => {
    const metadata = parseMetadata('---\nk: "[[L|x]]"\nl: ["[t](a%20b.md)"]\nb: !!binary aGk=\n---\n');
    expect(metadata?.frontmatter).toEqual({ b: new Uint8Array([104, 105]), k: '[[L|x]]', l: ['[t](a%20b.md)'] });
    expect(metadata?.frontmatterLinks).toEqual([
      { displayText: 'x', key: 'k', link: 'L', original: '[[L|x]]' },
      { displayText: 't', key: 'l.0', link: 'a b.md', original: '[t](a%20b.md)' }
    ]);
    expect(metadata?.frontmatterPosition?.end.offset).toBe(58);
  });

  it('leaves out front matter that does not parse to an object, and keeps its section', () => {
    const metadata = parseMetadata('---\n- a\n---\n');
    expect(metadata?.frontmatter).toBeUndefined();
    expect(metadata?.sections?.map(({ type }) => type)).toEqual(['yaml']);
  });

  it('is null where the worker throws', () => {
    expect(parseMetadata('---\nk: "[t]()"\n---\n')).toBeNull();
    expect(parseMetadata('---\nhasOwnProperty: 1\n---\n')).toBeNull();
    expect(parseMetadata('---\nk: "[t]()"\n---\n', { obsidianVersion: '1.15.1' })).toBeNull();
  });

  it('reads a front matter key hasOwnProperty, and posts v: 1 after the block ids, from Obsidian 1.15.1 on', () => {
    expect(JSON.stringify(parseMetadata('---\nhasOwnProperty: 1\n---\na ^b', { obsidianVersion: '1.15.1' }))).toBe(
      '{"sections":[{"type":"yaml","position":{"start":{"line":0,"col":0,"offset":0},"end":{"line":2,"col":3,"offset":25}}},{"type":"paragraph","position":{"start":{"line":3,"col":0,"offset":26},"end":{"line":3,"col":4,"offset":30}},"id":"b"}],"blocks":{"b":{"position":{"start":{"line":3,"col":0,"offset":26},"end":{"line":3,"col":4,"offset":30}},"id":"b"}},"v":1,"frontmatter":{"hasOwnProperty":1},"frontmatterPosition":{"start":{"line":0,"col":0,"offset":0},"end":{"line":2,"col":3,"offset":25}},"frontmatterLinks":[]}'
    );
    expect(parseMetadata('', { obsidianVersion: '1.15.1' })).toEqual({ v: 1 });
    expect(parseMetadata('', { obsidianVersion: '1.16.0' })).toEqual({ v: 1 });
    expect(parseMetadata('', { obsidianVersion: '1.15.0' })).toEqual({});
  });

  it('drops a byte order mark, as the worker reads the bytes', () => {
    expect(parseMetadata('\u{FEFF}# a')?.headings?.[0]?.position.start.offset).toBe(0);
  });

  it('puts the footnotes section on the line after the last block', () => {
    const metadata = parseMetadata('a ^[n] b\n^bid');
    expect(metadata?.sections?.slice(-2)).toEqual([
      { position: { end: { col: 0, line: 2, offset: 13 }, start: { col: 0, line: 2, offset: 13 } }, type: 'text' },
      { position: { end: { col: 0, line: 2, offset: 13 }, start: { col: 0, line: 2, offset: 13 } }, type: 'element' }
    ]);
  });

  it('has the worker\'s key order and leaves out the fields it found nothing for', () => {
    expect(JSON.stringify(parseMetadata('[[a]]'))).toBe(
      '{"links":[{"position":{"start":{"line":0,"col":0,"offset":0},"end":{"line":0,"col":5,"offset":5}},"link":"a","original":"[[a]]","displayText":"a"}],'
        + '"sections":[{"type":"paragraph","position":{"start":{"line":0,"col":0,"offset":0},"end":{"line":0,"col":5,"offset":5}}}]}'
    );
    expect(parseMetadata('')).toEqual({});
  });

  it('lists only the footnote references that have a definition, and the labels inside a comment among them', () => {
    expect(parseMetadata('use[^1] and [^2]')?.footnoteRefs).toBeUndefined();
    const metadata = parseMetadata('%%\n[^1]: buried\n%%\n\nuse[^1]\n\n[^1]: real');
    expect(metadata?.footnotes?.map(({ position }) => position.start.line)).toEqual([6]);
    expect(metadata?.footnoteRefs?.map(({ position }) => position.start.line)).toEqual([1, 4]);
  });

  it('ends a footnote definition at a line only when the line\'s marker lies in the definition\'s first 1,024 characters', () => {
    expect(parseMetadata(footnoteDefinitionBefore(1023, '# ender'))?.headings?.map(({ heading }) => heading)).toEqual(['ender']);
    expect(parseMetadata(footnoteDefinitionBefore(1024, '# ender'))?.headings).toBeUndefined();
    expect(parseMetadata(footnoteDefinitionBefore(1019, '[^2]: x'))?.footnotes?.map(({ id }) => id)).toEqual(['1', '2']);
    expect(parseMetadata(footnoteDefinitionBefore(1020, '[^2]: x'))?.footnotes?.map(({ id }) => id)).toEqual(['1']);
  });

  it('takes a quoted paragraph after a link reference definition and a blank line as the definition\'s title', () => {
    const metadata = parseMetadata('[1]: https://example.com\n\n"To be or not to be."\n\nNext paragraph.');
    expect(metadata?.sections?.map(({ position, type }) => `${type}@${String(position.start.line)}-${String(position.end.line)}`)).toEqual(['definition@0-2', 'paragraph@4-4']);
  });

  it('gives the columns of the line that opens a comment block 2 short, and those of a callout\'s lazy line in a list item 1 past', () => {
    expect(parseMetadata('%% see [[target]] here\n%%')?.links?.[0]?.position.start.col).toBe(5);
    expect(parseMetadata('1. > [!note] T\n> ab cd [[target]] end')?.links?.[0]?.position.start.col).toBe(9);
    expect(parseMetadata('1. > [!note] T\n   > ab cd [[target]] end')?.links?.[0]?.position.start.col).toBe(11);
  });
});

// A one-line footnote definition followed by `line`, which starts `lineOffset` characters after the definition's start.
function footnoteDefinitionBefore(lineOffset: number, line: string): string {
  return `${'[^1]: '.padEnd(lineOffset - 1, 'w')}\n${line}\n\nuse[^1]`;
}

describe('parseRemark with soft line breaks read as hard', () => {
  it('makes a line feed after any spaces a break', () => {
    const [paragraph] = parseRemark('a\nb', { shouldReadSoftLineBreaksAsHard: true }).children;
    expect(paragraph && 'children' in paragraph ? paragraph.children.map((child) => child.type) : []).toEqual(['text', 'break', 'text']);
    const [strict] = parseRemark('a\nb').children;
    expect(strict && 'children' in strict ? strict.children.map((child) => child.type) : []).toEqual(['text']);
  });
});
