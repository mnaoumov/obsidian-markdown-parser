/**
 * @file
 *
 * The shape of a spec oracle file written by `scripts/spec-oracle.ts`.
 */

import type { OracleNode } from './oracle-file.ts';

/**
 * One spec example.
 */
export interface SpecOracleExample extends SpecOracleExampleSource {
  /**
   * The HTML the spec renders it to.
   */
  readonly html: string;
}

/**
 * Where a spec example comes from, and its markdown.
 */
export interface SpecOracleExampleSource {
  /**
   * The example number in its spec.
   */
  readonly example: number;

  /**
   * The example's markdown.
   */
  readonly markdown: string;

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
 * A spec oracle file.
 */
export interface SpecOracleFile {
  /**
   * The examples, as Obsidian read them.
   */
  readonly examples: readonly SpecOracleRead[];

  /**
   * Where the oracle was read.
   */
  readonly meta: SpecOracleMeta;
}

/**
 * Where a spec oracle was read.
 */
export interface SpecOracleMeta {
  /**
   * The Obsidian version, when the app reported one.
   */
  readonly appVersion: null | string;

  /**
   * The browser's user agent.
   */
  readonly userAgent: string;
}

/**
 * One spec example as Obsidian read it.
 */
export interface SpecOracleRead extends SpecOracleExampleSource {
  /**
   * The editor's tree, in pre-order, without the root.
   */
  readonly editorNodes: readonly OracleNode[];

  /**
   * The text the editor parsed, when it rewrote the example.
   */
  readonly editorText?: string;

  /**
   * The reading view's DOM with the app's default `strictLineBreaks: false`, without the copy button, the syntax
   * highlighting and the attributes the reading view adds.
   */
  readonly html: string;

  /**
   * The reading view's DOM with `strictLineBreaks: true`.
   */
  readonly htmlStrict: string;

  /**
   * The metadata worker's `CachedMetadata`.
   */
  readonly metadata: unknown;

  /**
   * The spec's HTML, put through the same DOM as `html`.
   */
  readonly specDom: string;

  /**
   * The HTML the spec renders the example to.
   */
  readonly specHtml: string;
}
