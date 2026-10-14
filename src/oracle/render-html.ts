/**
 * @file
 *
 * Renders a document with each adapter and compares the HTML with the reading view's DOM, as the oracle tests do: tags
 * without their `/`, attributes in name order, link targets decoded, and text quotes and spaces as the DOM gives them.
 */

import { micromark } from 'micromark';
import { gfmAutolinkLiteralHtml } from 'micromark-extension-gfm-autolink-literal';
import { gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { gfmTableHtml } from 'micromark-extension-gfm-table';

import type {
  ObsidianQuirkFlags,
  ObsidianSyntaxOptions
} from '../syntax/options.ts';

import { parseWithLinkReferences } from '../syntax/lezer-commonmark.ts';
import { renderLezerHtml } from '../syntax/lezer-html.ts';
import { createObsidianParser } from '../syntax/lezer.ts';
import { createObsidianMarkdownIt } from '../syntax/markdown-it.ts';
import { micromarkQuirksHtml } from '../syntax/micromark-quirks.ts';
import { createMicromarkObsidianMarkdown } from '../syntax/micromark.ts';
import { resolveObsidianQuirks } from '../syntax/options.ts';

/**
 * A parser adapter.
 */
export type Adapter = 'lezer' | 'markdown-it' | 'micromark';

/**
 * The options of {@link htmlRenderer}: the syntax and the quirks.
 */
export type HtmlRendererOptions = ObsidianSyntaxOptions;

/**
 * Every adapter.
 */
export const ADAPTERS: readonly Adapter[] = ['lezer', 'markdown-it', 'micromark'];

// The quirks an adapter cannot express: its flag changes nothing there.
const NOT_EXPRESSIBLE: Readonly<Partial<Record<Adapter, readonly (keyof ObsidianQuirkFlags)[]>>> = {
  lezer: ['listItem']
};
const TAG_RE = /<(?<name>[a-z][\da-z]*)(?<attributes>(?:\s+[^\s/=>]+(?:="[^"]*")?)*)\s*\/?>/gu;
const TAG_PARTS_RE = /<(?<name>[a-z][\da-z]*)(?<attributes>(?:\s+[^\s/=>]+(?:="[^"]*")?)*)\s*\/?>/u;
const ATTRIBUTE_RE = /[^\s/=>]+(?:="[^"]*")?/gu;
const BETWEEN_TAGS_RE = />\s+</gu;
const TARGET_ATTRIBUTE_RE = /^(?<name>href|src)="(?<value>[^"]*)"$/u;

/**
 * Orders two keys.
 *
 * @param a - A key.
 * @param b - Another key.
 * @returns Their order.
 */
export function compareKeys(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * A renderer of documents to HTML, with an adapter and options.
 *
 * @param adapter - The adapter.
 * @param options - The syntax and the quirks.
 * @returns The renderer.
 */
export function htmlRenderer(adapter: Adapter, options: HtmlRendererOptions): (markdown: string) => string {
  switch (adapter) {
    case 'lezer': {
      const parser = createObsidianParser(options);
      return (markdown) => renderLezerHtml(markdown, parseWithLinkReferences(parser, markdown), resolveObsidianQuirks(options));
    }
    case 'markdown-it': {
      const md = createObsidianMarkdownIt(options);
      return (markdown) => md.render(markdown);
    }
    case 'micromark': {
      const extensions = createMicromarkObsidianMarkdown(options);
      return (markdown) => micromark(markdown, { allowDangerousHtml: true, extensions, htmlExtensions: [gfmTableHtml(), gfmStrikethroughHtml(), gfmAutolinkLiteralHtml(), micromarkQuirksHtml] });
    }
    default: {
      throw new Error('Unknown adapter');
    }
  }
}

/**
 * Whether an adapter can express a quirk: `@lezer/markdown` keeps list item continuation internal, so `listItem`
 * changes nothing there.
 *
 * @param adapter - The adapter.
 * @param quirk - The quirk.
 * @returns Whether its flag works in the adapter.
 */
export function isExpressible(adapter: Adapter, quirk: keyof ObsidianQuirkFlags): boolean {
  return NOT_EXPRESSIBLE[adapter]?.includes(quirk) !== true;
}

/**
 * HTML as the DOM serializes it: tags without their `/`, attributes in name order, and text quotes and spaces as such.
 * Link targets are decoded, as the oracle decodes them.
 *
 * @param html - The HTML.
 * @returns The normalized HTML.
 */
export function normalizeHtml(html: string): string {
  return html
    .replaceAll(TAG_RE, (tag) => normalizeTag(tag))
    .replaceAll('&quot;', '"')
    .replaceAll('&nbsp;', ' ')
    .replaceAll(BETWEEN_TAGS_RE, '><')
    .trim();
}

function decodeTarget(attribute: string): string {
  const groups = TARGET_ATTRIBUTE_RE.exec(attribute)?.groups;
  if (!groups) {
    return attribute;
  }
  try {
    return `${groups['name'] ?? ''}="${decodeURI(groups['value'] ?? '')}"`;
  } catch {
    // A target that is not valid percent-encoding is compared as it is, as the oracle compares it.
    return attribute;
  }
}

function normalizeTag(tag: string): string {
  const groups = TAG_PARTS_RE.exec(tag)?.groups;
  const attributes = (groups?.['attributes']?.match(ATTRIBUTE_RE) ?? []).map((attribute) => decodeTarget(attribute));
  return `<${[groups?.['name'] ?? '', ...attributes.toSorted(compareKeys)].join(' ')}>`;
}
