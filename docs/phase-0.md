# Phase 0: class-span oracle and the gap to plain `@lezer/markdown`

Measured on 2026-10-13 against Obsidian 1.14.4 (installer 1.14.4, Electron 43.7.7), on a harness-owned instance driven over CDP.

## Verdict

**Go, with a stateful mapping layer.** Phase 1 is three parts, not one:

1. A Lezer block grammar with the editor's own block rules.
2. Obsidian syntax extensions.
3. A resumable, line-by-line inline-state pass that writes the classes a tree cannot express.

A tree plus a stateless mapping cannot reach exact compatibility. The largest residual is inline state that crosses block boundaries. Nothing measured is impossible to reproduce, and the state that is needed resets at blank lines, so it fits incremental parsing.

## How it was measured

- **Oracle** ([`phase0/oracle.mjs`](../phase0/oracle.mjs)). The script opens each document in the editor, in Source mode and in Live Preview, and walks `syntaxTree(state)` from `@codemirror/language`. A throw-away plugin in the temp vault reaches that module through the module map Obsidian gives plugins. The editor's tree is flat: a node spanning a whole line carries the **line classes** (rendered on `.cm-line`, all `HyperMD-*`), and its children carry the **token classes** (rendered as `cm-<token>`). A node's name is its classes joined by `_`. Nothing was copied from the app: the oracle only reads the tree the editor exposes.
- **Corpus** ([`phase0/corpus.mjs`](../phase0/corpus.mjs)). 2,128 documents: 28 hand-written cases for Obsidian syntax, and 300 fuzzed documents from each of 7 piece sets (`emph`, `gap`, `inline`, `obsidian`, `ord`, `quote`, `rich`). Each fuzzed document is 1 to 6 line fragments, with frontmatter added to one in 8. The piece sets come from the earlier metadata-parser fuzzing.
- **Gap** ([`phase0/gap.mjs`](../phase0/gap.mjs)). It parses the same text with `@lezer/markdown` and GFM, maps node types to the nearest classes, and scores the prediction per character (token classes) and per line (line classes). It runs in three stages:
  - `tree`: a stateless mapping from each node and its ancestors.
  - `lines`: adds the editor's block rules that one line and its tree context decide.
  - `state`: adds a prototype one-pass inline state machine of about 70 lines.
- **Plain subset.** 807 of the 2,128 documents use no extension token and no sub-language token. They isolate mapping and line-state effects from syntax that plain Lezer does not parse at all. Documents with task markers fall outside this subset, because `meta` and `property` also come from YAML.

Reproduce it with `node phase0/oracle.mjs 300`, then `node phase0/gap.mjs 6 tree|lines|state`. To see one document's disagreements line by line, run `STAGE=state node phase0/gap.mjs show <docId>`.

## Results

### Exact documents (every class on every character and line)

| Stage | Plain subset (807) | All documents (2,128) |
| --- | ---: | ---: |
| `tree` (stateless) | 346 (42.9%) | 394 (18.5%) |
| `lines` (+ line-local block rules) | 515 (63.8%) | 580 (27.3%) |
| `state` (+ inline state prototype) | 547 (67.8%) | 613 (28.8%) |

The all-documents column stays low because the extension and sub-language tokens below are not modelled at all.

### Tokens: 162 distinct classes seen

- **Map cleanly from the plain tree (23, F1 of 0.99 or more on the plain subset):** `escape`, `formatting-escape`, `hmd-escape-backslash`, `hmd-escape-char`, `strikethrough`, `formatting-strikethrough`, `link`, `formatting-link`, `url`, `comment` (HTML comments), `header-6`, `formatting-header-6`, `HyperMD-header-6`, `HyperMD-header-2`, `formatting-header-2`, `HyperMD-header-line`, `HyperMD-header-line-1`, `HyperMD-header-line-2`, `HyperMD-list-line-4`, `HyperMD-list-line-5`, `hmd-list-indent-4`, `HyperMD-table-row-2`, `HyperMD-table-row-3`.
- **Clean once the editor's line-local rules are applied (14):** all `formatting-quote*`, `quote-3`, `HyperMD-quote-3`, `strong`, `formatting-strong`, `formatting-em`, `list-3`, `HyperMD-list-line-3`, `hmd-list-indent-3`, `trailing-space-a`, `trailing-space-new-line`.
- **Still off after all three stages (50 plain-markdown classes), with F1 for `tree` / `lines` / `state`:**
  - Inline state: `em` 0.91/0.91/0.98, `inline-code` 0.65/0.68/0.92, `formatting-code` 0.85/0.85/0.55.
  - Code-block extent: `hmd-codeblock` 0.70/0.92/0.92, `formatting-code-block` 0.63/0.95/0.95, `HyperMD-codeblock-end` 0.43/0.67/0.67, `hmd-indented-code` 0.82/0.94/0.94.
  - List line state: `HyperMD-list-line-nobullet` 0.32/0.67/0.67, `hmd-list-indent-1` 0.66/0.88/0.88, `hmd-list-indent-2` 0.37/0.53/0.53, `list-1` 0.80/0.94/0.94.
  - Quote line state: `HyperMD-quote-lazy` 0.22/0.60/0.60, `hmd-indent-in-quote` 0/0/0.
  - Tables: `HyperMD-table-*` and `hmd-table-sep-*` 0.67 to 0.89. The editor recognises fewer table shapes than GFM, for example `-|-` as a delimiter row.
  - Everything else is 0.95 or better.
