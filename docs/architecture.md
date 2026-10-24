# Three engines, and what one would take

The goal in [AGENTS.md](../AGENTS.md) L2 is one incremental Lezer parser that could serve both Obsidian's editor and its reading view. This repository has three engines, not one. This page says why, what each one is measured against, and what a single Lezer engine would cost.

| Engine | Code | Gives | Matches |
| --- | --- | --- | --- |
| The class tokenizer | `src/editor/` | the classes the editor puts on every character and line (`highlight`, `editorClassLanguage`) | the live editor's class spans |
| The `@lezer/markdown` tree | `src/syntax/lezer.ts` | the Obsidian syntax as a Lezer tree (`parse`), and the same syntax as micromark and markdown-it extensions | the conformance corpus, the CommonMark and GFM suites, and the editor's classes construct by construct |
| The `remark-parse` 8 engine | `src/remark/`, `src/metadata/` | the reading view's parse and HTML (`parseRemark`, `renderRemarkHtml`) and the worker's `CachedMetadata` (`parseMetadata`) | the metadata worker and the reading view |

The micromark and markdown-it adapters are no engines of their own here: they read the syntax `src/syntax/spec.ts` defines, as the Lezer tree does, for the ecosystems that use those parsers.

Each engine is the parser Obsidian runs for that output today, or a port of it. The editor's classes come from a CodeMirror 5 line tokenizer, and the reading view and the metadata worker parse with `remark-parse` 8. So each output is exact because it comes from the same kind of parser as Obsidian's, and the three engines are the price of being exact on all three.

## Why the classes need a line tokenizer

The editor's classes are the output of a CodeMirror 5 mode, Obsidian's fork of the `markdown` mode inside HyperMD, which reads one line at a time and carries its state from line to line. Phase 0 measured how far a `@lezer/markdown` tree gets towards them ([phase-0.md](phase-0.md)):

| Approach | Exact documents |
| --- | ---: |
| A Lezer tree and a stateless mapping | 394 of 2,128 (18.5%) |
| Plus the editor's line-local block rules | 580 (27.3%) |
| Plus a 70-line inline state machine | 613 (28.8%) |
| The ported line tokenizer (phase 1) | 46,508 of 46,508, in eleven corpora |

What a tree cannot hold is the tokenizer's own behaviour:

