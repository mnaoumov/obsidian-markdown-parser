# obsidian-markdown-parser

**Private, experimental.** An incremental parser for Obsidian-flavoured markdown, built on `@lezer/markdown`, aiming to reproduce Obsidian's editor tokens and metadata exactly.

Unofficial: not affiliated with or endorsed by Obsidian. See [AGENTS.md](AGENTS.md) for status, goals and method.

## Development

The tooling follows the owner's TypeScript template: `npm install`, then `npm run build:compile` (type check), `npm run lint`, `npm run format:check`, `npm run spellcheck`, `npm run lint:md` and `npm test`. The package is `private` and has no build output or release step.

`highlight(text)` in `src/index.ts` gives the classes Obsidian's editor puts on every character and line, and `highlightLines` resumes from any line. How close it is, and how it works, is in [docs/phase-1.md](docs/phase-1.md). Third-party code it ports is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

To read a new oracle from a live Obsidian, run `npx jiti scripts/oracle.ts --seed <n>` (this needs a global `obsidian-integration-testing` install). To score the tokenizer against an oracle, run `npx jiti scripts/oracle-diff.ts [--oracle <file>]`, and add `--show <id>...` to see where documents differ.

The Phase 0 harness in `phase0/` stays only to reproduce [docs/phase-0.md](docs/phase-0.md): `node phase0/oracle.mjs 300`, then `node phase0/gap.mjs 6 tree|lines|state`.
