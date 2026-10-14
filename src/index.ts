/**
 * @file
 *
 * Entry point of the Obsidian-flavoured markdown parser.
 *
 * For now it exposes the plain `@lezer/markdown` parser. The Obsidian syntax extensions and the editor's
 * class-compatibility layer are shaped by Phase 0 and land on top of it.
 */

import type { Tree } from '@lezer/common';

import { parser } from '@lezer/markdown';

/**
 * Parses a markdown document into a Lezer syntax tree.
 *
 * @param text - The document to parse.
 * @returns The document's syntax tree.
 */
export function parse(text: string): Tree {
  return parser.parse(text);
}
