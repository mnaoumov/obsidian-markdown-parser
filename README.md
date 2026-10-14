# obsidian-markdown-parser

**Private, experimental.** An incremental parser for Obsidian-flavoured markdown, built on `@lezer/markdown`, aiming to reproduce Obsidian's editor tokens and metadata exactly.

Unofficial: not affiliated with or endorsed by Obsidian. See [AGENTS.md](AGENTS.md) for status, goals and method.

## Development

The tooling follows the owner's TypeScript template: `npm install`, then `npm run build:compile` (type check), `npm run lint`, `npm run format:check`, `npm run spellcheck`, `npm run lint:md` and `npm test`. The package is `private` and has no build output or release step.

`highlight(text)` in `src/index.ts` gives the classes Obsidian's editor puts on every character and line, and `highlightLines` resumes from any line. How close it is, and how it works, is in [docs/phase-1.md](docs/phase-1.md). Third-party code it ports is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

`editorClassLanguage` runs that tokenizer in CodeMirror 6, with the editor's tree shape and incremental re-parsing, and `editorClasses` renders its classes. How it works and what an edit costs are in [docs/cm6-host.md](docs/cm6-host.md); run `npx jiti scripts/cm6-bench.ts` to measure it.

`parse(text)` gives the `@lezer/markdown` tree with the Obsidian syntax: internal links, embeds, tags, `%%` comments, math, highlights, footnotes, block ids, callouts, task markers and front matter. The syntax, its conformance corpus and how the tree compares with the editor are in [docs/syntax.md](docs/syntax.md). To score the tree against the oracles, run `npx jiti scripts/syntax-diff.ts`, and add `--construct <name> --examples <n>` to see where documents differ.

`parseMdast(text)` gives the same syntax as an mdast tree, through the micromark extension `micromarkObsidianMarkdown` and the `mdast-util-from-markdown` extension `mdastObsidianMarkdown`. The mdast nodes and how the adapter compares with the Lezer tree are in [docs/syntax.md](docs/syntax.md#the-micromark-and-mdast-adapter). To compare the two on the oracles, run `npx jiti scripts/adapter-diff.ts`, with the same `--construct` and `--examples` options.

`parseMarkdownIt(text)` gives the same syntax as markdown-it tokens, through the markdown-it plugin `markdownItObsidianSyntax`, and `createObsidianMarkdownIt()` is a markdown-it configured with it, which also renders the syntax as HTML. The tokens and how they compare with the Lezer tree are in [docs/syntax.md](docs/syntax.md#the-markdown-it-plugin). To compare them on the oracles, run `npx jiti scripts/adapter-diff.ts --adapter markdown-it`.

Every adapter takes the same options: a preset (`commonmark`, `gfm` or `obsidian`, the default) with any of its flags turned on or off, as in `createObsidianParser({ preset: 'commonmark', tag: true })`, `createMicromarkObsidianMarkdown(options)` and `createObsidianMarkdownIt(options)`. With the `commonmark` preset each adapter is checked against the CommonMark 0.31.2 spec suite, and with `gfm` against the GFM spec's extension examples, both vendored in `spec/`. The results, the examples still failing and what each flag changes are in [docs/spec-suites.md](docs/spec-suites.md).

To read a new oracle from a live Obsidian, run `npx jiti scripts/oracle.ts --seed <n>` (this needs a global `obsidian-integration-testing` install). To score the tokenizer against an oracle, run `npx jiti scripts/oracle-diff.ts [--oracle <file>]`, and add `--show <id>...` to see where documents differ.

The Phase 0 harness in `phase0/` stays only to reproduce [docs/phase-0.md](docs/phase-0.md): `node phase0/oracle.mjs 300`, then `node phase0/gap.mjs 6 tree|lines|state`.
