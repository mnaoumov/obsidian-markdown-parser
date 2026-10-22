/**
 * @file
 *
 * The micromark and mdast entry point (`obsidian-markdown-parser/mdast`): the Obsidian syntax as micromark and
 * `mdast-util-from-markdown` extensions.
 *
 * - {@link parseMdast} gives the mdast tree with the Obsidian syntax, and {@link micromarkObsidianMarkdown} and
 *   {@link mdastObsidianMarkdown} are that syntax as micromark and `mdast-util-from-markdown` extensions.
 * - {@link createMicromarkObsidianMarkdown} takes a preset with any of its flags overridden, and
 *   {@link micromarkQuirksHtml} renders micromark's events with Obsidian's quirks.
 */

export type {
  BlockId,
  Callout,
  Embed,
  Highlight,
  InlineFootnote,
  InlineMath,
  InternalLink,
  InternalLinkFields,
  MathBlock,
  ObsidianComment,
  ObsidianCommentBlock,
  Tag
} from '../syntax/mdast.ts';

export type { ParseMdastOptions } from '../syntax/mdast.ts';

export {
  MDAST_NODE_TYPES,
  mdastObsidianMarkdown,
  mdastObsidianSyntax,
  parseMdast
} from '../syntax/mdast.ts';

export {
  micromarkObsidianTable,
  micromarkQuirksHtml
} from '../syntax/micromark-quirks.ts';

export type { CreateMicromarkObsidianMarkdownOptions } from '../syntax/micromark.ts';

export {
  createMicromarkObsidianMarkdown,
  createMicromarkObsidianSyntax,
  micromarkObsidianMarkdown,
  micromarkObsidianSyntax,
  ObsidianToken
} from '../syntax/micromark.ts';
