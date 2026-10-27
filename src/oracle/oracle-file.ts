/**
 * @file
 *
 * The shape of an oracle file written by `scripts/capture/oracle.ts`.
 */

/**
 * One document as the editor parsed it.
 */
export interface OracleDocument {
  /**
   * The corpus identifier.
   */
  readonly id: string;

  /**
   * The editor's tree, in pre-order, without the root.
   */
  readonly nodes: readonly OracleNode[];

  /**
   * The text given to the editor, when the editor rewrote it.
   */
  readonly original?: string;

  /**
   * The piece set.
   */
  readonly set: string;

  /**
   * The text the editor parsed.
   */
  readonly text: string;
}

/**
 * An oracle file.
 */
export interface OracleFile {
  /**
   * The documents.
   */
  readonly docs: readonly OracleDocument[];

  /**
   * Where and how the oracle was read.
   */
  readonly meta: OracleMeta;
}

/**
 * Where and how an oracle was read.
 */
export interface OracleMeta {
  /**
   * The Obsidian version, when the app reported one.
   */
  readonly appVersion: null | string;

  /**
   * How many documents were built from each piece set.
   */
  readonly perSet: number;

  /**
   * The corpus seed.
   */
  readonly seed: number;

  /**
   * The browser's user agent.
   */
  readonly userAgent: string;
}

/**
 * One node of the editor's syntax tree: its range, its depth below the root, and its classes joined by `_`.
 */
export type OracleNode = readonly [from: number, to: number, depth: number, name: string];
