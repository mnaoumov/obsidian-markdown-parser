# The `remark-parse` 8 engine

`src/remark/` is the parser Obsidian's reading view and metadata worker run: `remark-parse` 8.0.3 with `commonmark: true` and `gfm: true`, and Obsidian's edits to three of its block tokenizers. It is the fourth parser [the spec suites' decision](spec-suites.md#where-these-come-from-and-the-decision) called for. Obsidian's inline algorithm, its tabs, lazy quote lines and paragraph whitespace are no rules added to it: they are how `remark-parse` 8 reads markdown, so the engine has them by construction.

```ts
import { parseRemark, renderRemarkHtml } from 'obsidian-markdown-parser';

const tree = parseRemark('> [!note] Title\n> - [?] task'); // mdast, with positions
const html = renderRemarkHtml(tree); // as remark-html 13 renders it
```

## What it is

- `parser.ts`, `block.ts` and `inline.ts` are a TypeScript port of `remark-parse` 8.0.3: its parser, tokenizer factory and position tracking, its block tokenizers and its inline tokenizers with their locators. Only the `commonmark` and `gfm` branches are kept, the modes Obsidian runs. `trim@0.0.1`, which `remark-parse` 8 depends on and which carries a ReDoS advisory, is `String.prototype.trim`; the two strip the same characters.
- `entities.ts` is `parse-entities` 2.0.0, which decodes character references with the positions text nodes need. It keeps one behaviour of the original: a reference that is not one, such as `&foo` where `nonTerminated` is off, reuses the last reference decoded before it in the same value, so a link destination `&amp;&foo` decodes to `&&`.
- `html.ts` renders the tree in the shape `remark-html` 13 gives with `sanitize: false` (the handlers of `mdast-util-to-hast` 10 and `mdurl`'s `encode`), serialized as a browser serializes a DOM so it compares with the reading view's. Raw HTML is passed through as it is.
- `types.ts` names the tree's nodes: mdast as `remark-parse` 8 builds it, with each position's `indent`, and the fields Obsidian's edits add.

Nothing is taken from the app's bundle. Its behaviour was read to learn what the three edits do, and they are written into the port from that.

## Obsidian's edits

| Tokenizer | Edit |
| --- | --- |
| `blockquote` | The first line may open a callout, `[!type\|data]` with an optional `+` or `-` fold sign and a space or the line's end after it. The header is no part of the content: the node gets `callout: { type, fold, data }`, the type trimmed, lowercased and with each run of whitespace made a `-`, and the rest of the first line is tokenized on its own as the title. A blockquote without one has `callout: null`. |
| `list` | Any character between a task's brackets makes a task: `checked` is whether it is not a space, and `checklist` keeps the character (`null` on an item that is no task). An item's indentation is stripped past its lazy lines, where stock `remark-parse` 8 strips none once a lazy line appears, so `1. a\n\n      code\nlazy` holds a paragraph, not code. |
| `table` | Every row starts with a pipe if the first does, and none does if it does not: a row of the other shape ends the table. The spaces and tabs around a cell are part of it, kept as its `padding`, and its content is the rest. A row indented before its first pipe so makes a cell of that whitespace. |

## How it is checked

- **Against `remark-parse` 8 itself.** On 240,843 documents, the spec examples, the probes, the eleven oracle corpora and fuzzed documents from block, inline and mixed pieces, the engine's tree equals the tree of npm `remark-parse` 8.0.3 with Obsidian's three tokenizers in place, positions included. The comparison runs outside this repository, because its reference takes those tokenizers from the app.
- **Against the reading view.** `src/oracle/spec-quirks.test.ts` pins every spec example where the engine's HTML differs from the reading view's DOM, and `src/oracle/quirk-probes.test.ts` every probe. On the spec oracle it gives the reading view's HTML on every example of the `quirk` rows of [the differences](spec-suites.md#the-differences) but five where the browser or the sanitizer changes the HTML after the parse (148, 171, 187 and 494, and GFM 652), and on all 652 + 22 examples but these 61:
  - 20 where the browser re-reads raw HTML: it closes the tags left open, adds `<tbody>`, decodes character references in attributes and folds their whitespace, and drops stray end tags. The parse is the reading view's.
  - 8 of the comparison rows, where the spec's HTML holds an unclosed tag.
  - 27 of the rendering rows: the sanitizer and embeds.
  - 6 of the Obsidian syntax, which the engine does not read yet.
- **On the probes** it gives the reading view on 158 of 169, all 68 probes of the quirks that are no flag of the three adapters among them. The 11 it misses are the 10 the sanitizer or the DOM changes, and a stray end tag the browser drops.
- `src/remark/parse.test.ts` and `src/remark/html.test.ts` pin the edits, the inline algorithm and the renderer.

## What is left

- **The Obsidian syntax** as tokenizers of the engine: internal links and embeds, tags, comments, math, highlights, footnotes with inline notes, block ids and front matter. Its rules are the metadata worker's, so it is measured against the worker's `CachedMetadata`, which phase 2 reads.
- **The `CachedMetadata` projection** of phase 2, built on this tree.
