/**
 * @file
 *
 * Turns the pinned oracle files into plain JSON test cases that can sit next to another project's tests: the spec
 * examples, the reading-view quirk probes, the metadata worker documents and the samples of the parser issues reported on
 * the forum, each with the markdown and what Obsidian gave for it. Every value is the spec's or Obsidian's own output,
 * read by the oracle scripts: nothing of this repository's parser goes into a case. The one value built here is a
 * metadata issue's `expectedMetadata`, which is the worker's own output with the fault taken out.
 */

import type {
  ForumIssueFile,
  ForumIssueRead
} from './forum-issues.ts';
import type { OracleNode } from './oracle-file.ts';
import type { QuirkProbeFile } from './quirk-probes.ts';
import type { SpecOracleFile } from './spec-oracle-file.ts';
import type { SpecDifference } from './spec-quirks.ts';
import type { WorkerMetadataOracleFile } from './worker-metadata.ts';

import {
  EDITOR_VS_READING_VIEW_SAMPLES,
  METADATA_ISSUE_SAMPLES
} from './forum-issues.ts';
import { lineStartsOf } from './score.ts';
import {
  exampleKey,
  readingViewDifferences,
  SPEC_DIFFERENCES,
  specDifferenceKeys
} from './spec-quirks.ts';

/**
 * One line as the editor styles it.
 */
export interface EditorLine {
  /**
   * The line classes, rendered on `.cm-line`.
   */
  readonly lineClasses: readonly string[];

  /**
   * The line's text.
   */
  readonly text: string;

  /**
   * The styled spans of the line, in order; text outside them has no class.
   */
  readonly tokens: readonly EditorToken[];
}

/**
 * A styled span of a line.
 */
export interface EditorToken {
  /**
   * The token classes, each rendered as `cm-<class>`.
   */
  readonly classes: readonly string[];

  /**
   * The first column.
   */
  readonly from: number;

  /**
   * The column after the last.
   */
  readonly to: number;
}

/**
 * A case on which the editor and the reading view read the same note differently.
 */
export interface EditorVsReadingViewCase {
  /**
   * How the editor styles each line.
   */
  readonly editorLines: readonly EditorLine[];

  /**
   * The forum topic that reports it.
   */
  readonly forumUrl: string;

  /**
   * The case id, `<issue>-<sample>`.
   */
  readonly id: string;

  /**
   * The issue it belongs to.
   */
  readonly issue: string;

  /**
   * The document.
   */
  readonly markdown: string;

  /**
   * The metadata worker's `CachedMetadata`.
   */
  readonly metadata: unknown;

  /**
   * The disagreement, in one sentence.
   */
  readonly note: string;

  /**
   * The reading view's HTML, with `strictLineBreaks: true`.
   */
  readonly obsidianHtml: string;

  /**
   * The Obsidian version that read it.
   */
  readonly obsidianVersion: string;
}

/**
 * One way the reading view departs from the spec on an example.
 */
export interface ExportedDeparture {
  /**
   * The behaviour, with the examples that show each part of it.
   */
  readonly behaviour: string;

  /**
   * What kind of departure it is.
   */
  readonly kind: SpecDifference['kind'];

  /**
   * A short name.
   */
  readonly name: string;
}

/**
 * A metadata cache case: a document and the `CachedMetadata` the metadata worker posted for it.
 */
export interface MetadataCase {
  /**
   * The case id.
   */
  readonly id: string;

  /**
   * The document.
   */
  readonly markdown: string;

  /**
   * The worker's `CachedMetadata`, or `null` where the worker threw.
   */
  readonly metadata: unknown;

  /**
   * The Obsidian version whose worker posted it.
   */
  readonly obsidianVersion: string;
}

/**
 * A note whose metadata the worker drops or misplaces.
 */
export interface MetadataIssueCase {
  /**
   * The metadata the note should have; absent where what it should be is not clear.
   */
  readonly expectedMetadata?: unknown;

  /**
   * The forum topic that reports it.
   */
  readonly forumUrl: string;

  /**
   * The case id, `<issue>-<sample>`.
   */
  readonly id: string;

  /**
   * The issue it belongs to.
   */
  readonly issue: string;

  /**
   * The document.
   */
  readonly markdown: string;

  /**
   * The worker's `CachedMetadata`, or `null` where the worker threw.
   */
  readonly metadata: unknown;

