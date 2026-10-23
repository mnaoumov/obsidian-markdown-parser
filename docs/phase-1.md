# Phase 1: the editor's class tokens, reproduced

Measured on 2026-10-14 against Obsidian 1.14.4 (installer 1.14.4), on a harness-owned instance driven over CDP.

## Result

The tokenizer gives every character and every line of a document the same classes as Obsidian's editor on all 46,508 oracle documents.

| Oracle corpus                               | First read | Exact then | Documents now | Exact now |
| ------------------------------------------- | ---------: | ---------: | ------------: | --------: |
| seed 12345 (tuned against)                  |      2,128 |      2,128 |         4,228 |     4,228 |
| seed 777 (first read after tuning)          |      2,128 |      2,128 |         4,228 |     4,228 |
| seed 4242 (read once, at the end)           |      2,128 |      2,128 |         4,228 |     4,228 |
| seed 2026 (wider corpus, tuned against)     |      3,328 |      3,328 |         4,228 |     4,228 |
| seed 9001 (wider corpus, validation)        |      3,328 |      3,328 |         4,228 |     4,228 |
| seed 31337 (markdown blocks, tuned against) |      3,628 |      3,628 |         4,228 |     4,228 |
| seed 2718 (markdown blocks, validation)     |      3,628 |      3,628 |         4,228 |     4,228 |
| seed 1618 (code spans, tuned against)       |      3,928 |      3,928 |         4,228 |     4,228 |
| seed 1414 (code spans, validation)          |      3,928 |      3,928 |         4,228 |     4,228 |
| seed 3141 (highlight colors, tuned against) |      4,228 |      4,228 |         4,228 |     4,228 |
| seed 6174 (highlight colors, validation)    |      4,228 |      4,228 |         4,228 |     4,228 |

Each seed was first read from the corpus of its day, which lacked the piece sets added after it. On 2026-10-22 the nine seeds read before the last set were read again from the current corpus, so every file now holds the hand-written cases and all fourteen sets, and the tokenizer was exact on every one of them. A seed draws other texts for a set once a set before it is added or grows, so the document ids named in the paragraphs below, and in the rules further down, are those of a seed's first read.