- **Need Obsidian syntax extensions (48 classes, none of them produced by plain Lezer):** wikilinks and embeds (`hmd-internal-link`, `formatting-link-start`/`-end`, `link-has-alias`, `link-alias`, `link-alias-pipe`, `hmd-embed`, `formatting-embed`), tags (`hashtag`, `hashtag-begin`/`-end`, `formatting-hashtag`, and a per-tag `tag-<name>` class), `%%` comments (`comment-start`/`-end`), math (`math`, `math-block`, `formatting-math*`, `HyperMD-math`, and an odd `math-` on closing marks), highlights (`highlight`, `formatting-highlight*`), footnotes (`footref`, `inline-footnote*`, `hmd-footnote`, `HyperMD-footnote`, `hmd-barelink`, `hmd-barelink2`, `hmd-footref2`), block ids (`blockid`), callouts (`hmd-callout`, `HyperMD-callout`), and frontmatter (`hmd-frontmatter`). `hmd-barelink` also marks every bare `[text]` whether or not a definition exists.
- **Come from an embedded sub-language (19 classes):** the HTML tokenizer (`tag`, `bracket`, `attribute`, `string`, `hmd-html-begin`/`-end`), fenced-code languages (`keyword`, `def`, `variable`, `variable-2`, `number`, `operator`, `string-2`, `property`, `b`, `error`), and frontmatter YAML (`atom`, `meta`, `def`). These are CodeMirror 5 mode classes. Lezer reaches them through mixed parsing, and the open CodeMirror legacy modes emit the same names.

### What depends on line state

These are the residual causes on the plain subset, counted per document. A document can have several, and **only** means it was the sole cause in that document.

| Cause | `tree` | `lines` | `state` (only) |
| --- | ---: | ---: | ---: |
| Inline state with no lookahead | 170 | 140 | 62 (26) |
| Inline mark detail (`***`, runs met while a style is open) | 25 | 25 | 83 (54) |
| Code-block extent | 227 | 81 | 81 (47) |
| List structure | 236 | 69 | 69 (17) |
| Quote structure | 165 | 47 | 47 (9) |
| List indent numbering (`hmd-list-indent-N`) | 187 | 46 | 46 (10) |
| Headings | 15 | 6 | 6 (5) |

The editor's tokenizer is one-pass, and these behaviours follow from that:

1. **No lookahead for inline styles.** An opener styles everything after it whether or not it ever closes. `*a` on its own line is italic. The style then **rides across lines and across blocks**, from a list item into a following blockquote, and even onto the opening fence of a code block. Only a blank line resets it, and a line holding only spaces does not count as blank. In CommonMark these delimiters are literal text. A tree cannot hold a span that crosses block boundaries, so this needs the stateful pass. The 70-line prototype already removes most of it: 140 documents fall to 62, and `em` rises from 0.91 to 0.98.
2. **Fences ignore their container.** A fence inside a list item runs past the end of the item. A fence line inside a blockquote opens an inline-code state instead of a code block, and that state carries on until a blank line. Indented-code state leaks into the next line's indentation.
3. **List indentation is numbered by history.** `hmd-list-indent-N` depends on earlier siblings, not on depth. A nested `1. nested` indented by three spaces gets `-1`, and the next sibling with the same indentation gets `-2`.
4. **Line-local block rules** (the `lines` stage, modelled):
   - Quote depth is the number of `>` marks on the line. A lazy line keeps the previous line's depth.
   - No lists, headings or code blocks inside a blockquote.
   - An indented ATX heading cannot interrupt a paragraph.
   - Indented code is not code right after a non-blank line, except a closing fence.
   - A list item opened on its parent's line is text.
   - A mark absorbs every following space.
   - Trailing double spaces are marked whatever follows them.

   A custom Lezer block grammar can encode all of these.

### Other findings

- **The tree is identical in Source mode and in Live Preview** for every document whose text is identical. The 3 documents that differed (`ord-118`, `ord-123`, `ord-238`) did so only because the editor had rewritten the text differently in the two modes.
- **The editor rewrites ordered lists.** Ordered-list renumbering edited 98 of the 2,128 documents on `setValue`. The oracle therefore records and scores the text the editor actually parsed. Phase 1's oracle must keep doing that, or turn renumbering off.
- **Speed.** The oracle reads the 2,128 documents in both modes in about 17 seconds, so a fuzzing loop against the live editor is cheap.

## Decision - 2026-10-13

Recorded in the task as well. **Go with a stateful mapping layer.** Phase 1 builds a Lezer block grammar with the editor's line-local block rules and the Obsidian extensions, plus a resumable inline-state pass whose resume points are blank lines. Its target is a 0-diff fuzz on the same oracle.

One question stays open for the owner and the team: how far to reproduce behaviour that is a tokenizer artefact rather than markdown. Examples are italics carried into a following blockquote, and fences that ignore list ends. Byte-exact compatibility on malformed input means reproducing those artefacts too.