  /**
   * What goes wrong, and where `expectedMetadata` comes from.
   */
  readonly note: string;

  /**
   * The Obsidian version whose worker posted it.
   */
  readonly obsidianVersion: string;
}

/**
 * A reading-view quirk case: a document beyond the spec examples that shows how Obsidian departs from CommonMark.
 */
export interface QuirkCase {
  /**
   * The case id.
   */
  readonly id: string;

  /**
   * The document.
   */
  readonly markdown: string;

  /**
   * The metadata worker's sections, each as `<type>@<first line>-<last line>`, lines from 0.
   */
  readonly metadataSections: readonly string[];

  /**
   * What the quirk is.
   */
  readonly note: string;

  /**
   * The reading view's HTML, with `strictLineBreaks: true`.
   */
  readonly obsidianHtml: string;

  /**
   * The Obsidian version that rendered it.
   */
  readonly obsidianVersion: string;

  /**
   * The quirk it shows.
   */
  readonly quirk: string;

  /**
   * Whether GFM tables are part of the case: `gfm` for a table probe, `commonmark` otherwise.
   */
  readonly syntax: 'commonmark' | 'gfm';
}

/**
 * A spec example case: the spec's HTML and the reading view's.
 */
export interface SpecCase {
  /**
   * The spec's HTML for it.
   */
  readonly commonMarkSpecHtml: string;

  /**
   * How the reading view departs from the spec on it; absent where the two agree.
   */
  readonly departures?: readonly ExportedDeparture[];

  /**
   * The example number in its spec.
   */
  readonly example: number;

  /**
   * The case id, `<suite>-<example>`.
   */
  readonly id: string;

  /**
   * The example's markdown.
   */
  readonly markdown: string;

  /**
   * The metadata worker's `CachedMetadata` for it.
   */
  readonly metadata: unknown;

  /**
   * The reading view's HTML, with `strictLineBreaks: true`.
   */
  readonly obsidianHtml: string;

  /**
   * The reading view's HTML with `strictLineBreaks: false`, the app's default; absent where it is `obsidianHtml`.
   */
  readonly obsidianHtmlSoftBreaksAsHard?: string;

  /**
   * The Obsidian version that rendered it.
   */
  readonly obsidianVersion: string;

  /**
   * The spec section it is in.
   */
  readonly section: string;

  /**
   * The suite: the CommonMark spec, or the GFM spec's extension examples.
   */
  readonly suite: 'commonmark' | 'gfm';
}

/**
 * One exported suite file.
 */
export interface TestCaseSuite<Case> {
  /**
   * What the suite holds and how its values were read.
   */
  readonly about: string;

  /**
   * The cases.
   */
  readonly cases: readonly Case[];

  /**
   * The Obsidian version every case was read from.
   */
  readonly obsidianVersion: string;
}

/**
 * The exported suites.
 */
export interface TestCaseSuites {
  /**
   * The CommonMark spec examples.
   */
  readonly commonmark: TestCaseSuite<SpecCase>;

  /**
   * The CommonMark spec examples whose reading view, with `strictLineBreaks: true`, differs from the spec.
   */
  readonly commonmarkDepartures: TestCaseSuite<SpecCase>;

  /**
   * The notes the editor and the reading view read differently.
   */
  readonly editorVsReadingView: TestCaseSuite<EditorVsReadingViewCase>;

  /**
   * The GFM spec's extension examples.
   */
  readonly gfm: TestCaseSuite<SpecCase>;

  /**
   * The GFM spec's extension examples whose reading view, with `strictLineBreaks: true`, differs from the spec.
   */
  readonly gfmDepartures: TestCaseSuite<SpecCase>;

  /**
   * The metadata worker documents.
   */
  readonly metadata: TestCaseSuite<MetadataCase>;

  /**
   * The notes whose metadata the worker drops or misplaces.
   */
  readonly metadataCacheIssues: TestCaseSuite<MetadataIssueCase>;

  /**
   * The reading-view quirk probes.
   */
  readonly quirks: TestCaseSuite<QuirkCase>;
}

const SPEC_SUITE_NAMES: Readonly<Record<SpecCase['suite'], string>> = {
  commonmark: 'the CommonMark 0.31.2 spec',
  gfm: 'the GFM 0.29.0.gfm.13 spec\'s extension examples'
};

