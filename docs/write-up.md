# A markdown parser for Obsidian: the write-up

A report for the Obsidian team on `obsidian-markdown-parser`: what it set out to do, what it does, measured against Obsidian 1.14.4, what it does not do yet, where its code comes from, and the terms it is offered on. Each section links the page that holds the details and the numbers.

The repository is private and nothing in it has been published.

## In short

- **The editor's classes are reproduced exactly.** All 46,508 documents of eleven fuzzed corpora get the live editor's class on every character and line. Swapped in as the editor's language inside Obsidian, the parser gives 0 class differences from the stock language on 116 notes, and live preview draws the same widgets.
- **Live parsing works for the editor.** The tokenizer resumes from any line outside a fenced block or a script or style element, and after an edit it takes the old tree back once its state matches the old parse. An edit at the start of a 100,000-line document re-parses to the end in under 1 ms. Inside Obsidian a full parse is 14 to 17% faster than the stock language's, and a keystroke costs the same as the stock one, in live preview too.
- **The metadata worker's `CachedMetadata` is reproduced exactly**, as JSON with key order, on every document measured: 3,255 run through the worker offline, the live app's metadata of all 674 spec examples, and 115 vault notes inside Obsidian.
- **The Obsidian syntax is defined once** and ships for `@lezer/markdown`, micromark with mdast, and markdown-it, each checked against one conformance corpus and the CommonMark 0.31.2 suite.
- **It is three engines, not the single Lezer parser asked for.** Each of Obsidian's three outputs comes from a different kind of parser today, and each engine here is that kind of parser. What one engine would take is costed below, and it turns on one question for the team.

## The goals

The goals came from the founder (2026-10-13):

1. **One incremental parser on `@lezer/markdown`** that could serve both the editor and the reading view.
2. **Live parsing** of a changing document: efficiency, partial states and resume points.
3. **CSS-class compatibility.** The editor's classes come from a CodeMirror 5 token grammar, and themes and custom CSS depend on them, so a new parser has to give the same classes or every theme breaks.

Four more were added on top of those:

1. **One definition of the Obsidian syntax**, with one conformance corpus measured against Obsidian, shipped for the three main JavaScript markdown ecosystems: Lezer first, then micromark and mdast, then markdown-it.
2. **CommonMark and GFM conformance** in each of them, with Obsidian's departures from the spec as options.
3. **The reading view's parse and the metadata worker's `CachedMetadata`** from the same work, checked against the worker.
4. **A way to keep up with Obsidian**: every claim pinned to one version, and one command to re-check it against the next.

## How it was measured

Nothing here is matched to a description of Obsidian's behaviour. It is matched to Obsidian itself, through oracles read from a running app ([oracles.md](oracles.md)):

- **The editor's classes**, read from the live editor's syntax tree over the Chrome DevTools Protocol, for fuzzed documents built from pieces of every construct.
- **The metadata worker's `CachedMetadata`**, read live, and offline by running the app's own `worker.js` on generated documents.
- **The reading view's DOM**, for every CommonMark and GFM spec example and 169 probes of where Obsidian departs from the spec.

All of them are pinned to Obsidian 1.14.5. The pin lives in one place, and `npm run oracle:refresh` re-reads every oracle from another version, then reports what changed and whether the parser still matches. Its first run re-read 1.14.4 itself: 0 of the documents both reads hold changed, so a change on a new version is that version's. Its run on the 1.15.0 insider build found two new rules for the editor's formatting marks and nothing else, and the tokenizer now takes the Obsidian version whose classes it gives. Its run on the public 1.14.5 found 0 changed readings, so the pin moved to it from 1.14.4.

## Results per goal

### 1. One Lezer parser for the editor and the reading view: partly

There are three engines ([architecture.md](architecture.md)):

| Engine | Gives | Exact against |
| --- | --- | --- |
| A port of the editor's CodeMirror 5 line tokenizer, hosted as a Lezer `Parser` | the editor's classes, as a CodeMirror 6 `Language` | the live editor |
| `@lezer/markdown` with the Obsidian syntax as extensions | the syntax tree, and the same syntax for micromark and markdown-it | the conformance corpus and the spec suites |
| A port of `remark-parse` 8 with Obsidian's edits to three of its block tokenizers | the reading view's parse and HTML, and `CachedMetadata` | the reading view and the metadata worker |

