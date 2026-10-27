import type {
  Nodes,
  Root
} from 'mdast';

import {
  describe,
  expect,
  it
} from 'vitest';

import type { OutlineEntry } from '../conformance.ts';
import type { ObsidianNodeName } from '../spec.ts';
import type {
  Embed,
  InternalLink
} from './mdast.ts';

import { CONFORMANCE_CASES } from '../conformance.ts';
import { ObsidianNode as N } from '../spec.ts';
import { parseMdast } from './mdast.ts';

const NODE_NAMES: Readonly<Partial<Record<string, ObsidianNodeName>>> = {
  blockId: N.BlockId,
  callout: N.Callout,
  embed: N.Embed,
  footnoteDefinition: N.FootnoteDefinition,
  footnoteReference: N.FootnoteReference,
  highlight: N.Highlight,
  inlineFootnote: N.InlineFootnote,
  inlineMath: N.InlineMath,
  internalLink: N.InternalLink,
  math: N.MathBlock,
  obsidianComment: N.Comment,
  obsidianCommentBlock: N.CommentBlock,
  tag: N.Tag,
  yaml: N.FrontMatter
};

// The marks are not kept in mdast: the node and its fields say everything they did.
const MARKS: ReadonlySet<string> = new Set<ObsidianNodeName>([
  N.BlockIdMark,
  N.CalloutMark,
  N.CommentMark,
  N.FootnoteMark,
  N.FrontMatterMark,
  N.HighlightMark,
  N.InternalLinkAliasMark,
  N.InternalLinkMark,
  N.MathMark,
  N.TagMark
]);

function linkParts(node: Embed | InternalLink): OutlineEntry[] {
  const parts: OutlineEntry[] = [];
  if (node.path) {
    parts.push([N.InternalLinkPath, node.path]);
  }
  if (node.subpath !== null) {
    parts.push([N.InternalLinkSubpath, node.subpath]);
  }
  if (node.alias) {
    parts.push([N.InternalLinkAlias, node.alias]);
  }
  return parts;
}

/*
 * The outline of an mdast tree in the terms of the conformance corpus: each Obsidian node with the text it covers,
 * followed by its parts as its fields hold them.
 */
function outlineOf(tree: Root, markdown: string): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  visit(tree);
  return outline;

  function visit(node: Nodes): void {
    const name = NODE_NAMES[node.type];
    if (name) {
      outline.push([name, markdown.slice(node.position?.start.offset, node.position?.end.offset)]);
    }
    outline.push(...partsOf(node, markdown));
    const children = [...node.type === 'callout' ? node.title : [], ...'children' in node ? node.children : []];
    for (const child of children) {
      visit(child);
    }
  }
}

// The parts of a node, as its fields hold them.
function partsOf(node: Nodes, markdown: string): OutlineEntry[] {
  switch (node.type) {
    case 'callout': {
      const parts: OutlineEntry[] = [[N.CalloutType, node.calloutType]];
      if (node.fold) {
        parts.push([N.CalloutFold, node.fold]);
      }
      if (node.title.length > 0) {
        parts.push([N.CalloutTitle, sliceOf(markdown, node.title)]);
      }
      return parts;
    }
    case 'embed':
    case 'internalLink': {
      return linkParts(node);
    }
    case 'footnoteDefinition':
    case 'footnoteReference': {
      // An empty label `[^]` has no label node.
      return node.label ? [[N.FootnoteLabel, node.label]] : [];
    }
    case 'listItem': {
      const [paragraph] = node.children;
      return paragraph && typeof node.task === 'string' ? [[N.Task, sliceOf(markdown, [paragraph])], [N.TaskMarker, `[${node.task}]`]] : [];
    }
    case 'tag': {
      return [[N.TagName, node.name]];
    }
    case 'yaml': {
      return node.value ? [[N.FrontMatterContent, node.value]] : [];
    }
    default: {
      return [];
    }
  }
}
function sliceOf(markdown: string, nodes: readonly Nodes[]): string {
  const from = nodes[0]?.position?.start.offset ?? 0;
  const to = nodes.at(-1)?.position?.end.offset ?? from;
  return markdown.slice(from, to);
}

