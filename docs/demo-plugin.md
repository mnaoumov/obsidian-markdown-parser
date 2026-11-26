# The demo plugin

`src/demo-plugin/` is a private Obsidian plugin that runs this parser inside the app, next to the stock editor and metadata worker. It is never published. First measured on 2026-10-22 against Obsidian 1.14.4. The editor's cost was re-measured on 2026-11-24 against 1.15.1.

## Running it

1. `npx jiti scripts/demo/build-demo-plugin.ts` writes `dist/demo-plugin/main.js` and `manifest.json` (`--watch` rebuilds on change).
2. Copy `dist/demo-plugin/` into a test vault as `.obsidian/plugins/markdown-parser-demo/` and enable **Markdown parser demo**.
3. Run its commands from the command palette:
   - **Toggle the editor language** swaps the parser in and out of every open editor. The status bar says `Markdown parser: on` or `off`.
   - **Compare the editor classes of the active note** / **of every note** parses each note with both languages and compares the trees.
   - **Compare the metadata of every note** compares `parseMetadata` with the metadata cache.
   - **Measure parse and keystroke cost on the active note** times a full parse and 50 keystrokes with each language.

Each command shows its report in a modal and keeps it on the plugin as `lastReport`.

`npx jiti scripts/demo/demo-plugin-measure.ts [--vault <dir>] [--lines <n>] [--obsidian-version <version>]` does all of that unattended. It starts an owned Obsidian instance through a global `obsidian-integration-testing` install. The instance runs the Obsidian version the oracles are pinned to (`PINNED_OBSIDIAN_VERSION` in `src/oracle/oracle-location.ts`) whichever version is installed, or the one `--obsidian-version` names, and the report's `appVersion` says which version ran. It copies a real vault's notes into its temporary vault, adds a note of `<n>` lines built from those notes (100,000 by default), installs the build, runs every command and prints the reports as JSON. The default vault is the `obsidian-community-vault` checkout beside this repository. Folders whose names start with `.` and `node_modules` folders are skipped.

## How the swap works

The plugin registers `Prec.highest(language)` as an editor extension. CodeMirror's `language` facet takes its first value, so every editor parses with this parser, and Obsidian's own code reads the tree: the class renderer, live preview, folding, the task checkbox, the callout and the code block's language flair. Turning it off empties the extension array and calls `workspace.updateOptions()`.

Two things had to change for that to work:

- **Obsidian renders classes from two node props of its own.** Its copy of `@codemirror/language` adds `lineClassNodeProp` and `tokenClassNodeProp`, which the public package does not have, and its renderer reads those, not the node names. With a tree whose node names matched the stock tree exactly, the editor showed plain text. `createEditorClassLanguage` now takes `lineClassNodeProperty` and `tokenClassNodeProperty`, and gives the node types of a language made with them the classes in those props, joined by spaces. The plugin passes the app's two props, and the app's `apiVersion` as `obsidianVersion`, so the language gives the classes of the release it runs in.
- **`StreamLanguage` merges tokens.** When a token follows one of the same type, the stock host extends that token rather than adding one (`mergeTokens`, on by default). The host now does the same, so `- [ ] task` has one `list-1` node after the checkbox, not two.

The build keeps `obsidian`, `electron`, the `@codemirror/*` packages the app provides (`@codemirror/streamparser` is not among them and is bundled), `@lezer/common`, `@lezer/highlight` and `@lezer/lr` external, because the parser must use the app's copies: its `Tree` and `NodeProp` are the ones the editor checks. CodeMirror 5's modes are bundled. `src/editor/sub-modes.ts` loads them with Node's `require` through `runmode.node.js`, and the build turns `node:module` into a table of the mode files and resolves every mode's `require` of the CodeMirror 5 library to `runmode.node.js`.

## What it compares

