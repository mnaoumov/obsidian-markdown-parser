/**
 * @file
 *
 * The syntax entry point (`obsidian-markdown-parser/syntax`): what the `lezer`, `mdast` and `markdown-it` adapters
 * share, the node names, the options and the conformance corpus.
 *
 * - {@link ObsidianNode} names the syntax nodes, and {@link CONFORMANCE_CASES} is the corpus every adapter is checked
 *   against.
 * - {@link resolveObsidianSyntax} and {@link resolveObsidianQuirks} turn a preset (`commonmark`, `gfm` or `obsidian`)
 *   with any of its flags overridden into the flags each adapter reads.
 */

export type {
  ConformanceCase,
  OutlineEntry
} from '../syntax/conformance.ts';

export { CONFORMANCE_CASES } from '../syntax/conformance.ts';

export type {
  ObsidianQuirkFlags,
  ObsidianSyntaxFlags,
  ObsidianSyntaxOptions,
  ObsidianSyntaxPreset,
  ResolveObsidianQuirksOptions,
  ResolveObsidianSyntaxOptions
} from '../syntax/options.ts';

export {
  COMMONMARK_QUIRKS,
  OBSIDIAN_QUIRK_FLAGS,
  OBSIDIAN_QUIRKS,
  OBSIDIAN_SYNTAX_FLAGS,
  OBSIDIAN_SYNTAX_PRESETS,
  resolveObsidianQuirks,
  resolveObsidianSyntax
} from '../syntax/options.ts';

export type {
  ObsidianNodeName,
  TextRange
} from '../syntax/spec.ts';

export { ObsidianNode } from '../syntax/spec.ts';
