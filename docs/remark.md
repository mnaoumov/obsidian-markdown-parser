# The `remark-parse` 8 engine

`src/remark/` is the parser Obsidian's reading view and metadata worker run: `remark-parse` 8.0.3 with `commonmark: true` and `gfm: true`, Obsidian's edits to three of its block tokenizers, and the Obsidian syntax its extensions add. It is the fourth parser [the spec suites' decision](spec-suites.md#where-these-come-from-and-the-decision) called for. Obsidian's inline algorithm, its tabs, lazy quote lines and paragraph whitespace are no rules added to it: they are how `remark-parse` 8 reads markdown, so the engine has them by construction.

```ts
import { parseRemark, renderRemarkHtml } from 'obsidian-markdown-parser';

const tree = parseRemark('> [!note] Title\n> - [?] task [[Note|alias]] #tag'); // mdast, with positions
const html = renderRemarkHtml(tree); // as remark-html 13 renders it
const plain = parseRemark('#tag', { shouldReadObsidianSyntax: false }); // without the Obsidian syntax
```

## What it is

- `parser.ts`, `block.ts` and `inline.ts` are a TypeScript port of `remark-parse` 8.0.3: its parser, tokenizer factory and position tracking, its block tokenizers and its inline tokenizers with their locators. Only the `commonmark` and `gfm` branches are kept, the modes Obsidian runs. `trim@0.0.1`, which `remark-parse` 8 depends on and which carries a ReDoS advisory, is `String.prototype.trim`; the two strip the same characters. Like Obsidian's copy, the parser leaves the document's start at the first text eaten, where upstream leaves it at the first node added, so a blank line before front matter makes it no front matter.
- `obsidian.ts` is the Obsidian syntax: its tokenizers, where Obsidian puts them in the order tokenizers are tried, and the two tree transforms that change what the tree holds. [The Obsidian syntax](#the-obsidian-syntax) has the rules.
- `entities.ts` is `parse-entities` 2.0.0, which decodes character references with the positions text nodes need. It keeps one behaviour of the original: a reference that is not one, such as `&foo` where `nonTerminated` is off, reuses the last reference decoded before it in the same value, so a link destination `&amp;&foo` decodes to `&&`.
- `html.ts` renders the tree in the shape `remark-html` 13 gives with `sanitize: false` (the handlers of `mdast-util-to-hast` 10 and `mdurl`'s `encode`), serialized as a browser serializes a DOM so it compares with the reading view's. Raw HTML is passed through as it is. The Obsidian syntax is rendered as [below](#rendering).
- `types.ts` names the tree's nodes: mdast as `remark-parse` 8 builds it, with each position's `indent`, the fields Obsidian's edits add, and the nodes of the Obsidian syntax.

Nothing is taken from the app's bundle. Its behaviour was read to learn what the edits and the syntax do, and they are written into the port from that, then measured against the app.

## Obsidian's edits

| Tokenizer | Edit |
| --- | --- |
| `blockquote` | The first line may open a callout, `[!type\|data]` with an optional `+` or `-` fold sign and a space or the line's end after it. The header is no part of the content: the node gets `callout: { type, fold, data }`, the type trimmed, lowercased and with each run of whitespace made a `-`, and the rest of the first line is tokenized on its own as the title. A blockquote without one has `callout: null`. |
| `list` | Any character between a task's brackets makes a task: `checked` is whether it is not a space, and `checklist` keeps the character (`null` on an item that is no task). An item's indentation is stripped past its lazy lines, where stock `remark-parse` 8 strips none once a lazy line appears, so `1. a\n\n      code\nlazy` holds a paragraph, not code. |
| `table` | Every row starts with a pipe if the first does, and none does if it does not: a row of the other shape ends the table. The spaces and tabs around a cell are part of it, kept as its `padding`, and its content is the rest. A row indented before its first pipe so makes a cell of that whitespace. |

## The Obsidian syntax

Obsidian adds its syntax to `remark-parse` 8 as tokenizers and tree transforms, the same in the reading view and the metadata worker. So its rules are the worker's, which differ in places from the editor's that [`src/syntax/spec.ts`](syntax.md) follows ([where](#where-the-worker-and-the-editor-differ)). The nodes take the names `src/syntax/unified/mdast.ts` gives them where the shapes agree.

| Construct | Node | Rule |
| --- | --- | --- |
| Front matter | `yaml`, with `value` | At the very start of the document, before anything is eaten, a first line `---`, up to the next line that opens with `---`. The rest of that line is read as the next block. Front matter that never closes is none. |
| Internal link, embed | `internalLink`, `embed`, with `target`, `alias` and `displayText` | `[[` or `![[`, then content on one line up to the first `]]`, with no `[[` in it. It may hold a `]`. The alias starts at the first `\|` that is not the first character, and is trimmed. The target is the content before it, trimmed, with a final backslash taken off, no-break spaces made spaces, and in Unicode normal form C. The text it shows is the alias, or else the target with each run of `#` made ` > `. It is tried before links. |
| Tag | `tag`, with `name` | `#` followed by characters that are no whitespace, no ASCII punctuation but `-`, `/` and `_`, and nothing of the General or Supplemental Punctuation blocks. A name of digits only is no tag. It is read where the inline content starts, after whitespace, and wherever another construct ends, so `*#a*` holds a tag. |
| Comment | `obsidianComment`, `obsidianCommentBlock`, with `value` and `children` | Inline, `%%` to the next `%%` on the same line. A line opening with `%%` after any spaces, with no `%` after it on the line, opens a block that runs to the next `%%`, wherever it is, or to the end of its container; the rest of the closing line is the next block. A block interrupts a paragraph, a list and a quote. The text is read as inline markdown too, so links and tags in a comment are the worker's links and tags. In a block, their positions count from the block's start, not the text's. |
| Math | `inlineMath`, with `value` and `display`, and `math`, with `value` | Inline, `$` before a character that is no space or tab, closed by a `$` after one that is not before a digit, with backslash escapes; `$$` closes at the next `$$` and takes the whitespace after it up to and including a line break. A block is a line of two or more `$` after any spaces, with no `$` after them and a line after it, closed by a line whose only `$` are a run at least as long at its end, after any content, or by the end of its container. A block interrupts a paragraph, a list and a quote. |
| Highlight | `highlight`, with `color` | `==` before a character that is no whitespace, but not `====`, closed by the first `==` after a character that is no whitespace. A colored square or circle opening it gives its `color` and is no part of its content. |
| Footnote reference | `footnoteReference`, with `label` and `identifier` | `[^label]` with a label of no whitespace. A reference to no definition is the text of its label, lowercased. `[^` opens no link reference, and `[^label]:` no link reference definition. |
| Inline footnote | `inlineFootnote` | `^[` up to the `]` that balances its brackets, outside code spans and past backslash escapes, over lines too. Its content is inline markdown. |
| Footnote definition | `footnoteDefinition`, with `label` and `identifier` | `[^label]:` after any spaces and tabs, in any container, a quote's too. It goes on over lines indented by more than a tab, over lines after a line with content unless a block that interrupts it starts them, and over blank lines; a line indented less than a tab after a blank line ends it. It looks for an interrupting block only within its first 1,024 characters. |
| Block id | `blockId`, with `value`, and the `id` of a block | `^` and the ASCII letters `A-Z` and `a-z`, digits and `-`, after whitespace at the end of a block's inline content, or alone on a line that a blank line or the end follows. A block of the document takes the last block id inside it, a list item at any depth the first one inside it outside its nested lists, and a block id alone on its line is attached to the block before it and leaves the tree. The inside of an inline footnote is not searched. `^café`, `^a_b` and a Cyrillic id are no block id: the help said "Latin letters", and docs PR [obsidian-help#1159](https://github.com/obsidianmd/obsidian-help/pull/1159) names the characters. |

The callout and the task are [Obsidian's edits](#obsidians-edits) to `blockquote` and `list`.

## How it is checked

- **Against `remark-parse` 8 itself.** On 240,843 documents, the spec examples, the probes, the eleven oracle corpora and fuzzed documents from block, inline and mixed pieces, the engine's tree without the Obsidian syntax equals the tree of npm `remark-parse` 8.0.3 with Obsidian's three tokenizers in place, positions included. The comparison runs outside this repository, because its reference takes those tokenizers from the app.
- **Against the metadata worker.** The engine is what [the `CachedMetadata` projection](metadata.md) is built on, and that projection is checked whole against the worker: `scripts/capture/worker-oracle.ts` runs the worker's own `worker.js`, from the Obsidian install it names, offline in a Node `vm`, and `src/oracle/spec/worker-metadata.test.ts` pins `parseMetadata` to the whole metadata of every document of `oracle/worker-metadata-obsidian-1.15.1.json` and to the live app's metadata of all 674 spec examples. Every node of the Obsidian syntax and every position the worker lists is in that comparison. [How it is checked](metadata.md#how-it-is-checked) has the numbers.
- **What the walk reproduces of the worker.** The worker moves the content of inline footnotes into a footnotes section it adds after the document's blocks before it walks the tree, turns markdown links and images whose destination is no URL into internal links and embeds, and puts a task's checkbox first in a list item that no paragraph opens. [The projection](metadata.md#what-the-worker-does) walks the tree the same way.
- **Against the reading view.** `src/oracle/spec/spec-quirks.test.ts` pins every spec example where the engine's HTML differs from the reading view's DOM, and `src/oracle/spec/quirk-probes.test.ts` every probe. The HTML is compared after `normalizeHtml` takes off what the reading view adds, as the oracle took it off the DOM: the attributes it puts on links, headings and blocks, the classes of internal and external links (rewriting each class list, which folds its whitespace), a code block's class, and an embed, which is put back as the image it was. On the spec oracle the engine gives the reading view's HTML on every example of the `quirk` rows of [the differences](spec-suites.md#the-differences) but five where the browser or the sanitizer changes the HTML after the parse (148, 171, 187 and 494, and GFM 652), on every example of the `syntax` rows, and on all 652 + 22 examples but these 54:
  - 19 where the browser re-reads raw HTML: it closes the tags left open, adds `<tbody>`, decodes character references in attributes and folds their whitespace, and drops stray end tags. The parse is the reading view's.
  - 8 of the comparison rows, where the spec's HTML holds an unclosed tag.
  - 27 of the rendering rows: the sanitizer and embeds.
- **On the probes** it gives the reading view on 158 of 169, all 68 probes of the quirks that are no flag of the three adapters among them. The 11 it misses are the 10 the sanitizer or the DOM changes, and a stray end tag the browser drops.
- `src/remark/parse.test.ts`, `src/remark/obsidian.test.ts` and `src/remark/html.test.ts` pin the edits, the syntax, the inline algorithm and the renderer.

## Where the worker and the editor differ

`src/remark/conformance.test.ts` reads the conformance corpus, which follows the editor, with the engine, on the nodes both have: a task compared on its marker and a callout on its type, since the tree has no node for either. The engine reads 38 of its 47 cases as the editor does. The other 9 are places where the worker reads the syntax differently, each checked against the worker itself, or for a highlight, which `CachedMetadata` does not list, against the reading view of Obsidian 1.14.5:

| Case | The worker |
| --- | --- |
| `a ===marked=== b` | `=marked` is highlighted: the first `==` opens, and the first `==` after a character that is no whitespace closes, leaving the last `=` as text. The editor reads each run of `=` as one mark. |
| `a ==>x== b` | `>x` is highlighted: a `==` opens before any character that is no whitespace. The editor opens none before `>`. |
| `a %%hidden [[link]]%% b` | Reads the syntax inside a comment, and lists the link. |
| `%%\nhidden\n\n#not-a-tag\n%%\nafter` | Lists the tag inside the comment block. |
| `a %%open\nto the end` | No comment: an inline comment closes on its line. |
| `text %% inline\n%%` | The `%%` line interrupts the paragraph and opens a comment block, which runs to the end. |
| `text[^1] more` | No reference: there is no definition, so `[^1]` is the text `1`. |
| `text[^] more` | No reference, for the same reason. |
| `> [^2]: in a quote` | A footnote definition, inside the quote. |

So the editor's grammar and the worker's are two grammars. The editor's is the one the class layer and the three adapters follow, and the worker's is the one `CachedMetadata`, and so phase 2, reads.

## Rendering

`renderRemarkHtml` renders the syntax as Obsidian's handlers shape it: a tag as `<a class="tag">`, an internal link as `<a class="internal-link">` with its target as `href` and `data-href` (and an `aria-label` when it has an alias), an embed as `<span class="internal-embed">` with its target as `src`, its alias as `alt` and a size in its alias as `width` and `height`, a highlight as `<mark>` with its `data-highlight` color, inline math as `<span class="math math-inline">` or `math-block`, a math block as `<div class="math math-block">`, and front matter as a hidden `<pre class="frontmatter">`, as the reading view shows it. Comments, block ids and footnote definitions render nothing in place. Footnote references and inline footnotes are numbered by first reference, as `<sup class="footnote-ref">`, and a footnotes section after the document holds each footnote with a link back to each reference. The footnotes section is not measured against the reading view, whose spec examples hold none.

## Line breaks

The worker reads soft line breaks as hard ones, with Obsidian's `breaks` option, which `parseRemark` takes as `shouldReadSoftLineBreaksAsHard`. It is off by default, the strict line breaks of `remark-parse` 8, and [the projection](metadata.md) turns it on.
