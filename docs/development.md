# Development

How to build, check and measure the parser from a clone of this repository. What the packages export is in [api.md](api.md).

## Checks

`npm install`, then `npm run build:compile` (type check), `npm run lint`, `npm run format:check`, `npm run spellcheck`, `npm run lint:md` and `npm test`. CI runs the same steps on every push and pull request.

## Building the packages

`npm run build` compiles both packages: `@mnaoumov/obsidian-markdown-parser` into `dist/lib/`, with an entry point per part (`./editor`, `./lezer`, `./mdast`, `./markdown-it`, `./syntax`, `./remark`, `./metadata`), and `@mnaoumov/obsidian-markdown-parser-metadata` (`packages/metadata/`), the metadata projection and its remark engine without the editor or CodeMirror dependencies. `npm pack` and `npm pack --workspace packages/metadata` make the tarballs.

## Releasing

`npm run version -- <major|minor|patch|x.y.z>` bumps both packages to one version, settles `CHANGELOG.md`, commits, tags, pushes and creates the GitHub release. Publishing that release runs `.github/workflows/publish-npm.yml`, which builds and publishes both packages through npm trusted publishing.

## Measuring

- `npx jiti scripts/demo/cm6-bench.ts` measures the CodeMirror 6 host ([cm6-host.md](cm6-host.md)).
- `npx jiti scripts/demo/build-demo-plugin.ts` builds the demo plugin into `dist/demo-plugin/`; copy that folder into a test vault's `.obsidian/plugins/markdown-parser-demo/`. `npx jiti scripts/demo/demo-plugin-measure.ts` runs it on a real vault in an Obsidian instance it starts, and prints its reports ([demo-plugin.md](demo-plugin.md)). The demo plugin is never published.

## Oracles

Every claim about Obsidian is checked against readings of a running Obsidian, stored in `oracle/` ([oracles.md](oracles.md)).

- `npx jiti scripts/capture/oracle.ts --seed <n>` reads a new editor-class oracle from a live Obsidian. It needs a global `obsidian-integration-testing` install.
- `npx jiti scripts/oracles/oracle-diff.ts [--oracle <file>]` scores the tokenizer against an oracle; `--show <id>...` shows where documents differ.
- `npx jiti scripts/oracles/syntax-diff.ts` scores the Lezer tree against the oracles; `--construct <name> --examples <n>` shows where documents differ ([syntax.md](syntax.md)).
- `npx jiti scripts/oracles/adapter-diff.ts [--adapter markdown-it]` compares the mdast or markdown-it adapter with the Lezer tree, with the same options.
- `npx jiti scripts/capture/worker-oracle.ts` re-reads the worker oracle by running the metadata worker of an `obsidian-versions` checkout beside this repository ([metadata.md](metadata.md)).
- `npm run oracle:refresh -- [--obsidian-version <x.y.z|public-latest|catalyst-latest>]` re-reads every oracle from another Obsidian, writes them beside the pinned ones, and reports per oracle the readings that changed and whether the parser matches them. `npm run oracle:drift -- --to-version <version>` gives the same report for oracles already read.

Desktop oracles are pinned to Obsidian 1.15.1; the Android oracles are measured independently and remain on 1.14.4.

## Phase 0

The harness in `phase0/` stays only to reproduce [phase-0.md](phase-0.md): `node phase0/oracle.mjs 300`, then `node phase0/gap.mjs 6 tree|lines|state`.
