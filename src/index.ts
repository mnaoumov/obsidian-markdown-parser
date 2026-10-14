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
 * - {@link parseMdast} gives the mdast tree with the Obsidian syntax, and {@link micromarkObsidianMarkdown} and
 *   {@link mdastObsidianMarkdown} are that syntax as micromark and `mdast-util-from-markdown` extensions.
 * - {@link parseMarkdownIt} gives markdown-it tokens with the Obsidian syntax, {@link markdownItObsidianSyntax} is that
 *   syntax as a markdown-it plugin, and {@link createObsidianMarkdownIt} is a markdown-it configured with it.
 * - {@link ObsidianNode} names the syntax nodes, and {@link CONFORMANCE_CASES} is the corpus every adapter is checked
 *   against.
 * - {@link createObsidianParser}, {@link createMicromarkObsidianMarkdown} and {@link createObsidianMarkdownIt} take a
 *   preset (`commonmark`, `gfm` or `obsidian`) with any of its flags overridden, and {@link renderLezerHtml} renders a
 *   Lezer tree as CommonMark's reference implementation does, so each adapter is checked against the spec suites.
 * - The same options take Obsidian's quirks ({@link ObsidianQuirkFlags}), where it reads valid CommonMark differently.
 *   Every preset leaves them off, and {@link micromarkQuirksHtml} renders micromark's events with them.
 * - {@link parseRemark} parses as Obsidian's reading view and metadata worker do: `remark-parse` 8 with Obsidian's
 *   edits and the Obsidian syntax as the worker reads it, giving its mdast tree, and {@link renderRemarkHtml} renders
 *   that tree as `remark-html` does. Obsidian's inline algorithm, tabs, lazy quote lines and paragraph whitespace come
 *   from it by construction.
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

export { renderRemarkHtml } from './remark/html.ts';

export type { ParseRemarkOptions } from './remark/parse.ts';

export { parseRemark } from './remark/parse.ts';

export type {
  RemarkBlockId,
  RemarkBlockquote,
  RemarkBreak,
  RemarkCallout,
  RemarkCode,
  RemarkDefinition,
  RemarkDelete,
  RemarkEmbed,
  RemarkEmphasis,
  RemarkFootnoteDefinition,
  RemarkFootnoteReference,
  RemarkHeading,
  RemarkHighlight,
  RemarkHtml,
  RemarkImage,
  RemarkImageReference,
  RemarkInlineCode,
  RemarkInlineFootnote,
  RemarkInlineMath,
  RemarkInternalLink,
  RemarkInternalLinkBase,
  RemarkLink,
  RemarkLinkReference,
  RemarkList,
  RemarkListItem,
  RemarkMath,
  RemarkNode,
  RemarkNodeBase,
  RemarkObsidianComment,
  RemarkObsidianCommentBlock,
  RemarkParagraph,
  RemarkParent,
  RemarkParentBase,
  RemarkPoint,
  RemarkPosition,
  RemarkReferenceType,
  RemarkRoot,
  RemarkStrong,
  RemarkTable,
  RemarkTableAlignment,
  RemarkTableCell,
  RemarkTableCellPadding,
  RemarkTableRow,
  RemarkTag,
  RemarkText,
  RemarkThematicBreak,
  RemarkYaml
} from './remark/types.ts';

export type {
  ConformanceCase,
  OutlineEntry
} from './syntax/conformance.ts';

export { CONFORMANCE_CASES } from './syntax/conformance.ts';

export {
  collectLinkReferenceLabels,
  commonMarkFixes,
  commonMarkFixesWithoutHtmlBlock,
  linkReferenceCheck,
  parseWithLinkReferences
} from './syntax/lezer-commonmark.ts';

export type { RenderLezerHtmlOptions } from './syntax/lezer-html.ts';

export { renderLezerHtml } from './syntax/lezer-html.ts';

export type {
  CreateObsidianMarkdownOptions,
  CreateObsidianParserOptions
} from './syntax/lezer.ts';

export {
  createObsidianMarkdown,
  createObsidianParser,
  obsidianMarkdown,
  obsidianParser,
  obsidianSyntax
} from './syntax/lezer.ts';

export type {
  CreateObsidianMarkdownItOptions,
  MarkdownItObsidianSyntaxOptions
} from './syntax/markdown-it.ts';

export {
  createObsidianMarkdownIt,
  getObsidianTokenRange,
  markdownItObsidianSyntax,
  obsidianNodeNameOf,
  parseMarkdownIt
} from './syntax/markdown-it.ts';

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
} from './syntax/mdast.ts';

export type { ParseMdastOptions } from './syntax/mdast.ts';

export {
  MDAST_NODE_TYPES,
  mdastObsidianMarkdown,
  mdastObsidianSyntax,
  parseMdast
} from './syntax/mdast.ts';

export {
  micromarkObsidianTable,
  micromarkQuirksHtml
} from './syntax/micromark-quirks.ts';

export type { CreateMicromarkObsidianMarkdownOptions } from './syntax/micromark.ts';

export {
  createMicromarkObsidianMarkdown,
  createMicromarkObsidianSyntax,
  micromarkObsidianMarkdown,
  micromarkObsidianSyntax,
  ObsidianToken
} from './syntax/micromark.ts';

export type {
  ObsidianQuirkFlags,
  ObsidianSyntaxFlags,
  ObsidianSyntaxOptions,
  ObsidianSyntaxPreset,
  ResolveObsidianQuirksOptions,
  ResolveObsidianSyntaxOptions
} from './syntax/options.ts';

export {
  COMMONMARK_QUIRKS,
  OBSIDIAN_QUIRK_FLAGS,
  OBSIDIAN_QUIRKS,
  OBSIDIAN_SYNTAX_FLAGS,
  OBSIDIAN_SYNTAX_PRESETS,
  resolveObsidianQuirks,
  resolveObsidianSyntax
} from './syntax/options.ts';

export type {
  ObsidianNodeName,
  TextRange
} from './syntax/spec.ts';

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
