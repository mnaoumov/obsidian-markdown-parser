# The self-check judges: where Obsidian is wrong but consistent

The other bug finders compare two readings: Obsidian against the CommonMark and GFM spec examples ([spec-suites.md](spec-suites.md)), and the editing modes against Reading view ([mode-judge.md](mode-judge.md)). Neither can see a bug Obsidian makes the same way everywhere. A link whose position points at the wrong characters, a scan that stops after 1,024 characters, a rename that rewrites the wrong text: each one is consistent with itself, so a comparison of Obsidian with Obsidian finds nothing.

The self-check judges find those. Each one checks a relation that a correct parser keeps, and none of them needs a reference output:

```sh
npm run self-check -- [--count <n>] [--seed <n>] [--per-key <n>] [--oracles] [--out <file>]
```

## The relations

`src/oracle/self-check.ts` judges a note with nine relations:

| Judge | The relation |
| --- | --- |
| `offset` | Every position the cache gives for a link, embed, tag, footnote reference, footnote, heading, block id, definition or list item slices out that construct, and its line and column agree with its offset. A link's `original` is a whole `[[…]]` or `[…](…)`. |
| `shift` | Prepending a paragraph moves every position by its length and two lines, and changes nothing else. This is measured between the note with the prefix once and with it twice, so no list starts on line 0 or 1, whose parent the cache writes as -1 in both cases. |
| `padding` | Stretching the filler word `lorem` by 1,100 and by 4,200 characters, past the 1,024 and 4,096 marks, changes no structure: no item count, heading level, section type, link, tag or footnote. |
| `rename` | Writing `[[renamed]]` over each link or embed where the cache says it is, as a rename rewrites a link, gives a link to `renamed` there and leaves every other link as it was. |
| `escape` | A backslash before the opening or closing delimiter of a highlight, internal link, embed, inline math, comment or strikethrough makes the delimiter literal, so the construct goes. |
| `independence` | A block after a blank line gives the same headings, links, embeds, tags, footnotes, block ids, definitions and sections when it is read alone as when it is read after the blocks before it. Links by reference, footnote references and lists are left out, because they may lean on, or merge with, an earlier block by design. |
| `render` | The cache and Reading view find the same headings, links, embeds, tags and footnote references, and a heading has the same text in both. An item the cache finds inside a comment, which Reading view hides, gets a key of its own. A colored highlight shows nothing of its color marker. |
| `fidelity` | A Reading view text node holds its own source, once backslash escapes are taken out, container marks are dropped and whitespace is collapsed. |
| `conservation` | Every word of the source is either shown, or hidden by something that hides it by design: a comment, the front matter, a link destination, the lines of a definition up to a blank line, or a callout's type. |

The cache is `parseMetadata`, which gives the metadata worker's output exactly on every oracle document, and Reading view is the `remark-parse` 8 engine, which gives its HTML. So the judges run offline and at fuzzing speed. 4,000 generated notes plus the 3,284 worker oracle documents take about 30 s. Whatever the judges flag is Obsidian's behaviour, as far as the oracles measure it.

## The notes: a grammar, not a corpus

The oracle corpus joins line fragments. `src/oracle/note-grammar.ts` composes whole constructs instead. It takes every block of CommonMark, GFM and Obsidian (headings, setext headings, `%%` comments closed, unclosed or opened on a line with text, footnote and link reference definitions, tables, fences, math, thematic breaks and paragraphs opening on a quote or parenthesis). Each block holds inline constructs: internal links and embeds with headings, block ids and sizes, tags, defined and undefined footnote references, inline footnotes, highlights plain and colored, comments, math, code, markdown links and images, references, emphasis, escapes, entities and astral characters. Blocks nest in quotes, callouts and list or task items to depth 3. A container's continuation line is lazy one time in four. One inline run in twelve gets a filler word stretched so that its line ends near 1,000-1,030 or 4,080-4,100 characters.

The grammar draws with mulberry32. The corpus's linear congruential generator made some runs of draws impossible: in 4,000 notes it never once put a definition before a paragraph that opens on a quote.

## Reducing and sorting

The runner keeps up to `--per-key` notes for each key (30 by default) and reduces each one to a minimal note that still has that key. It runs delta debugging over lines and then over graphemes (`src/oracle/ddmin.ts`, shared with the mode judge). Keeping several notes per key matters: a single reduction collapses different causes onto one smallest shape.

