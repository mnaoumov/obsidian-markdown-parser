/**
 * @file
 *
 * Turns the pinned oracle files into plain JSON test cases that can sit next to another project's tests: the spec
 * examples, the reading-view quirk probes, the metadata worker documents, the samples of the parser issues reported on
 * the forum, and the editing mode oracle's notes with all three views, each with the markdown and what Obsidian gave for
 * it. Every value is the spec's, a reference
 * implementation's or Obsidian's own output: nothing of this repository's parser goes into a case. A quirk probe's
 * `referenceHtml` comes from `commonmark.js` or `cmark-gfm` (`reference-html.ts`), and the one value built here is a
 * metadata issue's `expectedMetadata`, which is the worker's own output with the fault taken out. The parser only sorts
 * the worker documents the worker threw on by their trigger, which picks each one's forum issue and note.
 */

import type { WorkerFailureTrigger } from '../../metadata/link-path.ts';
import type { EditingModesFile } from '../modes/editing-modes.ts';
import type {
  EditingMode,
  ForumIssueFile,
  ForumIssueRead
} from '../modes/forum-issues.ts';
import type {
  QuirkProbeFile,
  QuirkProbeRead
} from './quirk-probes.ts';
import type { GfmReferenceFile } from './reference-html.ts';
import type { SpecOracleFile } from './spec-oracle-file.ts';
import type { SpecDifference } from './spec-quirks.ts';
import type { WorkerMetadataOracleFile } from './worker-metadata.ts';

import { workerFailureOf } from '../../metadata/metadata.ts';
import {
  EDITING_MODES_PER_SET,
  JUDGED_SET
} from '../modes/editing-modes.ts';
import {
  EDITOR_VS_READING_VIEW_SAMPLES,
  METADATA_ISSUE_SAMPLES
} from '../modes/forum-issues.ts';
import { JUDGED_SAMPLES } from '../modes/mode-judge-samples.ts';
import {
  COMMONMARK_REFERENCE_IMPLEMENTATION,
  gfmReferenceHtml,
  isSameAsReference,
  renderCommonMarkReference
} from './reference-html.ts';
import {
  exampleKey,
  readingViewDifferences,
  SPEC_DIFFERENCES,
  specDifferenceKeys
} from './spec-quirks.ts';

/**
 * A note with all three of Obsidian's views of it: Source mode, Live Preview and the reading view.
 */
export interface EditorAndReadingViewCase {
  /**
   * The case id: the corpus id, a forum issue sample's or a judged sample's.
   */
  readonly id: string;

  /**
   * The document.
   */
  readonly markdown: string;

  /**
   * The metadata worker's `CachedMetadata`, or `null` where the worker threw.
   */
  readonly metadata: unknown;

  /**
   * Live Preview's `.cm-content` inner HTML.
   */
  readonly obsidianLivePreviewHtml: string;

  /**
   * The reading view's HTML, with `strictLineBreaks: true`.
   */
  readonly obsidianReadingViewHtml: string;

  /**
   * Source mode's `.cm-content` inner HTML.
   */
  readonly obsidianSourceModeHtml: string;

  /**
   * The Obsidian version that read it.
   */
  readonly obsidianVersion: string;

  /**
   * The corpus piece set it was built from, `forum` for a forum issue sample, or `judged` for a judged sample.
   */
  readonly set: string;
}

/**
 * A case that the editor, Source mode or Live Preview, and the reading view read differently.
 */
export interface EditorVsReadingViewCase {
  /**
   * The editing modes that disagree with the reading view on it.
   */
  readonly differsIn: readonly EditingMode[];

  /**
   * For a case the mode judge found, the family of disagreements it shows.
   */
  readonly family?: string;

  /**
   * The forum topic that reports it; absent for a case the mode judge found, which no forum topic reports yet.
   */
  readonly forumUrl?: string;

