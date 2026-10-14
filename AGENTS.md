# obsidian-markdown-parser

## L1. Status: PRIVATE

This repository is private. Do not make it public, publish it to npm, link it from any public place, or mention it in a public issue, PR, forum post or README of another project. Making it public needs the Obsidian team's permission first, and asking for it is the owner's call.

## L2. Goal

A single incremental markdown parser for Obsidian-flavoured markdown, built on [`@lezer/markdown`](https://github.com/lezer-parser/markdown), that could one day serve both Obsidian's editor and its reading view. The Obsidian founder named Lezer as the target and the two hard parts (2026-10-13):

- **Live parsing** of a changing document: efficiency, partial states and resume points.
- **CSS-class compatibility**: today's editor uses a CodeMirror 5 token grammar, and themes and custom CSS depend on the classes it emits. The new parser must reproduce those class tokens exactly, or every theme breaks.

**Beyond Lezer (owner, 2026-10-13): compatible with all modern markdown parsers.** The Obsidian syntax (wikilinks and embeds, tags, `%%` comments, math, callouts, block ids, highlights, inline footnotes, task markers) is defined once, with one conformance corpus measured against Obsidian, and shipped as an extension for each ecosystem: Lezer (`@lezer/markdown`, the primary target), micromark + mdast (current unified/remark), and markdown-it. Each adapter is checked against the same corpus. Only the Lezer target also carries the editor's class-token compatibility layer. Scope confirmed by the owner (2026-10-13): all three, in that order - Lezer first, then micromark/mdast, then markdown-it.

## L3. Method: measured against the live app, never copied from it

- Behaviour is matched by differential fuzzing against a real Obsidian instance driven over CDP: the editor's class-token spans (read through `@codemirror/language`) and the metadata worker's `CachedMetadata`.
- Obsidian's code is proprietary: never copy code from the app bundle into this repository. Reading it to learn behaviour is allowed for plugin development under Obsidian's Terms (Restrictions, item iii).
- This work is the owner's own, done in his own time and never billed under his contractor agreement. It is intended as a gift to the Obsidian team, handed over with a written assignment if they take it into the core.

## L4. Phases

0. Class-span oracle against the live editor; measure the gap between plain `@lezer/markdown` and today's tokens. Stop here if the CM5 tokenizer's quirks prove impractical to reproduce. **Done 2026-10-13: go, with a stateful mapping layer.** The numbers are in [`docs/phase-0.md`](docs/phase-0.md), and the harness is in `phase0/`: `oracle.mjs` reads the live editor's tree over CDP, `corpus.mjs` builds the documents, and `gap.mjs` scores a Lezer mapping against the oracle. The harness is plain `.mjs`, outside the TypeScript lint scope, because it is measurement tooling. Port it into `src/` or `scripts/` when Phase 1 makes it the test oracle.
1. Obsidian syntax extensions plus a class-compatibility layer, driven to 0 diffs on fuzzed documents.
2. `CachedMetadata` projection from the same tree, checked against the metadata worker.
3. A write-up for the team.
