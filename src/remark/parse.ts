/**
 * @file
 *
 * The `remark-parse` 8 engine: the parser Obsidian's reading view and metadata worker run, `remark-parse` 8.0.3 with
 * `commonmark: true` and `gfm: true` and Obsidian's edits to its `blockquote`, `list` and `table` tokenizers. Its
 * inline algorithm, tabs, lazy quote lines and paragraph whitespace are Obsidian's by construction.
 */

import type { RemarkRoot } from './types.ts';

import { BLOCK_TOKENIZERS } from './block.ts';
import { INLINE_TOKENIZERS } from './inline.ts';
import { RemarkParser } from './parser.ts';

/**
 * Parses a document as Obsidian's `remark-parse` 8 does.
 *
 * @param markdown - The document.
 * @returns Its mdast tree.
 */
export function parseRemark(markdown: string): RemarkRoot {
  return new RemarkParser(markdown, { block: BLOCK_TOKENIZERS, inline: INLINE_TOKENIZERS }).parse();
}
