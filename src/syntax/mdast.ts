/**
 * @file
 *
 * The Obsidian syntax as an `mdast-util-from-markdown` extension: the tokens of `micromark.ts` as mdast nodes.
 *
 * Where mdast already has a node for a construct, the extension gives that node: `footnoteReference` and
 * `footnoteDefinition` as in GFM, `yaml` as in `mdast-util-frontmatter`, and `inlineMath` and `math` as in
 * `mdast-util-math`. Every other construct gets a node of its own, and a task marker becomes fields of its list item.
 * {@link MDAST_NODE_TYPES} maps each node of {@link ObsidianNode} to its mdast node or field.
 */

import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  Literal,
  Node,
  Nodes,
  Parent,
  PhrasingContent,
  Root,
  Yaml
} from 'mdast';
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Handle
} from 'mdast-util-from-markdown';
import type { Token } from 'micromark-util-types';

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

import type { ObsidianNodeName } from './spec.ts';

import {
  micromarkObsidianMarkdown,
  ObsidianToken
} from './micromark.ts';
import { ObsidianNode } from './spec.ts';

/**
 * A block id, `^id` at the end of a block.
 */
export interface BlockId extends Literal {
  /**
   * The node type.
   */
  type: 'blockId';

  /**
   * The id, without its `^`.
   */
  value: string;
}

/**
 * A callout: a quote that opens with `[!type]`.
 */
export interface Callout extends Parent {
  /**
   * The callout type, between `[!` and `]`, as written.
   */
  calloutType: string;

  /**
   * The content: the lines after the title line.
   */
  children: (BlockContent | DefinitionContent)[];

  /**
   * The fold sign, or `null` without one.
   */
  fold: '-' | '+' | null;

  /**
   * The title: the rest of the marker's line. Empty when the line holds none.
   */
  title: PhrasingContent[];

  /**
   * The node type.
   */
  type: 'callout';
}

/**
 * An embed, `![[target]]`.
 */
export interface Embed extends InternalLinkFields, Node {
  /**
   * The node type.
   */
  type: 'embed';
}

/**
 * A highlight, `==text==`.
 */
export interface Highlight extends Parent {
  /**
   * The highlighted content.
   */
  children: PhrasingContent[];

  /**
   * The node type.
   */
  type: 'highlight';
}

/**
 * An inline footnote, `^[text]`.
 */
export interface InlineFootnote extends Parent {
  /**
   * The footnote's content.
   */
  children: PhrasingContent[];

  /**
   * The node type.
   */
  type: 'inlineFootnote';
}

/**
 * Inline math, `$tex$` or `$$tex$$` inside a paragraph, as `mdast-util-math` names it.
 */
export interface InlineMath extends Literal {
  /**
   * The node type.
   */
  type: 'inlineMath';
}

/**
 * An internal link, `[[target]]`.
 */
export interface InternalLink extends InternalLinkFields, Node {
  /**
   * The node type.
   */
  type: 'internalLink';
}

/**
 * The parts of an internal link or an embed.
 */
export interface InternalLinkFields {
  /**
   * The alias after the `|`, or `null` without one.
   */
  alias: null | string;

  /**
   * The link path, before any `#`. Empty for a link into the same note.
   */
  path: string;

  /**
   * The subpath from the `#` on, or `null` without one.
   */
  subpath: null | string;
}

/**
 * A math block, `$$` lines, as `mdast-util-math` names it.
 */
export interface MathBlock extends Literal {
  /**
   * The node type.
   */
  type: 'math';
}

/**
 * An inline comment, `%%text%%`.
 */
export interface ObsidianComment extends Literal {
  /**
   * The node type.
   */
  type: 'obsidianComment';
}

/**
 * A comment block, `%%` lines.
 */
export interface ObsidianCommentBlock extends Literal {
  /**
   * The node type.
   */
  type: 'obsidianCommentBlock';
}

/**
 * A tag, `#name`.
 */
export interface Tag extends Node {
  /**
   * The tag name, without its `#`.
   */
  name: string;

  /**
   * The node type.
   */
  type: 'tag';
}

declare module 'mdast' {
  interface BlockContentMap {
    callout: Callout;
    math: MathBlock;
    obsidianCommentBlock: ObsidianCommentBlock;
  }