Each reduced note goes into a family of `src/oracle/self-check-families.ts`, and the first family that matches wins. The verdicts are:

- `bug`: reported or to report.
- `known`: an open topic or the team already has it.
- `expected`: by design or documented.
- `minor`: shows only in notes nobody writes.
- `judge`: a limit of the judge itself, where Obsidian is right.

## The last run

On 2026-10-25, 4,000 generated notes (seed 20261024) and the worker oracle (7,284 notes) gave 62 keys, all in 23 families:

| Family | Verdict | What it is |
| --- | --- | --- |
| `comment-line-offset` | bug, [t/119821](https://forum.obsidian.md/t/119821) | On a line that opens a `%%` block comment, every position is 2 characters early, and a rename corrupts the line. |
| `lazy-callout-offset` | bug, [t/119821](https://forum.obsidian.md/t/119821) | On a callout's lazy line, every position is 1 character late. |
| `lazy-callout-negative-end` | bug, not reported | A list item or definition on such a line ends at offset -1. |
| `footnote-scan-window` | bug, [t/119822](https://forum.obsidian.md/t/119822) | A line ends a footnote definition only within its first 1,024 characters. |
| `definition-title-across-blank-line` | bug, [t/119823](https://forum.obsidian.md/t/119823) | A definition takes a quoted paragraph after a blank line as its title. |
| `open-bracket-hides-definition` | bug, not reported | A definition's label runs back across a blank line to an unclosed `[`. The paragraph vanishes, and the references to the definition break. |
| `undefined-footnote-brackets` | bug, [t/119824](https://forum.obsidian.md/t/119824) | An undefined footnote reference loses `[^` and `]` in Reading view. |
| `comment-footnote-backlink` | bug, [t/119825](https://forum.obsidian.md/t/119825) | A footnote reference inside a comment counts, and adds a back link. |
| `escaped-closer` | bug, [t/119826](https://forum.obsidian.md/t/119826) | A backslash does not escape a closing `==` or `]]`. |
| `footnote-block-id-empty-position` | bug, [t/119754](https://forum.obsidian.md/t/119754) | A block id in a footnote points at an empty spot. |
| `container-heading-uncached` | known, [t/59897](https://forum.obsidian.md/t/59897) | A heading in a quote, callout or list item is shown but not cached. |
| `heading-raw-source` | known | The cache's heading text keeps its markup. |
| `unclosed-comment-swallows` | expected, [t/119752](https://forum.obsidian.md/t/119752) | An unclosed `%%` line hides the rest of the note. |
| `unclosed-fence-swallows` | expected | An unclosed fence or `$$` runs to the end. |
| `comment-indexed` | expected | Links, embeds and tags inside a comment are indexed. |
| `duplicate-block-id` | expected | A block id used twice names only the first block that carries it. |
| `escaped-closer-other` | minor | The escaped closer on `%%` and `~~`. |
| `undecodable-destination` | minor | A link whose destination `decodeURI` refuses is shown but not cached. |
| `footnote-in-inline-footnote` | minor | A footnote reference inside an inline footnote shows as nothing. |
| `indented-block-start` | minor | An indented list item or footnote definition starts at its line's start. |
| `colored-highlight-residue` | minor | A colored highlight keeps the space after its emoji marker. |
| `bracket-run-link` | minor | A link right after a stray `[` takes the bracket into its target. |
| `tree-position` | judge | A Reading view text node is placed off its source. This shows only through the cache's positions. |

`src/oracle/self-check.test.ts` is the acceptance test. From generated notes alone, with no pinned shape, the judges must find every bug family above that was first reported from a hand-written note, plus the known and by-design families. They must also leave no finding unclassified. A family that stops being found, or a new key with no family, fails the suite.

## What the judges cannot find yet

- **A disagreement with other parsers.** A GFM task item whose body is read again as blocks, and any character accepted as a task status, are wrong only by the GFM spec. Finding them needs a differential against the reference engines.
- **API shape.** `blocks` being a record, and columns counting UTF-16 code units, are design choices, not inconsistencies.
- **Live surfaces.** Backlinks, the outline, `resolvedLinks`, a real `fileManager.renameFile` and `processFrontMatter` exist only in the app. The `rename` judge simulates a rename from the cache's positions, which is what the app's rename uses.
- **Editor-only behaviour,** such as a `%%` that opens a comment in a list item, belongs to the mode judge.
