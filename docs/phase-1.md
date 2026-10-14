# Phase 1: the editor's class tokens, reproduced

Measured on 2026-10-14 against Obsidian 1.14.4 (installer 1.14.4), on a harness-owned instance driven over CDP.

## Result

The tokenizer gives every character and every line of a document the same classes as Obsidian's editor on 13,039 of the 13,040 oracle documents.

| Oracle corpus                               | Documents | Exact |
| ------------------------------------------- | --------: | ----: |
| seed 12345 (tuned against)                  |     2,128 | 2,128 |
| seed 777 (first read after tuning)          |     2,128 | 2,128 |
| seed 4242 (read once, at the end)           |     2,128 | 2,128 |
| seed 2026 (wider corpus, tuned against)     |     3,328 | 3,328 |
| seed 9001 (wider corpus, validation)        |     3,328 | 3,327 |

Seed 777 scored 2,110 the first time it was read, which measured how well rules found on seed 12345 carry to documents nobody looked at. The rules it then taught carried to seed 4242, which scored 2,122 on its first read and 2,126 after two fixes found there. The last 4 documents (`inline-83`, `inline-280`, `inline-34`, `inline-206`) were closed by the two rules under [Line starts the markdown mode never sees](#line-starts-the-markdown-mode-never-sees) and by the CodeMirror 5 release under [Tables and front matter](#tables-and-front-matter).

The last two corpora add four piece sets the first three lacked: `table` (tables with and without outer pipes, after paragraphs, lists and headings, with code, links, math and HTML in cells), `html` (blocks, inline tags, scripts, styles, comments, declarations, HTML in quotes and lists), `lang` (30 fenced languages and their code lines) and `nest` (nested and mixed lists with fences, quotes, math and tables). Seed 2026 scored 3,268 of 3,328 on its first read. Seed 9001 was first read once seed 2026 was exact, and scored 3,289. Both were read again after a last change to the corpus, which only reordered the sets. The one document left, `lang-163`, is under [What is left](#what-is-left).

From this round on, a rule the oracle could not settle was read from the editor's own code, as AGENTS.md L3 allows: the HyperMD-derived mode in Obsidian's `app.js` and Obsidian's fork of the CodeMirror 5 markdown mode in `lib/codemirror/markdown.js`. The rules were then written in this port's own code and checked against all five corpora.

For comparison, Phase 0's best stage (a Lezer tree, a mapping and a 70-line inline state machine) reached 613 of 2,128.

Every line start is a resume point. Highlighting from a copy of the state after any line gives the same classes as highlighting the whole document. The test suite checks this at all 7,171 line starts of the seed 12345 corpus.

## How it works

The classes are the output of a CodeMirror 5 line tokenizer, not of a tree. So the class layer is a tokenizer:

- `src/editor/markdown-mode.ts` ports the CodeMirror 5 `markdown` mode (MIT). Obsidian's additions to the inline flow live here: `%%` comments, `==highlights==`, `[[internal links]]` and embeds, footnote references, inline footnotes, block ids, callouts, fences in list items and in quotes.
- `src/editor/obsidian-mode.ts` ports HyperMD (MIT), which wraps the markdown mode. It adds math, tables, footnote definitions, front matter, hashtags and the `line-*` classes, plus the Obsidian rules that act on whole lines.
- `src/editor/sub-modes.ts` loads CodeMirror 5's own modes from the `codemirror` package, pinned to 5.64.0, the release Obsidian 1.14.4 bundles: `htmlmixed` for HTML, `stex` for math, `yaml` for front matter, and any fenced-code language CodeMirror 5 knows. They load through CodeMirror 5's `runmode.node.js`.
- `src/editor/highlight.ts` runs the mode the way the editor does. It reads one line at a time, calls `blankLine` for empty lines, and never parses an empty last line.

The oracle harness from Phase 0 is now TypeScript:

- `scripts/oracle.ts` reads the live editor's tree for every corpus document. It opens a warm-up document first, because the editor loads the sTeX and fenced-code modes lazily: in Phase 0, documents read before the load finished came back without their math and code classes. It then re-reads each tree until two reads agree. It reads Source mode only, since Phase 0 found the tree identical in Live Preview.
- `src/oracle/corpus.ts` builds the corpus: Phase 0's hand-written documents and piece sets, and four more piece sets.
- `src/oracle/score.ts` scores per character and per line, through the same `_`-joined encoding the editor's node names use.
- `scripts/oracle-diff.ts` prints the score, the classes that disagree most, and a line-by-line diff of chosen documents.
- `oracle/obsidian-<version>-seed-<seed>.json` holds the five corpora. Each file keeps its documents' text, so the test does not rebuild them. A seed rebuilds a file's documents only with the piece sets of the commit that read it. They are the test oracle: `src/editor/highlight.test.ts` fails when a document's agreement changes in either direction.

## What the editor does that CodeMirror 5 and HyperMD do not

Each rule below was read off the oracle and checked against all three corpora.

### Quotes and callouts

- A quote mark keeps the spaces after it in its token, and the mark itself never wears a code style.
- Any markdown token read while a quote is open marks its line `HyperMD-quote`, unless another quote mark follows it. So a quote line keeps the class when a list item, a heading or HTML follows its mark.
- A line under a quote whose first quote mark is not within 3 spaces of its start is marked `HyperMD-quote-lazy`, including an indented one. A line ending in a math token or a block id follows its own rules.
- A callout marker joins the quote mark's token and marks the line `HyperMD-callout`. On a line's first mark, it does so only when the line above is not a quote line.
- A fence inside a quote is not a code block. It opens an inline-code state that styles everything after it until a backtick run of three or more closes it. No blank line ends that state, and opening a real fence does. The fence must be the first inline token after a quote mark. That mark may be on the line above when nothing followed it, as long as the fence could not open a code block itself.
- A code span opened inside a quote ends with its line.

### Lists and code

- A fence right after a list marker opens a code block, and a heading mark opens a heading. After a bullet, the heading mark wears no other class, not even `comment`.
- A fenced block's language mode starts with no base column, as in the CodeMirror 5 markdown mode. Python reads a base column as the indentation of its first scope, and would mark every line at column 0 an error.
- A fence ignores the end of its list item. Its lines are marked `HyperMD-list-line` and `HyperMD-list-line-nobullet`.
- A closing fence must be indented exactly as far as the opening line. In a list item, at least as far.
- A fence line keeps its indentation inside its own token.
- Every token of a fenced block carries `hmd-codeblock`.

### Inline syntax

- `%%` toggles a comment state. Inside a comment, each token read as markdown inline text carries `comment`. A footnote definition's opening mark gets the single class `commentformatting`, which is two classes joined without a space.
- `==` toggles a highlight. A run of three or more `=` is text.
- A run of plain text also stops at `|` and `$`.
- A tag token carries `tag-<name>`, keeping only ASCII letters, digits, `_` and `-`. The `#` token takes the whole name, and the last token takes its own text. The tokens after the `#` drop `em`.
- A `<!` declaration, `<?` instruction or `<![CDATA[` section in inline markdown is a comment. Its first token also carries the class `null`: HyperMD appends the inner mode's first style as a string, and that style is `null`. The line after indented code is not inline markdown when its first token is read, so a declaration there has no classes.
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

- A row that starts at column 0 with a pipe and has no empty cell heads a table when the next line has that shape too. A row with an inner pipe that neither starts nor ends with a pipe heads one when the next line has that shape too. Every cell of the next line must be a delimiter. Dashes may be single, and the column counts need not agree.
- A table does not interrupt a paragraph. It may follow a heading.
- A row continues a table without outer pipes when it has an inner pipe after a first character that is not a pipe. A row continues a table with outer pipes when it starts with a pipe at column 0.
- A table row is marked `HyperMD-table-<type>`, `HyperMD-table-row` and `HyperMD-table-row-<n>` by a separator read while its column count is 0. The type is 1 for a table without outer pipes and 2 for one with them, as in HyperMD. A row whose first token is spaces before a pipe skips the row count. Its separators then go unmarked, and so does the row.
- In a table, the spaces beside a pipe are a token of their own with no classes. An unescaped pipe ends every inline span open in its cell before it is read: code, comments, emphasis, highlights, tags and links. A pipe inside an internal link keeps its `link-alias-pipe` class and ends the link. Math ends before a pipe, and HTML ends at a pipe read as text, a string or an attribute.
- Front matter must open on the document's first line.
- Front matter is read by the YAML mode of CodeMirror 5.64.0, the release Obsidian bundles. Its key pattern differs from later releases: in `- [ ] [a]: /u` it reads everything from the space after `[` to `:` as a key, where 5.65 closes a flow sequence at `]`.

### Line starts the markdown mode never sees

Obsidian reads two tokens that start a line before the markdown mode runs. The markdown mode never sees such a line, so the line cannot head a setext heading, and the next line's `---` is a rule.

- A block id that is the whole line.
- Math at the line's start, once an earlier line has started with math. Obsidian keeps this memory across lines and clears it only at a `$` that does not open math. The first line in a document to start with math still goes through the markdown mode.

## What is left

- A ```` ```markdown ```` block runs CodeMirror 5's stock markdown mode, because that is the `markdown` mode the `codemirror` package registers. Obsidian registers its own fork under that name. The fork gives a nested fence with an unknown language a mode that styles nothing, and the stock mode falls back to `comment`. That one difference is `lang-163` of seed 9001.
- CodeMirror 6's `StreamLanguage` cannot host this tokenizer, because it gives modes no way to read the next line, which setext headings and tables need. `src/editor/language.ts` is a host that can, with the editor's tree shape and incremental re-parsing. Its design and cost are in [cm6-host.md](cm6-host.md).
- The Obsidian syntax extensions for `@lezer/markdown`, which Phase 2's `CachedMetadata` projection needs, are in [syntax.md](syntax.md).

## Decision - 2026-10-14

The editor's classes come from a line tokenizer, so the class-compatibility layer is a line tokenizer with copyable state, not a Lezer grammar plus a mapping. The `@lezer/markdown` tree stays the semantic structure for Phase 2 and for the reading view.
