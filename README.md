# obsidian-markdown-parser

**Private, experimental.** An incremental parser for Obsidian-flavoured markdown, built on `@lezer/markdown`, aiming to reproduce Obsidian's editor tokens and metadata exactly.

Unofficial: not affiliated with or endorsed by Obsidian. See [AGENTS.md](AGENTS.md) for status, goals and method.

## Development

The tooling follows the owner's TypeScript template: `npm install`, then `npm run build:compile` (type check), `npm run lint`, `npm run format:check`, `npm run spellcheck`, `npm run lint:md` and `npm test`. The package is `private` and has no build output or release step.