Each output is exact because it comes from the same kind of parser Obsidian uses for it. The classes are the artefacts of a stateful line tokenizer: inline styles with no lookahead that run across blocks, fences that ignore their container, list indentation numbered by history. Phase 0 measured how far a `@lezer/markdown` tree with a mapping gets towards them: 28.8% of documents exact, against 100% for the ported tokenizer ([phase-0.md](phase-0.md)). The reading view and the worker run `remark-parse` 8, whose block structure and inline algorithm differ from `@lezer/markdown`'s in places no extension point reaches.

So the realistic single-engine target is two Lezer parsers: the class tokenizer, which already is one, and one `@lezer/markdown` tree for everything else. Getting the metadata and the reading view from that tree means putting `remark-parse` 8's block structure and inline rules inside `@lezer/markdown`, unless today's reading of malformed input may change. That is the question for the team below.

### 2. Live parsing: yes for the editor, not yet for the metadata

The CodeMirror 6 host ([cm6-host.md](cm6-host.md)) parses in chunks that record the tokenizer state, resumes after an edit from the last chunk the edit cannot have changed, and reuses the old chunks after the edit once a line ends in a state equal to the old parse's at the same text. Measured with `scripts/cm6-bench.ts`:

| Lines | Full parse | Edit at the start, re-parse to the end |
| ---: | ---: | ---: |
| 10,000 | 49.9 ms | 0.95 ms |
| 100,000 | 172.2 ms | 1.29 ms |

Before the reuse, the second column was 19.8 ms and 100.6 ms, on texts read before the corpus gained its last three piece sets, which cost about half as much to parse in full. An edit that changes the state of every line after it, such as opening a fence, still costs a parse to the end. 9,900 random edits across all eleven corpora gave the same tree as a fresh parse.

Inside Obsidian, with the parser swapped in as the editor's language ([demo-plugin.md](demo-plugin.md)), on a 100,001-line note:

| Mode | Full parse, parser | Full parse, stock | Keystroke, parser | Keystroke, stock |
| --- | ---: | ---: | ---: | ---: |
| Source | 735 ms | 852 ms | 2.2 ms | 3.5 ms |
| Live preview | 727 ms | 877 ms | 25.3 ms | 26.1 ms |