  interface ListItem {
    /**
     * The task marker's character, between `[` and `]`, or `null` for an item that is no task.
     */
    task?: null | string | undefined;
  }

  interface PhrasingContentMap {
    blockId: BlockId;
    embed: Embed;
    highlight: Highlight;
    inlineFootnote: InlineFootnote;
    inlineMath: InlineMath;
    internalLink: InternalLink;
    obsidianComment: ObsidianComment;
    tag: Tag;
  }

  interface RootContentMap {
    blockId: BlockId;
    callout: Callout;
    embed: Embed;
    highlight: Highlight;
    inlineFootnote: InlineFootnote;
    inlineMath: InlineMath;
    internalLink: InternalLink;
    math: MathBlock;
    obsidianComment: ObsidianComment;
    obsidianCommentBlock: ObsidianCommentBlock;
    tag: Tag;
  }
}

/**
 * Where each node of the Obsidian syntax goes in mdast: a node type, or a field of a node.
 */
export const MDAST_NODE_TYPES: Readonly<Record<ObsidianNodeName, string>> = {
  [ObsidianNode.BlockId]: 'blockId',
  [ObsidianNode.BlockIdMark]: 'blockId (not kept)',
  [ObsidianNode.Callout]: 'callout',
  [ObsidianNode.CalloutFold]: 'callout.fold',
  [ObsidianNode.CalloutMark]: 'callout (not kept)',
  [ObsidianNode.CalloutTitle]: 'callout.title',
  [ObsidianNode.CalloutType]: 'callout.calloutType',
  [ObsidianNode.Comment]: 'obsidianComment',
  [ObsidianNode.CommentBlock]: 'obsidianCommentBlock',
  [ObsidianNode.CommentMark]: 'obsidianComment, obsidianCommentBlock (not kept)',
  [ObsidianNode.Embed]: 'embed',
  [ObsidianNode.FootnoteDefinition]: 'footnoteDefinition',
  [ObsidianNode.FootnoteLabel]: 'footnoteReference.label, footnoteDefinition.label',
  [ObsidianNode.FootnoteMark]: 'footnoteReference, footnoteDefinition, inlineFootnote (not kept)',
  [ObsidianNode.FootnoteReference]: 'footnoteReference',
  [ObsidianNode.FrontMatter]: 'yaml',
  [ObsidianNode.FrontMatterContent]: 'yaml.value',
  [ObsidianNode.FrontMatterMark]: 'yaml (not kept)',
  [ObsidianNode.Highlight]: 'highlight',
  [ObsidianNode.HighlightMark]: 'highlight (not kept)',
  [ObsidianNode.InlineFootnote]: 'inlineFootnote',
  [ObsidianNode.InlineMath]: 'inlineMath',
  [ObsidianNode.InternalLink]: 'internalLink',
  [ObsidianNode.InternalLinkAlias]: 'internalLink.alias, embed.alias',
  [ObsidianNode.InternalLinkAliasMark]: 'internalLink, embed (not kept)',
  [ObsidianNode.InternalLinkMark]: 'internalLink, embed (not kept)',
  [ObsidianNode.InternalLinkPath]: 'internalLink.path, embed.path',
  [ObsidianNode.InternalLinkSubpath]: 'internalLink.subpath, embed.subpath',
  [ObsidianNode.MathBlock]: 'math',
  [ObsidianNode.MathMark]: 'inlineMath, math (not kept)',
  [ObsidianNode.Tag]: 'tag',
  [ObsidianNode.TagMark]: 'tag (not kept)',
  [ObsidianNode.TagName]: 'tag.name',
  [ObsidianNode.Task]: 'listItem.task, listItem.checked',
  [ObsidianNode.TaskMarker]: 'listItem.task'
};

// Where the marker of each callout starts, so its title paragraph can be told from the paragraphs after it.
const calloutMarkStarts = new WeakMap<Callout, number>();

// The node `this.buffer()` pushes to collect a callout's title.
interface Fragment extends Parent {
  type: 'fragment';
}

interface WithType<Type> {
  readonly type: Type;
}

/**
 * The Obsidian syntax as an `mdast-util-from-markdown` extension, for the tokens of `micromarkObsidianSyntax`.
 */
