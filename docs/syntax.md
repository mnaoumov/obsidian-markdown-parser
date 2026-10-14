# The Obsidian syntax, defined once

The semantic tree Phase 2 reads is the `@lezer/markdown` tree with the Obsidian syntax added. The syntax is defined once, in three files every parser adapter shares:

- `src/syntax/spec.ts`: the node names (`ObsidianNode`) and the lexical rules, as plain functions over strings. The micromark adapter calls the same functions, and so will the markdown-it adapter to come.
- `src/syntax/conformance.ts`: the conformance corpus. Each case is a document and the outline of the Obsidian nodes in it, in document order with the text each covers. Plain markdown nodes are not in the outline, so a case means the same to every parser. An adapter passes when it gives every case's outline.
- `src/syntax/lezer.ts`: the `@lezer/markdown` extensions. `obsidianSyntax` is the Obsidian syntax, and `obsidianMarkdown` adds the GFM pieces Obsidian supports: tables, strikethrough and bare URLs. Obsidian's task markers replace GFM's. `parse()` in `src/index.ts` uses them.
- `src/syntax/micromark.ts` and `src/syntax/mdast.ts`: the micromark syntax extension and its `mdast-util-from-markdown` extension, described [below](#the-micromark-and-mdast-adapter). `parseMdast()` in `src/index.ts` uses them.

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

`scripts/syntax-diff.ts` scores the tree against the classes the live editor gave the first five oracle corpora of Phase 1, construct by construct. For each one it compares the characters the editor marks with the characters the tree's nodes cover. Whitespace is not compared, nor is the inside of a comment, where the editor still styles markdown and the tree has none. A callout is compared per line, on the editor's `HyperMD-callout` line class. A footnote definition is compared on its `[^label]:` alone, since the editor gives a link reference definition's label the same classes.

| Construct | Documents using it | Agreeing | Disagreeing, by piece set |
| --- | ---: | ---: | --- |
| internal link | 1,176 | 1,140 | obsidian 20, html 14, table 2 |
| tag | 749 | 717 | html 13, gap 11, obsidian 8 |
| highlight | 518 | 516 | obsidian 2 |
| comment | 1,594 | 1,128 | quote 191, rich 183, gap 68, obsidian 13, nest 11 |
| math | 1,453 | 1,087 | rich 122, quote 118, gap 99, table 17, obsidian 7, nest 3 |
| footnote reference | 350 | 345 | obsidian 5 |
| inline footnote | 343 | 341 | obsidian 2 |
| block id | 893 | 882 | obsidian 7, nest 3, table 1 |
| front matter | 1,728 | 1,728 | |
| callout | 437 | 409 | obsidian 25, gap 3 |
| footnote definition | 347 | 342 | obsidian 5 |
| task marker | 932 | 837 | quote 58, obsidian 16, nest 9, rich 8, ord 4 |

`src/oracle/syntax-score.test.ts` pins these numbers, so a change that moves one fails until the table and the test are updated together.

The documents that disagree fall into a few groups. None of them is a rule of the Obsidian syntax the tree gets wrong. Each is a place where a line tokenizer and a block parser read a document differently:

- **An unclosed `%%` or `$$` that runs past its block.** In the editor, an inline comment or display math left open in a paragraph goes on over blank lines, list items, fences and the end of a quote, until the next `%%` or `$$`. The tree closes it at the end of its paragraph, and inside a quote at the end of the quote. This is most of the comment and math rows. The tree cannot carry the state over a block boundary without breaking incremental parsing, because a reused block does not run its parser again. So the tree stops at the block boundary. Phase 2 measures what the metadata worker does here.
- **HTML blocks.** The tree reads HTML blocks as CommonMark does: a line such as `</div>` or `<div>` opens a block that ends at the next blank line. The editor leaves HTML at the tag, so the lines after it still hold links, tags, tasks, block ids and footnotes. This is most of the `obsidian` and `html` entries.
- **Tables.** GFM reads `[[Note|alias]]` above a `|---|---|` line as a table header and splits the link at its pipe. The editor does not take that line as a table.
- **Quote continuation.** The editor treats a lazy line, or a `---` after a quote, as still in the quote. So a `> [!type]` on the next line continues that quote instead of opening a callout. It also marks a callout on every line where a deeper `>` opens with `[!type]`. The tree has one callout per quote.
- **Task markers in quotes.** The editor does not style a task marker in a list inside a quote. The tree reads a task there, as the metadata worker lists one.

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

`scripts/adapter-diff.ts` compares the Obsidian nodes of the two adapters on the 20,296 documents of the seven oracle corpora, construct by construct, with each node's parts. 19,509 documents give the same nodes. `src/syntax/micromark.test.ts` pins the count for the first corpus (2,011 of 2,128).

| Construct | Documents using it | Agreeing | Disagreeing, by group |
| --- | ---: | ---: | --- |
| internal link | 1,668 | 1,662 | table 5, html 1 |
| tag | 1,089 | 1,089 | |
| highlight | 774 | 774 | |
| comment | 2,241 | 1,870 | final line break 361, quote 8, gap 2 |
| math | 2,125 | 1,769 | final line break 317, table 18, quote 13, gap 5, rich 3 |
| footnote reference | 899 | 899 | |
| inline footnote | 483 | 483 | |
| block id | 1,277 | 1,274 | table 3 |
| front matter | 2,684 | 2,670 | obsidian 9, gap 3, inline 2 |
| callout | 591 | 590 | obsidian 1 |
| footnote definition | 496 | 496 | |
| task | 1,371 | 1,332 | ord 30, obsidian 3, quote 3, rich 2, nest 1 |

None of the differences is a rule of the Obsidian syntax. Each is a place where the two parsers' block structure reads a document differently:

- **A final line break.** A comment or math block that never closes, at the end of a document that ends with a line break, takes that line break in the Lezer tree, which reads the empty last line as part of the block. micromark ends the block before it, as it ends fenced code. This is most of the comment and math rows.
- **The end of a container.** Likewise, an unclosed block inside a quote or a list item takes the quote's last empty line in the Lezer tree, and ends before it in micromark.
- **Tables.** The two GFM table parsers disagree on which lines form a table, for example a header row above a delimiter row with a different number of cells, or a table after a lazy line.
- **Lists and lazy lines.** micromark lets a list item that does not start at 1 interrupt a lazy paragraph line, and Lezer does not. The task rows are these.
- **Empty front matter content.** For front matter whose content is one empty line, the Lezer tree has an empty `FrontMatterContent` node. A micromark token cannot be empty, so the adapter gives none.
- **A task in a later paragraph.** The Lezer tree reads a task marker at the start of any paragraph in a list item. The micromark adapter reads one only in the item's first paragraph, where micromark marks the content as such.

## What is left

- The markdown-it plugin, built on `src/syntax/spec.ts` and checked against the corpus.
- Phase 2 checks the rules against the metadata worker: the groups above, empty internal links (`[[]]`, a link here, as in the editor), a block id with no space before its `^` (one here, as in the editor), front matter that never closes, and whether a lazy line belongs to a footnote definition.
- The front matter content and math are left as text. A YAML and a LaTeX parser can be mounted on `FrontMatterContent` and the math nodes later.
