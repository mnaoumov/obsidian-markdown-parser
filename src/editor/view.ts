/**
 * @file
 *
 * Renders the editor-class tree the way Obsidian's editor does: a token's classes as `cm-<class>` on its text, and a
 * line's classes as they are on its `.cm-line`.
 */

import type {
  EditorState,
  Range
} from '@codemirror/state';
import type {
  DecorationSet,
  EditorView,
  ViewUpdate
} from '@codemirror/view';

import { syntaxTree } from '@codemirror/language';
import {
  Decoration,
  ViewPlugin
} from '@codemirror/view';

import {
  lineClassesProperty,
  tokenClassesProperty
} from './language.ts';

/**
 * A range of the document.
 */
export interface DocumentRange {
  /**
   * Where the range starts.
   */
  readonly from: number;

  /**
   * Where the range ends.
   */
  readonly to: number;
}

class EditorClassesView {
  public decorations: DecorationSet;

  public constructor(view: EditorView) {
    this.decorations = editorClassDecorations(view.state, view.visibleRanges);
  }

  public update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = editorClassDecorations(update.state, update.view.visibleRanges);
    }
  }
}

/**
 * Renders the classes of the editor-class tree in the visible ranges.
 */
export const editorClasses = ViewPlugin.fromClass(EditorClassesView, { decorations: (plugin) => plugin.decorations });

/**
 * Builds the decorations for the classes of the editor-class tree in the given ranges.
 *
 * @param state - The editor state.
 * @param ranges - The ranges, in document order.
 * @returns The decorations: a line decoration per line node, a mark per token node.
 */
export function editorClassDecorations(state: EditorState, ranges: readonly DocumentRange[]): DecorationSet {
  const tree = syntaxTree(state);
  const decorations: Range<Decoration>[] = [];
  for (const { from, to } of ranges) {
    tree.iterate({
      enter: (node) => {
        const lineClasses = node.type.prop(lineClassesProperty);
        if (lineClasses) {
          // A line node starts its line; the ranges may cut it, and a line decoration is added once.
          if (node.from >= from) {
            decorations.push(Decoration.line({ class: lineClasses.join(' ') }).range(node.from));
          }
          return;
        }
        const tokenClasses = node.type.prop(tokenClassesProperty);
        const markFrom = Math.max(node.from, from);
        const markTo = Math.min(node.to, to);
        if (!tokenClasses || markTo <= markFrom) {
          return;
        }
        decorations.push(Decoration.mark({ class: tokenClasses.map((cls) => `cm-${cls}`).join(' ') }).range(markFrom, markTo));
      },
      from,
      to
    });
  }
  return Decoration.set(decorations, true);
}
