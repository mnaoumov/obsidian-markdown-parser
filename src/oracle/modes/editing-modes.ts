/**
 * @file
 *
 * The editing mode oracle, read from a live Obsidian by `scripts/modes/editing-modes-oracle.ts` into
 * `oracle/editing-modes-obsidian-<version>.json`: Source mode's, Live Preview's and the reading view's DOM, the editor's
 * tree and the metadata worker's `CachedMetadata` of a bounded sample of the class-span corpus and of the judged samples
 * (`mode-judge-samples.ts`), so a test of a parser that serves all three views has them side by side.
 */

import type {
  OracleFile,
  OracleNode
} from '../oracle-file.ts';
import type { SpecOracleMeta } from '../spec/spec-oracle-file.ts';

import {
  classOracleFileName,
  MAIN_CLASS_ORACLE_SEED,
  PINNED_OBSIDIAN_VERSION,
  PINNED_ORACLE_DIRECTORY,
  readOracleFile
} from '../oracle-location.ts';
import { JUDGED_SAMPLES } from './mode-judge-samples.ts';

/**
 * How many documents of each piece set of the main class-span oracle the sample takes: its first ones.
 */
export const EDITING_MODES_PER_SET = 40;

/**
 * The piece set of the judged samples.
 */
export const JUDGED_SET = 'judged';

/**
 * A document the oracle reads.
 */
export interface EditingModesDocument {
  /**
   * The id: the corpus id, or the judged sample's.
   */
  readonly id: string;

  /**
   * The note.
   */
  readonly markdown: string;

  /**
   * The piece set, or {@link JUDGED_SET}.
   */
  readonly set: string;
}

/**
 * The editing mode oracle file.
 */
export interface EditingModesFile {
  /**
   * Where the documents were read.
   */
  readonly meta: SpecOracleMeta;

  /**
   * Every document of {@link editingModesDocuments}, as Obsidian read it.
   */
  readonly reads: readonly EditingModesRead[];
}

/**
 * A document as Obsidian read it.
 */
export interface EditingModesRead extends EditingModesDocument {
  /**
   * The reading view's DOM with `strictLineBreaks: true`, normalized as `scripts/capture/spec-oracle.ts` normalizes it.
   */
  readonly html: string;

  /**
   * Live Preview's `.cm-content` inner HTML, read with the cursor on an empty line appended to the note, and that line
   * left out.
   */
  readonly livePreviewHtml: string;

  /**
   * The metadata worker's `CachedMetadata`, or `null` where the worker threw.
   */
  readonly metadata: unknown;

  /**
   * The editor's tree, in pre-order, without the root, as `scripts/capture/oracle.ts` reads it.
   */
  readonly nodes: readonly OracleNode[];

  /**
   * Source mode's `.cm-content` inner HTML, read as {@link livePreviewHtml} is.
   */
  readonly sourceModeHtml: string;
}

/**
 * Every document the oracle reads: the first {@link EDITING_MODES_PER_SET} of each piece set of the main class-span
 * oracle, then the judged samples. The corpus is the pinned version's, whichever version the oracle is read from, so
 * a re-read of this oracle alone needs no class-span oracle of its version.
 *
 * @returns The documents.
 */
export function editingModesDocuments(): EditingModesDocument[] {
  const corpus = readOracleFile(classOracleFileName(MAIN_CLASS_ORACLE_SEED, PINNED_OBSIDIAN_VERSION), PINNED_ORACLE_DIRECTORY) as OracleFile;
  const countPerSet = new Map<string, number>();
  const documents: EditingModesDocument[] = [];
  for (const document of corpus.docs) {
    const count = countPerSet.get(document.set) ?? 0;
    if (count >= EDITING_MODES_PER_SET) {
      continue;
    }
    countPerSet.set(document.set, count + 1);
    documents.push({ id: document.id, markdown: document.text, set: document.set });
  }
  for (const sample of JUDGED_SAMPLES) {
    documents.push({ id: sample.id, markdown: sample.markdown, set: JUDGED_SET });
  }
  return documents;
}
