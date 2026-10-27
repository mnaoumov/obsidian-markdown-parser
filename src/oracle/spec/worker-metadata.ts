/**
 * @file
 *
 * The shape of the metadata worker oracle file `scripts/capture/worker-oracle.ts` writes: each document with the whole
 * `CachedMetadata` Obsidian's metadata worker posted for it.
 */

import type { CachedMetadata } from '../../metadata/types.ts';

/**
 * One document of the worker oracle, with the metadata the worker posted for it.
 */
export interface WorkerMetadataDocument {
  /**
   * The metadata, or `null` where the worker threw.
   */
  readonly metadata: CachedMetadata | null;

  /**
   * The piece set, `conformance` for a document of the conformance corpus, or `pinned` for one kept whole.
   */
  readonly set: string;

  /**
   * The document.
   */
  readonly text: string;
}

/**
 * The worker oracle file.
 */
export interface WorkerMetadataOracleFile {
  /**
   * The documents.
   */
  readonly docs: readonly WorkerMetadataDocument[];

  /**
   * How the oracle was read.
   */
  readonly meta: WorkerMetadataOracleMeta;
}

/**
 * How the worker oracle was read.
 */
export interface WorkerMetadataOracleMeta {
  /**
   * The Obsidian version whose worker was run.
   */
  readonly appVersion: string;

  /**
   * How many documents were built from each piece set.
   */
  readonly perSet: number;

  /**
   * The corpus seed.
   */
  readonly seed: number;
}
