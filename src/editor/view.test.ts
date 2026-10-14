import type { DecorationSet } from '@codemirror/view';

import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  describe,
  expect,
  it
} from 'vitest';

import { editorClassLanguage } from './language.ts';
import { editorClassDecorations } from './view.ts';

const PARSE_TIMEOUT_MS = 1e9;

// The part of a mark or line decoration's spec the tests read.
interface ClassSpec {
  readonly class?: string;
}

function listDecorations(set: DecorationSet): [number, number, string][] {
  const out: [number, number, string][] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    out.push([from, to, String((value.spec as ClassSpec).class)]);
  });
  return out;
}

function parsedState(document: string): EditorState {
  // eslint-disable-next-line unicorn/name-replacements -- CodeMirror's option name.
  const state = EditorState.create({ doc: document, extensions: editorClassLanguage });
  ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
  return state;
}

describe('editorClassDecorations', () => {
  it('should put line classes on the line and token classes on the text', () => {
    const state = parsedState('# Title\nplain *em*');
    expect(listDecorations(editorClassDecorations(state, [{ from: 0, to: state.doc.length }]))).toEqual([
      [0, 0, 'HyperMD-header HyperMD-header-1'],
      [0, 2, 'cm-formatting cm-formatting-header cm-formatting-header-1 cm-header cm-header-1'],
      [2, 7, 'cm-header cm-header-1'],
      [14, 15, 'cm-em cm-formatting cm-formatting-em'],
      [15, 17, 'cm-em'],
      [17, 18, 'cm-em cm-formatting cm-formatting-em']
    ]);
  });

  it('should decorate only the given ranges', () => {
    const state = parsedState('# One\n# Two\n# Three');
    const decorations = listDecorations(editorClassDecorations(state, [{ from: 8, to: 11 }]));
    expect(decorations).toEqual([[8, 11, 'cm-header cm-header-1']]);
  });
});
