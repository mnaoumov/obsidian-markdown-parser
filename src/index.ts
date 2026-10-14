/**
 * @file
 *
 * Entry point of the Obsidian-flavoured markdown parser.
 *
 * - {@link highlight} and {@link highlightLines} give the classes Obsidian's editor puts on every character and
 *   line, resumable from any line.
 * - {@link editorClassLanguage} hosts that tokenizer in CodeMirror 6, with the editor's tree shape and incremental
 *   re-parsing, and {@link editorClasses} renders its classes the way the editor does.
 * - {@link parse} gives the `@lezer/markdown` tree with the Obsidian syntax, and {@link obsidianMarkdown} is that
 *   syntax as `@lezer/markdown` extensions.
 * - {@link ObsidianNode} names the syntax nodes, and {@link CONFORMANCE_CASES} is the corpus every adapter is checked
 *   against.
 */

import type { Tree } from '@lezer/common';

import { obsidianParser } from './syntax/lezer.ts';

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

export type { CreateEditorClassLanguageOptions } from './editor/language.ts';

export {
  createEditorClassLanguage,
  editorClassLanguage,
  lineClassesProperty,
  tokenClassesProperty
} from './editor/language.ts';

export type { DocumentRange } from './editor/view.ts';

export {
  editorClassDecorations,
  editorClasses
} from './editor/view.ts';

export type {
  ConformanceCase,
  OutlineEntry
} from './syntax/conformance.ts';

export { CONFORMANCE_CASES } from './syntax/conformance.ts';

export {
  obsidianMarkdown,
  obsidianParser,
  obsidianSyntax
} from './syntax/lezer.ts';

export type { ObsidianNodeName } from './syntax/spec.ts';

export { ObsidianNode } from './syntax/spec.ts';

/**
 * Parses a markdown document into a Lezer syntax tree with the Obsidian syntax.
 *
 * @param text - The document to parse.
 * @returns The document's syntax tree.
 */
export function parse(text: string): Tree {
  return obsidianParser.parse(text);
}