export const mdastObsidianSyntax: FromMarkdownExtension = {
  canContainEols: ['highlight'],
  enter: {
    [ObsidianNode.BlockId]: enterNode(() => ({ type: 'blockId', value: '' })),
    [ObsidianNode.Callout]: enterNode(() => ({ calloutType: '', children: [], fold: null, title: [], type: 'callout' })),
    [ObsidianNode.CalloutTitle]: function enterCalloutTitle(this: CompileContext): undefined {
      this.buffer();
    },
    [ObsidianNode.Comment]: enterNode(() => ({ type: 'obsidianComment', value: '' })),
    [ObsidianNode.CommentBlock]: enterNode(() => ({ type: 'obsidianCommentBlock', value: '' })),
    [ObsidianNode.Embed]: enterNode(() => ({ alias: null, path: '', subpath: null, type: 'embed' })),
    [ObsidianNode.FootnoteDefinition]: enterNode(() => ({ children: [], identifier: '', label: '', type: 'footnoteDefinition' })),
    [ObsidianNode.FootnoteReference]: enterNode(() => ({ identifier: '', label: '', type: 'footnoteReference' })),
    [ObsidianNode.FrontMatter]: enterNode(() => ({ type: 'yaml', value: '' })),
    [ObsidianNode.Highlight]: enterNode(() => ({ children: [], type: 'highlight' })),
    [ObsidianNode.InlineFootnote]: enterNode(() => ({ children: [], type: 'inlineFootnote' })),
    [ObsidianNode.InlineMath]: enterNode(() => ({ type: 'inlineMath', value: '' })),
    [ObsidianNode.InternalLink]: enterNode(() => ({ alias: null, path: '', subpath: null, type: 'internalLink' })),
    [ObsidianNode.MathBlock]: enterNode(() => ({ type: 'math', value: '' })),
    [ObsidianNode.Tag]: enterNode(() => ({ name: '', type: 'tag' }))
  },
  exit: {
    [ObsidianNode.BlockId]: function exitBlockId(this: CompileContext, token: Token): undefined {
      withNode(this, 'blockId', (node) => {
        node.value = this.sliceSerialize(token).slice(1);
      });
      this.exit(token);
    },
    [ObsidianNode.Callout]: function exitCallout(this: CompileContext, token: Token): undefined {
      withNode(this, 'callout', (node) => {
        splitTitleParagraph(node);
      });
      this.exit(token);
    },
    [ObsidianNode.CalloutFold]: function exitCalloutFold(this: CompileContext, token: Token): undefined {
      withNode(this, 'callout', (node) => {
        node.fold = this.sliceSerialize(token) === '+' ? '+' : '-';
      });
    },
    [ObsidianNode.CalloutMark]: function exitCalloutMark(this: CompileContext, token: Token): undefined {
      withNode(this, 'callout', (node) => {
        calloutMarkStarts.set(node, token.start.offset);
      });
    },
    [ObsidianNode.CalloutTitle]: function exitCalloutTitle(this: CompileContext): undefined {
      const fragment = this.stack.pop() as Fragment;
      withNode(this, 'callout', (node) => {
        node.title = fragment.children as PhrasingContent[];
      });
    },
    [ObsidianNode.CalloutType]: function exitCalloutType(this: CompileContext, token: Token): undefined {
      withNode(this, 'callout', (node) => {
        node.calloutType = this.sliceSerialize(token);
      });
    },
    [ObsidianNode.Comment]: exitNode,
    [ObsidianNode.CommentBlock]: exitBlock,
    [ObsidianNode.Embed]: exitNode,
    [ObsidianNode.FootnoteDefinition]: exitNode,
    [ObsidianNode.FootnoteLabel]: function exitFootnoteLabel(this: CompileContext, token: Token): undefined {
      const node = this.stack.at(-1);
      if (node?.type !== 'footnoteReference' && node?.type !== 'footnoteDefinition') {
        return;
      }
      const label = this.sliceSerialize(token);
      node.label = label;
      node.identifier = normalizeIdentifier(label).toLowerCase();
    },
    [ObsidianNode.FootnoteReference]: exitNode,
    [ObsidianNode.FrontMatter]: exitNode,
    [ObsidianNode.FrontMatterContent]: function exitFrontMatterContent(this: CompileContext, token: Token): undefined {
      withNode(this, 'yaml', (node: Yaml) => {
        node.value = this.sliceSerialize(token);
      });
    },
    [ObsidianNode.Highlight]: exitNode,
    [ObsidianNode.InlineFootnote]: exitNode,
    [ObsidianNode.InlineMath]: exitNode,
    [ObsidianNode.InternalLink]: exitNode,
    [ObsidianNode.InternalLinkAlias]: linkPart('alias'),
    [ObsidianNode.InternalLinkPath]: linkPart('path'),
    [ObsidianNode.InternalLinkSubpath]: linkPart('subpath'),
    [ObsidianNode.MathBlock]: exitBlock,
    [ObsidianNode.Tag]: exitNode,
    [ObsidianNode.TagName]: function exitTagName(this: CompileContext, token: Token): undefined {
      withNode(this, 'tag', (node) => {
        node.name = this.sliceSerialize(token);
      });
    },
    [ObsidianNode.TaskMarker]: function exitTaskMarker(this: CompileContext, token: Token): undefined {
      const listItem = this.stack.findLast((node): node is ListItem => node.type === 'listItem');
      if (!listItem) {
        return;
      }
      const marker = this.sliceSerialize(token).slice(1, -1);
      listItem.task = marker;
      listItem.checked = marker !== ' ';
    },
    [ObsidianToken.Content]: function exitContent(this: CompileContext, token: Token): undefined {
      const node = this.stack.at(-1);
      if (node && 'value' in node) {
        node.value = this.sliceSerialize(token);
      }
    }
  }
};