- **Classes.** For each note, both languages parse the text in a fresh `EditorState`, and the comparison reads both trees the way the oracle reads the live editor. `differing` lists the notes where a character's token classes or a line's line classes differ, the measure the oracle tests score by. `differingNodes` lists the notes whose trees differ node for node.
- **Lazy modes.** Obsidian loads a fenced block's CodeMirror 5 mode the first time a parse meets its language, and that first parse leaves the block plain. The comparison parses every note once with the stock language before it compares, then waits a second for the modes to load.
- **Metadata.** `parseMetadata(text)` against `metadataCache.getFileCache(file)`, compared as JSON values with key order ignored.
- **Cost.** A full parse is `ensureSyntaxTree` to the end of a fresh state, the median of 5. A keystroke is one transaction that inserts a character in the middle of the note in the live editor, together with the parse to the end of the viewport after it. That is the median and the slowest of 50 typed one after another, 16 ms apart: a test instance's window is hidden, and `requestAnimationFrame` hardly fires there. The characters are removed afterwards. Both languages are timed in the same editor, in source mode and in live preview.

## Results

One run of `npx jiti scripts/demo/demo-plugin-measure.ts --lines 100000` on 2026-10-22, Obsidian 1.14.4, on an AMD Ryzen 5 7500F. The vault is the 115 notes of `obsidian-community-vault` plus `long.md`, a note of 100,001 lines and 3,648,939 characters built by repeating them.

**The swap works.** With the parser on, the editor renders the same classes, and live preview draws the same widgets: the fold indicator on a heading, the task checkbox, the callout, and the code block's flair and language highlighting.

**Classes: 0 differences.** On all 116 notes, 282,354 stock nodes, every character and every line gets the same classes from both languages.

**Nodes: 0 differences.** The first run found 2 notes that differed: a code span left open inside a quote, where the parser's token was `inline-code_inline-code_quote_quote-1` and the stock one `inline-code_quote_quote-1`. The class sets were equal, but the two type names differed, so the tokens next to it did not merge and the text rendered as more spans than the stock editor's. With that, the classes a footnote label repeats and the tokens with an empty style fixed, a second run the same day gave 0 of 116 notes, and the eleven class oracles are exact node for node too.

**Metadata: 0 differences** on all 116 notes, `long.md` included, which took 646 ms in all. The first run left `long.md` out: `parseMetadata`'s peak memory then grew with the square of the note (360 MB at 25,000 lines, 2.5 GB at 100,000) and took the app down. The engine put eaten text back as `subvalue + value`, which the next slice flattened into a fresh copy of the rest of the note, and every node value sliced from that copy kept it alive. It now puts back the string it sliced from, and the peak in Node is 250 MB at 100,000 lines and grows with the note.

**Cost.** Re-measured on 2026-11-24 with Obsidian 1.15.1 (`--obsidian-version 1.15.1`), at `3642e25`, on the same machine with no other job running. Classes, nodes and metadata were again 0 differences on all 116 notes. Medians, in milliseconds, with the slowest keystroke in brackets:

| Note | Mode | Full parse, parser | Full parse, stock | Keystroke, parser | Keystroke, stock |
| :--- | :--- | -----------------: | ----------------: | ----------------: | ---------------: |
| 178 lines | source | 5.3 | 4.7 | 1.6 (4.1) | 3.0 (15.0) |
| 178 lines | live preview | 3.4 | 3.7 | 2.8 (3.9) | 3.4 (5.7) |
| 100,001 lines | source | 882 | 985 | 1.8 (5.4) | 2.8 (7.0) |
| 100,001 lines | live preview | 927 | 1,009 | 28.4 (44.6) | 26.0 (77.6) |

On the long note a full parse is 8 to 10% faster than the stock language's. On the short note the two are within a millisecond. A keystroke costs less than the stock one in source mode. In live preview on the long note it is about the same by median, and its slowest keystroke is lower. On 1.14.4, measured on 2026-10-22 on a machine running other jobs, a full parse was 14 to 17% faster, and the long note's live-preview keystroke was 25.3 ms against 26.1 ms.

The first run of the day gave a live-preview keystroke on the long note 87.9 ms against the stock 29.4 ms. A CPU profile of the keystrokes over CDP found two causes, both in how live preview reads the tree:

