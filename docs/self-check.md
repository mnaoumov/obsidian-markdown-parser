# The self-check judges: where Obsidian is wrong but consistent

The other bug finders compare two readings: Obsidian against the CommonMark and GFM spec examples ([spec-suites.md](spec-suites.md)), and the editing modes against Reading view ([mode-judge.md](mode-judge.md)). Neither can see a bug Obsidian makes the same way everywhere. A link whose position points at the wrong characters, a scan that stops after 1,024 characters, a rename that rewrites the wrong text: each one is consistent with itself, so a comparison of Obsidian with Obsidian finds nothing.

The self-check judges find those. Each one checks a relation that a correct parser keeps, and none of them needs a reference output:

```sh
npm run self-check -- [--count <n>] [--seed <n>] [--per-key <n>] [--oracles] [--engines] [--live-surfaces] [--out <file>]
```

`--engines` also runs the engine differential ([below](#the-engine-differential)) over as many generated notes of CommonMark and GFM alone. `--live-surfaces` also judges the live surface oracle ([below](#the-live-surfaces)) and reports its families as a table of their own.

## The relations

`src/oracle/self-check.ts` judges a note with ten relations:

| Judge | The relation |
| --- | --- |
| `offset` | Every position the cache gives for a link, embed, tag, footnote reference, footnote, heading, block id, definition or list item slices out that construct, and its line and column agree with its offset. A link's `original` is a whole `[[…]]` or `[…](…)`. |
| `shift` | Prepending a paragraph moves every position by its length and two lines, and changes nothing else. This is measured between the note with the prefix once and with it twice, so no list starts on line 0 or 1, whose parent the cache writes as -1 in both cases. |
| `padding` | Stretching the filler word `lorem` by 1,100 and by 4,200 characters, past the 1,024 and 4,096 marks, changes no structure: no item count, heading level, section type, link, tag or footnote. |
| `rename` | Writing `[[renamed]]` over each link or embed where the cache says it is, as a rename rewrites a link, gives a link to `renamed` there and leaves every other link as it was. |
| `escape` | A backslash before the opening or closing delimiter of a highlight, internal link, embed, inline math, comment or strikethrough makes the delimiter literal, so the construct goes. |
| `independence` | A block after a blank line gives the same headings, links, embeds, tags, footnotes, block ids, definitions and sections when it is read alone as when it is read after the blocks before it. Links by reference, footnote references and lists are left out, because they may lean on, or merge with, an earlier block by design. A block that would read as front matter alone, such as `---`, `k: v` and `---`, is read after a blank line, because only a note's start opens front matter. |
| `render` | The cache and Reading view find the same headings, links, embeds, tags and footnote references, and a heading has the same text in both. An item the cache finds inside a comment, which Reading view hides, gets a key of its own. A colored highlight shows nothing of its color marker. |
| `fidelity` | A Reading view text node holds its own source, once backslash escapes are taken out, container marks are dropped and whitespace is collapsed. |
| `conservation` | Every word of the source is either shown, or hidden by something that hides it by design: a comment, the front matter, a link destination, the lines of a definition up to a blank line, or a callout's type. |
| `shape` | Every item field of the cache is a list, as `links` is. A column counts graphemes, as a reader counts characters: inserting an emoji and a space, or a letter with a combining mark and a space, before the first link, embed, tag or footnote reference that follows a space moves its column by 2, the graphemes it inserts. A correct parser could count either unit; the judge asks for graphemes so that the API's choice of UTF-16 code units, the unit of `offset` and of CodeMirror, is found and recorded rather than assumed. |

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
- `quirk`: a deviation of `remark-parse` 8 from the spec that the spec suites already measure ([spec-suites.md](spec-suites.md#obsidians-quirks)). Only the engine differential gives these.
- `judge`: a limit of the judge itself, where Obsidian is right or is not judged.

## The last run

On 2026-10-25, 4,000 generated notes (seed 20261024) and the worker oracle (7,284 notes) gave 65 keys, all in 25 families:

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
| `blocks-record` | expected | `blocks` is a record keyed by block id, where every other item field is a list, as `obsidian.d.ts` declares it. |
| `utf16-columns` | expected | A column counts UTF-16 code units, not graphemes: an emoji or a combining mark before a link moves it one column more than a reader sees. |
| `escaped-closer-other` | minor | The escaped closer on `%%` and `~~`. |
| `undecodable-destination` | minor | A link whose destination `decodeURI` refuses is shown but not cached. |
| `footnote-in-inline-footnote` | minor | A footnote reference inside an inline footnote shows as nothing. |
| `indented-block-start` | minor | An indented list item or footnote definition starts at its line's start. |
| `colored-highlight-residue` | minor | A colored highlight keeps the space after its emoji marker. |
| `bracket-run-link` | minor | A link right after a stray `[` takes the bracket into its target. |
| `tree-position` | judge | A Reading view text node is placed off its source. This shows only through the cache's positions. |

`src/oracle/self-check.test.ts` is the acceptance test. From generated notes alone, with no pinned shape, the judges must find every bug family above that was first reported from a hand-written note, plus the known and by-design families. They must also leave no finding unclassified. A family that stops being found, or a new key with no family, fails the suite.

## The engine differential

The relations above cannot see a bug that is wrong only by the spec: a GFM task item whose text is read again as blocks, or any character taken as a task status, is consistent with itself everywhere. `src/oracle/engine-differential.ts` finds those by asking other parsers. The grammar has a second mode for it, `generateNotes({ syntax: 'gfm' })`, which draws only CommonMark and GFM constructs (no Obsidian syntax, block ids, callouts or front matter) and adds task marks of `[X]`, `[?]`, `[-]` and `[/]`. Each note is rendered by four engines:

| Engine | Role |
| --- | --- |
| `remark-parse-8` | Judged: the `remark-parse` 8 engine with Obsidian's edits, which is Reading view. |
| `micromark` | Reference: with its GFM table, strikethrough and autolink literal extensions. |
| `markdown-it` | Reference: its default preset, with raw HTML and `linkify` (no fuzzy links). |
| `commonmark.js` | Reference, only for a note the GFM extensions of `micromark` change nothing in, since it knows none of them. |

Each engine's HTML goes through `parse5` into one token sequence: element names, the attributes that carry meaning (a link's destination and title, an image's source and text, an ordered list's start), and text with its white space collapsed. Three differences are made equal first, because they are not what the differential looks for. A paragraph directly in a list item is read as its content, since `remark-parse` 8 decides looseness by its own rule (the `looseList` quirk). No reference runs a task extension, so the GFM rule is applied to their output (a list item whose first block is a paragraph opening on `[ ]`, `[x]` or `[X]` and white space is a task), and the judged engine's checkbox is read as the same mark. `markdown-it`'s `<s>` is read as `<del>`.

When the references agree and the judged engine does not, the key is `engines:obsidian:<its token>-vs-<theirs>`, named by the first token that differs. When the references disagree, the note is a spec question and the judged engine is not judged on it. The key then names the reference alone against the other two (`engines:references:micromark-alone:...`), or the pair. The findings are reduced and sorted like the others, into the families at the head of `self-check-families.ts`. The judge is no part of `judgeNote`, which reads Obsidian syntax the references do not know. It takes about 2 ms a note.

Its inline atoms are the grammar's atoms that every engine reads as CommonMark or GFM. One atom is added to them: `*em **nested strong***`, strong emphasis closed inside emphasis by one run of three, which is the shape of CommonMark example 414 and of the open bug report [t/26871](https://forum.obsidian.md/t/26871).

On 2026-10-25, 4,000 notes (seed 20261024) gave 59 keys, all in 8 families. The two marked *earlier run* were found by the same seed before the nested emphasis atom was added, and are missing from this run only because that atom changed what the seed draws:

| Family | Verdict | What it is |
| --- | --- | --- |
| `task-body-blocks` | known | A task item's text after its mark is read again as blocks: `- [ ] # H` holds a heading, `- [ ] > q` a quote, `- [ ] [r]: u` a definition, where GFM reads a paragraph. |
| `task-status-any-character` | expected | Any character between a task's brackets makes a task, checked unless it is a space. GFM reads only a space, `x` or `X`. |
| `engine-emphasis-pairing` | known, [t/26871](https://forum.obsidian.md/t/26871) | A `*` run paired otherwise than CommonMark pairs it: `*em **nested strong***` is a `*` followed by strong emphasis that ends on a `*`, where CommonMark reads emphasis around strong emphasis (example 414). Reading view does the same. The topic is open and tagged `upstream-bug`, and t/82094 was closed as its duplicate. |
| `open-reference-bracket-dropped` (earlier run) | bug, [t/119764](https://forum.obsidian.md/t/119764) | A `[` straight after a bracketed text, never closed, is not shown: `[x][` reads `[x]`. Reading view does the same on 1.14.5 and 1.15.0: `remark-parse` 8's `reference` tokenizer eats the `[` with the shortcut reference, the loss behind the topic's `[foo][ref[]` sample. |
| `task-without-text` | minor | A task mark with nothing after it makes a task. The spec has no example either way. |
| `engine-container-continuation` | quirk | A list item or quote goes on where CommonMark ends it, or ends where a lazy line continues it: `- >u` then `>p` keeps `p` in the list item's quote, and an indented line after a quoted list item is read as code. |
| `engine-table` | quirk | A table where GFM reads none, or one that ends where GFM takes a line with no pipe as a row. |
| `engine-setext-heading` | quirk | A setext heading underlines only a one-line paragraph, and takes a lazy `=` or `-` line. |
| `engine-link-definition` | quirk | A definition CommonMark rejects: a blank label, an unescaped `[`, no destination, an unbalanced `)`, a title never closed. |
| `engine-autolink-literal` (earlier run) | quirk | A bare URL right after a character that is not a space: GFM links `]http://m` and leaves `shttp://x.c`, and `remark-parse` 8 does the opposite. |
| `references-disagree` | judge | `micromark` alone on an ordered list not numbered 1 that opens a quote straight after a paragraph, and `markdown-it` alone on a definition in a quote followed by a lazy line. |

The acceptance test runs the differential on 4,000 notes. It must find `task-body-blocks`, `task-status-any-character` and `engine-emphasis-pairing` and leave nothing unclassified.

## The live surfaces

Some surfaces exist only in the app: the Outline and Backlinks views, `resolvedLinks`, a real `fileManager.renameFile` and `processFrontMatter`. `scripts/live-surfaces-oracle.ts` reads them for the first 400 grammar notes, written into one vault with the four files they link to (`target.md`, `page.md`, `image.png`, `pic.png`), into `oracle/live-surfaces-obsidian-<version>.json` ([oracles.md](oracles.md)). The read takes about 2.5 minutes. `src/oracle/live-surfaces.ts` then judges each note offline against its cache, as the app held it before the note was opened, and against the `remark-parse` 8 engine:

| Judge | The relation |
| --- | --- |
| `openFile` | Opening the note in the editor leaves its cache as the worker gave it. |
| `resolvedLinks` | Every cached link, embed and front matter link is counted once, under the file it resolves to in `resolvedLinks` or under its link path in `unresolvedLinks`. |
| `backlinks` | `getBacklinksForFile` of each target, and the Backlinks view of it, hold exactly the note's links to that target, at the cache's positions and front matter keys. The count the view shows is the number of matches it lists. |
| `outline` | The Outline view lists the cache's headings, nested by their levels, each showing the text Reading view shows. |
| `renameFile` | Renaming every target changes the note only inside the cached links to it, each getting the new name: the rename the `rename` judge simulates from the cache's positions. Renaming them back gives the note back. |
| `processFrontMatter` | Setting one key leaves the body byte for byte, keeps every other value, and changes the front matter only by the added line. |

The notes cannot be reduced offline, since only the app reads them, so each finding carries the lines it lies on and is sorted into a family by those lines. `src/oracle/live-surfaces.test.ts` pins the cache to `parseMetadata`, and requires the pinned reading to fall into exactly the families below. On 1.14.5, `resolvedLinks`, `getBacklinksForFile`, the Outline's count and nesting, the body after `processFrontMatter`, and every rename round trip whose forward rename was right all held on all 400 notes. What broke:

| Family | Verdict | Findings | What it is |
| --- | --- | --- | --- |
| `editor-reformats-table` | bug, not reported | 5 | Live Preview writes every table back to the file padded to its column widths, with no edit: when the note is left for another one, or already on opening when a math span or a fenced code block with a language follows the table. A cell with more `\|` than the header gets a header column, so an unescaped `[[target\|alias]]` is split in two. The cache, the Backlinks view and the rename then read the padded text: a link offset moved by the padding, a Backlinks span marked on it, and a rename body that changed outside its links. A rename of a note never opened leaves its table alone. |
| `comment-line-offset` | bug, [t/119821](https://forum.obsidian.md/t/119821) | 17 | The real rename corrupts a link on a line that opens a `%%` block comment, as the simulated one predicts. |
| `front-matter-restyled` | expected | 114 | `processFrontMatter`, and a rename that updates a front matter link, write the whole front matter back in the YAML library's style (`tags: [a]` becomes a block list). |
| `outline-embed-source` | minor | 14 | An embed or image in a heading shows in the Outline as its link path. |
| `outline-inline-footnote` | bug, not reported | 12 | An inline footnote in a heading shows in the Outline as a numbered list after the heading. |
| `outline-undefined-reference` | minor | 6 | An undefined reference link in a heading shows in the Outline as its text alone. |
| `outline-escaped-bracket` | bug, not reported | 5 | `\[[escaped]]` in a heading shows in the Outline as `[escaped]`. |

## A new Obsidian build

The judges above run on this repository's engines, which match the pinned oracles, so a new public or Catalyst build reaches them only through oracles read from it. The release differential runs the bug finders on two versions' oracles and diffs their family tables:

```sh
npm run oracle:differential -- --to-version <version> [--to-dir <directory>] [--from-version <version>] [--from-dir <directory>] [--out-dir <directory>]
```

`npm run oracle:refresh` runs it after the drift report, unless `--skip-differential` ([oracles.md](oracles.md#the-release-differential)). Per version it runs the mode judge, whose editor side is the build's class-span trees, and `npm run self-check -- --count 0 --live-surfaces`, which judges the build's live surface oracle. The offline relations of the table above are left out: they judge `parseMetadata` and the `remark-parse` 8 engine, which no build changes, so their families move only when the notes' text does.

## What the judges cannot find yet

- **The spec on Obsidian syntax.** The engine differential reads notes of CommonMark and GFM alone, so it cannot see a spec construct read wrongly next to an internal link, a comment or a callout. No reference knows those.
- **Live surfaces beyond the sample.** The live judges see only the 400 notes the oracle read, and only the four targets they link to, so a shape that needs another note, a folder or a name clash to show is out of their reach.
- **Editor-only behaviour,** such as a `%%` that opens a comment in a list item, belongs to the mode judge.
