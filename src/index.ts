/**
 * @file
 *
 * Entry point of the Obsidian-flavoured markdown parser: everything the narrower entry points in `src/entries/`
 * export, which [`docs/api.md`](../docs/api.md) lists.
 *
 * - `./editor`: {@link highlight} and {@link highlightLines} give the classes Obsidian's editor puts on every character
 *   and line, resumable from any line, {@link editorClassLanguage} hosts that tokenizer in CodeMirror 6, and
 *   {@link editorClasses} renders its classes the way the editor does.
 * - `./lezer`: {@link parse} gives the `@lezer/markdown` tree with the Obsidian syntax, and {@link obsidianMarkdown} is
 *   that syntax as `@lezer/markdown` extensions.
 * - `./mdast`: {@link parseMdast} gives the mdast tree with the Obsidian syntax, and {@link micromarkObsidianMarkdown}
 *   and {@link mdastObsidianMarkdown} are that syntax as micromark and `mdast-util-from-markdown` extensions.
 * - `./markdown-it`: {@link parseMarkdownIt} gives markdown-it tokens with the Obsidian syntax, and
 *   {@link markdownItObsidianSyntax} is that syntax as a markdown-it plugin.
 * - `./syntax`: what the three adapters share, {@link ObsidianNode}, {@link CONFORMANCE_CASES} and the options: a
 *   preset (`commonmark`, `gfm` or `obsidian`) with any of its flags overridden, Obsidian's quirks
 *   ({@link ObsidianQuirkFlags}) included.
 * - `./remark`: {@link parseRemark} parses as Obsidian's reading view and metadata worker do, and
 *   {@link renderRemarkHtml} renders that tree as `remark-html` does.
 * - `./metadata`: {@link parseMetadata} gives the `CachedMetadata` Obsidian's metadata worker posts for a document,
 *   equal to the worker's as JSON.
 */

export * from './entries/editor.ts';
export * from './entries/lezer.ts';
export * from './entries/markdown-it.ts';
export * from './entries/mdast.ts';
export * from './entries/metadata.ts';
export * from './entries/remark.ts';
export * from './entries/syntax.ts';