  /**
   * The case id: `<issue>-<sample>` for a forum issue, `judged-<family>` for a case the mode judge found.
   */
  readonly id: string;

  /**
   * The issue it belongs to, or `judged` for a case the mode judge found.
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
   * Live Preview's `.cm-content` inner HTML.
   */
  readonly obsidianLivePreviewHtml: string;

  /**
   * The reading view's HTML, with `strictLineBreaks: true`.
   */
  readonly obsidianReadingViewHtml: string;

  /**
   * Source mode's `.cm-content` inner HTML.
   */
  readonly obsidianSourceModeHtml: string;

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
export interface MetadataFailingCase {
  /**
   * The metadata the note should have; absent where what it should be is not clear.
   */
  readonly expectedMetadata?: unknown;

  /**
   * The forum topic that reports it.
   */
  readonly forumUrl: string;

  /**
   * The case id: a worker document's id in the full file, or `<issue>-<sample>` for a forum sample.
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
 * A no-spec case: a document beyond the spec examples on which the reading view departs from a reference
 * implementation that passes its whole spec suite.
 */
export interface NoSpecCase {
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
  readonly obsidianReadingViewHtml: string;

  /**
   * The Obsidian version that rendered it.
   */
  readonly obsidianVersion: string;

  /**
   * The quirk it shows.
   */
  readonly quirk: string;

  /**
   * The reference implementation's HTML, as it renders it.
   */
  readonly referenceHtml: string;
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
  readonly obsidianReadingViewHtml: string;

  /**
   * The reading view's HTML with `strictLineBreaks: false`, the app's default; absent where it is `obsidianReadingViewHtml`.
   */
  readonly obsidianReadingViewHtmlSoftBreaksAsHard?: string;

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

  /**
   * The reference implementation whose HTML the cases expect, as `<name>@<version>`; only in a no-spec suite.
   */
  readonly referenceImplementation?: string;
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
  readonly commonmarkFailing: TestCaseSuite<SpecCase>;

  /**
   * The CommonMark quirk probes whose reading view differs from `commonmark.js`.
   */
  readonly commonmarkNoSpecFailing: TestCaseSuite<NoSpecCase>;

  /**
   * The notes that the editor, Source mode or Live Preview, and the reading view read differently.
   */
  readonly editorVsReadingView: TestCaseSuite<EditorVsReadingViewCase>;

  /**
   * A bounded sample of notes with all three views: the editing mode oracle's, and the forum issue samples.
   */
  readonly editorVsReadingViewAll: TestCaseSuite<EditorAndReadingViewCase>;

  /**
   * The GFM spec's extension examples.
   */
  readonly gfm: TestCaseSuite<SpecCase>;

  /**
   * The GFM spec's extension examples whose reading view, with `strictLineBreaks: true`, differs from the spec.
   */
  readonly gfmFailing: TestCaseSuite<SpecCase>;

  /**
   * The GFM quirk probes whose reading view differs from `cmark-gfm`.
   */
  readonly gfmNoSpecFailing: TestCaseSuite<NoSpecCase>;

  /**
   * The metadata worker documents.
   */
  readonly metadata: TestCaseSuite<MetadataCase>;

