# CHANGELOG

## 1.0.0

The first release. A parser for Obsidian-flavoured markdown that gives the same answers as Obsidian 1.15.1, in two npm packages under the MIT License.

### New

- **Editor classes:** the CSS classes Obsidian's editor puts on every character, from a port of its CodeMirror 5 tokenizer, hosted as a CodeMirror 6 language that re-parses incrementally after an edit.
- **Syntax tree:** wikilinks, embeds, tags, comments, math, highlights, footnotes, block ids and callouts as one syntax, shipped as `@lezer/markdown` extensions, a micromark extension with mdast nodes, and a markdown-it plugin, each with `commonmark`, `gfm` and `obsidian` presets.
- **Reading view:** the mdast tree and HTML of Obsidian's reading view, from a port of `remark-parse` 8 with Obsidian's edits.
- **Metadata:** `parseMetadata` gives the `CachedMetadata` Obsidian's metadata worker posts for a note: headings, links, embeds, tags, footnotes, list items, sections, block ids and front matter.
- **Metadata package:** `@mnaoumov/obsidian-markdown-parser-metadata` carries the metadata projection and its remark engine alone, without the editor or CodeMirror dependencies.

Install with `npm install @mnaoumov/obsidian-markdown-parser`, or `npm install @mnaoumov/obsidian-markdown-parser-metadata` for the metadata alone.
