/**
 * @file
 *
 * The `remark-parse` 8 engine: the parser Obsidian's reading view and metadata worker run, `remark-parse` 8.0.3 with
 * `commonmark: true` and `gfm: true`, Obsidian's edits to its `blockquote`, `list` and `table` tokenizers, and the
 * Obsidian syntax its extensions add. Its inline algorithm, tabs, lazy quote lines and paragraph whitespace are
 * Obsidian's by construction.
 */

import type { RemarkTokenizers } from './parser.ts';
import type { RemarkRoot } from './types.ts';

import {
  BLOCK_STARTS,
  BLOCK_TOKENIZERS
} from './block.ts';
import { INLINE_TOKENIZERS } from './inline.ts';
import {
  OBSIDIAN_TOKENIZERS,
  SOFT_BREAK_AS_HARD_TOKENIZER,
  transformObsidianTree
} from './obsidian.ts';
import {
  BLOCK_METHODS,
  INLINE_METHODS,
  INTERRUPT_BLOCKQUOTE,
  INTERRUPT_LIST,
  INTERRUPT_PARAGRAPH,
  RemarkParser
} from './parser.ts';

/**
 * A tree from {@link parseRemarkTree}.
 */
export interface ParsedRemarkTree {
  /**
   * Whether a tokenizer made a footnote definition or reference, an inline footnote or a block id.
   */
  readonly hasFootnoteOrBlockId: boolean;

  /**
   * The tree.
   */
  readonly root: RemarkRoot;
}

/**
 * The options of {@link parseRemark}.
 */
export interface ParseRemarkOptions {
  /**
   * Whether the Obsidian syntax is read: front matter, internal links and embeds, tags, comments, math, highlights,
   * footnotes with inline notes, and block ids. Without it, the engine is `remark-parse` 8 with Obsidian's edits to
   * three of its tokenizers alone. Defaults to `true`.
   */
  readonly shouldReadObsidianSyntax?: boolean;

  /**
   * Whether every line break in inline content is a hard one, as the metadata worker reads them: Obsidian's `breaks`
   * option, which turns a line feed after any spaces into a `break`. Defaults to `false`, `remark-parse` 8's strict line
   * breaks.
   */
  readonly shouldReadSoftLineBreaksAsHard?: boolean;
}

/**
 * The options of {@link parseRemarkTree}, those of {@link parseRemark}.
 */
export type ParseRemarkTreeOptions = ParseRemarkOptions;

const MARKDOWN_TOKENIZERS: RemarkTokenizers = {
  block: BLOCK_TOKENIZERS,
  blockMethods: BLOCK_METHODS,
  blockStarts: BLOCK_STARTS,
  inline: INLINE_TOKENIZERS,
  inlineMethods: INLINE_METHODS,
  interruptBlockquote: INTERRUPT_BLOCKQUOTE,
  interruptList: INTERRUPT_LIST,
  interruptParagraph: INTERRUPT_PARAGRAPH
};

/**
 * Parses a document as Obsidian's `remark-parse` 8 does.
 *
 * @param markdown - The document.
 * @param options - Whether the Obsidian syntax is read.
 * @returns Its mdast tree.
 */
export function parseRemark(markdown: string, options?: ParseRemarkOptions): RemarkRoot {
  return parseRemarkTree(markdown, options).root;
}

/**
 * Parses a document as {@link parseRemark} does, and says whether its tree holds a footnote or a block id, so a caller
 * that walks the tree for them can skip the walk.
 *
 * @param markdown - The document.
 * @param options - Whether the Obsidian syntax is read.
 * @returns Its mdast tree, and whether a tokenizer made a footnote definition or reference, an inline footnote or a
 * block id.
 */
export function parseRemarkTree(markdown: string, options?: ParseRemarkTreeOptions): ParsedRemarkTree {
  const shouldReadObsidianSyntax = options?.shouldReadObsidianSyntax ?? true;
  let tokenizers = shouldReadObsidianSyntax ? OBSIDIAN_TOKENIZERS : MARKDOWN_TOKENIZERS;
  if (options?.shouldReadSoftLineBreaksAsHard) {
    tokenizers = { ...tokenizers, inline: { ...tokenizers.inline, break: SOFT_BREAK_AS_HARD_TOKENIZER } };
  }
  const parser = new RemarkParser(markdown, tokenizers);
  const root = parser.parse();
  // The transforms act on footnotes and block ids alone, so a tree with none is left as it is without a walk.
  if (shouldReadObsidianSyntax && parser.hasFootnoteOrBlockId) {
    transformObsidianTree(root);
  }
  return { hasFootnoteOrBlockId: parser.hasFootnoteOrBlockId, root };
}