- **No lookahead for inline styles.** An opener styles everything after it whether or not it ever closes, and the style rides across lines and blocks until a blank line. In CommonMark those delimiters are text.
- **Fences ignore their container.** A fence in a list item runs past the item, and a fence line in a quote opens an inline code state that lasts to the next blank line.
- **List indentation is numbered by history.** `hmd-list-indent-N` counts earlier siblings, not depth.
- **Unclosed `%%` and `$$` run past their block** in the editor, over blank lines, list items and the end of a quote ([syntax.md](syntax.md#measured-against-the-live-editor)).

A Lezer tree that reuses a block after an edit does not run its parser over it again, so state that crosses a block boundary breaks incremental parsing. A tree can only end such a span at the block boundary, which is what `src/syntax/lezer.ts` does.

The class layer is still a Lezer parser. `src/editor/language.ts` hosts the tokenizer as a Lezer `Parser` of its own, which CodeMirror 6 runs as a `Language`, with the editor's tree shape, resume points at every line and reuse after an edit ([cm6-host.md](cm6-host.md)). Inside Obsidian it gives 0 class differences from the stock language on a real vault ([demo-plugin.md](demo-plugin.md)). What it is not is a `@lezer/markdown` grammar, and nothing measured so far says one could produce the classes.

## Why the reading view and the worker need `remark-parse` 8

Obsidian's reading view and metadata worker parse with `remark-parse` 8 (`commonmark: true`), with Obsidian's edits to its `blockquote`, `list` and `table` tokenizers. The reading view differs from the CommonMark spec on 211 of its 674 examples ([spec-suites.md](spec-suites.md#the-differences)), and the differences fall into two kinds:

- **Block and syntax rules that an extension point reaches.** Setext headings, empty list items, loose lists, soft line breaks, character references, autolinks, HTML comments and blocks, link definitions and tables are a flag of each adapter, `ObsidianQuirkFlags`, off in every preset. `listItem` is one in micromark and markdown-it, but not in `@lezer/markdown`, which keeps list item continuation internal.
- **Rules no extension point reaches.** Emphasis (79 examples and GFM 631), links (19), code span runs, image descriptions, tabs, lazy quote lines and a paragraph's leading and trailing whitespace. Each adapter reads these with its own inline algorithm and its own container handling. With every flag on, each adapter gives the reading view on 34 of the 68 probes measured for them, and misses the other 34 ([spec-suites.md](spec-suites.md#measured-beyond-the-spec-examples)).

These are not separate rules Obsidian adds: they are how `remark-parse` 8 reads markdown. So the decision of 2026-10-14 ([spec-suites.md](spec-suites.md#where-these-come-from-and-the-decision)) was a fourth parser, a port of `remark-parse` 8 with the three edits, which has every one of them by construction. The alternative, an inline flag in each adapter, would have been three ports of one algorithm and would still have left out tabs, lazy quote lines and paragraph whitespace.

The worker also reads the Obsidian syntax by rules of its own. On the 47 cases of the conformance corpus, which follows the editor, it differs on 9: a run of three or more `=` and a `==` before `>`, links and tags inside comments, an inline comment closing on its line, a `%%` line interrupting a paragraph, a footnote reference with no definition, and a footnote definition inside a quote ([remark.md](remark.md#where-the-worker-and-the-editor-differ)). So the editor and the worker are two grammars of the syntax, and an engine has to pick one.

## What each engine is measured against

| Engine | Oracle | Result |
| --- | --- | --- |
| The class tokenizer | the live editor's class spans, `oracle/obsidian-1.14.5-seed-*.json` | exact on all 46,508 documents, and its CodeMirror 6 host's tree node for node; 0 class differences inside Obsidian on 116 notes |
| The `@lezer/markdown` tree | the conformance corpus; the CommonMark 0.31.2 suite with the `commonmark` preset; the editor's classes per construct (`scripts/syntax-diff.ts`) | every conformance case; 651 of 652 spec examples; the per-construct agreement in [syntax.md](syntax.md#measured-against-the-live-editor), where every difference is block structure, not a rule of the syntax |
| The micromark and markdown-it adapters | the same corpus and suites, and the Lezer tree (`scripts/adapter-diff.ts`) | every conformance case; 652 of 652 spec examples; the same Obsidian nodes as the Lezer tree on 28,551 and 28,681 of 29,596 documents |
| The `remark-parse` 8 engine | npm `remark-parse` 8.0.3 with Obsidian's three tokenizers; the reading view's HTML of the spec examples and 169 probes | the same tree, positions included, on 240,843 documents; the reading view's HTML on every `quirk` and `syntax` row of the spec but five examples the browser or the sanitizer changes after the parse |
| `parseMetadata` | the worker's own `worker.js`, run offline on 3,255 documents; the live app's metadata of all 674 spec examples | equal as JSON, key order included, on all of them; 0 differences inside Obsidian on 115 notes |

Every oracle is pinned to Obsidian 1.14.5 and re-read from a newer one with `npm run oracle:refresh` ([oracles.md](oracles.md)).

## What a single Lezer engine would take

A single engine would be one `@lezer/markdown` tree from which the metadata and the reading view's HTML are derived, as well as the editor's display. Its gain is real: the tree is incremental, so metadata could follow an edit instead of re-parsing the note, which `parseMetadata` does today on every call ([demo-plugin.md](demo-plugin.md#results)). The editor and the reading view would also read one structure.

The class layer would stay a second parser in any version of this. Phase 0 is the measurement: the classes are a tokenizer's artefacts, and the tokenizer is already a Lezer `Parser`. So the realistic single-engine target is two Lezer parsers, the class tokenizer and one `@lezer/markdown` tree for everything else, in place of today's tokenizer, tree and `remark-parse` 8 engine.

Deriving the worker's metadata and the reading view's HTML from the `@lezer/markdown` tree would need:

1. **The block structure of `remark-parse` 8 in `@lezer/markdown`.** List item continuation (`listItem`, example 280), pipe-less table rows that open a container, blocks that interrupt a table, tabs, lazy quote lines after an empty `>` line, and paragraph whitespace are all inside `@lezer/markdown`'s container handling, with no extension point. Each needs either a fork of `@lezer/markdown`'s block context or new extension points upstream.
2. **The inline algorithm of `remark-parse` 8.** Its emphasis rules, links inside links, link brackets matched before code spans and raw HTML, code span runs and reference label rules replace `@lezer/markdown`'s delimiter resolution. No inline parser hook changes that resolution, so it means an extension that reads a block's whole inline content itself, and then the inline half of the tree is a port of `remark-parse` 8's inline tokenizers rather than Lezer's.
3. **The worker's syntax rules, beside the editor's.** The tree follows the editor's grammar, but for an internal link's content, which it reads as the worker does ([syntax.md](syntax.md#inline-syntax-inside-an-internal-link)). The 9 conformance cases where the worker differs would need a second configuration of the syntax extensions, or a projection that re-reads those spots, so either the tree or the metadata gives up matching one of the two.
4. **The worker's walk, done on a Lezer tree.** The projection's rules carry over ([metadata.md](metadata.md#what-the-worker-does)): sections, heading text, markdown links whose destination is no URL, inline footnotes moved after the blocks, the task checkbox moving an item's end, and positions as `remark-parse` 8 reports them, a comment block's counting from the block's start among them.
5. **Rendering.** `renderLezerHtml` exists for the spec suites, but the reading view's HTML is `remark-html` 13's shape, with Obsidian's handlers for the syntax ([remark.md](remark.md#rendering)), and would be rebuilt over the tree.

Items 1 and 2 are most of the cost, and they are the reason the fourth parser was built: they amount to putting `remark-parse` 8 inside `@lezer/markdown`. Whether it is worth it turns on a question for the Obsidian team that phase 0 already raised: how much of today's behaviour on malformed input has to stay exact. If the reading view and the metadata may change where `remark-parse` 8's reading is an artefact rather than markdown, such as emphasis across a code span or a link inside a link, items 1 and 2 shrink to the flags the adapters already have, and the gap is the measured list above. If they must stay exact, the `remark-parse` 8 engine is the cheaper way to get there.

No projection from the `@lezer/markdown` tree has been measured yet, so the size of that gap is known only on the spec examples and probes, not on the worker's oracle.

## Next step

A prototype of the single-engine path, outside this page's scope: a `CachedMetadata` projection from the `@lezer/markdown` tree, with the `obsidian` preset and every quirk flag on, scored against the worker oracle (`oracle/worker-metadata-obsidian-1.14.5.json`) and the live app's metadata of the spec examples, with each differing document put down to one of the five items above. That turns the gap into numbers, which is what the team would need to choose between the two paths.
