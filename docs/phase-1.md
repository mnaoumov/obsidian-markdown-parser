# Phase 1: the editor's class tokens, reproduced

Measured on 2026-10-14 against Obsidian 1.14.4 (installer 1.14.4), on a harness-owned instance driven over CDP.

## Result

The tokenizer gives every character and every line of a document the same classes as Obsidian's editor on 6,380 of 6,384 oracle documents (99.94%).

| Oracle corpus                        | Documents | Exact | Not exact                      |
| ------------------------------------ | --------: | ----: | ------------------------------ |
| seed 12345 (tuned against)           |     2,128 | 2,127 | `inline-83`                    |
| seed 777 (first read after tuning)   |     2,128 | 2,127 | `inline-280`                   |
| seed 4242 (read once, at the end)    |     2,128 | 2,126 | `inline-34`, `inline-206`      |

Seed 777 scored 2,110 the first time it was read, which measured how well rules found on seed 12345 carry to documents nobody looked at. The rules it then taught carried to seed 4242, which scored 2,122 on its first read and 2,126 after two fixes found there.

For comparison, Phase 0's best stage (a Lezer tree, a mapping and a 70-line inline state machine) reached 613 of 2,128.

Every line start is a resume point. Highlighting from a copy of the state after any line gives the same classes as highlighting the whole document. The test suite checks this at all 7,171 line starts of the seed 12345 corpus.

## How it works

The classes are the output of a CodeMirror 5 line tokenizer, not of a tree. So the class layer is a tokenizer:

- `src/editor/markdown-mode.ts` ports the CodeMirror 5 `markdown` mode (MIT). Obsidian's additions to the inline flow live here: `%%` comments, `==highlights==`, `[[internal links]]` and embeds, footnote references, inline footnotes, block ids, callouts, fences in list items and in quotes.
- `src/editor/obsidian-mode.ts` ports HyperMD (MIT), which wraps the markdown mode. It adds math, tables, footnote definitions, front matter, hashtags and the `line-*` classes, plus the Obsidian rules that act on whole lines.
- `src/editor/sub-modes.ts` loads CodeMirror 5's own modes from the `codemirror@5` package: `htmlmixed` for HTML, `stex` for math, `yaml` for front matter, and any fenced-code language CodeMirror 5 knows. They load through CodeMirror 5's `runmode.node.js`.
- `src/editor/highlight.ts` runs the mode the way the editor does. It reads one line at a time, calls `blankLine` for empty lines, and never parses an empty last line.

The oracle harness from Phase 0 is now TypeScript:

- `scripts/oracle.ts` reads the live editor's tree for every corpus document. It opens a warm-up document first, because the editor loads the sTeX and fenced-code modes lazily: in Phase 0, documents read before the load finished came back without their math and code classes. It then re-reads each tree until two reads agree. It reads Source mode only, since Phase 0 found the tree identical in Live Preview.
- `src/oracle/corpus.ts` builds the same corpus as Phase 0 for the same seed.
- `src/oracle/score.ts` scores per character and per line, through the same `_`-joined encoding the editor's node names use.
- `scripts/oracle-diff.ts` prints the score, the classes that disagree most, and a line-by-line diff of chosen documents.
- `oracle/obsidian-<version>-seed-<seed>.json` holds the three corpora. They are the test oracle: `src/editor/highlight.test.ts` fails when a document's agreement changes in either direction.

## What the editor does that CodeMirror 5 and HyperMD do not

Each rule below was read off the oracle and checked against all three corpora.

### Quotes and callouts

- A quote mark keeps the spaces after it in its token, and the mark itself never wears a code style.
- A lazy line under a quote is marked `HyperMD-quote-lazy`, including an indented one. A line ending in a math token or a block id follows its own rules.
- A callout marker joins the quote mark's token and marks the line `HyperMD-callout`. On a line's first mark, it does so only when the line above is not a quote line.
- A fence inside a quote is not a code block. It opens an inline-code state that styles everything after it until a backtick run of three or more closes it. No blank line ends that state, and opening a real fence does.
- A code span opened inside a quote ends with its line.

### Lists and code

- A fence right after a list marker opens a code block, and so does a heading mark.
- A fence ignores the end of its list item. Its lines are marked `HyperMD-list-line` and `HyperMD-list-line-nobullet`.
- A closing fence must be indented exactly as far as the opening line. In a list item, at least as far.
- A fence line keeps its indentation inside its own token.
- Every token of a fenced block carries `hmd-codeblock`.

### Inline syntax

- `%%` toggles a comment state. Inside a comment, each token read as markdown inline text carries `comment`. A footnote definition's opening mark gets the single class `commentformatting`, which is two classes joined without a space.
- `==` toggles a highlight. A run of three or more `=` is text.
- A tag token carries `tag-<name>`, with `/` removed. The `#` token takes the whole name, and the last token takes its own text.
- A block id is a `^id` that ends its line, after any character.
- Inline `$` math opens before a non-space and closes after one. A line holding only `$$` opens a math block whose lines carry `HyperMD-math`. Math opens inside the markdown inline flow, after the line's block structure is read.
- A reference label must follow the link text with no space.
- An autolink's address is also a URL, and a bare URL wears the classes of its context.
- A backslash at the end of a line escapes nothing.

### Footnotes

- `[^ref]` and `^[inline]` have their own marks (`footref`, `formatting-link-start`/`-end`, `inline-footnote-start`/`-end`) and no `link` class.
- A definition opens only at the start of its line. Its marks do not wear the quote style, but its label does.
- Indented lines after a definition continue it (`HyperMD-footnote`), and so do blank lines. An indented list item does not.
- After a definition's `]:`, only a URL is marked. Anything else is plain text.

### Tables and front matter

- A row wrapped in pipes heads a table when the next line is a delimiter row wrapped in pipes. A row with an inner pipe heads one when the next line is a delimiter row without outer pipes. Dashes may be single, and the column counts need not agree.
- A table does not interrupt a paragraph.
- Every table row is marked `HyperMD-table-<type>`, `HyperMD-table-row` and `HyperMD-table-row-<n>`. The type is 1 for a table without outer pipes and 2 for one with them, as in HyperMD.
- Front matter must open on the document's first line.

## What is left

- **`inline-83` and `inline-34`.** A line that starts with math or a block id, and is followed by `---`, sometimes heads a setext heading and sometimes does not. Both misses follow a line with a footnote construct. Other documents show the opposite outcome after an inline footnote, so the rule is not that simple.
- **`inline-280` and `inline-206`.** Unclosed front matter whose YAML holds `- [ ] [a]: /u`. Obsidian's YAML mode treats `] [a]` as a key, while CodeMirror 5.65.21's marks `]` as closing a flow sequence. Obsidian probably bundles a different CodeMirror 5 release.
- The corpus has few tables, few HTML blocks and only the `js` code language, so rules there rest on few samples. A corpus with more of those pieces would test them.
- CodeMirror 6's `StreamLanguage` cannot host this tokenizer as it stands, because it gives modes no way to read the next line. Setext headings and tables need that lookahead. Obsidian's editor has its own host that provides it.
- The Obsidian syntax extensions for `@lezer/markdown`, which Phase 2's `CachedMetadata` projection needs, are not written yet.

## Decision - 2026-10-14

The editor's classes come from a line tokenizer, so the class-compatibility layer is a line tokenizer with copyable state, not a Lezer grammar plus a mapping. The `@lezer/markdown` tree stays the semantic structure for Phase 2 and for the reading view.
