# The Obsidian syntax, defined once

The semantic tree Phase 2 reads is the `@lezer/markdown` tree with the Obsidian syntax added. The syntax is defined once, in three files every parser adapter shares:

- `src/syntax/spec.ts`: the node names (`ObsidianNode`) and the lexical rules, as plain functions over strings. The micromark adapter and the markdown-it plugin call the same functions.
- `src/syntax/conformance.ts`: the conformance corpus. Each case is a document and the outline of the Obsidian nodes in it, in document order with the text each covers. Plain markdown nodes are not in the outline, so a case means the same to every parser. An adapter passes when it gives every case's outline.
- `src/syntax/lezer.ts`: the `@lezer/markdown` extensions. `obsidianSyntax` is the Obsidian syntax, and `obsidianMarkdown` adds the GFM pieces Obsidian supports: tables, strikethrough and bare URLs. Obsidian's task markers replace GFM's. `parse()` in `src/index.ts` uses them.
- `src/syntax/micromark.ts` and `src/syntax/mdast.ts`: the micromark syntax extension and its `mdast-util-from-markdown` extension, described [below](#the-micromark-and-mdast-adapter). `parseMdast()` in `src/index.ts` uses them.
- `src/syntax/markdown-it.ts`: the markdown-it plugin, described [below](#the-markdown-it-plugin). `parseMarkdownIt()` in `src/index.ts` uses it.
- `src/syntax/options.ts`: the options every adapter takes, a preset with any of its flags overridden, one flag per construct. How each adapter does on the CommonMark and GFM spec suites with them is in [spec-suites.md](spec-suites.md).

## The rules

The rules follow the editor's tokenizer (`src/editor/`), because it is the only Obsidian behaviour measured so far. Where the metadata worker might read a construct differently, Phase 2 measures it. Each rule has a case in the corpus.

| Construct | Nodes | Rule |
| --- | --- | --- |
| Internal link, embed | `InternalLink`, `Embed`, with `InternalLinkMark`, `InternalLinkPath`, `InternalLinkSubpath`, `InternalLinkAliasMark`, `InternalLinkAlias` | `[[` or `![[`, then content with no `]` and no line break, closed by `]]`. The subpath starts at the first `#` and the alias at the first `\|`. In a table the alias pipe is written `\|`, and the backslash belongs to the alias mark. |
| Tag | `Tag`, with `TagMark`, `TagName` | `#` at the start of the inline content or after whitespace, followed by tag characters (anything but whitespace, ASCII punctuation other than `-`, `/` and `_`, and the General and Supplemental Punctuation blocks). A name of digits only is no tag. |
| Comment | `ObsidianComment`, `ObsidianCommentBlock`, with `ObsidianCommentMark` | Inline `%%` to the next `%%`, across lines of its paragraph. An unclosed one runs to the end of the paragraph. A line that starts with `%%` and does not close it opens a comment block, which spans blank lines up to the line holding the next `%%`, or to the end of its container. The names carry the `Obsidian` prefix because `@lezer/markdown` already names HTML comments `Comment` and `CommentBlock`. |
| Math | `InlineMath`, `MathBlock`, with `MathMark` | `$` before a non-space opens inline math when a later `$` on the line follows a non-space, and the first `$` no backslash escapes closes it. `$$` always opens, and closes at the next `$$`. A line that starts with `$$` and does not close it opens a math block, like a comment block. |
| Highlight | `Highlight`, with `HighlightMark` | `==` before a non-space opens, and any `==` closes. A run of three or more `=` is text. |
| Footnote reference | `FootnoteReference`, with `FootnoteMark`, `FootnoteLabel` | `[^label]` with a label of no `]` and no line break. |
| Inline footnote | `InlineFootnote`, with `FootnoteMark` | `^[text]` with text of no `]` and no line break. The text is read as inline markdown. |
| Footnote definition | `FootnoteDefinition`, with `FootnoteMark`, `FootnoteLabel` | `[^label]:` opening a line, outside any quote or list item. Its content continues on indented lines and across blank lines, and a line opening another definition ends it. Inside a quote, `[^label]: text` is a reference followed by text. |
| Block id | `BlockId`, with `BlockIdMark` | `^` followed by letters, digits and `-` to the end of the line. |
| Callout | `Callout`, with `QuoteMark`, `CalloutMark` (holding `CalloutType` and `CalloutFold`) and `CalloutTitle` | A quote whose content opens with `[!type]`, optionally followed by `+` or `-`. The rest of the line is the title. Lines continuing the quote are the content. Lines with no `>` right after the title line continue it, as in the editor, and become the content's first paragraph. |
| Task | `Task`, with `TaskMarker` | A list item opening with `[c]` for any one character `c`, followed by whitespace. |
| Front matter | `FrontMatter`, with `FrontMatterMark` and `FrontMatterContent` | A first line of exactly `---`, up to the next line of exactly `---`. Like in the editor, front matter that never closes runs to the end of the document. |

`src/syntax/lezer.test.ts` runs the corpus. It also edits 400 oracle documents and checks that an incremental parse after each edit gives the same tree as a full parse.

## Measured against the live editor

`scripts/syntax-diff.ts` scores the tree against the classes the live editor gave five of the oracle corpora of Phase 1 (seeds 12345, 777, 4242, 2026 and 9001, 21,140 documents of every piece set), construct by construct. For each one it compares the characters the editor marks with the characters the tree's nodes cover. Whitespace is not compared, nor is the inside of a comment, where the editor still styles markdown and the tree has none. A callout is compared per line, on the editor's `HyperMD-callout` line class. A footnote definition is compared on its `[^label]:` alone, since the editor gives a link reference definition's label the same classes.

| Construct | Documents using it | Agreeing | Disagreeing, by piece set |
| --- | ---: | ---: | --- |
| internal link | 1,416 | 1,334 | html 41, mdlang 25, obsidian 14, table 2 |
| tag | 951 | 894 | mdlang 26, html 16, gap 10, obsidian 5 |
| highlight | 2,177 | 1,437 | mark 630, codespan 96, mdlang 13, obsidian 1 |
| comment | 1,962 | 1,453 | rich 192, quote 180, gap 76, nest 23, obsidian 16, mdlang 16, codespan 6 |
| math | 1,775 | 1,357 | rich 133, quote 120, gap 85, mdlang 35, table 26, nest 12, obsidian 7 |
| footnote reference | 384 | 360 | mdlang 20, obsidian 4 |
| inline footnote | 355 | 342 | mdlang 11, obsidian 2 |
| block id | 979 | 946 | mdlang 23, nest 5, table 3, obsidian 2 |
| front matter | 2,732 | 2,732 | |
| callout | 426 | 395 | obsidian 16, mdlang 13, gap 2 |
| footnote definition | 455 | 436 | mdlang 16, obsidian 3 |
| task marker | 1,054 | 937 | quote 52, obsidian 21, mdlang 14, nest 14, rich 12, ord 4 |

`src/oracle/syntax-score.test.ts` pins these numbers, so a change that moves one fails until the table and the test are updated together.

The documents that disagree fall into a few groups. All but the highlight runs below are places where a line tokenizer and a block parser read a document differently, not a rule of the Obsidian syntax the tree gets wrong:

- **An unclosed `%%` or `$$` that runs past its block.** In the editor, an inline comment or display math left open in a paragraph goes on over blank lines, list items, fences and the end of a quote, until the next `%%` or `$$`. The tree closes it at the end of its paragraph, and inside a quote at the end of the quote. This is most of the comment and math rows. The tree cannot carry the state over a block boundary without breaking incremental parsing, because a reused block does not run its parser again. So the tree stops at the block boundary. Phase 2 measures what the metadata worker does here.
- **HTML blocks.** The tree reads HTML blocks as CommonMark does: a line such as `</div>` or `<div>` opens a block that ends at the next blank line. The editor leaves HTML at the tag, so the lines after it still hold links, tags, tasks, block ids and footnotes. This is most of the `obsidian` and `html` entries.
- **Tables.** GFM reads `[[Note|alias]]` above a `|---|---|` line as a table header and splits the link at its pipe. The editor does not take that line as a table.
- **Quote continuation.** The editor treats a lazy line, or a `---` after a quote, as still in the quote. So a `> [!type]` on the next line continues that quote instead of opening a callout. It also marks a callout on every line where a deeper `>` opens with `[!type]`. The tree has one callout per quote.
- **Task markers in quotes.** The editor does not style a task marker in a list inside a quote. The tree reads a task there, as the metadata worker lists one.
- **Fences opened in a quote or a list item.** The editor keeps a fence open after the quote or list item it opened in ends, and inside a markdown fence it styles no Obsidian syntax. The tree ends the fence with its container and reads the lines after it as markdown. These are the `mdlang` entries, where the tree marks a construct the editor does not.
- **Unclosed highlights.** The editor styles a `==` that never closes as a highlight up to the next list item or blank line, as it styles an unclosed comment or math. The tree has no node for a highlight that never closes. These are all of the `codespan` highlight entries.
- **Highlight runs the tree reads by another rule.** The editor toggles a highlight on any run of two or more `=` and opens none before `>`. The tree opens one only on a run of exactly two, and before any non-space, `>` included. So `===x===` is a highlight in the editor alone, and `==>x==` in the tree alone. With unclosed highlights, these are the `mark` entries: in 381 of them the editor marks text the tree does not, in 162 the tree marks text the editor does not, and in 87 both.

## The micromark and mdast adapter

`micromarkObsidianSyntax` in `src/syntax/micromark.ts` is the Obsidian syntax as a micromark syntax extension, and `micromarkObsidianMarkdown` adds GFM tables, strikethrough (`~~` only) and bare URLs, as `obsidianMarkdown` does for Lezer. GFM task list items are left out, because Obsidian's task markers replace them. `mdastObsidianSyntax` in `src/syntax/mdast.ts` turns the tokens into mdast nodes, and `parseMdast()` runs both.

The tokens carry the `ObsidianNode` names, so the micromark events give the same outline as the Lezer tree. Every case in the corpus passes on the events, and on the mdast tree once the marks are left out (`src/syntax/micromark.test.ts`, `src/syntax/mdast.test.ts`).

How the constructs are built:

- **Measured, then consumed.** micromark gives a construct one character at a time. Most constructs look ahead with `effects.check`, collect the rest of the line (or of the inline content, for comments and math), measure it with the rule in `spec.ts`, and then consume exactly that many characters. Tabs are measured with the virtual spaces micromark pads them with.
- **Highlights** pair their `==` delimiters in a `resolveAll`, as GFM strikethrough pairs `~~`. So a `==` inside a code span is not a delimiter.
- **Comment and math blocks, and front matter,** are flow constructs that read one line at a time. A block that interrupts a paragraph only shows that it starts, as micromark's fenced code does.
- **Callouts and footnote definitions** are containers. A callout continues like a block quote. Its marker and title are read in its first paragraph, and the line ending after the title goes with them, so the rest of that paragraph is the content's first paragraph. A marker with no title takes its line outside any paragraph, so a lazy line does not continue the callout, as in the Lezer tree.
- **A `[^label]:`** never opens a CommonMark link reference definition. The extension disables micromark's `definition` and stands in for it.
- **Every line ending a construct spans** is a token of its own, as in micromark's own constructs. micromark's subtokenizer splits the events of an inline parse at those tokens, and a token that crosses a line ending without one makes it loop forever.

### The mdast nodes

Where mdast already has a node for a construct, the adapter gives that node, so existing tools read it. Every other construct gets a node of its own. The marks are not kept: the node and its fields hold what they said. `MDAST_NODE_TYPES` lists the mapping.

| Construct | mdast node | Fields |
| --- | --- | --- |
| Internal link, embed | `internalLink`, `embed` | `path`, `subpath` (with its `#`, or `null`), `alias` (or `null`) |
| Tag | `tag` | `name`, without its `#` |
| Comment | `obsidianComment`, `obsidianCommentBlock` | `value`: the text between the delimiters |
| Math | `inlineMath`, `math`, as in `mdast-util-math` | `value`: the text between the delimiters |
| Highlight | `highlight` | phrasing `children` |
| Footnote reference | `footnoteReference`, as in GFM | `label`, `identifier` |
| Inline footnote | `inlineFootnote` | phrasing `children` |
| Footnote definition | `footnoteDefinition`, as in GFM | `label`, `identifier`, block `children` |
| Block id | `blockId` | `value`, without its `^` |
| Callout | `callout` | `calloutType`, `fold` (`+`, `-` or `null`), `title` (phrasing), block `children` |
| Task | the `listItem` | `task` (the marker's character), `checked` (`false` for a space) |
| Front matter | `yaml`, as in `mdast-util-frontmatter` | `value`: the content lines |

A block's value leaves out the line ending after its opening delimiter and the one before its closing delimiter.

### Measured against the Lezer extensions

`scripts/adapter-diff.ts` compares the Obsidian nodes of the two adapters on the 29,596 documents of seven oracle corpora (seeds 12345, 777, 4242, 2026, 9001, 2718 and 31337), construct by construct, with each node's parts. 28,551 documents give the same nodes. `src/syntax/micromark.test.ts` pins the count for the first corpus (4,068 of 4,228).

| Construct | Documents using it | Agreeing | Disagreeing, by group |
| --- | ---: | ---: | --- |
| internal link | 1,943 | 1,939 | table 4 |
| tag | 1,281 | 1,278 | html 2, table 1 |
| highlight | 2,807 | 2,692 | mark 115 |
| comment | 2,700 | 2,233 | final line break 458, quote 7, gap 1, table 1 |
| math | 2,474 | 2,077 | final line break 362, table 21, quote 10, gap 2, rich 2 |
| footnote reference | 1,071 | 1,071 | |
| inline footnote | 506 | 506 | |
| block id | 1,344 | 1,343 | table 1 |
| front matter | 3,817 | 3,805 | obsidian 6, gap 4, inline 2 |
| callout | 595 | 589 | obsidian 3, gap 3 |
| footnote definition | 637 | 637 | |
| task | 1,480 | 1,434 | ord 29, obsidian 6, nest 5, quote 4, rich 2 |

None of the differences is a rule of the Obsidian syntax. Each is a place where the two parsers' block structure, or their pairing of inline delimiters, reads a document differently:

- **A final line break.** A comment or math block that never closes, at the end of a document that ends with a line break, takes that line break in the Lezer tree, which reads the empty last line as part of the block. micromark ends the block before it, as it ends fenced code. This is most of the comment and math rows.
- **The end of a container.** Likewise, an unclosed block inside a quote or a list item takes the quote's last empty line in the Lezer tree, and ends before it in micromark.
- **Tables.** The two GFM table parsers disagree on which lines form a table, for example a header row above a delimiter row with a different number of cells, or a table after a lazy line.
- **Lists and lazy lines.** micromark lets a list item that does not start at 1 interrupt a lazy paragraph line, and Lezer does not. The task rows are these.
- **Empty front matter content.** For front matter whose content is one empty line, the Lezer tree has an empty `FrontMatterContent` node. A micromark token cannot be empty, so the adapter gives none.
- **A task in a later paragraph.** The Lezer tree reads a task marker at the start of any paragraph in a list item. The micromark adapter reads one only in the item's first paragraph, where micromark marks the content as such.
- **HTML.** micromark reads a `<br/>` line at the start of a document as an HTML block that runs to the next blank line, so a tag on the line after it is text, and the Lezer tree does not.
- **Highlights across emphasis.** In `*==🟡e*==`, micromark pairs the `==` inside the emphasis with the one after it, so the highlight crosses the emphasis's closing `*`. The Lezer tree closes the emphasis first and leaves both `==` as text. These are the `mark` entries.

## The markdown-it plugin

`markdownItObsidianSyntax` in `src/syntax/markdown-it.ts` is the Obsidian syntax as a markdown-it plugin. `createObsidianMarkdownIt()` adds it to a markdown-it with HTML and bare URLs enabled, whose default preset already has GFM tables and strikethrough (`~~` only), and `parseMarkdownIt()` parses with it. markdown-it has no task lists of its own, so Obsidian's task markers need no stand-in.

### The tokens

The tokens are named after `ObsidianNode`. A node with nodes inside it is a pair, `<name>_open` and `<name>_close`, as markdown-it's own `blockquote_open` and `blockquote_close` are, and a node with none is a single `<name>` token. So `[[Note|shown]]` gives `InternalLink_open`, `InternalLinkMark`, `InternalLinkPath`, `InternalLinkAliasMark`, `InternalLinkAlias`, `InternalLinkMark` and `InternalLink_close`. `obsidianNodeNameOf()` gives the node a token stands for.

Every opening or single Obsidian token carries the source range it covers as `{ from, to }` in its `meta`, read with `getObsidianTokenRange()`. The offsets are into the source as markdown-it normalizes it, with every line ending as `\n`. With them, the tokens give the same outline as the Lezer tree, and every case in the corpus passes (`src/syntax/markdown-it.test.ts`).

The tokens hold what the mdast nodes hold as fields: a leaf's text in `content` (a tag name, a link's path, a footnote label, a callout type), a mark's text in `markup`, and the text of a comment, math or front matter in its opening token's `content`. A task becomes `Task_open`, `TaskMarker` and `Task_close` around the inline content of its list item's first paragraph, and the list item gets a `task-list-item` class and the marker as `data-task`.

The plugin renders the syntax as plain HTML, not measured against Obsidian's reading view: a link as `<a class="internal-link">` showing its alias or its target, an embed as `<span class="internal-embed">`, a tag as `<a class="tag">`, a highlight as `<mark>`, math as its source in a `math` element for a math renderer to typeset, a callout as `<div class="callout" data-callout="type">` with a `callout-title`, a task as a checkbox, and footnotes as `<sup>` references and `footnote-definition` blocks. Comments, block ids and front matter render nothing.

### How the constructs are built

- **Inline content is mapped back to the document.** markdown-it's inline rules read a block's inline content, not the document: a paragraph's lines without their container prefixes, a heading without its marks, a table cell without the backslash of a `\|`. The inline rules record ranges in that content, and a core rule maps them to the document. Each content line of a paragraph ends where its document line ends, the last one before its trailing whitespace, and a heading's before a closing `#` sequence. A table cell is found in its row after the cells before it, with each `\|` of the row read as `|`, so an internal link's escaped alias pipe covers both characters, as in the Lezer tree.
- **Highlights** are paired after the content is read, at the same nesting level: each `==` closes the nearest one before it that can open.
- **Comment and math blocks, and front matter,** are block rules. A comment or math block can interrupt a paragraph unless the paragraph leaves its delimiter open, so the line closes the inline span instead.
- **Callouts** are quotes: the rule reads the quote with markdown-it's own quote rule, then turns the first line of its first paragraph into the marker and the title. When the marker has no title and the next line is a lazy line, the quote is read as that one line, so the lazy line does not continue the callout.
- **Footnote definitions** read their content as a container, which continues on any indented line and across blank lines. A `[^label]:` line is never a link reference definition: the plugin wraps markdown-it's `reference` rule.

### Measured against the Lezer extensions

`scripts/adapter-diff.ts --adapter markdown-it` compares the plugin with the Lezer extensions on the same 29,596 documents. 28,682 documents give the same nodes, more than the micromark adapter's 28,551. `src/syntax/markdown-it.test.ts` pins the count for the first corpus (4,086 of 4,228).

| Construct | Documents using it | Agreeing | Disagreeing, by group |
| --- | ---: | ---: | --- |
| internal link | 1,943 | 1,939 | table 4 |
| tag | 1,281 | 1,277 | table 2, html 2 |
| highlight | 2,793 | 2,775 | mark 18 |
| comment | 2,700 | 2,239 | final line break 458, table 2, gap 1 |
| math | 2,474 | 2,087 | final line break 362, table 21, quote 3, rich 1 |
| footnote reference | 1,071 | 1,071 | |
| inline footnote | 506 | 506 | |
| block id | 1,344 | 1,343 | table 1 |
| front matter | 3,817 | 3,817 | |
| callout | 595 | 592 | obsidian 3 |
| footnote definition | 637 | 637 | |
| task | 1,480 | 1,438 | ord 25, obsidian 6, nest 5, quote 4, rich 2 |

As with micromark, none of the differences is a rule of the Obsidian syntax:

- **A final line break.** The same documents as for micromark: an unclosed comment or math block at the end of a document that ends with a line break ends before that line break, where the Lezer tree takes it.
- **Tables.** markdown-it reads a row with pipes above a line of `---` as a table of one column, where the Lezer tree reads a setext heading. Its other table rules differ as micromark's do.
- **Lists and lazy lines.** markdown-it lets a list item that does not start at 1, or an empty one, interrupt a lazy paragraph line in a list item or a quote, and a table does not interrupt one. The Lezer tree reads those lines the other way round. The task rows are these, and so are the `quote` math entries and the callout entries.
- **HTML.** markdown-it reads a `<br/>` line as an HTML block that runs to the next blank line, as micromark does, and the Lezer tree does not.
- **Highlights across emphasis.** markdown-it pairs a `==` only with one at its own nesting level. So in `- ==🟢l` followed by the lazy line `*==🟡e*==`, the first `==` closes at the last one, after the emphasis, where the Lezer tree closes it at the `==` inside the emphasis. These are the `mark` entries.

markdown-it drops a last line of the document that holds only whitespace and has no line break. An unclosed block that reaches the end of the document takes that whitespace, as in the other two parsers, unless it is in a quote. Unlike micromark, a markdown-it token can be empty, so front matter content of one empty line is an empty `FrontMatterContent`, as in the Lezer tree.

## What is left

- The metadata worker reads the syntax with its own rules, which the `remark-parse` 8 engine follows ([its syntax](remark.md#the-obsidian-syntax)). Where it reads the conformance corpus differently from the editor is [listed there](remark.md#where-the-worker-and-the-editor-differ): a link holding a `]`, the syntax inside comments, inline comments on one line, a `%%` line opening a comment block, a reference to no definition, and a definition inside a quote. The rules here stay the editor's, which the class layer and the three adapters follow.
- The front matter content and math are left as text. A YAML and a LaTeX parser can be mounted on `FrontMatterContent` and the math nodes later.