  /**
   * The notes whose metadata the worker drops or misplaces: the worker documents it throws on, and the forum samples.
   */
  readonly metadataFailing: TestCaseSuite<MetadataFailingCase>;
}

const SPEC_SUITE_NAMES: Readonly<Record<SpecCase['suite'], string>> = {
  commonmark: 'the CommonMark 0.31.2 spec',
  gfm: 'the GFM 0.29.0.gfm.13 spec\'s extension examples'
};

// What every spec suite's cases hold, after the sentence naming its examples.
const SPEC_SUITE_ABOUT = 'with the spec\'s HTML (`commonMarkSpecHtml`), the reading view\'s HTML with `strictLineBreaks: true` (`obsidianReadingViewHtml`), with the app\'s default `strictLineBreaks: false` where that differs (`obsidianReadingViewHtmlSoftBreaksAsHard`), and the metadata worker\'s CachedMetadata. `departures` explains each example whose reading view differs from the spec: `quirk` is Obsidian\'s parser reading valid markdown differently, `syntax` is Obsidian syntax, `rendering` is the sanitizer or an embed changing the parser\'s HTML, and `comparison` is the spec\'s HTML holding an unclosed tag that a DOM closes. The reading view\'s HTML is its rendered DOM, serialized, without the code block copy button, the syntax highlighting and the attributes the view adds to blocks; compare it with the spec\'s after putting both through a DOM and dropping whitespace between tags.';

const NO_SPEC_SUITE_ABOUT: Readonly<Record<QuirkProbeRead['preset'], string>> = {
  commonmark: 'Documents beyond the CommonMark spec\'s examples on which Obsidian\'s reading view departs from CommonMark. The spec has no example for them, so the expected HTML comes from its reference implementation.',
  gfm: 'Documents beyond the GFM spec\'s examples, GFM tables and strikethrough, on which Obsidian\'s reading view departs from GFM. The spec has no example for them, so the expected HTML comes from its own implementation.'
};

const NO_SPEC_REFERENCE_SPEC: Readonly<Record<QuirkProbeRead['preset'], string>> = {
  commonmark: 'all 652 examples of the CommonMark 0.31.2 spec',
  gfm: 'all 22 extension examples of the GFM 0.29.0.gfm.13 spec, run with the extensions the spec\'s tests use (table, autolink, tagfilter, strikethrough, tasklist)'
};

// The forum issue a trigger of a worker throw was reported as, and the note of a worker document it throws on.
interface WorkerFailureIssue {
  readonly issue: string;
  readonly note: string;
}

const WORKER_FAILURE_ISSUES: Readonly<Record<WorkerFailureTrigger, WorkerFailureIssue>> = {
  blankLinkDestination: {
    issue: 'issue-1',
    note: 'A property value that is a markdown link with an empty or blank destination makes the worker throw, so the note has no metadata at all.'
  },
  hasOwnPropertyKey: {
    issue: 'issue-2',
    note: 'A property named `hasOwnProperty`, at any depth, makes the worker throw, so the note has no metadata at all.'
  }
};

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
 * Builds the suites from the oracle files. A failing suite is its full suite filtered by the reading view's HTML, so
 * the two cannot drift apart.
 *
 * @param spec - The spec oracle.
 * @param probes - The quirk probe oracle.
 * @param worker - The metadata worker oracle.
 * @param forum - The forum issue oracle.
 * @param gfmReference - The `cmark-gfm` reference file.
 * @param editingModes - The editing mode oracle.
 * @returns The suites.
 */
export function buildTestCaseSuites(spec: SpecOracleFile, probes: QuirkProbeFile, worker: WorkerMetadataOracleFile, forum: ForumIssueFile, gfmReference: GfmReferenceFile, editingModes: EditingModesFile): TestCaseSuites {
  const specCases = buildSpecCases(spec);
  const departing = new Set(readingViewDifferences(spec));
  return {
    commonmark: buildSpecSuite(spec, specCases, 'commonmark', null),
    commonmarkFailing: buildSpecSuite(spec, specCases, 'commonmark', departing),
    commonmarkNoSpecFailing: buildNoSpecSuite(probes, 'commonmark', COMMONMARK_REFERENCE_IMPLEMENTATION, renderCommonMarkReference),
    editorVsReadingView: buildEditorVsReadingViewSuite(forum, editingModes),
    editorVsReadingViewAll: buildEditorAndReadingViewSuite(forum, editingModes),
    gfm: buildSpecSuite(spec, specCases, 'gfm', null),
    gfmFailing: buildSpecSuite(spec, specCases, 'gfm', departing),
    gfmNoSpecFailing: buildNoSpecSuite(probes, 'gfm', gfmReference.meta.implementation, (markdown) => gfmReferenceHtml(gfmReference, markdown)),
    metadata: buildMetadataSuite(worker),
    metadataFailing: buildMetadataFailingSuite(worker, forum)
  };
}

function buildEditorAndReadingViewSuite(forum: ForumIssueFile, editingModes: EditingModesFile): TestCaseSuite<EditorAndReadingViewCase> {
  const obsidianVersion = requireVersion(editingModes.meta.appVersion);
  const forumCases = EDITOR_VS_READING_VIEW_SAMPLES.map((sample): EditorAndReadingViewCase => {
    const read = forumRead(forum, sample.markdown);
    if (read.sourceModeHtml === undefined || read.livePreviewHtml === undefined) {
      throw new Error(`The forum issue oracle has no editing mode read of ${JSON.stringify(sample.markdown)}`);
    }
    return {
      id: sample.id,
      markdown: sample.markdown,
      metadata: read.metadata,
      obsidianLivePreviewHtml: read.livePreviewHtml,
      obsidianReadingViewHtml: read.html,
      obsidianSourceModeHtml: read.sourceModeHtml,
      obsidianVersion: requireVersion(forum.meta.appVersion),
      set: 'forum'
    };
  });
  const cases = [
    ...editingModes.reads.map((read): EditorAndReadingViewCase => ({
      id: read.id,
      markdown: read.markdown,
      metadata: read.metadata,
      obsidianLivePreviewHtml: read.livePreviewHtml,
      obsidianReadingViewHtml: read.html,
      obsidianSourceModeHtml: read.sourceModeHtml,
      obsidianVersion,
      set: read.set
    })),
    ...forumCases
  ];
  return {
    about: `Notes with all three of Obsidian's views of them, read from the live app: the first ${String(EDITING_MODES_PER_SET)} documents of each piece set of the generated corpus (\`set\` names it), the notes on which the mode judge found a new disagreement between the editor and Reading view (\`set: judged\`), and the forum issue samples (\`set: forum\`). \`obsidianSourceModeHtml\` and \`obsidianLivePreviewHtml\` are the inner HTML of the editor's \`.cm-content\` in the default theme, read once the DOM had stopped changing, so math had rendered, with the cursor on an empty line appended to the note so that Live Preview shows no source for the selection, and that line left out; \`obsidianReadingViewHtml\` is the reading view's HTML with \`strictLineBreaks: true\`, serialized as in the spec suites; \`metadata\` is the metadata worker's CachedMetadata. A test of a parser that serves all three can expect each, and the \`-failing\` file names the cases on which they disagree.`,
    cases,
    obsidianVersion
  };
}

function buildEditorVsReadingViewSuite(forum: ForumIssueFile, editingModes: EditingModesFile): TestCaseSuite<EditorVsReadingViewCase> {
  const obsidianVersion = requireVersion(forum.meta.appVersion);
  const judgedCases = JUDGED_SAMPLES.map((sample): EditorVsReadingViewCase => {
    const read = editingModes.reads.find((candidate) => candidate.id === sample.id && candidate.markdown === sample.markdown);
    if (read === undefined) {
      throw new Error(`The editing mode oracle has no read of ${sample.id}`);
    }
    return {
      differsIn: sample.differsIn,
      family: sample.family,
      id: sample.id,
      issue: JUDGED_SET,
      markdown: sample.markdown,
      metadata: read.metadata,
      note: sample.note,
      obsidianLivePreviewHtml: read.livePreviewHtml,
      obsidianReadingViewHtml: read.html,
      obsidianSourceModeHtml: read.sourceModeHtml,
      obsidianVersion: requireVersion(editingModes.meta.appVersion)
    };
  });
  const forumCases = EDITOR_VS_READING_VIEW_SAMPLES.map((sample): EditorVsReadingViewCase => {
    const read = forumRead(forum, sample.markdown);
    if (read.sourceModeHtml === undefined || read.livePreviewHtml === undefined) {
      throw new Error(`The forum issue oracle has no editing mode read of ${JSON.stringify(sample.markdown)}`);
    }
    return {
      differsIn: sample.differsIn,
      forumUrl: sample.forumUrl,
      id: sample.id,
      issue: sample.issue,
      markdown: sample.markdown,
      metadata: read.metadata,
      note: sample.note,
      obsidianLivePreviewHtml: read.livePreviewHtml,
      obsidianReadingViewHtml: read.html,
      obsidianSourceModeHtml: read.sourceModeHtml,
      obsidianVersion
    };
  });
  const cases = [...forumCases, ...judgedCases];
  return {
    about:
      'Notes that Obsidian\'s editor and its Reading view read differently, where by `editor` we mean `Source mode` or `Live Preview`: the samples of the issues reported on the Obsidian forum (`forumUrl`), and one note for each new kind of disagreement the mode judge found across the oracle corpora (`issue: judged`, with its `family`), each confirmed on the live editor\'s tree. Each case is under the same `id` in the `-all` file. Each case has all three as the user sees them: `obsidianSourceModeHtml` and `obsidianLivePreviewHtml` are the inner HTML of the editor\'s `.cm-content` in the default theme, read once math had rendered, with the cursor on an empty line appended to the note so that Live Preview shows no source for the selection, and that line left out; `obsidianReadingViewHtml` is the reading view\'s HTML with `strictLineBreaks: true`, serialized as in the spec suites. `metadata` is the metadata worker\'s CachedMetadata, which reads the note as Reading view does. `differsIn` lists the editing modes, `sourceMode` and `livePreview`, that disagree with Reading view, and `note` names the disagreement. A test of a parser that serves all three expects them to agree.',
    cases,
    obsidianVersion
  };
}

// The worker documents the worker threw on, each with the forum issue of its trigger, then the forum samples.
function buildMetadataFailingSuite(worker: WorkerMetadataOracleFile, forum: ForumIssueFile): TestCaseSuite<MetadataFailingCase> {
  const obsidianVersion = requireVersion(forum.meta.appVersion);
  const throws = buildMetadataSuite(worker).cases.filter((testCase) => testCase.metadata === null).map((testCase): MetadataFailingCase => {
    const failure = workerFailureOf(testCase.markdown, { obsidianVersion: requireVersion(worker.meta.appVersion) });
    if (failure === null) {
      throw new Error(`The worker threw on ${testCase.id}, and no known trigger explains it`);
    }
    const { issue, note } = WORKER_FAILURE_ISSUES[failure.trigger];
    return {
      forumUrl: forumUrlOf(issue),
      id: testCase.id,
      issue,
      markdown: testCase.markdown,
      metadata: testCase.metadata,
      note: `${note} No stand-in of this document was read, so it has no expected metadata; the samples of ${issue} carry it.`,
      obsidianVersion: testCase.obsidianVersion
    };
  });
  // A sample whose worker metadata is already what it should be is fixed in this release, as `hasOwnProperty` is in 1.15.1.
  const samples = METADATA_ISSUE_SAMPLES.flatMap((sample): MetadataFailingCase[] => {
    const { metadata } = forumRead(forum, sample.markdown);
    const standIn = sample.standIn === undefined ? null : forumRead(forum, sample.standIn).metadata;
    const expectedMetadata = sample.expectedOf?.(metadata, standIn);
    if (expectedMetadata !== undefined && JSON.stringify(expectedMetadata) === JSON.stringify(metadata)) {
      return [];
    }
    return [{
      ...(expectedMetadata !== undefined) && { expectedMetadata },
      forumUrl: sample.forumUrl,
      id: sample.id,
      issue: sample.issue,
      markdown: sample.markdown,
      metadata,
      note: sample.note,
      obsidianVersion
    }];
  });
  return {
    about: 'Notes whose metadata Obsidian\'s metadata worker drops or misplaces, each under the issue reported on the Obsidian forum (`issue`, `forumUrl`): first every document of the full file the worker threw on, under the same id, then the forum samples, `<issue>-<sample>`. `metadata` is the CachedMetadata the worker posted, as JSON with its key order, or null where it threw and the note lost all its metadata. `expectedMetadata`, where what the note should give is clear, is that metadata as it should be, built from the worker\'s own output as `note` says; it is absent where the right answer is the team\'s call, and on the full file\'s documents, for which no stand-in was read.',
    cases: [...throws, ...samples],
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

// A probe's id counts the probes of its quirk across both presets, so an id names the same probe whichever file it is in.
function buildNoSpecSuite(probes: QuirkProbeFile, preset: QuirkProbeRead['preset'], referenceImplementation: string, render: (markdown: string) => string): TestCaseSuite<NoSpecCase> {
  const obsidianVersion = requireVersion(probes.meta.appVersion);
  const countPerQuirk = new Map<string, number>();
  const cases: NoSpecCase[] = [];
  for (const probe of probes.probes) {
    const index = (countPerQuirk.get(probe.quirk) ?? 0) + 1;
    countPerQuirk.set(probe.quirk, index);
    if (probe.preset !== preset) {
      continue;
    }
    const note = QUIRK_NOTES[probe.quirk];
    if (note === undefined) {
      throw new Error(`No note for the quirk ${probe.quirk}`);
    }
    const referenceHtml = render(probe.markdown);
    if (isSameAsReference(probe.html, referenceHtml)) {
      continue;
    }
    cases.push({
      id: `${probe.quirk}-${String(index)}`,
      markdown: probe.markdown,
      metadataSections: probe.sections,
      note,
      obsidianReadingViewHtml: probe.html,
      obsidianVersion,
      quirk: probe.quirk,
      referenceHtml
    });
  }
  return {
    about: `${NO_SPEC_SUITE_ABOUT[preset]} \`referenceHtml\` is the HTML of ${referenceImplementation} (\`referenceImplementation\`), which passes ${NO_SPEC_REFERENCE_SPEC[preset]}, and \`obsidianReadingViewHtml\` the reading view's with \`strictLineBreaks: true\`, serialized as in the spec suites. A probe on which the two agree is left out. Compare them as the spec suites compare the reading view with the spec: put \`referenceHtml\` through a DOM, then drop whitespace between tags in both. \`quirk\` names the behaviour, \`note\` describes it, and \`metadataSections\` are the metadata worker's sections.`,
    cases,
    obsidianVersion,
    referenceImplementation
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
    const obsidianReadingViewHtml = read.htmlStrict;
    const softBreaksAsHard = read.html;
    const departures = departuresOf.get(exampleKey(read));
    return {
      commonMarkSpecHtml: read.specHtml,
      ...(departures !== undefined) && { departures },
      example: read.example,
      id: `${read.suite}-${String(read.example)}`,
      markdown: read.markdown,
      metadata: read.metadata,
      obsidianReadingViewHtml,
      ...(softBreaksAsHard !== obsidianReadingViewHtml) && { obsidianReadingViewHtmlSoftBreaksAsHard: softBreaksAsHard },
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
    : `The examples of ${SPEC_SUITE_NAMES[suite]} on which the reading view's HTML with \`strictLineBreaks: true\` (\`obsidianReadingViewHtml\`) differs from the spec's, each the same case as in the full file; an example whose only departure is \`soft line breaks are hard\` matches the spec there and is left out`;
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

function forumUrlOf(issue: string): string {
  const sample = METADATA_ISSUE_SAMPLES.find((candidate) => candidate.issue === issue);
  if (sample === undefined) {
    throw new Error(`No forum sample of ${issue}`);
  }
  return sample.forumUrl;
}

function requireVersion(version: null | string): string {
  if (version === null) {
    throw new Error('The oracle names no Obsidian version');
  }
  return version;
}
