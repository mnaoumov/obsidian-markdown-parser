/**
 * @file
 *
 * The sub-modes the editor switches into: HTML, sTeX for math, YAML for front matter, and fenced-code languages.
 *
 * They are CodeMirror 5's own modes (MIT, the `codemirror` package pinned to 5.64.0, the release Obsidian 1.14.5
 * bundles: the YAML mode's key pattern differs in later releases), which is what the editor's class names come
 * from. They load through CodeMirror 5's `runmode.node.js`, a minimal CodeMirror object made for running modes
 * outside an editor, which registers itself in place of the full library before the mode files require it.
 */

// eslint-disable-next-line import-x/no-nodejs-modules -- CodeMirror 5's modes are CommonJS/UMD files, loaded through Node's require.
import { createRequire } from 'node:module';

import type { AnyMode } from './mode.ts';

import { createMarkdownMode } from './markdown-mode.ts';

interface CodeMirror5 {
  readonly defineMIME: (mime: string, spec: string) => void;
  readonly defineMode: (name: string, factory: (options: object, spec: MarkdownSpec) => object) => void;
  // eslint-disable-next-line typescript-dev-toolkit/no-undefined-return-type -- Mirrors CodeMirror 5's findModeByName, which answers `undefined` for an unknown name.
  readonly findModeByName: (name: string) => ModeInfo | undefined;
  readonly getMode: (options: object, spec: object | string) => AnyMode;
  readonly innerMode: (mode: AnyMode, state: object) => InnerMode;
}

interface InnerMode {
  readonly mode: AnyMode;
  readonly state: object;
}

// The options a spec for the markdown mode may carry.
interface MarkdownSpec {
  readonly highlightFormatting?: boolean;
  readonly strikethrough?: boolean;
  readonly taskLists?: boolean;
}

interface ModeInfo {
  readonly mime?: string;
  readonly mimes?: string[];
  readonly mode: string;
}

interface XmlState {
  readonly context?: unknown;
  readonly tagStart: null | number;
  readonly tokenize: XmlTokenizer;
}

interface XmlTokenizer {
  readonly isInText?: boolean;
}

const INDENT_UNIT = 2;
const MODE_OPTIONS = { indentUnit: INDENT_UNIT };

const require = createRequire(import.meta.url);

/*
 * `runmode.node.js` must load first: it registers itself in Node's require cache in place of the full CodeMirror 5
 * library, which the mode files below then require. The mode files are CommonJS/UMD and register themselves on that
 * object, so they load for their side effect, and the language modes are named by a computed path.
 */
/* eslint-disable import-x/no-commonjs, import-x/no-dynamic-require, import-x/no-unassigned-import, unicorn/no-top-level-side-effects -- CodeMirror 5's CommonJS/UMD modes load through require, runmode.node.js first, each registering itself as a side effect. */
const codeMirror5 = require('codemirror/addon/runmode/runmode.node.js') as CodeMirror5;
require('codemirror/mode/meta.js');

for (const name of ['xml', 'javascript', 'css', 'htmlmixed', 'stex', 'yaml']) {
  require(`codemirror/mode/${name}/${name}.js`);
}
/* eslint-enable import-x/no-commonjs, import-x/no-dynamic-require, import-x/no-unassigned-import, unicorn/no-top-level-side-effects -- The load-order block ends here. */

/**
 * The HTML mode (`htmlmixed`).
 */
export const HTML_MODE = codeMirror5.getMode(MODE_OPTIONS, 'text/html');

/**
 * The sTeX mode, for math.
 */
export const TEX_MODE = codeMirror5.getMode(MODE_OPTIONS, { name: 'stex' });

/**
 * The YAML mode, for front matter.
 */
export const YAML_MODE = codeMirror5.getMode(MODE_OPTIONS, 'yaml');

// CodeMirror's null mode, which styles nothing.
const NULL_MODE = codeMirror5.getMode(MODE_OPTIONS, 'text/plain');

/*
 * Obsidian registers its own fork of the CodeMirror 5 markdown mode under the name `markdown`, so a block whose
 * language resolves to that mode runs the fork with the options its spec gives. This port stands in for the fork, and
 * the stock `markdown.js` is never loaded.
 */
// eslint-disable-next-line unicorn/no-top-level-side-effects -- The mode registers itself on CodeMirror 5's object, as the fork does.
codeMirror5.defineMode('markdown', (_options, spec) =>
  createMarkdownMode({
    getCodeMode: findCodeMode,
    highlightFormatting: spec.highlightFormatting === true,
    html: { isInText: isHtmlInText, mode: HTML_MODE },
    strikethrough: spec.strikethrough === true,
    taskLists: spec.taskLists === true
  }));
// eslint-disable-next-line unicorn/no-top-level-side-effects -- The fork registers these MIME types for itself.
codeMirror5.defineMIME('text/markdown', 'markdown');
// eslint-disable-next-line unicorn/no-top-level-side-effects -- The fork registers these MIME types for itself.
codeMirror5.defineMIME('text/x-markdown', 'markdown');

/**
 * Finds the mode for a fenced code block's info string, the way the editor's markdown mode does.
 *
 * @param name - The language name from the info string.
 * @returns The mode, or `null` when the language has none.
 */
export function getCodeMode(name: string): AnyMode | null {
  const mode = findCodeMode(name);
  return mode.name === 'null' ? null : mode;
}

/**
 * Whether an HTML mode state sits inside a script or style element, which the HTML mode tokenizes with a mode made for
 * that element.
 *
 * @param state - The HTML mode state.
 * @returns `true` inside such an element.
 */
export function isHtmlInEmbeddedMode(state: object): boolean {
  return codeMirror5.innerMode(HTML_MODE, state).mode.name !== 'xml';
}

/**
 * Whether an HTML mode state sits in plain text, outside every tag and every embedded script or style: the test the
 * CodeMirror 5 markdown mode uses to leave an HTML block.
 *
 * @param state - The HTML mode state.
 * @returns `true` in plain text.
 */
export function isHtmlInText(state: object): boolean {
  const inner = codeMirror5.innerMode(HTML_MODE, state);
  const xmlState = inner.state as XmlState;
  return inner.mode.name === 'xml' && xmlState.tagStart === null && !xmlState.context && xmlState.tokenize.isInText === true;
}

/**
 * Finds the mode for a fenced code block's info string, the way Obsidian's fork of the CodeMirror 5 markdown mode
 * does: a language with no mode gets CodeMirror's null mode, which styles nothing.
 *
 * @param name - The language name from the info string.
 * @returns The mode.
 */
function findCodeMode(name: string): AnyMode {
  const info = codeMirror5.findModeByName(name);
  const spec = info ? info.mime ?? info.mimes?.[0] ?? name : name;
  if (info && info.mode !== 'null' && info.mode !== 'markdown') {
    try {
      // eslint-disable-next-line import-x/no-dynamic-require -- A fenced block's language mode is a CommonJS/UMD file found by name at run time.
      require(`codemirror/mode/${info.mode}/${info.mode}.js`);
    } catch {
      return NULL_MODE;
    }
  }
  return codeMirror5.getMode(MODE_OPTIONS, spec);
}
