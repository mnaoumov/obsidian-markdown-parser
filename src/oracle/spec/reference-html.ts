/**
 * @file
 *
 * The HTML that a reference implementation, one that passes its whole spec suite, gives for a document the spec has no
 * example for: `commonmark.js`, the CommonMark reference implementation, for CommonMark, and `cmark-gfm`, the GFM
 * spec's own implementation, for GFM. `commonmark.js` runs here. `cmark-gfm` is C with no faithful JavaScript build, so
 * `scripts/capture/reference-oracle.ts` runs it once, through the Python `cmarkgfm` binding, into an oracle file.
 */

import {
  HtmlRenderer,
  Parser
} from 'commonmark';
import {
  parseFragment,
  serialize
} from 'parse5';

import { normalizeHtml } from '../render-html.ts';

/**
 * The `cmark-gfm` reference file: each document with the HTML `cmark-gfm` gives for it.
 */
export interface GfmReferenceFile {
  /**
   * The documents.
   */
  readonly documents: readonly GfmReferenceRead[];

  /**
   * How the documents were rendered.
   */
  readonly meta: GfmReferenceMeta;
}

/**
 * How the `cmark-gfm` reference file was rendered.
 */
export interface GfmReferenceMeta {
  /**
   * The `cmark-gfm` extensions turned on, the ones the GFM spec's tests run with.
   */
  readonly extensions: readonly string[];

  /**
   * The implementation, as `cmark-gfm@<the version it reports>`.
   */
  readonly implementation: string;

  /**
   * The binding that ran it, as `<package>@<version>`.
   */
  readonly via: string;
}

/**
 * A document with the HTML `cmark-gfm` gives for it.
 */
export interface GfmReferenceRead {
  /**
   * The HTML.
   */
  readonly html: string;

  /**
   * The document.
   */
  readonly markdown: string;
}

/**
 * The CommonMark reference implementation, as `<package>@<version>`; the version is the one that implements the
 * CommonMark 0.31.2 spec the export's spec cases come from.
 */
export const COMMONMARK_REFERENCE_IMPLEMENTATION = 'commonmark.js@0.31.2';

/**
 * The `cmark-gfm` release the GFM 0.29.0.gfm.13 spec belongs to.
 */
export const GFM_REFERENCE_VERSION = '0.29.0.gfm.13';

/**
 * The name of the `cmark-gfm` reference file in `oracle/`.
 */
export const GFM_REFERENCE_FILE_NAME = `reference-cmark-gfm-${GFM_REFERENCE_VERSION}.json`;

/**
 * Finds the HTML `cmark-gfm` gave for a document.
 *
 * @param file - The reference file.
 * @param markdown - The document.
 * @returns The HTML.
 */
export function gfmReferenceHtml(file: GfmReferenceFile, markdown: string): string {
  const read = file.documents.find((candidate) => candidate.markdown === markdown);
  if (read === undefined) {
    throw new Error(`The cmark-gfm reference file has no read of ${JSON.stringify(markdown)}; run scripts/capture/reference-oracle.ts`);
  }
  return read.html;
}

/**
 * Whether two HTML strings are the same document, compared as the spec cases compare the reading view with the spec:
 * the reference HTML is put through a DOM, as the oracle puts the spec's HTML through the app's, and both are
 * normalized. The reading view's HTML is a DOM's already.
 *
 * @param readingViewHtml - The reading view's HTML.
 * @param referenceHtml - The reference implementation's HTML.
 * @returns Whether they agree.
 */
export function isSameAsReference(readingViewHtml: string, referenceHtml: string): boolean {
  return normalizeHtml(readingViewHtml) === normalizeHtml(throughDom(referenceHtml));
}

/**
 * Renders a document with `commonmark.js`, with its default options, as the CommonMark spec's tests run it.
 *
 * @param markdown - The document.
 * @returns The HTML.
 */
export function renderCommonMarkReference(markdown: string): string {
  return new HtmlRenderer().render(new Parser().parse(markdown));
}

/**
 * HTML as a DOM serializes it once parsed as a fragment, by the HTML standard's algorithms. It gives the spec oracle's
 * `specDom` on every spec example but three: the app's Chromium keeps a `<?...>` processing instruction where the
 * standard reads a comment, and escapes `<` and `>` in an attribute value.
 *
 * @param html - The HTML.
 * @returns The serialized DOM.
 */
export function throughDom(html: string): string {
  return serialize(parseFragment(html));
}
