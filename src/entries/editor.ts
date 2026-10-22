/**
 * @file
 *
 * The editor entry point (`obsidian-markdown-parser/editor`): the classes Obsidian's editor puts on every character
 * and line.
 *
 * - {@link highlight} and {@link highlightLines} give those classes, resumable from any line whose state
 *   {@link isLineStateResumable} accepts.
 * - {@link editorClassLanguage} hosts that tokenizer in CodeMirror 6, with the editor's tree shape and incremental
 *   re-parsing, and {@link editorClasses} renders its classes the way the editor does.
 */

export type {
  ClassSpan,
  HighlightedLine,
  HighlightLinesParams,
  LineState
} from '../editor/highlight.ts';

export {
  copyLineState,
  highlight,
  highlightLines,
  isLineStateResumable
} from '../editor/highlight.ts';

export type { CreateEditorClassLanguageOptions } from '../editor/language.ts';

export {
  createEditorClassLanguage,
  editorClassLanguage,
  lineClassesProperty,
  tokenClassesProperty
} from '../editor/language.ts';

export type { DocumentRange } from '../editor/view.ts';

export {
  editorClassDecorations,
  editorClasses
} from '../editor/view.ts';
