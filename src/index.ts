/**
 * @file
 *
 * Entry point of the Obsidian-flavoured markdown parser.
 *
 * - {@link highlight} and {@link highlightLines} give the classes Obsidian's editor puts on every character and
 *   line, resumable from any line.
 * - {@link parse} gives the plain `@lezer/markdown` tree. The Obsidian syntax extensions for it come later.
 */

import type { Tree } from '@lezer/common';

import { parser } from '@lezer/markdown';

export type {
  ClassSpan,
  HighlightedLine,
  HighlightLinesParams,
  LineState
} from './editor/highlight.ts';

export {
  copyLineState,
  highlight,
  highlightLines
} from './editor/highlight.ts';

/**
 * Parses a markdown document into a Lezer syntax tree.
 *
 * @param text - The document to parse.
 * @returns The document's syntax tree.
 */
export function parse(text: string): Tree {
  return parser.parse(text);
}
