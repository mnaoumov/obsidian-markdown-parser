# The CommonMark and GFM spec suites

Every parser adapter is checked against the CommonMark spec suite, and against the examples of the GFM spec's extensions, by `src/syntax/spec-suites.test.ts`. Each adapter takes the same options: a preset, with any of its flags turned on or off.

## The suites

`spec/` holds the two suites as JSON, one entry per example with its markdown, the HTML it renders to, its number and its section:

- `spec/commonmark-0.31.2.json` is the [CommonMark spec 0.31.2](https://spec.commonmark.org/0.31.2/) suite, 652 examples. It is the published `spec.json` of that release, with a final line break.
- `spec/gfm-0.29.0.gfm.13.json` is the [GFM spec](https://github.github.com/gfm/) of `cmark-gfm` 0.29.0.gfm.13 (`test/spec.txt`), 670 examples. Each example of an extension lists it in `extensions`: 8 `table`, 2 `strikethrough`, 11 `autolink` and 1 `tagfilter`. The two task list examples are marked `disabled` in the spec, and `cmark-gfm` does not run them either, so they are left out.

`scripts/spec-json.ts` turns a spec's `spec.txt` into that JSON the way the spec's own `spec_tests.py` reads it: `jiti scripts/spec-json.ts <spec.txt> <out.json>`. On the CommonMark spec it gives the published `spec.json` byte for byte.

Both specs are under CC-BY-SA 4.0, attributed in [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).

The GFM suite runs only its extension examples. The rest of it is CommonMark 0.29, which the CommonMark suite covers as 0.31.2, and the two releases disagree on a few examples.

## The options

`src/syntax/options.ts` defines one flag per construct, three presets, and the quirk flags described in [Obsidian's quirks](#obsidians-quirks):

| Preset | Flags on |
| --- | --- |
| `commonmark` | none |
| `gfm` | `table`, `strikethrough`, `autolinkLiteral` |
| `obsidian` (the default) | all of them |

The other flags are the Obsidian syntax: `internalLink`, `tag`, `comment`, `math`, `highlight`, `footnote`, `inlineFootnote`, `blockId`, `callout`, `task` and `frontMatter`. Options are a preset with any flag overridden, for example `{ preset: 'commonmark', tag: true }`. Every adapter takes them:

- `createObsidianParser(options)` and `createObsidianMarkdown(options)` for `@lezer/markdown`. A parser is configured once, and incremental parsing needs the same parser for every edit.
- `createMicromarkObsidianMarkdown(options)` for micromark, and `createMicromarkObsidianSyntax(flags)` for the Obsidian syntax alone. `parseMdast(markdown, options)` gives the mdast tree.
- `createObsidianMarkdownIt(options)` for markdown-it, which starts from markdown-it's `commonmark` preset, and `md.use(markdownItObsidianSyntax, options)` for the plugin alone.

The existing exports (`obsidianParser`, `micromarkObsidianMarkdown`, `parseMarkdownIt` and the rest) are the `obsidian` preset.

Every flag adds syntax. A document that uses it parses differently, and one that does not parses as before. So no flag is a quirk: a quirk changes how valid CommonMark parses. The quirks are flags of their own, which every preset leaves at the CommonMark behaviour (see [Obsidian's quirks](#obsidians-quirks)).

## Results

| Adapter | CommonMark 0.31.2, `commonmark` preset | GFM extension examples, `gfm` preset |
| --- | ---: | ---: |
| `@lezer/markdown` | 651 of 652 | 21 of 22 |
| micromark | 652 of 652 | 21 of 22 |
| markdown-it | 652 of 652 | 13 of 22 |

The test pins the examples each adapter fails, so an example that starts or stops passing fails the test until the list is updated:

- **`@lezer/markdown` 280** (`-\n\n  foo`): a list item that starts with a blank line and is followed by another one is empty, and `foo` is a paragraph after the list. `@lezer/markdown` keeps the item open and puts `foo` in it. Its list item continuation is internal, so an extension cannot change it.
- **628** (`@lezer/markdown` and micromark): the GFM 0.29 spec links `ftp://foo.bar.baz`. Both parsers link only `http`, `https` and `www.` addresses, as github.com does today.
- **markdown-it 621-627 and 630**: markdown-it finds bare URLs with linkify-it, which links no `www.` address without a scheme here and links the spec's invalid email address `hello@mail+xyz.example`.
- **markdown-it 652**: markdown-it has no tag filter. micromark runs `micromark-extension-gfm-tagfilter`, and the Lezer renderer has its own filter.

### How the Lezer tree is checked

A `@lezer/markdown` tree is not HTML, so `src/syntax/lezer-html.ts` renders it as the CommonMark reference implementation renders a document. It reads each node's text back from the source: it takes the container prefixes off code and HTML block lines, tabs split as the spec splits them, and strips each paragraph line's leading whitespace. It decides whether a list is tight from the blank lines between its items and between their blocks. It renders the Obsidian nodes as their content.

`@lezer/markdown` 1.8 itself differs from CommonMark 0.31.2 in a few rules. `src/syntax/lezer-commonmark.ts` fixes three of them in `commonMarkFixes`, which every parser of this package includes:

- An ATX heading's `#` sequence may be followed by a tab (example 10).
- `<textarea>` opens an HTML block of the first kind, as `<pre>`, `<script>` and `<style>` do (example 171).
- Raw inline HTML follows the spec: no whitespace between `<` and the tag name, and no line break there either, and the comment forms of 0.31.2, `<!-->`, `<!--->` and `--` inside a comment (examples 621, 625, 626).

With these fixes the oracle scores of the tree (`docs/syntax.md`) do not change.

The fourth difference is a design choice of `@lezer/markdown`, not a defect. To parse incrementally, it does not check that a link reference is defined, so it reads `[foo]` as a link even without a `[foo]:` definition. Brackets and emphasis around such a link then pair differently (examples 493, 512, 523, 528, 569, 571). `linkReferenceCheck(labels)` makes a parser check the labels it is given, and `parseWithLinkReferences(parser, text)` parses a whole document twice, first to collect its labels. The suite parses that way. A tree parsed with the check cannot be reused once an edit adds or removes a definition, so the editor's parser does without it.

## Each flag on the CommonMark suite

The test toggles every flag by itself from each preset. For each flag it compares every CommonMark example's parse with the preset's own parse: the Lezer tree's nodes, markdown-it's tokens and micromark's events. The examples a flag changes are the same for every preset and every adapter, and each one uses the flag's syntax:

| Flag | Examples it changes | Why |
| --- | --- | --- |
| `autolinkLiteral` | 602, 608, 611, 612 | They hold a URL or an email address that is no CommonMark autolink, which CommonMark leaves as text. |
| `frontMatter` | 96, 98 | They open with a `---` line, which CommonMark reads as a thematic break. |
| `internalLink` | 548, 559, 590 | They hold `[[foo]]`, `[[*foo* bar]]` or `![[foo]]`, which CommonMark reads as brackets around a link or as text. |
| `tag` | 64 | `#hashtag`, which CommonMark reads as text and not as a heading. `#5` is no tag, since its name is all digits. |
| the rest | none | No CommonMark example uses their syntax. |

## Obsidian's quirks

### How they were measured

`scripts/spec-oracle.ts` runs every CommonMark example and every GFM extension example through Obsidian 1.14.4, driven over CDP as `scripts/oracle.ts` drives it, and reads all three of its parsers:

- the editor's tree, as `scripts/oracle.ts` reads it;
- the metadata worker's `CachedMetadata`, from `app.metadataCache.computeMetadataAsync`;
- the reading view's DOM, from `MarkdownRenderer.render`, with `strictLineBreaks: true` and with the app's default `strictLineBreaks: false`.

The reading view's DOM is compared with the spec's HTML put through the same DOM, after taking off what the reading view adds to the parser's HTML: the copy button and the syntax highlighting of code blocks, the attributes it puts on headings, links and blocks, and the classes of links. Link targets are compared decoded, and attributes in name order. The result is `oracle/spec-obsidian-1.14.4.json`.

`src/oracle/spec-quirks.ts` explains each difference, and `src/oracle/spec-quirks.test.ts` pins it: every example the reading view renders differently is listed under a behaviour, and every listed example still differs.

- The reading view differs from the spec on **211 of the 674 examples** with `strictLineBreaks: true`. `strictLineBreaks: false` changes 66 more renderings.
- The **metadata worker runs the same parser** as the reading view: its sections, without definitions, agree with the reading view's top-level blocks on every example but 14, which hold raw HTML (the reading view reads it into elements, and its sanitizer prunes them) or front matter.
- The **editor** is a separate line tokenizer, whose behaviour `src/editor/` already reproduces exactly (`docs/phase-1.md`), so it is no source of tree quirks.

### The differences

| Behaviour | Kind | Examples | Flag |
| --- | --- | --- | --- |
| A setext heading's text is one line, and its underline starts its line and ends with its marker. | quirk | 81, 82, 84, 86, 95 | `setextHeading: 'single-line'` |
| An empty list item (`*`, `+`, `-`, `1.`) interrupts a paragraph. | quirk | 285, 367 | `emptyListItem: 'interrupts-paragraph'` |
| A list is loose when a blank line anywhere inside it, in a nested list or in fenced code, is followed by more of it. | quirk | 307, 318, 319 | `looseList: 'blank-line-anywhere'` |
| With `strictLineBreaks: false`, a line ending inside a paragraph is a hard line break. | quirk | 65 CommonMark examples and GFM 199 | `softLineBreak: 'hard-break'` |
| A tab is not expanded to its tab stop. | quirk | 2, 5, 6, 7, 9, 11 | none |
| A named character reference needs no `;`, and a numeric one past the last code point is U+FFFD. | quirk | 28, 29 | `characterReference: 'obsidian'` |
| A paragraph keeps its leading whitespace, and its trailing whitespace. | quirk | 82, 84, 222, 224, 226, 241, 252, 255, 275, 276, 278, 280, 645 | none |
| Fenced code that runs to the end of the document keeps its last line ending as an empty line. | quirk | 127, 137, 139 | none |
| A lazy line continues a quote after an empty `>` line and inside fenced code, and ends it when indented. | quirk | 93, 237, 238, 249 | none |
| A definition's title is on its line or none, `<>` is no destination, and a setext underline makes a definition a heading. | quirk | 196, 200, 202, 210, 216 | `linkDefinition: 'obsidian'` |
| List item structure: a marker indented four or more columns opens a sibling, a paragraph indented less than the content column stays in the item after a blank line, ordered markers take ten digits. | quirk | 257, 266, 278, 280, 312, 313 | `listItem: 'obsidian'`, not in `@lezer/markdown` |
| `<textarea>` opens no raw HTML block, and `</pre>` ends a paragraph. | quirk | 148, 171 | `htmlBlock: 'obsidian'` |
| HTML comments follow CommonMark 0.30. | quirk | 625, 626 | `htmlComment: 'obsidian'` |
| Emphasis has its own delimiter rules, and is matched before code spans, raw HTML, autolinks and link brackets. | quirk | 79 examples and GFM 631 | none |
| A link may hold a link, link brackets are matched before code spans, raw HTML and autolinks, and reference labels and destinations have their own rules. | quirk | 19 examples | none |
| A code span's opening run closes at a shorter run. | quirk | 347 | none |
| An image's description is its source text. | quirk | 520, 573, 574, 575, 576, 577, 585, 589 | none |
| An autolink takes only some schemes, and a `mailto:` one shows no scheme. | quirk | 597, 598, 601, 606 | `autolink: 'obsidian'` |
| Tables: edge pipes, escaped pipes in code, rows without a pipe, short delimiter rows. | quirk | GFM 199, 200, 202, 203 | `gfmTable: 'obsidian'` |
| No bare `ftp://` URL, and no tag filter. | quirk | GFM 628, 652 | none |
| The `obsidian` preset's syntax: tags, front matter, internal links, bare URLs. | syntax | 64, 96, 98, 548, 559, 590, 602, 608, 611, 612 | `ObsidianSyntaxFlags` |
| The reading view's HTML sanitizer, and its embeds of vault files. | rendering | 27 examples and GFM 652 | none |
| The spec's HTML holds an unclosed tag, which the browser closes and repeats. | comparison | 10 examples | none |

`src/oracle/spec-quirks.ts` lists every example of each row, and the part of the behaviour each one shows.

### The flags

`src/syntax/options.ts` defines one flag per quirk in `ObsidianQuirkFlags`. Each takes the CommonMark behaviour (`COMMONMARK_QUIRKS`), which every preset keeps, or Obsidian's (`OBSIDIAN_QUIRKS`). Options take them beside the syntax flags, for example `{ preset: 'obsidian', setextHeading: 'single-line' }`. The first four name the behaviour; the others swap a construct's rules for Obsidian's, so they take `'commonmark'` or `'obsidian'`.

| Flag | `@lezer/markdown` | micromark and mdast | markdown-it |
| --- | --- | --- | --- |
| `setextHeading` | a leaf parser drops the setext heading parser from a paragraph whose underline Obsidian does not read, and a `---` line then ends the paragraph | a setext underline construct that checks Obsidian's rule before micromark's own | an `lheading` rule that reads Obsidian's setext heading |
| `emptyListItem` | an `endLeaf` check | a list construct that lets an empty item interrupt | a rule in the paragraph's terminator chain |
| `looseList` | `renderLezerHtml`'s `looseList` option, since the tree does not say whether a list is loose | a resolver marks each list the quirk makes loose, `micromarkQuirksHtml` renders it, and `parseMdast` spreads its items | a core rule shows the list's paragraphs |
| `softLineBreak` | a `HardBreak` node for each line ending of inline content | a `hardBreakTrailing` token before each one, which mdast reads as a `break` | a core rule turns each `softbreak` into a `hardbreak` |
| `characterReference` | an inline parser before `Entity`, and `renderLezerHtml` decodes the reference as Obsidian does | a construct beside micromark's in inline content, whose value token carries the text, which `micromarkQuirksHtml` and `parseMdast` read | an inline rule before `entity` |
| `autolink` | an inline parser before `RawHTML`, and `renderLezerHtml` shows the link as Obsidian does | a construct in place of `autolink`, whose target token carries the text and the address | a rule in place of `autolink` |
| `htmlComment` | an inline parser before `RawHTML` | a construct in place of `htmlText` that checks the comment first | an inline rule before `html_inline` |
| `htmlBlock` | an HTML block parser in place of `HTMLBlock`, without the `<textarea>` fix | a construct in place of `htmlFlow` | a rule in place of `html_block` |
| `linkDefinition` | a `LinkReference` leaf parser in place of `@lezer/markdown`'s | a construct in place of `definition`, and a probe at setext underlines | a rule in place of `reference` |
| `gfmTable` | `obsidianTable` in place of `Table` | `micromarkObsidianTable` in place of `micromark-extension-gfm-table`, with its tokens | a rule in place of `table`, after every other block |
| `listItem` | none: list item continuation is internal | `obsidianList`, a port of micromark's list construct, in place of `list` | a port of the `list` rule |

The rules every adapter shares are in `src/syntax/quirk-rules.ts`.

`spec-suites.test.ts` turns each quirk on alone from each preset, and checks the CommonMark examples whose rendering changes, and the GFM extension examples from the `gfm` preset. They are the same for every preset and every adapter, but where the table says otherwise:

| Flag | Examples it changes |
| --- | --- |
| `setextHeading` | 81, 82, 84, 86, 95 |
| `emptyListItem` | 285, 367 |
| `looseList` | 307, 318, 319, and 280 in `@lezer/markdown`, which keeps that example's paragraph in its list item (its one failing example) |
| `softLineBreak` | every example with a soft line break, 67 of them, and GFM 203, which GFM reads as a paragraph |
| `characterReference` | 28, 29 |
| `autolink` | 597, 598, 601, 606 |
| `htmlComment` | 625, 626 |
| `htmlBlock` | 148, 171 |
| `linkDefinition` | 196, 200, 202, 210, 216, and 546 and 552, whose labels hold a bracket or only whitespace: Obsidian reads those definitions too, and differs from the spec on their links as well |
| `gfmTable` | GFM 199, 200, 202, 203 |
| `listItem` | 257, 266, 278, 280, 312, 313 in micromark and markdown-it, none in `@lezer/markdown` |

With every quirk at its CommonMark behaviour, each adapter passes the CommonMark suite as before, and with all of them on, every adapter renders both suites, and `parseMdast` builds their trees.

`src/oracle/spec-quirks.test.ts` checks the flags against Obsidian itself: with one quirk on, each adapter renders the quirk's examples as the reading view does, except where another of Obsidian's quirks shows in the same example. `setextHeading` misses 82 and 84, and `listItem` 278 and 280, whose paragraphs keep their leading whitespace. `htmlBlock` misses 148 and 171, whose raw HTML the reading view's DOM rewrites: it adds `<tbody>`, drops the line ending after `<pre>`, and holds the HTML after `<textarea>` as its text. `listItem` misses all six in `@lezer/markdown`. `softLineBreak` misses 16 of its CommonMark examples and GFM 199, each for another quirk in the table above, and its examples differ from Obsidian's own list where Obsidian parses the example differently: 84, 196, 210, 241 and 625 have a soft line break only in Obsidian's parse, and 93, 148, 216, 238, 285, 312 and 367 only in CommonMark's.

### Where the rules come from

Obsidian's reading view and its metadata worker parse with `remark-parse` 8 (`commonmark: true`), whose own rules give most of these quirks. So the rules of `characterReference`, `autolink`, `htmlComment`, `htmlBlock` and `linkDefinition` are re-expressed from `remark-parse` 8 and `parse-entities` 2, under their MIT licenses (`THIRD-PARTY-NOTICES.md`), and the definition parser was fuzzed against `remark-parse` 8 itself: on 300,000 random one-block documents, about 22,000 of them definitions, the two found the same definitions, ending in the same place.

Obsidian's table and list rules were measured on the live app, on documents beyond the spec examples. `scripts/quirk-probe-oracle.ts` reads the documents of `src/oracle/quirk-probes.ts` from the reading view and the metadata worker into `oracle/quirk-probes-obsidian-1.14.4.json`, as `scripts/spec-oracle.ts` reads the spec examples, and `src/oracle/quirk-probes.test.ts` checks every flag against them. The 101 probes of the flags show:

- **Tables**: a row starts with a pipe, or does not, as the header does, and one that disagrees ends the table; whitespace before the first pipe is a start without one, and makes an empty first cell. The delimiter row gives the columns: a `:` alone aligns left, and no cell but the first may be empty. A line with no pipe after its first character ends the table, and nothing else does, so `> q|x` and `# h|x` are rows. A table interrupts no paragraph.
- **Lists**: the rules of `listItem`, as the flag describes them, over markers of 10 and 14 digits, siblings indented up to five columns, and items whose first line is empty.

Every probe reproduces the reading view with its flag in every adapter, except for:

- what the reading view's sanitizer and DOM do to the parser's HTML: comments, `<meta>`, a `javascript:` target and stray end tags;
- a link title's character references, which Obsidian reads as inline content's and the flag leaves to CommonMark;
- paragraphs that keep their leading whitespace (see [the differences](#the-differences));
- in `@lezer/markdown` and micromark, a row of a table without a leading pipe that opens a container (`- | -`, `> q|x`), which ends the table: both read containers before the table can see the line. `@lezer/markdown` also ends one at any block that interrupts a paragraph, such as `# h|x`;
- in `@lezer/markdown`, `listItem`.

### The quirks that are no flag

- **Inline algorithms**: emphasis, links, code span runs. Each adapter reads inline content with its own delimiter and bracket algorithm, which no extension point changes. Reproducing them needs Obsidian's inline algorithm in place of the adapter's, not a flag.
- **Tabs and lazy quote lines**: each adapter measures indentation and decides lazy continuation inside its own container handling, which no extension point reaches.
- **Leading and trailing whitespace, unclosed fenced code, image descriptions**: the trees agree with CommonMark on these. Only the text a renderer takes from the source differs.
- **Rendering and comparison**: the sanitizer, embeds and the spec's unclosed tags are not the parser's.

#### Measured beyond the spec examples

The 68 other probes of `src/oracle/quirk-probes.ts` show these quirks on documents the spec examples do not hold, each tagged with an `UnflaggedQuirk`: 20 of emphasis, 16 of links, 5 of code spans, 3 of image descriptions, 8 of tabs, 10 of lazy quote lines and 6 of paragraph whitespace. With every quirk flag on, each adapter gives the reading view on 34 of them, the same 34 in all three, and `quirk-probes.test.ts` pins the other 34. They show:

- **Emphasis**: a `_` run inside a word opens and closes (`foo_bar_baz __a__b` has `<strong>a</strong>b`), whitespace on either side of a run does not stop it (`a ** b ** c`), and a run pairs with the first run that can close it, before code spans, raw HTML, autolinks and link brackets are read (``` `` *a `*` b* `` ``` is ``` `` <em>a `</em>` b* `` ```). `***a***` is `<strong><em>a</em></strong>`.
- **Links**: a link may hold one (`[a [b](c)](d)` is one link, whose text is `a [b](c)`). A code span, raw HTML or an autolink does not stop a `]`, which makes them text, not a link (``` `` [a `]` b](c) `` ``` stays text). Reference labels are not trimmed or collapsed: `[ a ]` matches no `[a]:` definition, and `[a]` matches no `[ a ]:` one.
- **Code spans**: an opening run closes at a shorter run: ```` ``` a `` ```` is a backtick and a code span `a`.
- **Image descriptions**: the description is its source text, ``` `` *a* `b` [c](d) `` ``` as it stands.
- **Tabs**: a tab after `>` opens indented code (`>\ta`), indented code takes no remainder of a tab as spaces (`-\t\ta` is the code `a`), and a line indented by a space and a tab does not go on indented code.
- **Lazy quote lines**: an empty `>` line does not end the paragraph, so the next line is a lazy paragraph in the quote, an indented line after a quote is indented code outside it, a lazy line goes on fenced code in a quote, and a line after indented code in a quote is a paragraph in the quote.
- **Paragraph whitespace**: a paragraph keeps the whitespace that starts its first line and ends its last.

#### Where these come from, and the decision

All of them are `remark-parse` 8's own rules. Stock `remark-parse` 8.0.3 with `commonmark: true` and `gfm: true`, with Obsidian's edits to three of its block tokenizers (`blockquote`, `list` and `table`, as the [Where the rules come from](#where-the-rules-come-from) section says), was rendered with `remark-html` 13, put through a DOM, and compared with the reading view as the tests compare an adapter. On the spec oracle it gives the reading view's HTML on 171 of the 211 examples where the reading view differs from the spec: every example of every `quirk` row of [the differences](#the-differences) but 187 and 494, whose spec HTML holds an unclosed tag. The other 40 examples are the `obsidian` preset's syntax (not loaded in the measurement), the sanitizer, embeds and the spec's unclosed tags. It changes 2 of the 463 examples where the reading view and the spec agree, 154 and 627, an attribute's line ending and a `<?php` tag, which the reading view's HTML handling and the measurement's DOM treat differently: the parses agree. On the probes it gives the reading view on 159 of the 169, all 68 of these and all of the flags' but the 10 the sanitizer or the DOM changes. The measurement took the three edited tokenizers from the app, so it is not in this repository, which takes no code from the app.

So the choice was:

1. **A fourth parser, built on `remark-parse` 8 with Obsidian's three block edits, re-expressed in this package.** It gives an mdast tree that reads every quirk as Obsidian does by construction, and it is the parser the `CachedMetadata` projection of phase 2 needs.
2. An `inline: 'commonmark' | 'obsidian'` flag in each adapter, a port of `remark-parse` 8's inline tokenizers into each one's inline model. It would leave out tabs, lazy quote lines and paragraph whitespace, which are container handling that no extension point reaches, and it would be three ports of one algorithm.
3. Leaving them out of scope, with this measurement as the record.

**Decided (2026-10-14): the first.** The three adapters keep their own inline algorithm and container handling, which is what each one's ecosystem expects, and get no `inline` flag. The quirk flags stay what they are: the block and syntax rules an adapter's extension points reach. A reader that wants Obsidian's parse exactly uses the fourth parser.

**Built (2026-10-14):** `src/remark/`, `parseRemark` and `renderRemarkHtml`. It gives the reading view's HTML on every example of the `quirk` rows but five that the browser or the sanitizer changes after the parse, and on all 68 probes of these quirks; [The `remark-parse` 8 engine](remark.md) has its edits, how it is checked and what it misses.

## What is left

- **The Obsidian syntax in the fourth parser**: the engine reads Obsidian's markdown, but not yet its syntax ([what is left there](remark.md#what-is-left)).
- **`listItem` in `@lezer/markdown`**, and **example 280** there, which both need a change to its list item continuation.
- **Pipe-less table rows that open a container** in `@lezer/markdown` and micromark, and other paragraph-interrupting blocks in `@lezer/markdown`.
- **The edges of the flags' rules**: a link title's lenient character references; a definition that runs over a blank line, which Obsidian reads and no adapter does, since none reads a paragraph over one; an HTML block's empty line read after whitespace a container took; and an item whose empty first line has trailing spaces.