Seed 777 scored 2,110 the first time it was read, which measured how well rules found on seed 12345 carry to documents nobody looked at. The rules it then taught carried to seed 4242, which scored 2,122 on its first read and 2,126 after two fixes found there. The last 4 documents (`inline-83`, `inline-280`, `inline-34`, `inline-206`) were closed by the two rules under [Line starts the markdown mode never sees](#line-starts-the-markdown-mode-never-sees) and by the CodeMirror 5 release under [Tables and front matter](#tables-and-front-matter).

Seeds 2026 and 9001 add four piece sets the first three corpora lacked: `table` (tables with and without outer pipes, after paragraphs, lists and headings, with code, links, math and HTML in cells), `html` (blocks, inline tags, scripts, styles, comments, declarations, HTML in quotes and lists), `lang` (30 fenced languages and their code lines) and `nest` (nested and mixed lists with fences, quotes, math and tables). Seed 2026 scored 3,268 of 3,328 on its first read. Seed 9001 was first read once seed 2026 was exact, and scored 3,289. Both were read again after a last change to the corpus, which only reordered the sets. Its one document left, `lang-163`, was a ```` ```markdown ```` block, and the rules under [Markdown blocks](#markdown-blocks) fixed it.

Seeds 31337 and 2718 add the `mdlang` piece set: markdown nested in a markdown fence, opened by ```` ```markdown ````, ````` ````markdown `````, `~~~markdown` or ```` ```text/x-markdown ````, at a line start, in a list item or after a quote mark. Seed 31337 scored 3,605 of 3,628 on its first read. Its other misses taught the editor rules at the end of [Markdown blocks](#markdown-blocks). Seed 2718 was then read once and scored 3,627. Its one document left, `rich-41`, had no markdown block: it taught the last rule under [Quotes and callouts](#quotes-and-callouts), which Obsidian's fork of the markdown mode states in its own code.

Seeds 1618 and 1414 add the `codespan` piece set: code spans opened by one, two or three backticks and left open at the end of their line, outside and inside quotes, list items, footnote definitions, headings, tables, comments and links, and lines that could close them. Seed 1618 scored 3,749 of 3,928 on its first read: the editor ends a one- or two-backtick span with its line everywhere, not only in a quote, as `app.js` says. That rule, and three it uncovered about footnote definitions and comments, made it exact. Seed 1414 was then read once and scored 3,921. Its misses taught the rule under [Footnotes](#footnotes) about link text left open on the line above, and the highlight rule under [Inline syntax](#inline-syntax). Its two documents left, `mdlang-25` and `mdlang-80`, failed before this round too, and have nothing to do with code spans. They were read down to smaller documents on the live editor and taught the callout rule under [Quotes and callouts](#quotes-and-callouts) and the escape rule under [Inline syntax](#inline-syntax).

Seeds 3141 and 6174 add the `mark` piece set: highlights opened with each of the twelve color markers Obsidian's fork of the markdown mode knows, a marker before a space or alone, an emoji that is not a marker, `==>`, runs of three and four `=`, a mark with a space on each side, and highlights in emphasis, quotes, list items, headings, tables, comments and math. Seed 3141 scored 3,942 of 4,228 on its first read. The editor takes the fork's rule for the mark and its color, which made it exact. Seed 6174 was then read once and scored 4,222. Its misses taught the last two highlight rules under [Inline syntax](#inline-syntax). Its two documents left, `mdlang-99` and `mdlang-154`, have the same text as seed 1414's two, and the same two rules fixed them.

From this round on, a rule the oracle could not settle was read from the editor's own code, as AGENTS.md L3 allows: the HyperMD-derived mode in Obsidian's `app.js` and Obsidian's fork of the CodeMirror 5 markdown mode in `lib/codemirror/markdown.js`. The rules were then written in this port's own code and checked against all five corpora.

For comparison, Phase 0's best stage (a Lezer tree, a mapping and a 70-line inline state machine) reached 613 of 2,128.

Every line start outside a fenced code block and outside a `<script>` or `<style>` element is a resume point (`isLineStateResumable`). Highlighting from a copy of the state after such a line gives the same classes as highlighting the whole document. The test suite checks this at the 12,818 such line starts of the 14,501 in the seed 12345 corpus. Inside those blocks the state holds a CodeMirror 5 mode object that keeps state in its closure, which a copy shares rather than copies ([cm6-host.md](cm6-host.md#incremental-reuse)).

## How it works

The classes are the output of a CodeMirror 5 line tokenizer, not of a tree. So the class layer is a tokenizer:

- `src/editor/markdown-mode.ts` ports the CodeMirror 5 `markdown` mode (MIT), as Obsidian forks it. Its editor layer carries HyperMD's options and token types, and Obsidian's additions to the inline flow: `%%` comments, `==highlights==`, `[[internal links]]` and embeds, footnote references, inline footnotes, block ids, callouts, fences in list items and in quotes.
- `src/editor/obsidian-mode.ts` ports HyperMD (MIT), which wraps the markdown mode. It adds math, tables, footnote definitions, front matter, hashtags and the `line-*` classes, plus the Obsidian rules that act on whole lines.
- `src/editor/sub-modes.ts` loads CodeMirror 5's own modes from the `codemirror` package, pinned to 5.64.0, the release Obsidian 1.14.4 and 1.14.5 bundle: `htmlmixed` for HTML, `stex` for math, `yaml` for front matter, and any fenced-code language CodeMirror 5 knows. They load through CodeMirror 5's `runmode.node.js`. It also registers this port, without its editor layer, as the `markdown` mode, as Obsidian registers its fork.
- `src/editor/highlight.ts` runs the mode the way the editor does. It reads one line at a time, calls `blankLine` for empty lines, and never parses an empty last line.

The oracle harness from Phase 0 is now TypeScript:

- `scripts/oracle.ts` reads the live editor's tree for every corpus document. It opens a warm-up document first, because the editor loads the sTeX and fenced-code modes lazily: in Phase 0, documents read before the load finished came back without their math and code classes. It then re-reads each tree until two reads agree. It reads Source mode only, since Phase 0 found the tree identical in Live Preview.
- `src/oracle/corpus.ts` builds the corpus: Phase 0's hand-written documents and piece sets, and four more piece sets.
- `src/oracle/score.ts` scores per character and per line, through the same `_`-joined encoding the editor's node names use.
- `scripts/oracle-diff.ts` prints the score, the classes that disagree most, and a line-by-line diff of chosen documents.
- `oracle/obsidian-<version>-seed-<seed>.json` holds the eleven corpora. Each file keeps its documents' text, so the test does not rebuild them. A seed rebuilds a file's documents only with the piece sets of the commit that read it. They are the test oracle: `src/editor/highlight.test.ts` fails when a document's agreement changes in either direction.

## What the editor does that CodeMirror 5 and HyperMD do not

Each rule below was read off the oracle and checked against all three corpora.

### Quotes and callouts

- A quote mark keeps the spaces after it in its token, and the mark itself never wears a code style.
- Any markdown token read while a quote is open marks its line `HyperMD-quote`, unless another quote mark follows it. So a quote line keeps the class when a list item, a heading or HTML follows its mark.
- A line under a quote whose first quote mark is not within 3 spaces of its start is marked `HyperMD-quote-lazy`, including an indented one. A line ending in a math token or a block id follows its own rules.
- A callout marker joins the quote mark's token and marks the line `HyperMD-callout`. On a line's first mark, it does so only when the line above is not a quote line. An open quote fence does not stop it: in `mdlang-80` of seed 1414, a heading under `` > ```markdown `` ends the quote, so the `> [!note]` after it opens a callout while the fence's code style runs on.
- A fence inside a quote is not a code block. It opens an inline-code state that styles everything after it until a backtick run of three or more closes it. No blank line ends that state, and opening a real fence does. The fence must be the first inline token after a quote mark. That mark may be on the line above when nothing followed it, as long as the fence could not open a code block itself.
- A line that closes every open list item keeps the block indentation of the outermost one. A quote mark before that column is then not the line's first token, and a fence after it that starts at that column is, so it opens a real code block. In `rich-41` of seed 2718, ```` > ``` ```` after `+ L` and a deeper list item `- D` indented by four spaces opens one.

### Lists and code

- A fence right after a list marker opens a code block, and a heading mark opens a heading. After a bullet, the heading mark wears no other class, not even `comment`.
- A fenced block's language mode starts with no base column, as in the CodeMirror 5 markdown mode. Python reads a base column as the indentation of its first scope, and would mark every line at column 0 an error.
- A fence ignores the end of its list item. Its lines are marked `HyperMD-list-line` and `HyperMD-list-line-nobullet`.
- A closing fence must be indented exactly as far as the opening line. In a list item, at least as far.
- A fence line keeps its indentation inside its own token.
- Every token of a fenced block carries `hmd-codeblock`.

### Inline syntax

- `%%` toggles a comment state. Inside a comment, each token read as markdown inline text carries `comment`. A footnote definition's opening mark gets the single class `commentformatting`, which is two classes joined without a space, unless a code span left open on the line above hides the comment.
- A code span opened by one or two backticks ends with its line, wherever it was opened. One opened by three or more runs on until a run of the same length closes it.
- A run of two or more `=` toggles a highlight. It opens one only before a character that is neither whitespace nor `>`. Where it opens nothing, only its first `=` is read. A run with a space on each side is plain text, and so is the space before it. A list item or a blank line ends a highlight, as it ends emphasis and code spans.
- A color marker right after an opening run joins the run's token: one of 🔴 🟥 (red), 🟠 🟧 (orange), 🟡 🟨 (yellow), 🟢 🟩 (green), 🔵 🟦 (blue) and 🟣 🟪 (purple). Every token of that highlight, both of its marks included, then carries `highlight-<color>` beside `highlight`. Any other emoji is highlighted text.
- A run of plain text also stops at `|` and `$`.
- A tag token carries `tag-<name>`, keeping only ASCII letters, digits, `_` and `-`. The `#` token takes the whole name, and the last token takes its own text. The tokens after the `#` drop `em`.
- A `<!` declaration, `<?` instruction or `<![CDATA[` section in inline markdown is a comment. Its first token also carries the class `null`: HyperMD appends the inner mode's first style as a string, and that style is `null`. The line after indented code is not inline markdown when its first token is read, so a declaration there has no classes.
- A block id is a `^id` that ends its line, after any character.
- Inline `$` math opens before a non-space and closes after one. A line holding only `$$` opens a math block whose lines carry `HyperMD-math`. Math opens inside the markdown inline flow, after the line's block structure is read. Every token of `$` math, both marks included, wears the `strong`, `em`, `strikethrough` and `highlight` spans open around it, even from an earlier line of the paragraph, but not a highlight's color class. `$$` math wears none of them. Neither `$` nor `$$` opens math inside a markdown link's text, closed or not, and link text ends with its line. An image's alt text and math opened before the `[` are not link text.
- From Obsidian 1.15.0 on, a mark that closes `*` or `_` emphasis, `**` or `__` strong emphasis, `~~` strikethrough or a code span, a quote's fence included, also carries `formatting-<kind>-end`, as a highlight's closing mark already carries `formatting-highlight-end` in 1.14.4. A `***` that opens both emphases carries `formatting-em` beside `formatting-strong`, where 1.14.4 gives it only `formatting-strong` and `em`. The tokenizer follows the version it is given as `obsidianVersion`, and 1.14 without one ([oracles.md](oracles.md#the-last-run)).
- A reference label must follow the link text with no space.
- An autolink's address is also a URL, and a bare URL wears the classes of its context.
- A backslash escapes only a character CommonMark lets it escape, as in the fork: `\a` is plain text. A backslash at the end of a line escapes nothing.

### Footnotes

- `[^ref]` and `^[inline]` have their own marks (`footref`, `formatting-link-start`/`-end`, `inline-footnote-start`/`-end`) and no `link` class.
- An inline footnote's body is read as inline markdown, and every token of it but math wears `footref inline-footnote`. `^[` opens one anywhere in the inline flow, link text included, but not inside another. The first `]` outside link text, an internal link, an image and code closes it, the `]` of a footnote reference too, and so does the end of its line. The markdown mode still reads a token at a mark, from past a closing `]`, so the closing mark takes that token's classes, and what that token does to the state stays, as with `^[a][b]`, whose `]` opens link text. That token sees none of Obsidian's inline syntax. This rule was read in the editor's mode in Obsidian 1.15.0's `app.js` and then measured against the live editor of 1.14.5 ([provenance.md](provenance.md#what-was-read)).
- A definition opens only at the start of its line. Its marks do not wear the quote style, but its label does.
- A line after a definition continues it (`HyperMD-footnote`) when it is indented by a whole number of tab stops of 4, counting a tab as 4 spaces. Blank lines continue it too. A line indented by 2 spaces, and an indented list item, do not.
- A definition opens even when link text was left open on the line above. Other links on that line wear no `hmd-barelink`: the open link text hides them.
- After a definition's `]:`, only a URL is marked. Anything else is plain text.
- A definition's label between its marks wears `hmd-barelink hmd-footnote` twice, and its marks once. The repeat changes no class, but it is in the token's type name, so it decides which tokens merge into one span.
- The spaces after a definition's `]:` are a token with no style, even on a lazy quote line, so they are no node. The indentation of a line that continues a definition is a token whose style holds the line class only, so it is a node named `""`.

The tree is the editor's node for node, not only class for class: a token of a quote fence wears `inline-code` once, as every other token does, and the CodeMirror 6 host keeps a style's repeats and its empty styles ([cm6-host.md](cm6-host.md#the-tree)).

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

### Markdown blocks

Obsidian registers its fork of the CodeMirror 5 markdown mode under the name `markdown`. So a fenced block whose language resolves to that mode (`markdown` in any case, or the MIME type `text/markdown` or `text/x-markdown`) runs the fork itself. It runs without HyperMD and without the editor's layer, with the options the fork defaults to. `src/editor/sub-modes.ts` registers this port under that name in the same way, and the stock `markdown.js` is never loaded. `md` resolves to no mode at all.

Inside such a block, the fork's defaults apply:

- No mark gets a `formatting-*` class.
- The token types are the fork's own: `comment` for code, `variable-2`, `variable-3` and `keyword` for list levels 1 to 3, and `hr` for a rule.
- There are no task markers, strikethrough, highlights, `%%` comments, internal links, footnote references, block ids, callouts, tags or math. HyperMD and Obsidian's editor layer add those.
- A fence with a language that has no mode gets CodeMirror's null mode, which styles nothing. An empty language does the same. Outside a markdown block, such a fence's lines are `inline-code`.
- A fence as the first inline token after a quote mark toggles a code span (`comment`). A backtick run of the same length closes it too.
- A footnote definition may open after other tokens on its line. Its label is `link`, and the next word after `]:` is `string url`, with an optional title that the fork does not style.
- An escape adds no class.
- An autolink's address is only `link`.

The fork resets link text and an unfinished image at every line start, and it styles a link's address like the text around it. Both hold in the editor too: the editor layer runs the same code.

The `mdlang` set also reached three editor rules that no corpus had touched before. A ```` ```markdown ```` line after a quote mark is a quote fence, not a code block, so its lines are read by the editor:

- Obsidian clears a link's type at every line start and at a blank line. Without that, link text left open at the end of a line carried `hmd-barelink` into the next one.
- A footnote definition's marks wear `formatting formatting-link link` and nothing else, not even the code style of a quote fence they sit in. After a URL, a quoted or bracketed title is `hmd-footnote-url-title`.
- Inside a quote-fence span, text is read one character at a time after its runs, so a heading's closing marks are still `formatting-header`.

## What is left

- CodeMirror 6's `StreamLanguage` cannot host this tokenizer, because it gives modes no way to read the next line, which setext headings and tables need. `src/editor/language.ts` is a host that can, with the editor's tree shape and incremental re-parsing. Its design and cost are in [cm6-host.md](cm6-host.md).
- The Obsidian syntax extensions for `@lezer/markdown`, which Phase 2's `CachedMetadata` projection needs, are in [syntax.md](syntax.md).

## Decision - 2026-10-14

The editor's classes come from a line tokenizer, so the class-compatibility layer is a line tokenizer with copyable state, not a Lezer grammar plus a mapping. The `@lezer/markdown` tree stays the semantic structure for Phase 2 and for the reading view.