/**
 * The Obsidian syntax with the GFM extensions Obsidian supports: tables, strikethrough and bare URLs.
 */
export const mdastObsidianMarkdown: readonly FromMarkdownExtension[] = [
  gfmTableFromMarkdown(),
  gfmStrikethroughFromMarkdown(),
  gfmAutolinkLiteralFromMarkdown(),
  mdastObsidianSyntax
];

/**
 * Parses a markdown document into an mdast tree with the Obsidian syntax.
 *
 * @param markdown - The document to parse.
 * @returns The document's mdast tree.
 */
export function parseMdast(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [...micromarkObsidianMarkdown], mdastExtensions: [...mdastObsidianMarkdown] });
}

function enterNode(create: () => Nodes): Handle {
  return function enter(this: CompileContext, token: Token): undefined {
    this.enter(create(), token);
  };
}

// A block's value is its text between the delimiters, without the line endings after the opener and before the closer.
function exitBlock(this: CompileContext, token: Token): undefined {
  const node = this.stack.at(-1);
  if (node && 'value' in node && typeof node.value === 'string') {
    node.value = node.value.replace(/^(?:\r\n|\r|\n)/u, '').replace(/(?:\r\n|\r|\n)$/u, '');
  }
  this.exit(token);
}

function exitNode(this: CompileContext, token: Token): undefined {
  this.exit(token);
}

function linkPart(field: keyof InternalLinkFields): Handle {
  return function exitLinkPart(this: CompileContext, token: Token): undefined {
    const node = this.stack.at(-1);
    if (node?.type === 'internalLink' || node?.type === 'embed') {
      node[field] = this.sliceSerialize(token);
    }
  };
}

/*
 * The callout's first paragraph opens with the marker and the title, which the title holds already. What follows the
 * title line in that paragraph is the content's first paragraph; an empty one is dropped.
 */
function splitTitleParagraph(callout: Callout): void {
  const [first] = callout.children;
  const markStart = calloutMarkStarts.get(callout);
  if (markStart === undefined || first?.type !== 'paragraph' || first.position?.start.offset !== markStart) {
    return;
  }
  const [firstChild] = first.children;
  if (!firstChild) {
    callout.children.shift();
    return;
  }
  first.position.start = { ...firstChild.position?.start ?? first.position.start };
}

function withNode<Type extends Nodes['type']>(context: CompileContext, type: Type, update: (node: Extract<Nodes, WithType<Type>>) => void): void {
  const node = context.stack.findLast((candidate) => candidate.type === type);
  if (node) {
    update(node as Extract<Nodes, WithType<Type>>);
  }
}
