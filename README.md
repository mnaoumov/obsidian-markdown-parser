# obsidian-markdown-parser

**Private, experimental.** An incremental parser for Obsidian-flavoured markdown, built on `@lezer/markdown`, aiming to reproduce Obsidian's editor tokens and metadata exactly.

Unofficial: not affiliated with or endorsed by Obsidian. See [AGENTS.md](AGENTS.md) for status, goals and method.

## Development

The tooling follows the owner's TypeScript template: `npm install`, then `npm run build:compile` (type check), `npm run lint`, `npm run format:check`, `npm run spellcheck`, `npm run lint:md` and `npm test`. The package is `private` and has no build output or release step.

The Phase 0 measurement harness lives in `phase0/`, and its report is [docs/phase-0.md](docs/phase-0.md). To run it, use `node phase0/oracle.mjs 300` (this needs a global `obsidian-integration-testing` install), then `node phase0/gap.mjs 6 tree|lines|state`.
