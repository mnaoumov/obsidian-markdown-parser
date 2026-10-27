/**
 * @file
 *
 * A private demo plugin that runs this parser inside Obsidian, next to the stock editor and metadata worker. It is
 * never published: build it with `jiti scripts/demo/build-demo-plugin.ts` and copy `dist/demo-plugin/` into a vault.
 *
 * - The toggle puts the editor-class language in front of Obsidian's markdown language. The `language` facet takes its
 *   first value, so the editor parses with this parser while Obsidian's own renderer, live preview and folding read the
 *   tree.
 * - The class comparison parses a note, or every note, with both languages and compares their trees node by node.
 * - The metadata comparison builds every note's `CachedMetadata` with `parseMetadata` and compares it with the cache.
 * - The measurement times a full parse with each language and 50 keystrokes typed into the active editor with each.
 *
 * Every command keeps its report in `lastReport` and shows it in a modal, so a script driving the app over CDP can read it.
 */

import type { Language } from '@codemirror/language';
import type {
  Extension,
  Text
} from '@codemirror/state';
import type { PluginValue } from '@codemirror/view';
import type {
  NodeProp,
  Tree
} from '@lezer/common';
import type {
  App,
  TFile
} from 'obsidian';

// eslint-disable-next-line import-x/no-namespace -- Obsidian's copy adds two props the package's types lack, read off the module object.
import * as codeMirrorLanguage from '@codemirror/language';
import {
  EditorState,
  Prec
} from '@codemirror/state';
import {
  EditorView,
  ViewPlugin
} from '@codemirror/view';
import {
  apiVersion,
  MarkdownView,
  Modal,
  Notice,
  Plugin
} from 'obsidian';

import type {
  ClassDifference,
  NodeListDifference
} from './compare.ts';

import { createEditorClassLanguage } from '../editor/language.ts';
import { parseMetadata } from '../metadata/metadata.ts';
import {
  findClassDifference,
  findNodeListDifference,
  findValueDifference,
  median,
  readTreeNodes
} from './compare.ts';

/**
 * The report of the class comparison.
 */
export interface ClassComparisonReport {
  /**
   * The notes where a character or a line gets different classes, each with its first difference.
   */
  readonly differing: readonly NoteClassDifference[];

  /**
   * The notes whose trees differ node for node, each with its first difference. Every character can have the same
   * classes while the nodes differ: split where the stock tree has one node, the text renders as more spans.
   */
  readonly differingNodes: readonly NoteNodeDifference[];

  /**
   * How many notes were compared.
   */
  readonly notes: number;

  /**
   * How many nodes the stock trees hold in all.
   */
  readonly stockNodes: number;
}

/**
 * The report of the measurement.
 */
export interface MeasurementReport {
  /**
   * The note's length in characters.
   */
  readonly characters: number;

  /**
   * The note's length in lines.
   */
  readonly lines: number;

  /**
   * The median full parse in milliseconds, per language.
   */
  readonly medianFullParseMs: Readonly<Record<LanguageName, number>>;

  /**
   * The median keystroke in milliseconds, per language: the transaction typing one character in the middle of the
   * note, with the parse to the end of the viewport after it.
   */
  readonly medianKeystrokeMs: Readonly<Record<LanguageName, number>>;

  /**
   * The note's path.
   */
  readonly path: string;

  /**
   * The slowest keystroke in milliseconds, per language.
   */
  readonly slowestKeystrokeMs: Readonly<Record<LanguageName, number>>;
}

/**
 * The report of the metadata comparison.
 */
export interface MetadataComparisonReport {
  /**
   * The notes whose metadata differs, each with the path of its first difference.
   */
  readonly differing: readonly NoteMetadataDifference[];

  /**
   * How many notes were compared.
   */
  readonly notes: number;

  /**
   * How long `parseMetadata` took over all notes, in milliseconds.
   */
  readonly parseMs: number;
}

/**
 * A note where a character or a line gets different classes.
 */
export interface NoteClassDifference {
  /**
   * The first difference.
   */
  readonly difference: ClassDifference;

  /**
   * The note's path.
   */
  readonly path: string;
}

/**
 * A note whose metadata differs.
 */
export interface NoteMetadataDifference {
  /**
   * The note's path.
   */
  readonly path: string;

  /**
   * The path of the first difference in the metadata, such as `$.links[0].position`.
   */
  readonly where: string;
}

/**
 * A note whose trees differ node for node.
 */
