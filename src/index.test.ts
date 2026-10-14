import {
  describe,
  expect,
  it
} from 'vitest';

import { parse } from './index.ts';

describe('parse', () => {
  it('should parse a document into a tree covering all of it', () => {
    const text = '# Heading\n\nSome *emphasis* and a [link](https://example.com).\n';
    const tree = parse(text);

    const nodeNames: string[] = [];
    tree.iterate({
      enter(node) {
        nodeNames.push(node.name);
      }
    });

    expect(tree.length).toBe(text.length);
    expect(nodeNames).toEqual(expect.arrayContaining(['Document', 'ATXHeading1', 'Paragraph', 'Emphasis', 'Link', 'URL']));
  });
});
