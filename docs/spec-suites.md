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
| A named character reference needs no `;`, and a numeric one past the last code point is U+FFFD. | quirk | 28, 29 | none |
| A paragraph keeps its leading whitespace, and its trailing whitespace. | quirk | 82, 84, 222, 224, 226, 241, 252, 255, 275, 276, 278, 280, 645 | none |
| Fenced code that runs to the end of the document keeps its last line ending as an empty line. | quirk | 127, 137, 139 | none |
| A lazy line continues a quote after an empty `>` line and inside fenced code, and ends it when indented. | quirk | 93, 237, 238, 249 | none |
| A definition's title is on its line or none, `<>` is no destination, and a setext underline makes a definition a heading. | quirk | 196, 200, 202, 210, 216 | none |
| List item structure: a marker indented four or more columns opens a sibling, a paragraph indented less than the content column stays in the item after a blank line, ordered markers take ten digits. | quirk | 257, 266, 278, 280, 312, 313 | none |
| `<textarea>` opens no raw HTML block, and `</pre>` ends a paragraph. | quirk | 148, 171 | none |
| HTML comments follow CommonMark 0.30. | quirk | 625, 626 | none |
| Emphasis has its own delimiter rules, and is matched before code spans, raw HTML, autolinks and link brackets. | quirk | 79 examples and GFM 631 | none |
| A link may hold a link, link brackets are matched before code spans, raw HTML and autolinks, and reference labels and destinations have their own rules. | quirk | 19 examples | none |
| A code span's opening run closes at a shorter run. | quirk | 347 | none |
| An image's description is its source text. | quirk | 520, 573, 574, 575, 576, 577, 585, 589 | none |
| An autolink takes only some schemes, and a `mailto:` one shows no scheme. | quirk | 597, 598, 601, 606 | none |
| Tables: edge pipes, escaped pipes in code, rows without a pipe, short delimiter rows. | quirk | GFM 199, 200, 202, 203 | none |
| No bare `ftp://` URL, and no tag filter. | quirk | GFM 628, 652 | none |
| The `obsidian` preset's syntax: tags, front matter, internal links, bare URLs. | syntax | 64, 96, 98, 548, 559, 590, 602, 608, 611, 612 | `ObsidianSyntaxFlags` |
| The reading view's HTML sanitizer, and its embeds of vault files. | rendering | 27 examples and GFM 652 | none |
| The spec's HTML holds an unclosed tag, which the browser closes and repeats. | comparison | 10 examples | none |

`src/oracle/spec-quirks.ts` lists every example of each row, and the part of the behaviour each one shows.

### The flags

`src/syntax/options.ts` defines one flag per quirk in `ObsidianQuirkFlags`. Each takes the CommonMark behaviour (`COMMONMARK_QUIRKS`), which every preset keeps, or Obsidian's (`OBSIDIAN_QUIRKS`). Options take them beside the syntax flags, for example `{ preset: 'obsidian', setextHeading: 'single-line' }`.

| Flag | `@lezer/markdown` | micromark and mdast | markdown-it |
| --- | --- | --- | --- |
| `setextHeading` | a leaf parser drops the setext heading parser from a paragraph whose underline Obsidian does not read, and a `---` line then ends the paragraph | a setext underline construct that checks Obsidian's rule before micromark's own | an `lheading` rule that reads Obsidian's setext heading |
| `emptyListItem` | an `endLeaf` check | a list construct that lets an empty item interrupt | a rule in the paragraph's terminator chain |
| `looseList` | `renderLezerHtml`'s `looseList` option, since the tree does not say whether a list is loose | a resolver marks each list the quirk makes loose, `micromarkQuirksHtml` renders it, and `parseMdast` spreads its items | a core rule shows the list's paragraphs |
| `softLineBreak` | a `HardBreak` node for each line ending of inline content | a `hardBreakTrailing` token before each one, which mdast reads as a `break` | a core rule turns each `softbreak` into a `hardbreak` |

`spec-suites.test.ts` turns each quirk on alone from each preset, and checks the CommonMark examples whose rendering changes. They are the same for every preset and every adapter:

| Flag | Examples it changes |
| --- | --- |
| `setextHeading` | 81, 82, 84, 86, 95 |
| `emptyListItem` | 285, 367 |
| `looseList` | 307, 318, 319, and 280 in `@lezer/markdown`, which keeps that example's paragraph in its list item (its one failing example) |
| `softLineBreak` | every example with a soft line break, 67 of them |

With every quirk at its CommonMark behaviour, each adapter passes the CommonMark suite as before.

`src/oracle/spec-quirks.test.ts` checks the flags against Obsidian itself: with one quirk on, each adapter renders the quirk's examples as the reading view does, except where another of Obsidian's quirks shows in the same example. `setextHeading` misses 82 and 84, whose paragraphs keep their leading whitespace. `softLineBreak` misses 16 of its examples, each for another quirk in the table above, and its examples differ from Obsidian's own list where Obsidian parses the example differently: 84, 196, 210, 241 and 625 have a soft line break only in Obsidian's parse, and 93, 148, 216, 238, 285, 312 and 367 only in CommonMark's.

### The quirks that are no flag yet

- **Inline algorithms**: emphasis, links, code span runs. Each adapter reads inline content with its own delimiter and bracket algorithm, which no extension point changes. Reproducing them needs Obsidian's inline algorithm in place of the adapter's, not a flag.
- **Tabs and lazy quote lines**: each adapter measures indentation and decides lazy continuation inside its own container handling, which no extension point reaches.
- **List item structure**: list item continuation is internal to `@lezer/markdown`, as for example 280 below. micromark and markdown-it need their list constructs replaced.
- **Leading and trailing whitespace, unclosed fenced code, image descriptions**: the trees agree with CommonMark on these. Only the text a renderer takes from the source differs.
- **Character references, definitions, HTML block kinds, HTML comments, autolinks, tables**: each adapter can express them, with its own construct or rule for the syntax. They are not done yet.
- **Rendering and comparison**: the sanitizer, embeds and the spec's unclosed tags are not the parser's.

## What is left

- **The quirks that are no flag yet**, listed above.
- **Example 280** in `@lezer/markdown`, which needs a change to its list item continuation.
