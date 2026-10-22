/**
 * @file
 *
 * The markdown-it entry point (`obsidian-markdown-parser/markdown-it`): the Obsidian syntax as a markdown-it plugin.
 *
 * - {@link parseMarkdownIt} gives markdown-it tokens with the Obsidian syntax, {@link markdownItObsidianSyntax} is that
 *   syntax as a markdown-it plugin, and {@link createObsidianMarkdownIt} is a markdown-it configured with it, taking a
 *   preset with any of its flags overridden.
 */

export type {
  CreateObsidianMarkdownItOptions,
  MarkdownItObsidianSyntaxOptions
} from '../syntax/markdown-it.ts';

export {
  createObsidianMarkdownIt,
  getObsidianTokenRange,
  markdownItObsidianSyntax,
  obsidianNodeNameOf,
  parseMarkdownIt
} from '../syntax/markdown-it.ts';