Live preview walks the whole tree on every keystroke and splits every node's classes, so its keystroke follows the tree's length and how cheaply its class strings split. A first run gave 87.9 ms against 29.4 ms, until the re-parse stopped at the viewport, as the stock one does, and the class strings were internalized ([demo-plugin.md](demo-plugin.md#results)).

The metadata is not incremental: `parseMetadata` parses the whole note on every call. Its peak memory grows with the note's length: 250 MB of process memory for the 100,000-line note in Node, 82 MB of it the `remark-parse` tree.

### 3. CSS-class compatibility: yes

([phase-1.md](phase-1.md))

- **46,508 of 46,508 documents exact**, in eleven oracle corpora covering tables, HTML blocks, 30 fenced languages through their CodeMirror 5 modes, nested lists, markdown nested in markdown fences, code spans left open and highlight color markers.
- **Inside Obsidian, 0 class differences** on 116 notes and 282,354 stock nodes. Obsidian's renderer reads two node props of its own, which the language fills in when given them, so themes, live preview, folding, task checkboxes, callouts and code-block flair all work on the parser's tree.
- **The tree is identical node for node**, type names and merged tokens included, on all 46,508 documents and inside Obsidian on all 116 notes, so the same text renders as the same spans. On the spec examples, every tree whose classes match the editor's matches it node for node too.

### 4. One syntax for three ecosystems: yes

The syntax is defined once (`src/syntax/spec.ts`): internal links and embeds, tags, `%%` comments, math, highlights, footnotes with inline notes, block ids, callouts, task markers and front matter ([syntax.md](syntax.md)). Each adapter passes the whole conformance corpus. On the 29,596 documents of seven oracle corpora, compared with the Lezer tree node for node:

| Adapter | Same Obsidian nodes as the Lezer tree |
| --- | ---: |
| micromark and mdast | 28,551 of 29,596 |
| markdown-it | 28,681 of 29,596 |

None of the differences is a rule of the Obsidian syntax. Each is a place where two parsers' block structure reads the document differently, an unclosed block taking the document's last line break, which GFM table rules apply, and which list items may interrupt a lazy line, or where they pair a highlight's `==` across emphasis differently.

### 5. CommonMark and GFM: yes, with Obsidian's departures as options

Every adapter takes a preset (`commonmark`, `gfm`, `obsidian`) with any flag overridden ([spec-suites.md](spec-suites.md)):

| Adapter | CommonMark 0.31.2 | GFM extension examples |
| --- | ---: | ---: |
| `@lezer/markdown` | 651 of 652 | 21 of 22 |
| micromark | 652 of 652 | 21 of 22 |
| markdown-it | 652 of 652 | 13 of 22 |

The reading view departs from the spec on 211 of the 674 examples, each explained and pinned by a test. Eleven of the rules behind them are flags of `ObsidianQuirkFlags`, off in every preset: ten in every adapter, and list item continuation in micromark and markdown-it only, since `@lezer/markdown` keeps it internal. The rest are `remark-parse` 8's own inline algorithm and container handling, which no adapter's extension points reach, so they come from the fourth engine instead.

### 6. The reading view's parse: yes

The `remark-parse` 8 port gives the same tree, positions included, as npm `remark-parse` 8.0.3 with Obsidian's three tokenizers on 240,843 documents, and the reading view's HTML on every spec example in the quirk and syntax rows but five that the browser or the sanitizer changes after the parse, and on all 68 probes of the inline departures ([remark.md](remark.md)).

### 7. `CachedMetadata`: yes

`parseMetadata` gives the worker's whole `CachedMetadata`, equal as JSON with key order: headings, links and embeds, the markdown links the worker counts, tags, footnotes, reference definitions, list items, sections, block ids, and front matter, or `null` where the worker throws ([metadata.md](metadata.md)). It is pinned to 3,255 worker documents and the live app's metadata of all 674 spec examples, and outside the repository it gave 0 differences on 180,000 more fuzzed documents. Inside Obsidian it matched the metadata cache on all 116 notes, the 100,001-line note included, in 646 ms for all of them.

### 8. Keeping up with Obsidian: yes

`npm run oracle:refresh -- --obsidian-version <version>` reads every oracle from that version beside the pinned ones, and `npm run oracle:drift` reports per oracle the readings that changed and whether the parser matches them, then runs the conformance suites on the new files ([oracles.md](oracles.md)). Moving the pin to a new version means fixing what the report shows, then changing one constant and re-recording the scores that name the old files.

## Known gaps

Each is measured, and each has a test or a script that reproduces it.

### In the editor engine

- **25 of the 674 spec examples** differ in the editor's classes.

### In the metadata engine

- **`parseMetadata` is not incremental**, so it re-parses the whole note on every change.

### In the Lezer tree and the adapters

- **`@lezer/markdown` 1.8 differs from CommonMark 0.31.2 in seven examples.** Six are worked around here. Example 280, a list item that starts with a blank line, sits in its internal list continuation and cannot be. All seven are reported upstream as [lezer/markdown#70](https://code.haverbeke.berlin/lezer/markdown/issues/70), without naming this project.
- **The adapters differ from the Lezer tree on 1,045 and 915 of 29,596 documents**, block structure and the pairing of highlights across emphasis (goal 4).
- **With every flag on, each adapter matches the reading view on 34 of the 68 inline probes.** The other 34 are `remark-parse` 8's inline rules, which only the fourth engine has.
- **The editor and the worker read the syntax differently in 9 of the conformance corpus's cases**: a link holding a `]`, a run of three or more `=` and a `==` before `>` in a highlight, links and tags inside comments, an inline comment closing on its line, a `%%` line interrupting a paragraph, a footnote reference with no definition, and a footnote definition inside a quote ([remark.md](remark.md#where-the-worker-and-the-editor-differ)). The tree follows the editor and the metadata follows the worker.
- **List indentation beyond CommonMark's is not yet measured**: whether Obsidian nests a child indented by 2 or 3 spaces where CommonMark needs the content column, and the same with tabs.

### In the architecture

- **No `CachedMetadata` projection from the `@lezer/markdown` tree exists yet**, so the cost of a single engine is known on the spec examples and probes only. The next step is that projection, scored against the worker oracle with each differing document put down to its cause ([architecture.md](architecture.md#next-step)).

## Questions for the team

1. **How much of today's reading of malformed input has to stay exact?** If the reading view and the metadata may change where `remark-parse` 8's reading is an artefact rather than markdown, such as emphasis across a code span or a link inside a link, the single `@lezer/markdown` tree is within reach, with the flags the adapters already have. If they must stay exact, the `remark-parse` 8 engine is the cheaper way to keep them so.
2. **Which grammar of the syntax wins where the editor and the worker disagree?** Today a note can show a link in the editor that the metadata does not count. One parser for both would have to pick.
3. **What would the team want it measured against next**: a newer Obsidian, a larger real vault, mobile, or a theme set?

## Where the code comes from

([provenance.md](provenance.md), [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md))

- **No code of the Obsidian app is in the repository**, and none has ever been committed. The full history was checked for every file it ever added.
- **The app's code was read**, so this is not a clean room in the strict sense: the editor's mode and the CodeMirror 5 fork, for rules the class oracle could not settle, and `worker.js`, for which `remark-parse` tokenizers were edited, the plugin chain that adds the syntax and the walk to `CachedMetadata`. Every rule taken from it was written fresh and then measured against the running app. Each part's page says whether it was read.
- **Open-source code is ported under its license**: CodeMirror 5's `markdown` mode and HyperMD, `remark-parse` 8.0.3 and its helpers, and parts of micromark, markdown-it and `@lezer/markdown`, all MIT, with the CommonMark and GFM spec examples under CC-BY-SA 4.0.
- **The oracle files hold the app's output on documents the repository generated**: class names, `CachedMetadata` and rendered HTML. No code. The offline worker oracle loads `worker.js` from an Obsidian install at run time and keeps nothing of it.
- **It was written with AI coding tools**, under my direction.

## Terms

This is offered to Obsidian as a gift.

- **If the team takes it into the core**, I will sign a written assignment of my copyright in the repository at an agreed commit, with the third-party components left under their own licenses. A draft is ready.
- **Until then it stays private.** It is not published, packaged to a registry or mentioned anywhere public, and that changes only with the team's permission.
- **Access** is a GitHub invitation to the private repository, or an archive of it, whichever the team prefers.
- **Help with the hand-over** is part of the offer: walking through the code, moving the oracles to a new Obsidian, or measuring whatever the team asks.

## Running it

From a clone, with Node 22 or later:

```sh
npm install
npm test                    # every suite, the oracle checks included
npm run build               # both packages, into dist/lib/ and packages/metadata/dist/
```

- **The demo plugin**: `npx jiti scripts/build-demo-plugin.ts`, then copy `dist/demo-plugin/` into a test vault as `.obsidian/plugins/markdown-parser-demo/` and enable **Markdown parser demo**. Its commands swap the parser in and out of every editor, compare the classes and the metadata with the app's own, and time a full parse and 50 keystrokes ([demo-plugin.md](demo-plugin.md)).
- **The same, unattended on a vault**: `npx jiti scripts/demo-plugin-measure.ts [--vault <dir>] [--lines <n>]`.
- **The oracles against another Obsidian**: `npm run oracle:refresh -- --obsidian-version <version>` ([oracles.md](oracles.md)).
- **The editor's cost**: `npx jiti scripts/cm6-bench.ts [--lines <n>]`.
- **The packages and their entry points**: [api.md](api.md). `obsidian-markdown-parser-metadata` is the metadata alone, with four small dependencies and no editor.

The scripts that read a live Obsidian need `obsidian-integration-testing`, which launches the app in a throw-away profile and vault.
