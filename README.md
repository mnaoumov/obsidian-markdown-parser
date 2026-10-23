# obsidian-markdown-parser

**Private, experimental.** An incremental parser for Obsidian-flavoured markdown, built on `@lezer/markdown`, aiming to reproduce Obsidian's editor tokens and metadata exactly.

Unofficial: not affiliated with or endorsed by Obsidian. See [AGENTS.md](AGENTS.md) for status, goals and method.

The whole picture for the Obsidian team, with what each goal reached, the known gaps and the terms, is in [docs/write-up.md](docs/write-up.md).

It is three engines, not one: the editor's classes come from a ported CodeMirror 5 line tokenizer hosted as a Lezer parser, the Obsidian syntax tree from `@lezer/markdown`, and the reading view's parse and the metadata from a port of `remark-parse` 8. Why each output needs its engine, what each is measured against, and what a single Lezer engine would take are in [docs/architecture.md](docs/architecture.md).

## Development

The tooling follows the owner's TypeScript template: `npm install`, then `npm run build:compile` (type check), `npm run lint`, `npm run format:check`, `npm run spellcheck`, `npm run lint:md` and `npm test`.

`npm run build` compiles two installable packages, both `private` and never published: `obsidian-markdown-parser` into `dist/lib/`, with an entry point per part (`./editor`, `./lezer`, `./mdast`, `./markdown-it`, `./syntax`, `./remark`, `./metadata`), and `obsidian-markdown-parser-metadata` (`packages/metadata/`), the metadata projection and its remark engine without the editor or CodeMirror dependencies. `npm pack` and `npm pack --workspace packages/metadata` make the tarballs. The entry points, what each exports and the packages' dependencies are in [docs/api.md](docs/api.md).

`highlight(text)` in `src/index.ts` gives the classes Obsidian's editor puts on every character and line, and `highlightLines` resumes from any line. How close it is, and how it works, is in [docs/phase-1.md](docs/phase-1.md). Third-party code it ports is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

`editorClassLanguage` runs that tokenizer in CodeMirror 6, with the editor's tree shape and incremental re-parsing, and `editorClasses` renders its classes. How it works and what an edit costs are in [docs/cm6-host.md](docs/cm6-host.md); run `npx jiti scripts/cm6-bench.ts` to measure it.

A private demo plugin in `src/demo-plugin/` runs that language inside Obsidian in place of the stock one, and compares the editor classes and the metadata with the app's own. Build it with `npx jiti scripts/build-demo-plugin.ts`, which writes `dist/demo-plugin/`, and copy that folder into a test vault's `.obsidian/plugins/markdown-parser-demo/`. It is never published. `npx jiti scripts/demo-plugin-measure.ts` runs it on a real vault in an owned Obsidian instance and prints its reports. What it shows and the numbers are in [docs/demo-plugin.md](docs/demo-plugin.md).

`parse(text)` gives the `@lezer/markdown` tree with the Obsidian syntax: internal links, embeds, tags, `%%` comments, math, highlights, footnotes, block ids, callouts, task markers and front matter. The syntax, its conformance corpus and how the tree compares with the editor are in [docs/syntax.md](docs/syntax.md). To score the tree against the oracles, run `npx jiti scripts/syntax-diff.ts`, and add `--construct <name> --examples <n>` to see where documents differ.

`parseMdast(text)` gives the same syntax as an mdast tree, through the micromark extension `micromarkObsidianMarkdown` and the `mdast-util-from-markdown` extension `mdastObsidianMarkdown`. The mdast nodes and how the adapter compares with the Lezer tree are in [docs/syntax.md](docs/syntax.md#the-micromark-and-mdast-adapter). To compare the two on the oracles, run `npx jiti scripts/adapter-diff.ts`, with the same `--construct` and `--examples` options.

`parseMarkdownIt(text)` gives the same syntax as markdown-it tokens, through the markdown-it plugin `markdownItObsidianSyntax`, and `createObsidianMarkdownIt()` is a markdown-it configured with it, which also renders the syntax as HTML. The tokens and how they compare with the Lezer tree are in [docs/syntax.md](docs/syntax.md#the-markdown-it-plugin). To compare them on the oracles, run `npx jiti scripts/adapter-diff.ts --adapter markdown-it`.

Every adapter takes the same options: a preset (`commonmark`, `gfm` or `obsidian`, the default) with any of its flags turned on or off, as in `createObsidianParser({ preset: 'commonmark', tag: true })`, `createMicromarkObsidianMarkdown(options)` and `createObsidianMarkdownIt(options)`. With the `commonmark` preset each adapter is checked against the CommonMark 0.31.2 spec suite, and with `gfm` against the GFM spec's extension examples, both vendored in `spec/`. The results, the examples still failing and what each flag changes are in [docs/spec-suites.md](docs/spec-suites.md).

`parseRemark(text)` parses as Obsidian's reading view and metadata worker do, and `parseMetadata(text)` gives the `CachedMetadata` the metadata worker posts for a document, equal to it as JSON. The engine is in [docs/remark.md](docs/remark.md) and the projection in [docs/metadata.md](docs/metadata.md). To re-read the worker oracle, run `npx jiti scripts/worker-oracle.ts`, which runs the metadata worker of the `obsidian-versions` checkout beside this repository.

To read a new oracle from a live Obsidian, run `npx jiti scripts/oracle.ts --seed <n>` (this needs a global `obsidian-integration-testing` install). To score the tokenizer against an oracle, run `npx jiti scripts/oracle-diff.ts [--oracle <file>]`, and add `--show <id>...` to see where documents differ.

Every oracle is pinned to Obsidian 1.14.5. To re-read all of them from another Obsidian and see what changed, run `npm run oracle:refresh -- [--obsidian-version <x.y.z|public-latest|catalyst-latest>]`: it writes that version's oracles beside the pinned ones, then reports, per oracle, the readings that changed between the versions and whether the parser matches the new ones. `npm run oracle:drift -- --to-version <version>` gives the same report for oracles already read. How it works and the last run are in [docs/oracles.md](docs/oracles.md).

What is ported from open-source code, what was learned by reading Obsidian's code, what was only measured, and what the oracle files hold are in [docs/provenance.md](docs/provenance.md).

The Phase 0 harness in `phase0/` stays only to reproduce [docs/phase-0.md](docs/phase-0.md): `node phase0/oracle.mjs 300`, then `node phase0/gap.mjs 6 tree|lines|state`.
