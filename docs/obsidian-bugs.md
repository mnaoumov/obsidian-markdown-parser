# Obsidian bugs

A ledger of the bugs and inconsistencies in Obsidian's own parsing that this parser met while it was measured against the app. It is for the Obsidian team: it shows which of them adopting the parser would close, which it reproduces on purpose, and where the fix would go. It is private, like the rest of the repository.

Each bug is also reported in the [Bug reports](https://forum.obsidian.md/c/bug-reports/7) category of the Obsidian forum. A report there describes Obsidian's behaviour only, with steps any user can follow, and never names this parser.

Much of the parser reproduces Obsidian on purpose. The class tokenizer (`src/editor/`) gives the editor's classes exactly, because themes depend on them, and `parseRemark` and `parseMetadata` (`src/remark/`, `src/metadata/`) give the reading view's parse and the metadata worker's `CachedMetadata` exactly. So for many bugs the parser does what Obsidian does today, pinned by an oracle, and the entry says where a fix would go. The `@lezer/markdown` tree and the other two adapters (`src/syntax/`) follow CommonMark in every preset, and take Obsidian's departures only as the flags of `ObsidianQuirkFlags` in `src/syntax/options.ts` ([spec-suites.md](spec-suites.md#the-flags)).

Every behaviour below was re-tested on Obsidian 1.14.5, the current public release, in a vault with no community plugins and the default theme and settings. Where an entry says "run here", the parser's output was read on the entry's sample with the code as it stands; it is not otherwise pinned.

## Adding an entry

1. Re-test the bug on the current public release, in a vault with no community plugins.
2. Search the forum for a duplicate. If one exists, add the entry with that thread and post no new report.
3. Add the entry here and a forum draft in the same change. The draft follows the category's template and describes Obsidian's behaviour only.
4. Once the report is posted, replace "not posted yet" with the thread's URL.

An entry that no longer reproduces moves to [Not bugs any more](#not-bugs-any-more).

## Summary

The components are the editor (Source mode and Live Preview), the metadata cache, the reading view, and CommonMark 0.31.2 where Obsidian departs from it.

| Bug | Title | Components | This parser | Forum |
| --- | --- | --- | --- | --- |
| B1 | A property value like `[text]()` wipes the note's metadata | metadata cache | reproduces | [119745](https://forum.obsidian.md/t/119745) |
| B2 | A property named `hasOwnProperty` wipes the note's metadata | metadata cache | reproduces | [119750](https://forum.obsidian.md/t/119750) |
| B3 | A note with a footnote gets two empty sections | metadata cache | reproduces | not posted yet |
| B4 | Front matter closed by `---` and trailing spaces, `---x` or `----` | metadata cache, editor, `getFrontMatterInfo` | reproduces each side | not posted yet |
| B5 | Highlights with `===` or starting with `>` | editor, reading view | reproduces each side | [119746](https://forum.obsidian.md/t/119746) |
| B6 | A `%%` opened mid-line runs on in the editor | editor, reading view, metadata cache | partly fixed in the tree | not posted yet |
| B7 | An unclosed `$$` turns the blocks after it into math | editor, reading view | partly fixed in the tree | not posted yet |
| B8 | Inline code that wraps onto the next line | editor, reading view | fixed in the tree | not posted yet |
| B9 | `$math$` in a markdown link's text | editor, reading view | fixed in the tree | not posted yet |
| B10 | A math-only setext heading is a rule after a line that started with math | editor, reading view, metadata cache | fixed in the tree | not posted yet |
| B11 | A task in a quote is not styled as a task | editor, metadata cache, reading view | fixed in the tree | not posted yet |
| B12 | A fence left open in a quote or list item runs on | editor, reading view | fixed in the tree | not posted yet |
| B13 | Emphasis ignores CommonMark's delimiter rules | reading view, CommonMark | CommonMark in the adapters | not posted yet |
| B14 | A `*` or `]` inside inline code closes emphasis or a link | reading view, CommonMark | CommonMark in the adapters | not posted yet |
| B15 | A link inside a link's text | reading view, CommonMark | CommonMark in the adapters | not posted yet |
| B16 | Reference link labels | reading view, CommonMark | CommonMark in the adapters; flag in part | not posted yet |
| B17 | A code span opened with three backticks closes at two | reading view, CommonMark | CommonMark in the adapters | not posted yet |
| B18 | An image's alt text keeps the markdown source | reading view, CommonMark | CommonMark in the adapters | not posted yet |
| B19 | Tabs are not expanded to tab stops | reading view, CommonMark | CommonMark in the adapters | not posted yet |
| B20 | Blockquote continuation lines | reading view, CommonMark | CommonMark in the adapters | not posted yet |
| B21 | List item boundaries | reading view, CommonMark | CommonMark in the adapters; flags | not posted yet |
| B22 | A blank line in a nested list spaces out the outer list | reading view, CommonMark | CommonMark in the adapters; flag | not posted yet |
| B23 | A code block left open at the end gets an extra empty line | reading view, CommonMark | CommonMark in the adapters | not posted yet |
| B24 | `&copy` and `&nbsp` without a semicolon become characters | reading view, CommonMark | CommonMark in the adapters; flag | not posted yet |
| B25 | Autolink schemes, and `<mailto:...>` hiding the scheme | reading view, CommonMark | CommonMark in the adapters; flag | not posted yet |
| B26 | An indented line that starts with math is math in the editor | editor, reading view | fixed in the tree | [50661](https://forum.obsidian.md/t/50661) |
| B27 | A setext heading takes only one line | reading view, editor, CommonMark | CommonMark in the adapters; flag | [112786](https://forum.obsidian.md/t/112786) |
| B28 | Live Preview hides a backslash at the start of an indented code block | editor, reading view | fixed in the tree | not posted yet |

"Fixed in the tree" means the `@lezer/markdown` tree reads the sample as the reading view does, while the class tokenizer still reproduces the editor. "CommonMark in the adapters" means the `@lezer/markdown`, micromark and markdown-it adapters read it as CommonMark does, while `parseRemark` reproduces the reading view.

## Bugs

### B1. A property value like `[text]()` wipes the note's metadata

**Obsidian:** a front matter string that is a markdown link with no destination makes the metadata worker throw. `getFileCache` returns `null`, so the note loses every link, heading, tag, section and property, and `resolvedLinks` has no entry for it. `[text]( )` does the same. `[text](x)`, and `[text]()` in the body, are fine.

```markdown
---
k: "[text]()"
---
# Heading

[[Target]] #tag
```

**Components:** the metadata cache, against what the note holds.

**This parser:** reproduces it. `parseMetadata` returns `null` where the worker throws: `src/metadata/frontmatter.ts` throws a `WorkerFailure` for a front matter string that is a markdown link with no destination ([metadata.md](metadata.md#where-the-worker-throws)). The fix is that one check, since the rest of the projection never fails on such a value.

**Pinned by:** `src/metadata/metadata.test.ts`, "is null where the worker throws" (`k: "[t]()"`).

**Forum:** <https://forum.obsidian.md/t/119745>

### B2. A property named `hasOwnProperty` wipes the note's metadata

**Obsidian:** a front matter key `hasOwnProperty`, at any depth, makes the metadata worker throw, and `getFileCache` returns `null`. The worker calls the object's own `hasOwnProperty`, which the key hides. `foo: 1` in the same place is fine.

```markdown
---
hasOwnProperty: 1
---
# Heading

[[Target]] #tag
```

**Components:** the metadata cache, against what the note holds.

**This parser:** reproduces it. `src/metadata/frontmatter.ts` throws a `WorkerFailure` when an object's `hasOwnProperty` is not a function, and `parseMetadata` returns `null`. The fix is that one check: `Object.hasOwn` in the worker, or leaving the check out here.

**Pinned by:** `src/metadata/metadata.test.ts`, "is null where the worker throws" (`hasOwnProperty: 1`).

**Forum:** <https://forum.obsidian.md/t/119750>

### B3. A note with a footnote gets two empty sections

**Obsidian:** a note with a footnote definition or an inline footnote gets two more sections after its last block, of type `text` and `element`, both zero-length at the start of the line after the last block. The `element` section takes the last block id the footnotes hold, and `blocks` then points that id at the empty position instead of the definition.

```markdown
Text[^1]

[^1]: Note ^abc
```

**Components:** the metadata cache's `sections` and `blocks`, against the note's blocks.

**This parser:** reproduces it. On the sample `parseMetadata` gives the four sections, the `element` one with `id: "abc"`, and `blocks.abc` at line 3, column 0 (run here). They come from the footnotes section the worker builds after the document's blocks ([metadata.md](metadata.md#what-the-worker-does)), which `src/metadata/metadata.ts` reproduces. A fix there would leave the two sections out and keep the block id on its definition; not checked further.

**Pinned by:** `src/metadata/metadata.test.ts`, "puts the footnotes section on the line after the last block" (an inline footnote), and the worker oracle (`src/oracle/worker-metadata.test.ts`).

**Forum:** not posted yet (draft 03).

### B4. Front matter closed by `---` and trailing spaces, `---x` or `----`

**Obsidian:** the metadata cache closes front matter at the first later line that starts with `---`, whatever follows on it. `getFrontMatterInfo` and `processFrontMatter` want the closing `---` followed directly by a line break or the end of the file, so they see no front matter, and `processFrontMatter` adds a second front matter block at the top. Live Preview shows the YAML as raw lines with no Properties block, and for `---x` and `----` styles the next line as front matter too. The status bar counts the property.

```markdown
---
a: 1
---   
text
```

The closing line above has three trailing spaces. `---x` gives a paragraph `x` and the next line, and `----` an empty list item holding the next line.

**Components:** the metadata cache, against `getFrontMatterInfo`, `processFrontMatter` and the editor.

**This parser:** reproduces each side. `parseRemark` and `parseMetadata` read front matter up to the next line that opens with `---`, as the cache does ([remark.md](remark.md#the-obsidian-syntax)): on the three closing lines they give front matter `{ a: 1 }` and then a paragraph `text`, a paragraph `x` and `text`, or a list item holding `text` (run here). The Lezer tree needs a closing line of exactly `---`, and front matter that never closes runs to the end of the document, as in the editor ([syntax.md](syntax.md#the-rules)). The class tokenizer gives the editor's classes. No engine has `getFrontMatterInfo`'s rule. The fix is one rule for all of them, which is Obsidian's to choose; here it would change the front matter tokenizer in `src/remark/obsidian.ts` and the front matter parser in `src/syntax/lezer.ts`.

**Pinned by:** the worker oracle holds three documents whose front matter closes with `---x` (`oracle/worker-metadata-obsidian-1.14.5.json`, `src/oracle/worker-metadata.test.ts`). No test holds the trailing spaces or `----`.

**Forum:** not posted yet (draft 04). Related, fixed in 1.3.2: <https://forum.obsidian.md/t/57003> (an editor bug with spaces after the closing `---`).

### B5. Highlights with `===` or starting with `>`

**Obsidian:** the editor reads any run of two or more `=` as one mark and never opens a highlight before `>`. The reading view opens at the first `==` before a character that is no whitespace, and closes at the first `==` after one.

```markdown
a ===marked=== b

a ==>x== b

a ==> next step== b
```

| Markdown | Editor | Reading view |
| --- | --- | --- |
| `===marked===` | `marked` | `=marked`, then a plain `=` |
| `==>x==` | nothing | `>x` |
| `==> next step==` | nothing | `> next step` |

**Components:** the editor against the reading view.

**This parser:** reproduces each side. The class tokenizer and the Lezer tree follow the editor, and so do the micromark and markdown-it adapters, since the syntax rule in `src/syntax/spec.ts` is the editor's. `parseRemark` follows the reading view ([remark.md](remark.md#where-the-worker-and-the-editor-differ)). The fix is choosing one rule: for the tree and the adapters it is the highlight rule in `src/syntax/spec.ts`, and for the reading view's engine the highlight tokenizer in `src/remark/obsidian.ts`.

**Pinned by:** the conformance cases "a run of three or more = is a highlight mark" and "a highlight does not open before >" in `src/syntax/conformance.ts`, run by `src/syntax/lezer.test.ts` and the other adapters' tests, and listed as worker differences in `src/remark/conformance.test.ts`.

**Forum:** <https://forum.obsidian.md/t/119746>

### B6. A `%%` opened mid-line runs on in the editor

**Obsidian:** the help page says an inline comment keeps both markers on one line, and a block comment starts only where a line begins with `%%`. The reading view and the metadata cache follow it. The editor does not: a `%%` opened mid-line and never closed styles everything after it as a comment, over blank lines and headings, up to a later `%%`; and a `%%` mid-line closed at the start of the next line is one comment to the editor, while the reading view hides the rest of the note.

```markdown
a %%open

# Heading

text
```

```markdown
text %% inline
%%
after

# Heading
```

**Components:** the editor against the reading view and the metadata cache. The editor shows a heading the reader never sees, and the outline drops it.

**This parser:** partly fixed in the tree. The class tokenizer reproduces the editor. The Lezer tree closes an unclosed inline comment at the end of its paragraph, so in the first sample the heading and `text` are no comment, though `%%open` still is; the second sample it reads as the editor does ([syntax.md](syntax.md#the-rules)). The tree cannot carry a comment over a block boundary without breaking incremental parsing ([syntax.md](syntax.md#measured-against-the-live-editor)). `parseRemark` and `parseMetadata` follow the documented rules: three blocks in the first sample, and in the second the paragraph `text %% inline` and a comment block to the end (run here). Making the tree follow the docs is the comment rule in `src/syntax/spec.ts` and `src/syntax/lezer.ts`.

**Pinned by:** the conformance cases "an unclosed comment runs to the end of its paragraph" (`a %%open\nto the end`) and "a %% line closes the comment its paragraph left open" (`text %% inline\n%%`) in `src/syntax/conformance.ts`, listed as worker differences in `src/remark/conformance.test.ts`; the comment row of `src/oracle/syntax-score.test.ts`.

**Forum:** not posted yet (draft 07). Related but different: <https://forum.obsidian.md/t/96246> (`%%` pairs nested in a block comment).

### B7. An unclosed `$$` in a paragraph turns the blocks after it into math

**Obsidian:** the editor keeps math opened by `$$` in a paragraph open past the paragraph's end, over blank lines, list items and quotes, up to the next `$$` anywhere later. Live Preview renders it all as one display math block, and the list item and the quote disappear. The reading view shows a literal `$$` and four ordinary blocks.

```markdown
Cost is $$5 or more.

- item

> quote

Later text with $$ in it.
```

**Components:** the editor against the reading view.

**This parser:** partly fixed in the tree. The class tokenizer reproduces the editor. The Lezer tree closes the math at the end of its paragraph, so the list, the quote and the last paragraph are unaffected, but `$$5 or more.` and `$$ in it.` are still inline math, which the reading view does not show (run here). `parseRemark` reads a literal `$$`, as the reading view does (run here).

**Pinned by:** the math row of `src/oracle/syntax-score.test.ts`. No test holds this sample.

**Forum:** not posted yet (draft 08). Related: <https://forum.obsidian.md/t/113922> (`$$` math on a line with other text).

### B8. Inline code that wraps onto the next line

**Obsidian:** the editor ends a code span opened by one or two backticks at the end of its line, so the closing backticks on the next line open a new code span. The reading view, as CommonMark says, reads one code span `npm install --save-dev`. A span opened by three or more backticks does run on in the editor.

```markdown
Run ``npm install
--save-dev`` first.
```

**Components:** the editor against the reading view and CommonMark.

**This parser:** fixed in the tree. The class tokenizer reproduces the editor ([phase-1.md](phase-1.md#inline-syntax)). The Lezer tree, markdown-it and `parseRemark` read one code span (run here).

**Pinned by:** the class oracle corpora, which include code spans left open at the end of their line (`src/editor/highlight.test.ts`). No test names this sample.

**Forum:** not posted yet (draft 09).

### B9. Math in a markdown link's text

**Obsidian:** the editor never opens math inside a markdown link's text, so Live Preview shows its source, while the reading view renders it. An internal link's alias shows the source in both views.

```markdown
[Area $\pi r^2$](https://example.com)

[[Note|Area $\pi r^2$]]
```

**Components:** the editor against the reading view.

**This parser:** fixed in the tree. The class tokenizer reproduces the editor ([phase-1.md](phase-1.md#inline-syntax)). The Lezer tree has inline math inside the link, and `parseRemark` renders it, as the reading view does. Both leave the alias as text (run here).

**Pinned by:** `src/editor/highlight.test.ts`, "should open no math inside a markdown link's text".

**Forum:** not posted yet (draft 10).

### B10. A math-only setext heading is a rule after a line that started with math

**Obsidian:** once an earlier line has started with math, the editor reads a line that starts with math without its markdown mode, so that line cannot head a setext heading and the `---` under it is a rule. Only a heading whose text is all math is affected. The reading view shows a level 2 heading, and the metadata cache lists it.

```markdown
$a$ is the first line.

$b$
---
```

**Components:** the editor against the reading view and the metadata cache.

**This parser:** fixed in the tree. The class tokenizer reproduces the editor ([phase-1.md](phase-1.md#line-starts-the-markdown-mode-never-sees)). The Lezer tree reads a setext heading, `parseRemark` renders a level 2 heading, and `parseMetadata` lists the heading `$b$` (run here). In the editor the fix is one rule, the line-start memory `hmdLineStartedWithMath` in `src/editor/obsidian-mode.ts`.

**Pinned by:** the class oracle corpora (`src/editor/highlight.test.ts`); not checked that a corpus document shows this shape. No test names this sample.

**Forum:** not posted yet (draft 11).

### B11. A task in a quote is not styled as a task

**Obsidian:** the editor styles `[ ]` and `[x]` in a list inside a quote as link brackets, and Live Preview shows no checkbox. The metadata cache lists both as tasks, and the reading view shows their checkboxes.

```markdown
> - [ ] quoted task
> - [x] done quoted task

- [ ] normal task
```

**Components:** the editor against the metadata cache and the reading view.

**This parser:** fixed in the tree. The class tokenizer reproduces the editor. The Lezer tree reads a task in the quote, as the metadata worker lists one ([syntax.md](syntax.md#measured-against-the-live-editor)), and `parseMetadata` lists all three tasks (run here).

**Pinned by:** the task marker row of `src/oracle/syntax-score.test.ts` (its `quote` entries).

**Forum:** not posted yet (draft 12). Related: <https://forum.obsidian.md/t/30849> (lists in quotes in Live Preview).

### B12. A fence left open in a quote or list item runs on

**Obsidian:** in a quote, the editor reads a fence as an inline-code run that no blank line ends; in a list item, the fence ignores the end of the item. Either way the paragraph after the container is styled as code, with its link and tag as raw text. The reading view ends the code block with its container, and the metadata cache indexes the link and the tag.

```markdown
> ```
> code

Paragraph after the quote, with a [[link]] and a #tag.
```

```markdown
- ```
  code

Paragraph after the list, with a [[link]] and a #tag.
```

**Components:** the editor against the reading view and the metadata cache.

**This parser:** fixed in the tree. The class tokenizer reproduces the editor ([phase-1.md](phase-1.md#quotes-and-callouts)). The Lezer tree ends the fence with its container and reads the paragraph after it with its link and tag ([syntax.md](syntax.md#measured-against-the-live-editor)), and so do `parseRemark` and `parseMetadata` (run here).

**Pinned by:** the `mdlang` entries of `src/oracle/syntax-score.test.ts`, and the class oracle corpora.

**Forum:** not posted yet (draft 13). Related but different: <https://forum.obsidian.md/t/83554> (an indented code block in a quote).

### B13. Emphasis ignores CommonMark's delimiter rules

**Obsidian:** the reading view pairs `*` and `_` runs first come first served, without CommonMark's flanking checks, its rule for `_` inside words, or its nesting rules.

```markdown
a * foo bar*

a ** b ** c

foo_bar_

__foo, __bar__, baz__
```

| Markdown | Reading view | CommonMark |
| --- | --- | --- |
| `a * foo bar*` | `a <em> foo bar</em>` | as typed (example 351) |
| `a ** b ** c` | `a <strong> b </strong> c` | as typed |
| `foo_bar_` | `foo<em>bar</em>` | as typed (example 360) |
| `__foo, __bar__, baz__` | `<strong>foo, </strong>bar<strong>, baz</strong>` | nested strong (example 389) |

**Components:** the reading view against CommonMark.

**This parser:** the three adapters read emphasis as CommonMark does, in every preset. `parseRemark` reproduces the reading view (run here). No flag gives Obsidian's reading in the adapters, since it is `remark-parse` 8's inline algorithm ([spec-suites.md](spec-suites.md#the-quirks-that-are-no-flag)).

**Pinned by:** the emphasis row of `src/oracle/spec-quirks.test.ts` (79 examples and GFM 631), and the emphasis probes of `src/oracle/quirk-probes.test.ts`, `a ** b ** c` among them.

**Forum:** not posted yet (draft 15). Related: <https://forum.obsidian.md/t/42174> (`_` inside CJK and Cyrillic words).

### B14. A `*` or `]` inside inline code closes emphasis or a link

**Obsidian:** the reading view matches emphasis and link brackets before code spans, so a `*` or `]` between backticks still closes them. Raw HTML and autolinks are cut the same way.

```markdown
*a `*`*

[not a `link](/foo`)

[a `]` b](c)
```

CommonMark gives `<em>a <code>*</code></em>` (example 478), `[not a <code>link](/foo</code>)` (example 342) and a link `a <code>]</code> b`. The reading view gives ``<em>a `</em>`*``, a link to ``/foo` `` whose text is ``not a `link``, and plain text.

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark. `parseRemark` reproduces the reading view (run here). No flag ([spec-suites.md](spec-suites.md#the-quirks-that-are-no-flag)).

**Pinned by:** the emphasis and link rows of `src/oracle/spec-quirks.test.ts`, and the probe `` [a `]` b](c) `` of `src/oracle/quirk-probes.test.ts`.

**Forum:** not posted yet (draft 16). Related, same cause with math: <https://forum.obsidian.md/t/53977>.

### B15. A link inside a link's text

**Obsidian:** the reading view makes the outer link the link and shows the inner one as text. CommonMark lets no link hold another, so the inner one wins (example 518).

```markdown
[foo [bar](/uri)](/uri2)
```

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark. `parseRemark` reproduces the reading view, and `parseMetadata` lists the outer link, as the worker does (run here). No flag.

**Pinned by:** the link row of `src/oracle/spec-quirks.test.ts` (examples 518, 519, 532, 533), and the probe `[a [b](c)](d)` of `src/oracle/quirk-probes.test.ts`.

**Forum:** not posted yet (draft 17).

### B16. Reference link labels

**Obsidian:** the reading view does not trim a reference label or collapse its whitespace before matching, reads chained labels differently, and takes a label holding an unescaped bracket as a definition.

```markdown
[ a ] and [a]

[a]: https://example.com
```

`[ a ]` stays text in the reading view, and is a link in CommonMark. Likewise `[a]` matches no `[ a ]:` definition, with only `[baz]:` defined, `[foo][bar][baz]` keeps `[foo][bar]` as text and links `baz`, where CommonMark keeps `[foo]` and links `bar` (example 569), and `[ref[]:` is a definition where CommonMark reads text (example 546).

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark; the Lezer tree checks that a label is defined only when parsed with `parseWithLinkReferences` ([spec-suites.md](spec-suites.md#how-the-lezer-tree-is-checked)). `parseRemark` reproduces the reading view (run here). The flag `linkDefinition: 'obsidian'` gives Obsidian's definition rules, which covers examples 546 and 552; the label matching is no flag.

**Pinned by:** the link row of `src/oracle/spec-quirks.test.ts`, the probes `[ a ] [A]` and `[ a ]:` of `src/oracle/quirk-probes.test.ts`, and the `linkDefinition` row of `src/syntax/spec-suites.test.ts`.

**Forum:** not posted yet (draft 18).

### B17. A code span opened with three backticks closes at two

**Obsidian:** the reading view closes a code span at a shorter backtick run, so ```` ```foo`` ```` is a backtick and the code span `foo`. CommonMark closes a span only at a run of the same length, and leaves this as written (example 347).

````markdown
```foo``
````

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark. `parseRemark` reproduces the reading view (run here). No flag.

**Pinned by:** the code span row of `src/oracle/spec-quirks.test.ts` (example 347), and the code span probe of `src/oracle/quirk-probes.test.ts`.

**Forum:** not posted yet (draft 19).

### B18. An image's alt text keeps the markdown source

**Obsidian:** the reading view puts the image description's source in `alt`, markup included: ``alt="foo *bar* `baz`"``. CommonMark gives its plain text, `foo bar baz` (examples 520, 573 to 577, 585, 589). Screen readers announce the alt text.

```markdown
![foo *bar* `baz`](https://obsidian.md/images/obsidian-logo-gradient.svg)
```

**Components:** the reading view against CommonMark.

**This parser:** the adapters' renderers give the plain text (markdown-it, run here). `parseRemark` reproduces the reading view, and `parseMetadata` gives the source as the embed's display text, as the worker does (run here). No flag.

**Pinned by:** the image description row of `src/oracle/spec-quirks.test.ts`, and the image probes of `src/oracle/quirk-probes.test.ts`.

**Forum:** not posted yet (draft 20).

### B19. Tabs are not expanded to tab stops

**Obsidian:** the reading view does not expand a tab to the next multiple of four columns when it reads block structure. So `>` and a tab open indented code in the quote, a tab-indented list item does not nest, and `*→*→*→` is three nested empty list items instead of a rule (example 11).

```markdown
>→quoted text
```

Here `→` stands for a tab.

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark: a quote holding the paragraph `quoted text` (run here). `parseRemark` reproduces the reading view. No flag, since tabs are measured inside each adapter's container handling ([spec-suites.md](spec-suites.md#the-quirks-that-are-no-flag)).

**Pinned by:** the tab row of `src/oracle/spec-quirks.test.ts` (examples 2, 5, 6, 7, 9, 11), and the tab probes of `src/oracle/quirk-probes.test.ts`, `>\ta` among them.

**Forum:** not posted yet (draft 21). Related, opposite symptom: <https://forum.obsidian.md/t/83554>.

### B20. Blockquote continuation lines

**Obsidian:** in the reading view an empty `>` line does not end the quoted paragraph, a lazy line goes on fenced code in a quote, an indented line after a quote is indented code outside it, and a setext underline after a lazy line makes a heading outside the quote.

```markdown
> bar
>
baz
```

CommonMark puts `baz` after the quote (example 249); the reading view keeps it in the quote. Examples 93, 237 and 238 show the other three.

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark (run here). `parseRemark` reproduces the reading view. No flag.

**Pinned by:** the lazy line row of `src/oracle/spec-quirks.test.ts` (examples 93, 237, 238, 249), and the lazy quote line probes of `src/oracle/quirk-probes.test.ts`.

**Forum:** not posted yet (draft 22).

### B21. List item boundaries

**Obsidian:** in the reading view an empty list item interrupts a paragraph, a marker indented four or more columns opens a sibling, a list item may start with more than one blank line, an ordered marker may have ten digits, and a paragraph indented less than the content column stays in the item after a blank line.

```markdown
foo
*
```

CommonMark reads one paragraph `foo *` (example 285). The reading view reads `foo` and an empty list.

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark in every preset (run here). `parseRemark` reproduces the reading view. The flag `emptyListItem: 'interrupts-paragraph'` gives Obsidian's reading of examples 285 and 367 in every adapter, and `listItem: 'obsidian'` that of examples 257, 266, 278, 280, 312 and 313 in micromark and markdown-it; `@lezer/markdown` keeps list item continuation internal ([spec-suites.md](spec-suites.md#the-flags)).

**Pinned by:** the empty list item and list item rows of `src/oracle/spec-quirks.test.ts`, the list probes of `src/oracle/quirk-probes.test.ts`, and the `emptyListItem` and `listItem` rows of `src/syntax/spec-suites.test.ts`.

**Forum:** not posted yet (draft 23). Related: <https://forum.obsidian.md/t/80628> and <https://forum.obsidian.md/t/53959>.

### B22. A blank line in a nested list spaces out the outer list

**Obsidian:** the reading view makes a list loose when a blank line anywhere inside it, in a nested list or in fenced code, is followed by more of it. CommonMark decides per list, and ignores blank lines in fenced code (examples 307, 318, 319).

```markdown
- foo
  - bar
    - baz


      bim
```

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark: only the innermost item is loose (markdown-it, run here). `parseRemark` reproduces the reading view. The flag `looseList: 'blank-line-anywhere'` gives Obsidian's reading in every adapter.

**Pinned by:** the loose list row of `src/oracle/spec-quirks.test.ts`, and the `looseList` row of `src/syntax/spec-suites.test.ts`.

**Forum:** not posted yet (draft 24).

### B23. A code block left open at the end gets an extra empty line

**Obsidian:** a fenced code block that runs to the end of a note ending with a line break keeps that line break as an empty last line in the reading view. CommonMark does not (examples 127, 137, 139).

````markdown
```
aaa
````

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark. `parseRemark` reproduces the reading view (run here). No flag: the trees agree, and only the text the renderer takes differs ([spec-suites.md](spec-suites.md#the-quirks-that-are-no-flag)).

**Pinned by:** the unclosed fenced code row of `src/oracle/spec-quirks.test.ts`.

**Forum:** not posted yet (draft 25).

### B24. `&copy` and `&nbsp` without a semicolon become characters

**Obsidian:** the reading view decodes a named character reference without its `;`, and turns a numeric reference past the last code point into U+FFFD. CommonMark needs the `;` and at most 7 digits (examples 28, 29). So `<http://a?b&copy=1&amp;c>` shows `©` in its text.

```markdown
&copy 2026 and A&nbsp B

&#87654321;
```

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark (markdown-it, run here). `parseRemark` reproduces the reading view (run here). The flag `characterReference: 'obsidian'` gives Obsidian's reading in every adapter.

**Pinned by:** the character reference row of `src/oracle/spec-quirks.test.ts`, the `characterReference` probes of `src/oracle/quirk-probes.test.ts`, the autolink probe `<http://a?b&copy=1&amp;c>`, and the `characterReference` row of `src/syntax/spec-suites.test.ts`.

**Forum:** not posted yet (draft 26).

### B25. Autolink schemes, and `<mailto:...>` hiding the scheme

**Obsidian:** the reading view makes an autolink only when the scheme is followed by `//`, or for `mailto:`, so `<a+b+c:d>` and `<tel:+123>` are text. A `mailto:` autolink's text drops the scheme, and an email autolink may hold a backslash. CommonMark takes any scheme of 2 to 32 characters (examples 597, 598, 601, 606).

```markdown
<MAILTO:FOO@BAR.BAZ>

<a+b+c:d>
```

**Components:** the reading view against CommonMark.

**This parser:** the three adapters follow CommonMark (run here). `parseRemark` reproduces the reading view: `FOO@BAR.BAZ` as the link text, and `<a+b+c:d>` as text (run here). The flag `autolink: 'obsidian'` gives Obsidian's reading in every adapter. Whether the flag's rule covers the `//` shapes measured on the live app (`obsidian://`, made-up schemes) is not checked.

**Pinned by:** the autolink row of `src/oracle/spec-quirks.test.ts`, and the `autolink` row of `src/syntax/spec-suites.test.ts`.

**Forum:** not posted yet (draft 27). Related, the editor side: <https://forum.obsidian.md/t/112736>.

### B26. An indented line that starts with math is math in the editor

**Obsidian:** the editor opens math after a line's leading whitespace even where the line is indented code, and `$$x` indented by four spaces opens a math block over the next lines. The reading view shows indented code.

```markdown
    $x$ math
```

**Components:** the editor against the reading view.

**This parser:** fixed in the tree. The class tokenizer reproduces the editor ([phase-1.md](phase-1.md#line-starts-the-markdown-mode-never-sees)). The Lezer tree, markdown-it and `parseRemark` read indented code (run here).

**Pinned by:** `src/editor/highlight.test.ts`, "should open math after a line's leading whitespace even where the line would be indented code".

**Forum:** a duplicate of <https://forum.obsidian.md/t/50661> (open). A reply could add the indented `$$x` shape, and that it does not happen when the line above is indented code.

### B27. A setext heading takes only one line

**Obsidian:** the reading view reads only the last line above a setext underline as the heading's text, so `Foo` / `Bar` / `---` is a paragraph and a rule. CommonMark reads a two-line heading (examples 81, 82, 84, 86, 95). The editor, too, marks only `Bar` as the heading.

```markdown
Foo
Bar
---
```

**Components:** the reading view and the editor against CommonMark.

**This parser:** the three adapters follow CommonMark. `parseRemark` reproduces the reading view, and the class tokenizer the editor (run here). The flag `setextHeading: 'single-line'` gives Obsidian's reading in every adapter.

**Pinned by:** the setext heading row of `src/oracle/spec-quirks.test.ts`, and the `setextHeading` row of `src/syntax/spec-suites.test.ts`.

**Forum:** a duplicate of <https://forum.obsidian.md/t/112786> (open).

### B28. Live Preview hides a backslash at the start of an indented code block

**Obsidian:** the editor splits the token that starts an indented code block at a leading backslash, into an escape's backslash (`hmd-escape-backslash`) and the rest of the line as its character (`hmd-escape-char`), beside the code classes. Live Preview then hides the backslash, as it hides an escape's in text, whatever follows it. The reading view shows the line as typed. A line that continues the block is not affected.

```markdown
Text before.

    \$HOME/bin
    \$PATH
```

**Components:** the editor against the reading view.

**This parser:** fixed in the tree. The class tokenizer reproduces the editor ([phase-1.md](phase-1.md#line-starts-the-markdown-mode-never-sees)). The Lezer tree, markdown-it and `parseRemark` read indented code holding the backslash (run here). In the editor the cause is the one of B26: the markdown mode reads the line's block structure only at the token after the leading whitespace, so that token is still read as inline markdown.

**Pinned by:** `src/editor/highlight.test.ts`, "should split the token that makes its line indented code at a leading backslash, as an escape of the rest of the line".

**Forum:** not posted yet (draft 28).

## Not bugs any more

Drafted, then not reproduced on 1.14.5, so not reported:

- **`[[a]b]]` was text in the editor and a link in the reading view** (draft 06). The editor now reads it as a link to `a]b`, and every view agrees. The class tokenizer follows the editor ([phase-1.md](phase-1.md#footnotes), `src/editor/highlight.test.ts`). The conformance case "internal link content holds no ] and no line break" in `src/syntax/conformance.ts` still reads it as no link.
- **An unclosed HTML tag leaking highlighting into the next note** (draft 14). Not reproduced by opening other notes or by replacing the note's text.

## Docs note: links and tags inside comments

Not a bug. Links and tags inside an inline `%% ... %%` comment or a `%%` comment block are listed in the metadata cache's links and tags, counted in `resolvedLinks`, and shown in the target's linked mentions and in the Tags pane, while the reading view hides them. Users rely on it, but the help page does not say so. `parseMetadata` lists them too, as the worker does ([remark.md](remark.md#where-the-worker-and-the-editor-differ)).