// What every spec suite's cases hold, after the sentence naming its examples.
const SPEC_SUITE_ABOUT = 'with the spec\'s HTML (`commonMarkSpecHtml`), the reading view\'s HTML with `strictLineBreaks: true` (`obsidianHtml`), with the app\'s default `strictLineBreaks: false` where that differs (`obsidianHtmlSoftBreaksAsHard`), and the metadata worker\'s CachedMetadata. `departures` explains each example whose reading view differs from the spec: `quirk` is Obsidian\'s parser reading valid markdown differently, `syntax` is Obsidian syntax, `rendering` is the sanitizer or an embed changing the parser\'s HTML, and `comparison` is the spec\'s HTML holding an unclosed tag that a DOM closes. The reading view\'s HTML is its rendered DOM, serialized, without the code block copy button, the syntax highlighting and the attributes the view adds to blocks; compare it with the spec\'s after putting both through a DOM and dropping whitespace between tags.';

const QUIRK_NOTES: Readonly<Record<string, string>> = {
  autolink: 'Which `<...>` autolinks there are: Obsidian takes any scheme followed by `://`, and any non-whitespace holding an `@`.',
  characterReference: 'Which character references there are: a numeric one takes any number of digits and needs no `;`, and a named one without its `;` takes the longest legacy HTML name it starts with.',
  codeSpan: 'How backtick runs pair into code spans, and how a code span\'s spaces are stripped.',
  emphasis: 'How `*` and `_` runs pair into emphasis, which follows Obsidian\'s own delimiter rules rather than CommonMark\'s.',
  gfmTable: 'How a GFM table is read: the delimiter row gives the columns, rows agree with the header on a leading pipe, a table interrupts no paragraph, and cells are read as written.',
  htmlBlock: 'Which lines open an HTML block and what ends it: no `<textarea>` in the first kind, `hgroup`, `meta`, `pre` and `source` in the sixth with no `search`, and the sixth and seventh end at an empty line only.',
  htmlComment: 'Which inline HTML comments there are, as CommonMark 0.30 has them: no text starting with `>` or `->`, ending with `-` or holding `--`.',
  image: 'How an image\'s description becomes its `alt`.',
  lazyQuote: 'Which lines continue a block quote lazily.',
  link: 'How brackets pair into links, and which destinations, titles and labels a link takes.',
  linkDefinition: 'How a link reference definition is read: its title, its destination, its label, and a setext underline below it.',
  listItem: 'How list items are structured: marker width, indentation that continues or opens an item, and items whose first line is empty.',
  tab: 'How a tab counts toward indentation after a list marker or a quote marker.',
  whitespace: 'Which leading and trailing whitespace a paragraph keeps.'
};

/**
 * Builds the suites from the oracle files. A departure suite is its full suite filtered by the reading view's HTML, so
 * the two cannot drift apart.
 *
 * @param spec - The spec oracle.
 * @param probes - The quirk probe oracle.
 * @param worker - The metadata worker oracle.
 * @param forum - The forum issue oracle.
 * @returns The suites.
 */
export function buildTestCaseSuites(spec: SpecOracleFile, probes: QuirkProbeFile, worker: WorkerMetadataOracleFile, forum: ForumIssueFile): TestCaseSuites {
  const specCases = buildSpecCases(spec);
  const departing = new Set(readingViewDifferences(spec));
  return {
    commonmark: buildSpecSuite(spec, specCases, 'commonmark', null),
    commonmarkDepartures: buildSpecSuite(spec, specCases, 'commonmark', departing),
    editorVsReadingView: buildEditorVsReadingViewSuite(forum),
    gfm: buildSpecSuite(spec, specCases, 'gfm', null),
    gfmDepartures: buildSpecSuite(spec, specCases, 'gfm', departing),
    metadata: buildMetadataSuite(worker),
    metadataCacheIssues: buildMetadataIssueSuite(forum),
    quirks: buildQuirkSuite(probes)
  };
}

/**
 * Splits the editor's tree into lines: a top node whose classes are all `HyperMD-*` gives its line's classes, and every
 * other node a token on each line it covers.
 *
 * @param text - The document.
 * @param nodes - The editor's tree, as the oracle reads it.
 * @returns The lines.
 */
