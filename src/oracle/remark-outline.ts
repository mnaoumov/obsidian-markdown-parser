/**
 * @file
 *
 * The outline of the Obsidian nodes the `remark-parse` 8 engine reads, in the shape of the conformance corpus's
 * outlines, so the corpus, which follows the editor, can be checked against the metadata worker's reading.
 */

import type { RemarkNode } from '../remark/types.ts';
import type { OutlineEntry } from '../syntax/conformance.ts';
import type { ObsidianNodeName } from '../syntax/spec.ts';

import { parseRemark } from '../remark/parse.ts';
import { ObsidianNode as N } from '../syntax/spec.ts';
/*
 * The nodes the engine's tree and the conformance outline both have. The engine keeps no marks, and its tree has no
 * node for a task or a callout's parts, so a task is compared on its marker and a callout on its type.
 */
const COMPARED: ReadonlySet<ObsidianNodeName> = new Set<ObsidianNodeName>([
  N.BlockId,
  N.CalloutType,
  N.Comment,
  N.CommentBlock,
  N.Embed,
  N.FootnoteDefinition,
  N.FootnoteReference,
  N.FrontMatter,
  N.Highlight,
  N.InlineFootnote,
  N.InlineMath,
  N.InternalLink,
  N.MathBlock,
  N.Tag,
  N.TaskMarker
]);

const NODE_NAMES: Readonly<Partial<Record<RemarkNode['type'], ObsidianNodeName>>> = {
  blockId: N.BlockId,
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

/**
 * The outline of the Obsidian nodes the engine reads in a document, on the nodes {@link COMPARED}.
 *
 * @param markdown - The document.
 * @returns The outline.
 */
export function engineOutline(markdown: string): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  const root = parseRemark(markdown);

  function walk(node: RemarkNode, isTopLevel: boolean): void {
    const name = NODE_NAMES[node.type];
    if (name) {
      outline.push([name, textOf(markdown, node)]);
    }
    if (node.type === 'blockquote' && node.callout) {
      outline.push([N.CalloutType, node.callout.type]);
    }
    if (node.type === 'listItem' && node.checklist !== null) {
      outline.push([N.TaskMarker, `[${node.checklist}]`]);
    }
    if ('children' in node) {
      for (const child of node.children) {
        walk(child, false);
      }
    }
    // A block id on a line of its own is attached to the block before it and leaves the tree.
    if (isTopLevel && node.id && !containsBlockId(node, node.id)) {
      outline.push([N.BlockId, `^${node.id}`]);
    }
  }

  for (const child of root.children) {
    walk(child, true);
  }
  return outline;
}

/**
 * The entries of a conformance outline that {@link engineOutline} gives too.
 *
 * @param expected - The outline.
 * @returns Its entries on the nodes compared.
 */
export function expectedOutline(expected: readonly OutlineEntry[]): OutlineEntry[] {
  return expected.filter(([name]) => COMPARED.has(name));
}

function containsBlockId(node: RemarkNode, id: string): boolean {
  return node.type === 'blockId' ? node.value === id : 'children' in node && node.children.some((child) => containsBlockId(child, id));
}

function textOf(markdown: string, node: RemarkNode): string {
  return markdown.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
}
