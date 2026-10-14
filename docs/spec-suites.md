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

`src/syntax/options.ts` defines one flag per construct, and three presets:

| Preset | Flags on |
| --- | --- |
| `commonmark` | none |
| `gfm` | `table`, `strikethrough`, `autolinkLiteral` |
| `obsidian` (the default) | all of them |

The other flags are the Obsidian syntax: `internalLink`, `tag`, `comment`, `math`, `highlight`, `footnote`, `inlineFootnote`, `blockId`, `callout`, `task` and `frontMatter`. Options are a preset with any flag overridden, for example `{ preset: 'commonmark', tag: true }`. Every adapter takes them:

- `createObsidianParser(options)` and `createObsidianMarkdown(options)` for `@lezer/markdown`. A parser is configured once, and incremental parsing needs the same parser for every edit.
- `createMicromarkObsidianMarkdown(options)` for micromark, and `createMicromarkObsidianSyntax(flags)` for the Obsidian syntax alone.
- `createObsidianMarkdownIt(options)` for markdown-it, which starts from markdown-it's `commonmark` preset, and `md.use(markdownItObsidianSyntax, options)` for the plugin alone.

The existing exports (`obsidianParser`, `micromarkObsidianMarkdown`, `parseMarkdownIt` and the rest) are the `obsidian` preset.

Every flag adds syntax. A document that uses it parses differently, and one that does not parses as before. So no flag is a quirk: a quirk changes how valid CommonMark parses, and none is implemented yet (see [What is left](#what-is-left)).

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

## What is left

- **Obsidian's quirks.** A quirk changes how valid CommonMark parses. An example is a list item's child indented less than its content column. The oracle has measured only the editor so far. The editor's differences from the tree (`docs/syntax.md`) are the behaviour of its line tokenizer, which the class layer reproduces exactly. The tree's quirks come from the metadata worker and the reading view, which run remark-parse 8 outside its `commonmark` mode. Each quirk is to be measured against Obsidian on the spec examples, recorded with the behaviour that shows it (the editor, the metadata worker or the reading view) and the examples it breaks, and added as a flag that every preset leaves off.
- **Example 280** in `@lezer/markdown`, which needs a change to its list item continuation.