export function editorLinesOf(text: string, nodes: readonly OracleNode[]): EditorLine[] {
  const starts = lineStartsOf(text);
  const lines = starts.map((start, index) => ({
    lineClasses: [] as string[],
    start,
    text: text.slice(start, (starts[index + 1] ?? text.length + 1) - 1),
    tokens: [] as EditorToken[]
  }));
  for (const [from, to, depth, name] of nodes) {
    const classes = name.split('_').filter(Boolean);
    if (depth === 1 && classes.length > 0 && classes.every((cls) => cls.startsWith('HyperMD-'))) {
      lines.findLast((line) => line.start <= from)?.lineClasses.push(...classes);
      continue;
    }
    for (const line of lines) {
      const end = line.start + line.text.length;
      if (from > end || to <= line.start) {
        continue;
      }
      const tokenFrom = Math.max(from, line.start) - line.start;
      const tokenTo = Math.min(to, end) - line.start;
      if (tokenFrom < tokenTo) {
        line.tokens.push({ classes, from: tokenFrom, to: tokenTo });
      }
    }
  }
  return lines.map(({ lineClasses, text: lineText, tokens }) => ({ lineClasses, text: lineText, tokens }));
}

function buildEditorVsReadingViewSuite(forum: ForumIssueFile): TestCaseSuite<EditorVsReadingViewCase> {
  const obsidianVersion = requireVersion(forum.meta.appVersion);
  const cases = EDITOR_VS_READING_VIEW_SAMPLES.map((sample): EditorVsReadingViewCase => {
    const read = forumRead(forum, sample.markdown);
    return {
      editorLines: editorLinesOf(sample.markdown, read.nodes),
      forumUrl: sample.forumUrl,
      id: sample.id,
      issue: sample.issue,
      markdown: sample.markdown,
      metadata: read.metadata,
      note: sample.note,
      obsidianHtml: read.html,
      obsidianVersion
    };
  });
  return {
    about: 'Notes that Obsidian\'s editor (Source mode and Live Preview) and its reading view read differently, each reported on the Obsidian forum (`forumUrl`). `editorLines` is how the editor styles each line: `lineClasses` go on `.cm-line`, and each token is a column range `[from, to)` of the line with its classes, each rendered as `cm-<class>`; text outside a token has no class. `obsidianHtml` is the reading view\'s HTML with `strictLineBreaks: true`, serialized as in the spec suites, and `metadata` the metadata worker\'s CachedMetadata, which reads the note as the reading view does. `note` names the disagreement. A test of a parser that serves both views expects them to agree.',
    cases,
    obsidianVersion
  };
}

function buildMetadataIssueSuite(forum: ForumIssueFile): TestCaseSuite<MetadataIssueCase> {
  const obsidianVersion = requireVersion(forum.meta.appVersion);
  const cases = METADATA_ISSUE_SAMPLES.map((sample): MetadataIssueCase => {
    const { metadata } = forumRead(forum, sample.markdown);
    const standIn = sample.standIn === undefined ? null : forumRead(forum, sample.standIn).metadata;
    return {
      ...(sample.expectedOf !== undefined) && { expectedMetadata: sample.expectedOf(metadata, standIn) },
      forumUrl: sample.forumUrl,
      id: sample.id,
      issue: sample.issue,
      markdown: sample.markdown,
      metadata,
      note: sample.note,
      obsidianVersion
    };
  });
  return {
    about: 'Notes whose metadata Obsidian\'s metadata worker drops or misplaces, each reported on the Obsidian forum (`forumUrl`). `metadata` is the CachedMetadata the worker posted, as JSON with its key order, or null where it threw and the note lost all its metadata. `expectedMetadata`, where what the note should give is clear, is that metadata as it should be, built from the worker\'s own output as `note` says; it is absent where the right answer is the team\'s call.',
    cases,
    obsidianVersion
  };
}

function buildMetadataSuite(worker: WorkerMetadataOracleFile): TestCaseSuite<MetadataCase> {
  const obsidianVersion = worker.meta.appVersion;
  const countPerSet = new Map<string, number>();
  const cases = worker.docs.map((document): MetadataCase => {
    const index = (countPerSet.get(document.set) ?? 0) + 1;
    countPerSet.set(document.set, index);
    return {
      id: `${document.set}-${String(index)}`,
      markdown: document.text,
      metadata: document.metadata,
      obsidianVersion
    };
  });
  return {
    about: 'Documents and the CachedMetadata Obsidian\'s metadata worker posted for each, as JSON with the worker\'s key order. `metadata` is null where the worker threw. The id names the piece set the document was built from: `conformance` documents exercise the Obsidian syntax (links, embeds, tags, comments, math, callouts, block ids, highlights, footnotes), `pinned` ones are kept whole for a shape the generator does not reach, and the others mix pieces of their kind.',
    cases,
    obsidianVersion
  };
}