export interface NoteNodeDifference {
  /**
   * The first difference.
   */
  readonly difference: NodeListDifference;

  /**
   * The note's path.
   */
  readonly path: string;
}

/**
 * The reports the commands keep.
 */
export interface Reports {
  /**
   * The last class comparison.
   */
  classes?: ClassComparisonReport;

  /**
   * The last measurement.
   */
  measurement?: MeasurementReport;

  /**
   * The last metadata comparison.
   */
  metadata?: MetadataComparisonReport;
}

/**
 * Which language parses: Obsidian's own, or this parser.
 */
type LanguageName = 'parser' | 'stock';

/**
 * The two node props Obsidian's copy of `@codemirror/language` adds, which its editor renders classes from.
 */
/* eslint-disable unicorn/name-replacements -- The names Obsidian exports. */
interface ObsidianLanguageModule {
  readonly lineClassNodeProp?: NodeProp<string>;
  readonly tokenClassNodeProp?: NodeProp<string>;
}
/* eslint-enable unicorn/name-replacements -- Only the export names above. */

const KEYSTROKES = 50;
const FULL_PARSE_RUNS = 5;
const PARSE_TIMEOUT_MS = 60_000;
const REPORT_INDENT = 2;
const MAX_LISTED_DIFFERENCES = 20;
const HALF = 0.5;
const MODE_LOAD_MS = 1000;
// The pause between keystrokes: a frame at 60 Hz. `requestAnimationFrame` hardly fires in a hidden window, which a test instance is.
const FRAME_MS = 16;

// The public package's types do not have Obsidian's two props, so the module is read through its own shape.
const { ensureSyntaxTree, language } = codeMirrorLanguage;
const obsidianLanguageModule = codeMirrorLanguage as ObsidianLanguageModule;
// The classes of the running app's release.
const parserLanguage = createEditorClassLanguage({
  obsidianVersion: apiVersion,
  ...(obsidianLanguageModule.lineClassNodeProp && { lineClassNodeProperty: obsidianLanguageModule.lineClassNodeProp }),
  ...(obsidianLanguageModule.tokenClassNodeProp && { tokenClassNodeProperty: obsidianLanguageModule.tokenClassNodeProp })
});

class ReportModal extends Modal {
  public constructor(app: App, private readonly title: string, private readonly report: object) {
    super(app);
  }

  public override onOpen(): void {
    this.setTitle(this.title);
    this.contentEl.createEl('pre', { text: JSON.stringify(shortenReport(this.report), null, REPORT_INDENT) ?? '' });
  }
}

/* eslint-disable unicorn/consistent-class-member-order -- perfectionist/sort-classes orders public members first, and the two rules disagree. */
/**
 * The demo plugin.
 */
// eslint-disable-next-line import-x/no-default-export -- Obsidian loads a plugin from its module's default export.
export default class MarkdownParserDemoPlugin extends Plugin {
  /**
   * The reports of the last run of each command.
   */
  public readonly lastReport: Reports = {};

  private readonly editorExtensions: Extension[] = [];
  private isParserOn = false;
  private readonly liveViews = new Set<EditorView>();
  private reportModal: null | ReportModal = null;
  private statusBarElement: HTMLElement | null = null;
  private stockLanguage: Language | null = null;

  /**
   * Compares the editor-class trees of every note, or of the given ones, with the stock editor's.
   *
   * @param paths - The notes to compare, or every note when omitted.
   * @returns The report.
   */
  public async compareClasses(paths?: readonly string[]): Promise<ClassComparisonReport> {
    const stock = this.getStockLanguage();
    const differing: NoteClassDifference[] = [];
    const differingNodes: NoteNodeDifference[] = [];
    let stockNodes = 0;
    const files = this.getNotes(paths);
    const texts = await Promise.all(files.map(async (file) => this.app.vault.cachedRead(file)));
    /*
     * Obsidian loads a fenced block's CodeMirror 5 mode the first time a parse meets its language, and that parse leaves
     * the block plain, so a first pass loads every mode the notes use.
     */
    for (const text of texts) {
      fullParse(stock, text);
    }
    await sleep(MODE_LOAD_MS);
    for (const [index, file] of files.entries()) {
      const text = texts[index] ?? '';
      const expected = readTreeNodes(fullParse(stock, text));
      const actual = readTreeNodes(fullParse(parserLanguage, text));
      stockNodes += expected.length;
      const classDifference = findClassDifference(text, expected, actual);
      if (classDifference) {
        differing.push({ difference: classDifference, path: file.path });
      }
      const nodeDifference = findNodeListDifference(expected, actual);
      if (nodeDifference) {
        differingNodes.push({ difference: nodeDifference, path: file.path });
      }
    }
    const report: ClassComparisonReport = { differing, differingNodes, notes: files.length, stockNodes };
    this.lastReport.classes = report;
    this.showReport('Editor classes compared with the stock editor', report);
    return report;
  }

