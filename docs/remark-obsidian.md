# Prior art: `@quartz-community/remark-obsidian`

[`@quartz-community/remark-obsidian`](https://github.com/quartz-community/remark-obsidian) (MIT, npm 2.2.1 on 2026-11-09) is a remark plugin for Obsidian-flavoured markdown, written for the Quartz static site generator. It is prior art for this repository's micromark and mdast target (`src/syntax/unified/`) and for its `remark-parse` 8 engine (`src/remark/`):

1. It reads wikilinks and embeds, highlights, `%%` comments, tags, callouts, inline footnotes, custom task characters and math, as mdast nodes. It has no Lezer tree and no editor class layer.
2. Its default reader is a "legacy" one built on a vendored `remark-parse` 8.0.3, with `remark-footnotes` 2, `remark-math` 3 and `parse-entities` 2 (`src/rp8/vendor/`), the parser Obsidian's reading view and metadata worker run. `test/rp8-vendored.test.ts` requires the vendored copy to give byte-identical trees to the published packages. A `strict` preset reads with micromark instead. This repository ported the same `remark-parse` 8.0.3 independently in `src/remark/` on 2026-10-14 ([remark.md](remark.md)).
3. Its `test/parity/` harness measures the plugin against a live Obsidian, with recorded answers in `test/parity/referee-answers/` and golden files in `test/parity/goldens/`. So many of its test expectations are already measurements of Obsidian, which its test titles say ("like Obsidian", "as Obsidian does").

Its author offered the test sets for this work (2026-10-14).

## The imported inputs

`src/oracle/remark-obsidian/cases.ts` holds the markdown inputs of its `test/remark-obsidian.test.ts` and `test/collect.test.ts` at commit `571e898` (2026-11-09, version 2.2.1), with the package's MIT notice and the test each input came from. `scripts/oracles/import-remark-obsidian.ts --source <checkout>` makes it again from a checkout of that repository. It reads the test files with the TypeScript compiler API and never runs them. An input is a constant first argument of a test helper that takes the markdown (`parse`, `processWithGfm`, `shape`, `links`, ...): a string, a joined array of strings, a `.repeat`, or a `const` or `for ... of` variable bound to one of these.

The import gives 445 distinct inputs: 432 from `remark-obsidian.test.ts` and 13 from `collect.test.ts`. 12 of them use CRLF line endings. 20 come from a test that passes the plugin options, such as the `strict` preset or `customTaskChars`, which Obsidian has no counterpart of. 53 arguments were not constants, such as markdown built in a loop or read from a fixture, and were skipped.

The `test/parity/` corpora were not imported. They are that harness's own measurements of Obsidian, kept in that repository's formats, and the worker oracle here reads Obsidian directly.

## Measured against Obsidian

`scripts/capture/worker-oracle.ts` runs Obsidian 1.15.0's metadata worker on every imported input, as the set `remark-obsidian` of `oracle/worker-metadata-obsidian-1.15.0.json`. The worker parses all 445 without throwing. `parseMetadata` gives the worker's whole `CachedMetadata` on every one of them, and `src/oracle/spec/worker-metadata.test.ts` keeps it that way, so the inputs found no difference in the projection.

The package's expected output and Obsidian's were compared by hand for the inputs the metadata settles: wikilinks and embeds (path, heading, alias, escaped pipes, whitespace trimming, a `[[` inside a target, a doubled bracket in an alias), tags (`#123`, a tag ended by the next `#`, a tag after an inline construct), and what `collectWikilinks` and `collectEmbedPaths` collect. All of them agree. The inputs about block structure and HTML, such as callouts, setext headings and code spans, were not compared one by one. The package's assertions on those are about its own mdast shape, which no Obsidian surface reports in the same form.

## List indentation

The same chat (2026-10-14) said that two or three spaces of indentation are valid nearly everywhere in Obsidian, though CommonMark counts them as one. The worker oracle now pins the shapes below, and the live editor and reading view of Obsidian 1.15.0 were read for them on 2026-11-10. `src/editor/list-indentation.test.ts` pins the editor's list depths. On desktop 1.15.0, Obsidian follows CommonMark's content column for these shapes, and the worker, the editor and the reading view agree on every one:

| Markdown | CommonMark | Worker `listItems` | Editor | Reading view |
| --- | --- | --- | --- | --- |
| `1. a` / `- b` (2 spaces) | Two lists, not nested | Two lists, `b` at the root | Both lines at depth 1 | `<ol>` then `<ul>` |
| `1. a` / `- b` (3 spaces) | Nested | Nested | Depth 2 | Nested |
| `1. a` / tab `- b` | Nested | Nested | Depth 2 | Nested |
| `- a` / `- b` (1 space) | Siblings | Siblings | Both at depth 1 | Siblings |
| `- a` / `- b` (3, 4 or 5 spaces) | Nested | Nested | Depth 2 | Nested |
| `- a` / tab `- b` | Nested | Nested | Depth 2 | Nested |
| `10. a` / `- b` (3 spaces) | Two lists, not nested | Two lists, `b` at the root | Both at depth 1 | `<ol start="10">` then `<ul>` |
| `10. a` / `- b` (4 spaces) | Nested | Nested | Depth 2 | Nested |
| `10. a` / tab `- b` | Nested | Nested | Depth 2 | Nested |
| `- a`, a blank line, `- b` or `- b` | Nested, loose | Nested | Depth 2 | Nested, `a` in a `<p>` |

So none of these shapes changes the tree away from CommonMark. The one oddity is a position: the worker starts a nested `- b` item at column 2 whether its marker is indented 3, 4 or 5 spaces, so its `position.start` is not where the marker is. `parseMetadata` already reproduces this. The tab shapes overlap with the list issues of `obsidian-test-mocks`' metadata parser, which runs on its own engine.
