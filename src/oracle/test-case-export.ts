/**
 * @file
 *
 * Turns the pinned oracle files into plain JSON test cases that can sit next to another project's tests: the spec
 * examples, the reading-view quirk probes and the metadata worker documents, each with the markdown and what Obsidian
 * gave for it. Every value is the spec's or Obsidian's own output, read by the oracle scripts: nothing of this
 * repository's parser goes into a case.
 */

import type { QuirkProbeFile } from './quirk-probes.ts';
import type { SpecOracleFile } from './spec-oracle-file.ts';
import type { SpecDifference } from './spec-quirks.ts';
import type { WorkerMetadataOracleFile } from './worker-metadata.ts';

import {
  exampleKey,
  readingViewDifferences,
  SPEC_DIFFERENCES,
  specDifferenceKeys
} from './spec-quirks.ts';

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
 * @returns The suites.
 */
export function buildTestCaseSuites(spec: SpecOracleFile, probes: QuirkProbeFile, worker: WorkerMetadataOracleFile): TestCaseSuites {
  const specCases = buildSpecCases(spec);
  const departing = new Set(readingViewDifferences(spec));
  return {
    commonmark: buildSpecSuite(spec, specCases, 'commonmark', null),
    commonmarkDepartures: buildSpecSuite(spec, specCases, 'commonmark', departing),
    gfm: buildSpecSuite(spec, specCases, 'gfm', null),
    gfmDepartures: buildSpecSuite(spec, specCases, 'gfm', departing),
    metadata: buildMetadataSuite(worker),
    quirks: buildQuirkSuite(probes)
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

function requireVersion(version: null | string): string {
  if (version === null) {
    throw new Error('The oracle names no Obsidian version');
  }
  return version;
}