describe('mdastObsidianSyntax', () => {
  for (const testCase of CONFORMANCE_CASES) {
    it(`should pass the conformance case: ${testCase.name}`, () => {
      expect(outlineOf(parseMdast(testCase.markdown), testCase.markdown)).toEqual(testCase.expected.filter(([name]) => !MARKS.has(name)));
    });
  }

  it('should give comments and math their text between the delimiters', () => {
    const tree = parseMdast('a %%note%% $x^2$ and $$y$$\n\n%%\nblock\n%%\n\n$$\n\\sum\n$$');
    const nodes = tree.children.flatMap((node): Nodes[] => 'children' in node ? node.children : [node]);
    const values = nodes.map((node) => [node.type, 'value' in node ? node.value : '']);
    expect(values).toEqual([
      ['text', 'a '],
      ['obsidianComment', 'note'],
      ['text', ' '],
      ['inlineMath', 'x^2'],
      ['text', ' and '],
      ['inlineMath', 'y'],
      ['obsidianCommentBlock', 'block'],
      ['math', String.raw`\sum`]
    ]);
  });

  it('should give a callout its type, fold and title, and the lines after the title as content', () => {
    const tree = parseMdast('> [!Tip]+ Read **this**\nlazy line\n> - item');
    const [callout] = tree.children;
    expect(callout?.type).toBe('callout');
    if (callout?.type !== 'callout') {
      return;
    }
    expect(callout.calloutType).toBe('Tip');
    expect(callout.fold).toBe('+');
    expect(callout.title.map((node) => node.type)).toEqual(['text', 'strong']);
    expect(callout.children.map((node) => node.type)).toEqual(['paragraph', 'list']);
    const [firstBlock] = callout.children;
    expect(firstBlock?.position?.start.offset).toBe('> [!Tip]+ Read **this**\n'.length);
  });

  it('should drop the title paragraph of a callout whose content starts on a quote line', () => {
    const tree = parseMdast('> [!note]\n> Body');
    const [callout] = tree.children;
    expect(callout?.type === 'callout' ? callout.children.map((node) => [node.type, node.position?.start.offset]) : []).toEqual([['paragraph', '> [!note]\n> '.length]]);
  });

  it('should mark a list item as a task and keep its text without the marker', () => {
    const tree = parseMdast('- [x] done\n- [ ] open\n- plain');
    const [list] = tree.children;
    const items = list?.type === 'list' ? list.children : [];
    expect(items.map((item) => [item.task ?? null, item.checked ?? null])).toEqual([['x', true], [' ', false], [null, null]]);
    const [first] = items;
    const [paragraph] = first?.children ?? [];
    expect(paragraph?.type === 'paragraph' ? paragraph.children : []).toMatchObject([{ type: 'text', value: 'done' }]);
  });

  it('should give footnotes a GFM identifier, and read an inline footnote and a highlight as inline content', () => {
    const tree = parseMdast('a[^Note] ^[an *inline* note] ==b *c*==\n\n[^Note]: text');
    const [paragraph, definition] = tree.children;
    expect(paragraph?.type === 'paragraph' ? paragraph.children.map((node) => node.type) : []).toEqual([
      'text',
      'footnoteReference',
      'text',
      'inlineFootnote',
      'text',
      'highlight'
    ]);
    expect(definition).toMatchObject({ identifier: 'note', label: 'Note', type: 'footnoteDefinition' });
  });

  it('should give front matter as a yaml node', () => {
    const [frontMatter] = parseMdast('---\na: 1\nb: 2\n---\ntext').children;
    expect(frontMatter).toMatchObject({ type: 'yaml', value: 'a: 1\nb: 2' });
  });
});