- **Live preview walks the whole tree on every change.** Its decoration field calls `iterate` on the tree with no range, on every transaction whose parse reaches 2,000 characters past the viewport within 20 ms. So the walk costs what the tree holds. In an editor `StreamLanguage` stops each parse at the end of the viewport, but the parser's re-parse took the chunks it reused after an edit on to the document's end. The walk covered 3.6 million characters where the stock one covered the 1.8 million up to the viewport, in the middle of the note. The reuse now stops at the end of the viewport, as the parse does ([the CodeMirror 6 host](cm6-host.md#incremental-reuse)), which brought the keystroke to 44 ms.
- **The walk splits every node's classes.** It builds `new Set(classes.split(' '))` from the token class prop of each node. V8 caches a split only for an internalized string, and the language made its class strings with `join`, so the same walk over the same 138,000 nodes took 39 ms on the parser's tree against 25 ms on the stock one. The language now internalizes them.

These are single runs, so the smallest times carry the most noise.

## The metadata against the worker

The demo plugin times `parseMetadata` but not the app's worker, which runs in a thread of its own. `npx jiti scripts/demo/metadata-bench.ts --worker <path to worker.js>... [--vault <dir>] [--lines <n>]... [--depth <n>]... [--size <n>]... [--runs <n>]` times both offline. It loads each named release's `worker.js` into a Node `vm` context, the way `scripts/capture/worker-oracle.ts` does, and runs the worker and `parseMetadata` on the same texts. It prints the median of `--runs` (3) after a warm-up, and says which workers gave the same `CachedMetadata`. Obsidian 1.15.1 added a format version, `v: 1`, to the metadata the worker posts. Apart from that field, the comparison covers the whole metadata, key order included. The texts are the vault's notes repeated to `--lines`, lists and quotes nested `--depth` deep, and `--size` unclosed emphasis openers, brackets, backtick runs, wikilinks on one line, and a footnote definition and a reference definition title ten times `--size` characters long.

One run on 2026-11-11, on an AMD Ryzen 5 7500F that other jobs held at 100% CPU, so the times are noisy. The workers are those of 1.14.5, 1.15.0 and 1.15.1, read from the `obsidian-versions` history.

| Text | Characters | `parseMetadata` | Worker 1.14.5 | Worker 1.15.0 | Worker 1.15.1 |
| :--- | ---------: | --------------: | ------------: | ------------: | ------------: |
| Vault notes, 10,000 lines | 374,468 | 196 ms | 2,768 ms | 1,488 ms | 311 ms |
| Vault notes, 100,000 lines | 3,648,939 | 7,307 ms | 8,262 ms | 6,823 ms | 321 ms |
| List nested 500 deep | 254,889 | 1,197 ms | 1,326 ms | 1,652 ms | 835 ms |
| List nested 600 deep | 365,889 | 1,465 ms | 1,949 ms | 2,001 ms | 1,525 ms |
| Quote nested 600 deep | 1,206 | 2.0 ms | 21.4 ms | 14.1 ms | 0.8 ms |
| 10,000 unclosed emphasis openers | 60,000 | 40,655 ms | 49,618 ms | 36,177 ms | 1,519 ms |
| 10,000 unclosed brackets | 30,000 | 5,366 ms | 4,937 ms | 4,105 ms | 2,368 ms |
| 10,000 unclosed backtick runs | 69,991 | 45.5 ms | 63.6 ms | 57.6 ms | 1.4 ms |
| 10,000 wikilinks on one line | 90,000 | 388 ms | 554 ms | 483 ms | 18.4 ms |
| Footnote definition of 100,000 characters | 100,023 | 7.4 ms | 27.8 ms | 25.0 ms | 7.9 ms |
| Reference definition title of 100,000 characters | 100,017 | 4.4 ms | 25.9 ms | 29.1 ms | 2.0 ms |

**The metadata is the same** from `parseMetadata` and all three workers, on every text. That includes lists nested past 512 levels and definitions longer than the 1,024 characters the worker scans for a footnote definition's end.

**1.15.1 changed the speed comparison.** `parseMetadata` was about as fast as the 1.14.5 and 1.15.0 workers, because it ports the same `remark-parse` 8, and it was faster on most texts, though not on the 100,000-line note, the unclosed emphasis openers or the unclosed brackets. The 1.15.1 worker, with the team's `remark` optimization, runs the 100,000-line note 23 times faster than `parseMetadata` and 10,000 unclosed emphasis openers 27 times faster. Both older workers and `parseMetadata` grow faster than the text on these two, and the 1.15.1 worker does not. The optimization was in the worker. The editor's figures above were re-measured on 1.15.1.

### After the engine's speed-ups

The engine was then made linear where it grew faster than the text, and cheaper per character. The scans that ran to the end of the text from every position, the unclosed emphasis and bracket scans and the inline locators, remember what they found per `tokenize` call (`TokenizeScope`, pinned against the parse without the memos by `src/remark/scan-memo.test.ts`). Each inline tokenizer names the characters it can start at, and each block tokenizer names where it can start by its first character and its first one after spaces and tabs (`BLOCK_STARTS`), so neither is tried elsewhere. Line offsets live in a typed array, an eat makes one closure, and the transforms after the parse walk the tree only when it holds a footnote or a block id. What was read in the 1.15.1 worker to learn its design is in [`provenance.md`](provenance.md).

The same bench on 2026-11-11, again on a machine other jobs held at 100% CPU, so the times swing by up to 3x from run to run and only the ratio within a row means much. `parseMetadata` and the worker each give the median of 5 runs, and the last column the ratio of their minimums over 31 interleaved runs (`parseMetadata`'s over the worker's), taken in a separate run.

| Text | Characters | `parseMetadata` | Worker 1.15.1 | Ratio of minimums |
| :--- | ---------: | --------------: | ------------: | ----------------: |
| Vault notes, 10,000 lines | 374,468 | 329 ms | 172 ms | 1.8 |
| Vault notes, 100,000 lines | 3,648,939 | 9,614 ms | 2,972 ms | 2.6 |
| List nested 500 deep | 254,889 | 2,328 ms | 4,107 ms | 0.44 |
| List nested 600 deep | 365,889 | 3,774 ms | 7,121 ms | 0.39 |
| Quote nested 600 deep | 1,206 | 1.0 ms | 4.8 ms | 1.8 |
| 10,000 unclosed emphasis openers | 60,000 | 208 ms | 7,867 ms | 0.015 |
| 10,000 unclosed brackets | 30,000 | 172 ms | 28,924 ms | below 0.01 |
| 10,000 unclosed backtick runs | 69,991 | 68.8 ms | 14.0 ms | 6.1 |
| 10,000 wikilinks on one line | 90,000 | 155 ms | 88.3 ms | 2.5 |
| Footnote definition of 100,000 characters | 100,023 | 49.7 ms | 80.1 ms | 1.6 |
| Reference definition title of 100,000 characters | 100,017 | 12.1 ms | 28.9 ms | 0.59 |

The metadata is still the same as the 1.15.1 worker's on every text. `parseMetadata` now grows with the text on every row and beats the worker on the nested lists, the unclosed emphasis openers and brackets, and the reference title. It is still slower on the vault notes, the backtick runs, the wikilinks, the nested quote and the long footnote, by 1.6 to 6 times. Its 10,000 brackets ran under a second in every run, where the worker's took about 29 s. A profile of the backtick runs alone gave 3.3 ms per parse at best, under 2 times the worker's best, so that row's 6.1 is partly the load. These rows need a run on an idle machine before any of them is quoted as settled.

### After the second round

Those five rows were then worked on, with the metadata unchanged. The engine changes:

1. A locator that finds the first of several markers (emphasis, strong, URLs) remembers each marker on its own and finds it with the engine's native string search. Before, it used one character-by-character scan for all of them.
2. The table's pipe search and the link's closing bracket search run once per `tokenize` call, through the call's memo (`TokenizeScope.indexOf`).
3. The block and inline tokenizer lists and their dispatch tables are built once per set of tokenizers and shared by every parse. Built per parse, they cost about half a millisecond each time.
4. A `tokenize` call keeps its state in one frame object that the parser's own methods read. Before, each call made a closure per helper.
5. An eat no longer compares the eaten text with the start of the value. That check read every eaten character a second time and cost about a fifth of a long note's parse. The 1.15.1 worker makes no such check.

The same bench on 2026-11-12, on the same machine, with other bulk jobs holding it at 25 to 75% CPU. `parseMetadata` and the worker each give the median of 5 runs. The last column is the ratio of their minimums over 31 interleaved runs (`parseMetadata`'s over the worker's). The five rows above were each measured in a process of their own, and the other rows in one process.

| Text | Characters | `parseMetadata` | Worker 1.15.1 | Ratio of minimums |
| :--- | ---------: | --------------: | ------------: | ----------------: |
| Vault notes, 10,000 lines | 374,468 | 97.8 ms | 231 ms | 1.4 |
| Vault notes, 100,000 lines | 3,648,939 | 1,743 ms | 1,594 ms | 1.8 |
| List nested 500 deep | 254,889 | 446 ms | 4,150 ms | 0.08 |
| List nested 600 deep | 365,889 | 1,159 ms | 7,558 ms | 0.06 |
| Quote nested 600 deep | 1,206 | 0.7 ms | 2.3 ms | 1.2 |
| 10,000 unclosed emphasis openers | 60,000 | 85.2 ms | 10,322 ms | below 0.01 |
| 10,000 unclosed brackets | 30,000 | 49.2 ms | 48,446 ms | below 0.01 |
| 10,000 unclosed backtick runs | 69,991 | 6.0 ms | 7.6 ms | 1.4 |
| 10,000 wikilinks on one line | 90,000 | 857 ms | 201 ms | 1.3 |
| Footnote definition of 100,000 characters | 100,023 | 1.7 ms | 62.6 ms | 0.22 |
| Reference definition title of 100,000 characters | 100,017 | 5.1 ms | 88.4 ms | 0.52 |

The metadata is still the same as the 1.15.1 worker's on every text. The long footnote now beats the worker. On the other four rows the gap narrowed:

1. The backtick runs went from 6.1 to 1.4.
2. The wikilinks went from 2.5 to 1.3.
3. The nested quote went from about 2 to 1.2.
4. The 10,000-line vault row went from 1.8 to 1.4.

The 100,000-line row gave between 1.3 and 1.8 in three runs. The wikilinks' median of 857 ms is the load: their minimums were 22.8 ms and 17.8 ms. These rows still need a run on an idle machine.

A list item's bullet is now read with one match instead of a replace callback, and its lines are split once instead of three times. Measured on 2026-11-12 under a heavier load, where a parse's wall time was about four times its CPU time, the 100,000-line vault row's minimum CPU time over 7 runs went from 421 to 499 ms before the change to 390 to 407 ms after it, in three alternating rounds each. Against the worker in the same process, the ratio of minimum CPU times was 1.07 and 1.24 in two runs. With the worker loaded in the process, `parseMetadata` took about a fifth more CPU time than without it, so part of the gap in the table above comes from sharing the heap with the worker rather than from the engine.

### On an idle machine

The same bench on 2026-11-24 at `243dd78`, on the same machine with no other job running. `parseMetadata` and the 1.15.1 worker each give the median of 5 runs. The last column is the ratio of their minimums over 31 interleaved runs (`parseMetadata`'s over the worker's), taken in a separate run. The 10,000 unclosed brackets row has no worker minimum, because the harness skips the worker there.

| Text | Characters | `parseMetadata` | Worker 1.15.1 | Ratio of minimums |
| :--- | ---------: | --------------: | ------------: | ----------------: |
| Vault notes, 10,000 lines | 374,468 | 28.4 ms | 28.4 ms | 1.36 |
| Vault notes, 100,000 lines | 3,648,939 | 293 ms | 256 ms | 1.30 |
| List nested 500 deep | 254,889 | 79.9 ms | 568 ms | 0.21 |
| List nested 600 deep | 365,889 | 129 ms | 1,182 ms | 0.19 |
| Quote nested 600 deep | 1,206 | 0.4 ms | 0.5 ms | 1.23 |
| 10,000 unclosed emphasis openers | 60,000 | 22.4 ms | 1,459 ms | 0.02 |
| 10,000 unclosed brackets | 30,000 | 14.9 ms | 2,427 ms | - |
| 10,000 unclosed backtick runs | 69,991 | 1.9 ms | 1.8 ms | 1.50 |
| 10,000 wikilinks on one line | 90,000 | 15.0 ms | 13.5 ms | 1.25 |
| Footnote definition of 100,000 characters | 100,023 | 3.2 ms | 4.6 ms | 0.22 |
| Reference definition title of 100,000 characters | 100,017 | 0.8 ms | 1.6 ms | 0.55 |

The metadata is the same as the 1.15.1 worker's on every text. On an idle machine every time is several times lower than under load, and the loaded runs above overstated both sides. `parseMetadata` still beats the worker on the nested lists, the unclosed emphasis openers and brackets, and both long definitions. It is still slower on the vault notes, the nested quote, the backtick runs and the wikilinks, by 1.2 to 1.5 times by minimum. The medians are closer: the 10,000-line note ties, and the 100,000-line note is 1.14 times the worker's. Timed by CPU time in a process of its own and then beside the worker, the 100,000-line note's `parseMetadata` runs were about the same (most runs 450 to 520 ms both ways), so the shared heap is not the cause of the remaining gap. Windows counts CPU time in 15.6 ms ticks, which is too coarse to settle it more finely.

### After the third round

The third round went after what a long note allocates, measured with V8's sampling heap profiler with inlining turned off, so that each byte is charged to the function that made it. Before it, 10 parses of the 10,000-line vault note allocated 404 MB. The changes:

1. Each `tokenize` call made a fresh scope, and with it the memo entries of every locator for every paragraph and heading. These entries were about a quarter of all the bytes. Now there is one scope per nesting depth, reused by every later call at that depth. An entry left by an earlier text is reset on its first use.
2. `eat.add(subvalue, node)` eats and adds a node in one step. `eat(subvalue)(node)` made a function in between, and it was about a tenth of the bytes. Every tokenizer whose node is made without eating more uses it. Those whose node holds children read after the eat, such as paragraphs, headings and emphasis, keep `eat(subvalue)(node)`.
3. A text run that merges into the text before it is not given a position of its own. A merged node's indent is extended in place, not copied.
4. The line starts and the blank lines are read by character code, not by a regular expression with a match array per line. A fenced code block's content is read a line at a time, not a character at a time.
5. A note with no lone surrogate and no byte order mark skips the UTF-8 round trip that reproduces the worker's decoding.

The same 10 parses now allocate 234 MB, 42% less. The metadata is unchanged: the tests, the worker oracle and `src/remark/scan-memo.test.ts` all pass.

Measured on 2026-11-25 with other bulk jobs holding the machine, so these are not idle-machine numbers. `parseMetadata` and the 1.15.1 worker each ran in a process of their own, alternately, three rounds each. The table gives the minimum per parse over the rounds, and the ratio is the range of the per-round ratios of minimums. The before column is the minimum of two runs of `parseMetadata` earlier the same day, before the changes.

| Text | Before: `parseMetadata` | After: `parseMetadata` | Worker 1.15.1 | Ratio after |
| :--- | ----------------------: | ---------------------: | ------------: | ----------: |
| Vault notes, 10,000 lines | 74.9 ms | 41.7 ms | 28.8 ms | 1.30 to 1.53 |
| 10,000 unclosed backtick runs | 1.25 ms | 1.30 ms | 0.90 ms | 1.27 to 1.44 |
| 10,000 wikilinks on one line | 13.3 ms | 11.9 ms | 10.2 ms | 1.05 to 1.17 |
| Quote nested 600 deep | 0.28 ms | 0.29 ms | 0.28 ms | 1.00 to 1.18 |

The vault note's minimum fell by about 40%, and the time spent in garbage collection fell from 19% to 15% of its CPU profile. The CPU time per parse, counted over all threads, stayed at about 60 ms, so under this load the gain shows in the best runs rather than in the average. The vault note and the backtick runs are still slower than the worker by minimum. The wikilinks and the nested quote are now within the noise of these runs. These rows still need a run on an idle machine.
