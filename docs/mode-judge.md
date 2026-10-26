# The mode judge: where the editing modes and Reading view disagree

Obsidian reads a note twice. Source mode and Live Preview run the editor's class tokenizer, a CodeMirror 5 line tokenizer, and Reading view and the metadata worker run `remark-parse` 8. Each of this repository's engines was measured against its own oracle and never against the other's. The mode judge compares the two readings of the same note, finds where they disagree, and sorts the disagreements into families, so new Obsidian bugs show up without someone having to spot them by hand.

```sh
npm run mode-judge -- [--per-key <n>] [--out <file>]
```

## What it compares

`src/oracle/mode-judge.ts` reads each side into the same facts:

- **Per character:** code (inline or block), math, comment, highlight, strong, emphasis, strikethrough, internal link or embed (its target, without the brackets), tag, and front matter.
- **Per line:** the heading level, the quote depth, whether the line is in a list item, a task's first line, a table row, or a thematic break.

The editing modes' facts come from the editor's classes: the class-span oracle's own tree on its documents, and the class tokenizer's prediction elsewhere, which matches the editor on every oracle document. The reading view's facts come from the `remark-parse` 8 tree (`src/remark/`), which matches Obsidian's on every oracle document. A difference is a fact one side has on a run of characters or lines and the other lacks. Its key is the side and the fact, with a `+` for a character run that crosses a line break, such as `editor:code+`.

Some things are not compared:

- Whitespace, since the editor gives a space between two tokens the classes of either.
- Anything inside a comment except the comment itself, since the editor styles markdown there and the reading view hides it.
- Anything inside code or front matter that both sides read as such, since the editor styles what a sub-mode sees there.

## Reducing and sorting

For each key, `reduceDifference` delta-debugs the note over its lines and then over its graphemes, down to a minimal note that keeps the difference. It keeps the difference's cause as well as its key: a candidate keeps the difference only when a difference of the same key falls on a line that holds the same facts on both sides as the first one's line in the note. So a quote carried onto a list item keeps the list item, and a code mark left open in a heading keeps the heading. Without that, a reduction could drift to another mechanism with the same key. A family's pattern therefore takes its construct after a quote, list or heading mark too. `src/oracle/mode-families.ts` then sorts each minimal note into a family. The first family whose rule matches takes it, so the more specific families come first. There are five kinds of family:

- **known:** a forum issue already reports it: one of the 14 samples of `src/oracle/forum-issues.ts`, or an open topic someone else filed, named by the family's `forumUrl`.
- **expected:** the editor shows it by design, or as a limit of Live Preview that obsidian-help documents (the family's `helpUrl`). The first such family is the line tokenizer styling an emphasis, highlight or strikethrough mark that it has not seen closed, or that the reading view does not pair, up to the end of its paragraph, and a code mark up to the end of its line, as the mark is typed.
- **quirk:** the reading view departs from CommonMark where the editor follows it. The spec and quirk probe oracles already measure these.
- **minor:** confirmed in the app and judged not worth reporting, since only a note nobody writes on purpose shows it.
- **candidate:** a new disagreement that no forum issue reports yet. A `forumUrl` on one names a topic the team closed without settling it.

`src/oracle/mode-judge.test.ts` checks four things:

- The judge flags all 14 forum samples on the editor's own tree.
- Every sample but one falls into a family of its own issue. The exception is `issue-5-1`, whose `===` run reduces to a highlight mark left open.
- It flags nothing on a set of notes that use every construct both sides read the same.
- Every judged sample falls into its own family.

## The run of 2026-10-25

The run covered 50,466 documents: the 46,508 class-span documents, all 674 spec examples and the 3,284 metadata worker documents. **19,145 of them differ.** Up to 300 documents of each key were reduced, which gave 2,256 distinct minimal notes. The counts below are reduced documents, not distinct notes, and an example in double quotes is written as a JSON string, its spaces kept.

| Kind | Family | Reduced | Example |
| --- | --- | ---: | --- |
| expected | unclosed-inline-mark | 1,720 | `` ` `` |
| known (issue 7) | math-left-open | 889 | `$$` |
| known (issue 12) | fence-left-open-in-container | 772 | `">- ```\n>>"` |
| known (issue 6) | comment-opened-mid-line | 712 | `x%%` |
| known (issue 8) | code-span-across-lines | 187 | `">``\n``"` |
| known (issue 11) | quoted-task | 153 | `">- [x] "` |
| known (issue 5) | highlight-equals-run | 147 | `==>==` |
| known (issue 9) | math-in-link-text | 40 | `[$m$` |
| known (issue 10) | setext-after-math-line | 26 | `$\n-` |
| known (issue existing-50661) | indented-math | 2 | `">\n    $"` |
| known ([topic 26871](https://forum.obsidian.md/t/26871)) | emphasis-pairing | 395 | `** x**` |
| quirk | setext-heading | 410 | `]\nx\n--` |
| quirk | lazy-quote | 196 | `>>\n>$` |
| quirk | code-span-pairing | 110 | `">``\nc`"` |
| quirk | lazy-line-after-empty-list-item | 42 | `"- \n="` |
| quirk | tab-indentation | 31 | `>\t-` |
| expected | unclosed-front-matter | 593 | `---` |
| candidate (closed [topic 104674](https://forum.obsidian.md/t/104674)) | html-block-ends-at-line | 343 | `</v>\n>` |
| candidate | fence-in-quote-nested-quote | 278 | `` >```\n>> `` |
| known ([topic 14361](https://forum.obsidian.md/t/14361)) | tag-after-mark | 267 | `*#t*` |
| candidate | empty-list-item | 260 | `-` |
| minor | lazy-line-after-empty-quote-line | 227 | `">\n    d"` |
| known ([topic 73772](https://forum.obsidian.md/t/73772)) | heading-in-quote | 171 | `>#` |
| known ([topic 29582](https://forum.obsidian.md/t/29582)) | block-on-list-item-first-line | 169 | `- >` |
| minor | table-with-empty-cells | 157 | `>\|\|\n\|-\|` |
| candidate | triple-backtick-mid-line | 146 | `` >```\n>> `` |
| minor | line-after-indented-code | 139 | `\t-\n%%` |
| known ([topic 38847](https://forum.obsidian.md/t/38847)) | unfinished-html-tag | 129 | `"<v\n- [x] "` |
| minor | highlight-across-lines | 115 | `>==q\n==p==` |
| minor | indented-code-in-container | 103 | `1.     Q` |
| known ([topic 112786](https://forum.obsidian.md/t/112786)) | one-dash-setext-underline | 81 | `x\n-` |
| minor | four-dollars | 81 | `\te\n$$$$` |
| expected ([help](https://help.obsidian.md/html#No%20Markdown%20inside%20HTML)) | inline-html-before-internal-link | 80 | `<u>[[L]]` |
| candidate (closed [topic 30367](https://forum.obsidian.md/t/30367)) | ordered-item-interrupts-paragraph | 73 | `"t\n9. "` |
| minor | highlight-closer-after-space | 70 | `==a ==c==` |
| minor | line-after-empty-list-item | 50 | `"  1. \n\t- "` |
| known ([topic 57053](https://forum.obsidian.md/t/57053)) | quote-onto-indented-list-item | 40 | `">\n - "` |
| minor | brackets-in-internal-link | 39 | `[[[[]]` |
| minor | indented-code-after-block | 32 | `">\n    d"` |
| known ([topic 53589](https://forum.obsidian.md/t/53589)) | inline-math-across-lines | 26 | `$\n$` |
| candidate | indented-fence-closer | 22 | `` ```\n ```\n# `` |
| known ([topic 34124](https://forum.obsidian.md/t/34124)) | setext-in-quote | 22 | `>k\n>-` |
| minor | math-across-table-cells | 20 | `\|$$\|\n\|-\|` |
| known ([topic 31041](https://forum.obsidian.md/t/31041)) | emphasis-around-inline-html | 11 | `*<r>*` |
| candidate | tag-after-quote-marker | 9 | `>#t` |
| minor | setext-under-special-line | 8 | `^a\n---` |
| candidate | comment-block-edge | 6 | `-\n%%%` |
| minor | fence-info-with-backtick | 0 | |
| none | unclassified | 27 | `==$==$` |

### What keeping the cause changed

Until 2026-10-25 the reducer kept only the key. On the same oracles that left 21 notes unclassified. Keeping the cause first left 313, and re-fitting the families' patterns brought it back down to 36. Most of the 313 were a family's own construct after a quote, list or heading mark, such as `` - ` `` or `>-`. The patterns take those marks now.

A reduction that changed family mostly found the mechanism its document really had, where the key-only one had drifted to another with the same key. 869 of the 9,626 reduced documents changed family, about one in eleven. The largest moves:

1. 133 from `triple-backtick-mid-line` to `fence-left-open-in-container`. The documents opened a fence in a list item, ```` - ``` ````, and the key-only reduction dropped the space, which leaves ```` -``` ````, three backticks mid-line.
2. 78 from `unclosed-front-matter` to `setext-heading`. The `---` was a setext underline under a paragraph, and the key-only reduction kept only the `---`.
3. 61 from `fence-in-quote-nested-quote` to `fence-left-open-in-container`, a fence in a list item in a quote.
4. 42 from `empty-list-item` to the new quirk `lazy-line-after-empty-list-item` (below).
5. 40 from `lazy-line-after-empty-quote-line` to the new `quote-onto-indented-list-item` (below).

Two families are new, one changed kind and one moved:

1. **`quote-onto-indented-list-item` (known, [topic 57053](https://forum.obsidian.md/t/57053)).** The editor carries a quote onto the next line when that line is a list item indented by a space or more, `">\n - "`, but not onto `>\n- b`. That is the owner's callout in a nested list item, followed by the next item (topic 80930, closed as a duplicate of the open topic 57053, *Live Preview: Support callouts in list items*, tagged `repro` and `editor-parser`). Live Preview, read live on 1.14.5, draws one embed that holds the callout as an indented code block and the item as a list of its own. The key-only reducer brought that note down to `>\n-`, a bare `-` after an empty quote line, which has the same key by another path. Keeping the list item's facts separates the two. The live read is pinned in `src/oracle/forum-issues.test.ts`.
2. **`lazy-line-after-empty-list-item` (quirk).** The reading view takes the unindented line after an empty list item into the item, as in `- \n>` or `- \n=`, where the editor and commonmark.js end the list. This repository's `remark-parse` 8 port reads it, and the port matches Obsidian's tree on every oracle document. No spec example or quirk probe pins it yet.
3. **`lazy-line-after-empty-quote-line` is minor again.** It was minor on 2026-10-24 and moved to known on 2026-10-25 only because the owner's callout note reduced into it. That note now has its own family, so what is left is a line after an empty quote line, such as an indented line, `</div>` or `---`, as it was first judged.
4. `math-across-table-cells` now comes before the `$$` families, since a reduction can drop the cell boundary between the two marks and leave `|$$|`.

That left 36 unclassified notes. The most common was `>#t`, a tag right after a quote marker with no space, which the editor does not read and the reading view does, in 9 reduced documents. It was read live on 2026-10-26 and is the candidate family `tag-after-quote-marker` now (below). The 27 left have no family, and each is one to three documents.

`emphasis-pairing` was a quirk family until 2026-10-25. It is known now, because an open topic in Bug reports, tagged `upstream-bug`, reports it: [topic 26871](https://forum.obsidian.md/t/26871), *Reading mode: Bug when italics and bold are applied to a text that has a space*. [Topic 82094](https://forum.obsidian.md/t/82094) was closed as its duplicate. Its note `*italic **bold&italic***` is CommonMark example 414, and Reading view on 1.14.5 renders that example as `<p>*foo <strong>bar*</strong></p>`, where CommonMark gives emphasis around strong emphasis.

That note itself does not land in this family. The editor reads it as CommonMark does, so the reading view's `<strong>` matches the editor's, and the one fact that differs is the emphasis the reading view drops. The reducer keeps that fact in the smallest note that still has it, `*i`, a mark left open, so the note falls into `unclosed-inline-mark`. That reduction is correct: the judge compares the two modes, and the editor is right on this note. What is wrong only by the spec belongs to the engine differential, whose `engine-emphasis-pairing` family finds the note's shape in generated notes ([self-check.md](self-check.md#the-engine-differential)).

`dist/mode-judge/report.json` holds every family with its ten most common minimal notes, and the number of documents behind each key.

## The new families, confirmed live and judged

`src/oracle/mode-judge-samples.ts` writes out one readable note for each family the run found new, except `comment-block-edge`, whose five notes show no single behaviour. `scripts/editing-modes-oracle.ts` read each of those notes from Obsidian 1.14.5, in Source mode, Live Preview and Reading view, together with the editor's tree and the worker's metadata. `src/oracle/editing-modes.test.ts` checks that each one still shows a difference of its family on the live editor's tree. They are the `judged` cases of the `-failing` export. Each note says what the two sides do.

Each of the 29 notes of the first run was judged on 2026-10-24 from its live read in all three modes, with realistic variants run through the judge, and the forum's Bug reports and Bug graveyard were searched for each. The eight first judged expected were then judged again: each one's note was read on 1.15.0 (Catalyst) too, which gave the same Reading view, Live Preview and metadata as 1.14.5, obsidian-help was searched for a sentence documenting it, and the team's reply on each closed topic was read. The kind in the table above is the verdict:

1. **Candidates, to report (7):**
   1. `triple-backtick-mid-line` (`` Use ```js for fences `` mid-line makes the rest of the note, headings included, inline code in the editor), `indented-fence-closer` (a closing fence indented by one to three spaces leaves the rest of the note code in the editor) and `fence-in-quote-nested-quote` (Live Preview draws a nested quote border on a `>>` line inside a quoted fence). No forum topic reports them.
   2. `empty-list-item`: `- a`, `-`, `- b` is one list of three items in Reading view, in the metadata cache and in CommonMark (example 281), and the editor shows the middle `-` as plain text. Typing a dash and a space already makes a bullet, so the "while it is being typed" reading does not hold for a saved note.
   3. `html-block-ends-at-line`: Reading view and the metadata cache follow CommonMark, and an HTML block runs on to the next empty line. Topic 104674 was closed by a moderator saying so. But the editor ends the block at its own line, so after `<hr>` or `</div>` Live Preview shows a working, clickable `[[link]]` and a styled `#tag` that are not indexed. That is what misled the topic's reporter.
   4. `ordered-item-interrupts-paragraph`: topic 30367 was not closed as by design. Its reporter could no longer reproduce it, because the condition is the paragraph right above the list. `text` followed by `2. item` still reproduces it.
   5. `tag-after-quote-marker`, judged on 2026-10-26: in `>#tag text`, Source mode and Live Preview show `#tag` as plain quote text, while Reading view links the tag and the metadata cache indexes it. In `> #tag text`, with a space, all three read the tag. Obsidian 1.15.0 (Catalyst) reads the note the same way. The editor's rule is the one behind `tag-after-mark`: a tag opens only at the start of a line or after whitespace, and the quote marker is neither. Topic 14361 reports only the emphasis case, and a forum search found no topic for the quote, so this is its own family. A report can point at topic 14361 as the same rule.

   Posting is the owner's call.
2. **Known, already reported by an open topic (8):** `heading-in-quote` and `setext-in-quote` (headings in a quote), `tag-after-mark` (`*#tag*`), `unfinished-html-tag` (`a<b` in prose takes the next lines, past an empty line, into a tag, so a heading after it loses its classes), `inline-math-across-lines`, `one-dash-setext-underline` (case 5 of topic 112786), `block-on-list-item-first-line` (topic 29582 for the quote, which the team acknowledged, and topic 117996 for a list or heading after the marker) and `emphasis-around-inline-html` (feature request 31041, where the team moved bold around `<u>` after saying it is not supported). `lazy-line-after-empty-quote-line` was counted here from 2026-10-25 until the reducer kept the cause, and is minor again (above).
3. **Expected (2):**
   1. `inline-html-before-internal-link` is documented in obsidian-help: *HTML content* says that Obsidian does not render Markdown inside HTML elements, by design, and that a link inside an inline tag only appears to work in Reading view. Topic 29589 was closed on the same grounds.
   2. `unclosed-front-matter` is the editor treating `---` on the first line as properties before the closing `---` has been typed, which is how the help tells you to add properties. No page says that Reading view and the index ignore properties that are never closed.
4. **Minor (13):** the remaining families show only in notes nobody writes on purpose, such as `||\n|-|`, `[[[[Note]]`, `$$$$` or `==a ==b==`. Their realistic variants agree on both sides: `==a\nb==`, `==if a == b==`, `# H\n    code` and `> quote\n>\n- item` give no difference.

Two of these rules are undocumented and come with a draft obsidian-help change. One is that an HTML block ends only at a blank line, under *HTML content*. The other is that properties need their closing `---`, under *Properties*.

The heading in a quote is no metadata heading either, since the worker leaves every heading in a quote out of `headings`.

## Limits

- The reading view side is this repository's `remark-parse` 8 port, not the live reading view. The port matches Obsidian's tree on every oracle document, and the judged samples' reading view HTML comes from the live app.
- A family is a regular expression over a minimal note, so a rule can take a note that belongs to a later family. The examples in the report are the check.
- Each key is reduced on its first 300 documents only, so a family that shows only in later documents of a common key is missed. A larger `--per-key` finds it, at the cost of a longer run.
- Live Preview renders widgets that the editor's classes do not show, such as tables, callouts, embeds and math. A disagreement that shows only in the rendered widgets is outside the judge.