  /**
   * Compares `parseMetadata` with the metadata cache for every note, or for the given ones.
   *
   * @param paths - The notes to compare, or every note when omitted.
   * @returns The report.
   */
  public async compareMetadata(paths?: readonly string[]): Promise<MetadataComparisonReport> {
    const differing: NoteMetadataDifference[] = [];
    const files = this.getNotes(paths);
    let parseMs = 0;
    for (const file of files) {
      const text = await this.app.vault.cachedRead(file);
      const start = performance.now();
      const metadata = parseMetadata(text);
      parseMs += performance.now() - start;
      const where = findValueDifference(this.app.metadataCache.getFileCache(file), metadata);
      if (where !== null) {
        differing.push({ path: file.path, where });
      }
    }
    const report: MetadataComparisonReport = { differing, notes: files.length, parseMs };
    this.lastReport.metadata = report;
    this.showReport('Metadata compared with the metadata cache', report);
    return report;
  }

  /**
   * Measures the active note: a full parse with each language, and keystrokes typed into its editor with each. The
   * keystrokes are removed afterwards.
   *
   * @returns The report, or `null` when no markdown editor is active.
   */
  public async measure(): Promise<MeasurementReport | null> {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const view = markdownView ? this.findLiveView(markdownView) : null;
    if (!view || !markdownView?.file) {
      new Notice('Open a note in the editor first.');
      return null;
    }
    const wasParserOn = this.isParserOn;
    const stock = this.getStockLanguage();
    const text = view.state.doc.toString();
    const fullParseMs: Record<LanguageName, number[]> = { parser: [], stock: [] };
    for (let run = 0; run < FULL_PARSE_RUNS; run++) {
      fullParseMs.stock.push(time(() => fullParse(stock, text)));
      fullParseMs.parser.push(time(() => fullParse(parserLanguage, text)));
    }
    const keystrokeMs: Record<LanguageName, number[]> = { parser: [], stock: [] };
    for (const name of ['stock', 'parser'] as const) {
      this.setParser(name === 'parser');
      keystrokeMs[name] = await typeKeystrokes(view);
    }
    this.setParser(wasParserOn);
    const report: MeasurementReport = {
      characters: text.length,
      lines: view.state.doc.lines,
      medianFullParseMs: { parser: median(fullParseMs.parser), stock: median(fullParseMs.stock) },
      medianKeystrokeMs: { parser: median(keystrokeMs.parser), stock: median(keystrokeMs.stock) },
      path: markdownView.file.path,
      slowestKeystrokeMs: { parser: Math.max(...keystrokeMs.parser), stock: Math.max(...keystrokeMs.stock) }
    };
    this.lastReport.measurement = report;
    this.showReport('Parse and keystroke cost', report);
    return report;
  }

  /**
   * Registers the editor extensions, the status bar item and the commands.
   */
  public override onload(): void {
    this.registerEditorExtension(ViewPlugin.define((view) => this.trackView(view)));
    this.registerEditorExtension(this.editorExtensions);
    this.statusBarElement = this.addStatusBarItem();
    this.renderStatus();
    this.addCommand({
      callback: () => {
        this.setParser(!this.isParserOn);
      },
      id: 'toggle',
      name: 'Toggle the editor language'
    });
    this.addCommand({ callback: () => this.compareClasses(this.activeNotePaths()), id: 'compare-classes-active', name: 'Compare the editor classes of the active note' });
    this.addCommand({ callback: () => this.compareClasses(), id: 'compare-classes-vault', name: 'Compare the editor classes of every note' });
    this.addCommand({ callback: () => this.compareMetadata(), id: 'compare-metadata-vault', name: 'Compare the metadata of every note' });
    this.addCommand({ callback: () => this.measure(), id: 'measure', name: 'Measure parse and keystroke cost on the active note' });
  }

