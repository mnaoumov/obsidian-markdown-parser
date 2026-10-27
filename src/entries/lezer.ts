/**
 * @file
 *
 * The Lezer entry point (`obsidian-markdown-parser/lezer`): the Obsidian syntax as `@lezer/markdown` extensions.
 *
 * - {@link parse} gives the `@lezer/markdown` tree with the Obsidian syntax, and {@link obsidianMarkdown} is that
 *   syntax as `@lezer/markdown` extensions.
 * - {@link createObsidianParser} takes a preset with any of its flags overridden, and {@link renderLezerHtml} renders
 *   a Lezer tree as CommonMark's reference implementation does, so the tree is checked against the spec suites.
 */

import type { Tree } from '@lezer/common';

import { obsidianParser } from '../syntax/lezer/lezer.ts';

export {
  collectLinkReferenceLabels,
  commonMarkFixes,
  commonMarkFixesWithoutHtmlBlock,
  linkReferenceCheck,
  parseWithLinkReferences
} from '../syntax/lezer/lezer-commonmark.ts';

export type { RenderLezerHtmlOptions } from '../syntax/lezer/lezer-html.ts';

export { renderLezerHtml } from '../syntax/lezer/lezer-html.ts';

export type {
  CreateObsidianMarkdownOptions,
  CreateObsidianParserOptions
} from '../syntax/lezer/lezer.ts';

export {
  createObsidianMarkdown,
  createObsidianParser,
  obsidianMarkdown,
  obsidianParser,
  obsidianSyntax
} from '../syntax/lezer/lezer.ts';

/**
 * Parses a markdown document into a Lezer syntax tree with the Obsidian syntax.
 *
 * @param text - The document to parse.
 * @returns The document's syntax tree.
 */
export function parse(text: string): Tree {
  return obsidianParser.parse(text);
}