function buildQuirkSuite(probes: QuirkProbeFile): TestCaseSuite<QuirkCase> {
  const obsidianVersion = requireVersion(probes.meta.appVersion);
  const countPerQuirk = new Map<string, number>();
  const cases = probes.probes.map((probe): QuirkCase => {
    const index = (countPerQuirk.get(probe.quirk) ?? 0) + 1;
    countPerQuirk.set(probe.quirk, index);
    const note = QUIRK_NOTES[probe.quirk];
    if (note === undefined) {
      throw new Error(`No note for the quirk ${probe.quirk}`);
    }
    return {
      id: `${probe.quirk}-${String(index)}`,
      markdown: probe.markdown,
      metadataSections: probe.sections,
      note,
      obsidianHtml: probe.html,
      obsidianVersion,
      quirk: probe.quirk,
      syntax: probe.preset
    };
  });
  return {
    about: 'Documents beyond the spec examples that show where Obsidian\'s reading view departs from CommonMark, with the reading view\'s HTML (`strictLineBreaks: true`, serialized as in the spec suite) and the metadata worker\'s sections. The CommonMark spec has no example for them, so they carry no spec HTML. `syntax: "gfm"` marks a case read with GFM tables in play.',
    cases,
    obsidianVersion
  };
}

function buildSpecCases(spec: SpecOracleFile): SpecCase[] {
  const obsidianVersion = requireVersion(spec.meta.appVersion);
  const departuresOf = new Map<string, ExportedDeparture[]>();
  for (const difference of SPEC_DIFFERENCES) {
    for (const key of specDifferenceKeys(difference)) {
      const departures = departuresOf.get(key) ?? [];
      departures.push({ behaviour: difference.behaviour, kind: difference.kind, name: difference.name });
      departuresOf.set(key, departures);
    }
  }
  return spec.examples.map((read): SpecCase => {
    const obsidianHtml = read.htmlStrict;
    const softBreaksAsHard = read.html;
    const departures = departuresOf.get(exampleKey(read));
    return {
      commonMarkSpecHtml: read.specHtml,
      ...(departures !== undefined) && { departures },
      example: read.example,
      id: `${read.suite}-${String(read.example)}`,
      markdown: read.markdown,
      metadata: read.metadata,
      obsidianHtml,
      ...(softBreaksAsHard !== obsidianHtml) && { obsidianHtmlSoftBreaksAsHard: softBreaksAsHard },
      obsidianVersion,
      section: read.section,
      suite: read.suite
    };
  });
}

// `departing` holds the keys of the examples to keep, or is null for the whole suite.
function buildSpecSuite(spec: SpecOracleFile, specCases: readonly SpecCase[], suite: SpecCase['suite'], departing: null | ReadonlySet<string>): TestCaseSuite<SpecCase> {
  const cases = specCases.filter((testCase) => testCase.suite === suite && (departing?.has(exampleKey(testCase)) ?? true));
  const obsidianVersion = requireVersion(spec.meta.appVersion);
  const subset = departing === null
    ? `Every example of ${SPEC_SUITE_NAMES[suite]}`
    : `The examples of ${SPEC_SUITE_NAMES[suite]} on which the reading view's HTML with \`strictLineBreaks: true\` (\`obsidianHtml\`) differs from the spec's, each the same case as in the full file; an example whose only departure is \`soft line breaks are hard\` matches the spec there and is left out`;
  return {
    about: `${subset}, ${SPEC_SUITE_ABOUT}`,
    cases,
    obsidianVersion
  };
}

function forumRead(forum: ForumIssueFile, markdown: string): ForumIssueRead {
  const read = forum.reads.find((candidate) => candidate.markdown === markdown);
  if (read === undefined) {
    throw new Error(`The forum issue oracle has no read of ${JSON.stringify(markdown)}`);
  }
  return read;
}

function requireVersion(version: null | string): string {
  if (version === null) {
    throw new Error('The oracle names no Obsidian version');
  }
  return version;
}