  /**
   * Turns the parser on or off in every editor.
   *
   * @param isOn - Whether the editors parse with this parser.
   */
  public setParser(isOn: boolean): void {
    if (isOn === this.isParserOn) {
      return;
    }
    if (isOn) {
      // The stock language is read before it is shadowed.
      this.captureStockLanguage();
      this.editorExtensions.push(Prec.highest(parserLanguage));
    } else {
      this.editorExtensions.length = 0;
    }
    this.isParserOn = isOn;
    this.app.workspace.updateOptions();
    this.renderStatus();
  }

  private activeNotePaths(): string[] {
    const file = this.app.workspace.getActiveFile();
    return file ? [file.path] : [];
  }

  private captureStockLanguage(): void {
    if (this.stockLanguage || this.isParserOn) {
      return;
    }
    for (const view of this.liveViews) {
      const found = view.state.facet(language);
      if (found && found !== parserLanguage) {
        this.stockLanguage = found;
        return;
      }
    }
  }

  private findLiveView(markdownView: MarkdownView): EditorView | null {
    for (const view of this.liveViews) {
      if (markdownView.contentEl.contains(view.dom)) {
        return view;
      }
    }
    return null;
  }

  private getNotes(paths?: readonly string[]): TFile[] {
    const files = this.app.vault.getMarkdownFiles();
    return paths ? files.filter((file) => paths.includes(file.path)) : files;
  }

  private getStockLanguage(): Language {
    this.captureStockLanguage();
    if (!this.stockLanguage && this.isParserOn) {
      // Every editor parses with this parser, so the stock language is shadowed: turn it off for a moment to read it.
      this.setParser(false);
      this.captureStockLanguage();
      this.setParser(true);
    }
    if (!this.stockLanguage) {
      throw new Error('Open a note in the editor first: the stock language is read from an editor.');
    }
    return this.stockLanguage;
  }

  private renderStatus(): void {
    this.statusBarElement?.setText(`Markdown parser: ${this.isParserOn ? 'on' : 'off'}`);
  }

  // Shows one report at a time: a report replaces the one before it.
  private showReport(title: string, report: object): void {
    this.reportModal?.close();
    this.reportModal = new ReportModal(this.app, title, report);
    this.reportModal.open();
  }

  private trackView(view: EditorView): PluginValue {
    this.liveViews.add(view);
    return {
      destroy: (): void => {
        this.liveViews.delete(view);
      }
    };
  }
}
/* eslint-enable unicorn/consistent-class-member-order -- The rule is off for MarkdownParserDemoPlugin only. */

function fullParse(parser: Language, text: string): Tree {
  // eslint-disable-next-line unicorn/name-replacements -- CodeMirror's option name.
  const state = EditorState.create({ doc: text, extensions: parser });
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
  if (!tree) {
    throw new Error('The parse did not finish in time');
  }
  return tree;
}

// Lists at most the first few notes of each list in the modal; the kept report has them all.
function shortenReport(report: object): object {
  return Object.fromEntries(
    Object.entries(report).map(([key, value]: [string, unknown]) => [
      key,
      Array.isArray(value) && value.length > MAX_LISTED_DIFFERENCES
        ? [...value.slice(0, MAX_LISTED_DIFFERENCES), `... ${String(value.length - MAX_LISTED_DIFFERENCES)} more`]
        : value
    ])
  );
}

function time(action: () => unknown): number {
  const start = performance.now();
  action();
  return performance.now() - start;
}

/*
 * Types characters one after another in the middle of the note, each as its own transaction, and times each with the
 * parse to the end of the viewport after it, a frame apart, then removes them.
 */
async function typeKeystrokes(view: EditorView): Promise<number[]> {
  const initial: Text = view.state.doc;
  const at = initial.line(Math.ceil(initial.lines * HALF)).from;
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }), selection: { anchor: at } });
  ensureSyntaxTree(view.state, view.state.doc.length, PARSE_TIMEOUT_MS);
  await sleep(FRAME_MS);
  const times: number[] = [];
  for (let index = 0; index < KEYSTROKES; index++) {
    times.push(time(() => {
      const pos = at + index;
      view.dispatch({ changes: { from: pos, insert: 'x' }, selection: { anchor: pos + 1 }, userEvent: 'input.type' });
      ensureSyntaxTree(view.state, view.viewport.to, PARSE_TIMEOUT_MS);
    }));
    await sleep(FRAME_MS);
  }
  view.dispatch({ changes: { from: at, to: at + KEYSTROKES } });
  return times;
}
