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

For each key, `reduceDifference` delta-debugs the note over its lines and then over its graphemes, down to a minimal note that keeps the difference. `src/oracle/mode-families.ts` then sorts each minimal note into a family. The first family whose rule matches takes it, so the more specific families come first. There are four kinds of family:

- **known:** a forum issue already reports it, one of the 14 samples of `src/oracle/forum-issues.ts`.
- **expected:** the editor's line tokenizer styles an emphasis, highlight or strikethrough mark that it has not seen closed, or that the reading view does not pair, up to the end of its paragraph, and a code mark up to the end of its line, as the mark is typed.
- **quirk:** the reading view departs from CommonMark where the editor follows it. The spec and quirk probe oracles already measure these.
- **candidate:** a new disagreement that no forum issue reports yet.

`src/oracle/mode-judge.test.ts` checks four things:

- The judge flags all 14 forum samples on the editor's own tree.
- Every sample but one falls into a family of its own issue. The exception is `issue-5-1`, whose `===` run reduces to a highlight mark left open.
- It flags nothing on a set of notes that use every construct both sides read the same.
- Every judged sample falls into its own family.

## The run of 2026-10-24

The run covered 50,437 documents: the 46,508 class-span documents, all 674 spec examples and the 3,255 metadata worker documents. **19,134 of them differ.** Up to 300 documents of each key were reduced, which gave 1,559 distinct minimal notes. The counts below are reduced documents, not distinct notes, and an example in double quotes is written as a JSON string, its spaces kept.

| Kind | Family | Reduced | Example |
| --- | --- | ---: | --- |
| expected | unclosed-inline-mark | 1,784 | `` ` `` |
| known (issue 7) | math-left-open | 956 | `$$` |
| known (issue 6) | comment-opened-mid-line | 660 | `x%%` |
| known (issue 12) | fence-left-open-in-container | 532 | `">```\n>"` |
| known (issue 8) | code-span-across-lines | 188 | `">``\n``"` |
| known (issue 5) | highlight-equals-run | 157 | `==>==` |
| known (issue 11) | quoted-task | 153 | `">- [x] "` |
| known (issue 9) | math-in-link-text | 40 | `[$m$` |
| known (issue 10) | setext-after-math-line | 26 | `$\n-` |
| quirk | emphasis-pairing | 391 | `** x**` |
| quirk | setext-heading | 348 | `]\nx\n--` |
| quirk | lazy-quote | 188 | `>>\n>$` |
| quirk | code-span-pairing | 106 | `">``\nc`"` |
| quirk | tab-indentation | 41 | `>\t-` |
| candidate | unclosed-front-matter | 705 | `---` |
| candidate | fence-in-quote-nested-quote | 338 | `` >```\n>> `` |
| candidate | html-block-ends-at-line | 321 | `"</v>\n- "` |
| candidate | empty-list-item | 313 | `-` |
| candidate | lazy-line-after-empty-quote-line | 284 | `>\n-` |
| candidate | tag-after-mark | 276 | `*#t*` |
| candidate | triple-backtick-mid-line | 257 | `` -```\n- `` |
| candidate | heading-in-quote | 172 | `>#` |
| candidate | table-with-empty-cells | 157 | `\|\|\n\|-\|` |
| candidate | block-on-list-item-first-line | 154 | `- >` |
| candidate | line-after-indented-code | 134 | `\t-\n%%` |
| candidate | indented-code-in-container | 126 | `1.     Q` |
| candidate | unfinished-html-tag | 124 | `"<v\n- [x] "` |
| candidate | highlight-across-lines | 100 | `==q\n==p==` |
| candidate | four-dollars | 83 | `$$$$\nt` |
| candidate | ordered-item-interrupts-paragraph | 83 | `"t\n9. "` |
| candidate | inline-html-before-internal-link | 80 | `<u>[[L]]` |
| candidate | highlight-closer-after-space | 75 | `==a ==c==` |
| candidate | one-dash-setext-underline | 69 | `x\n-` |
| candidate | brackets-in-internal-link | 39 | `[[[[]]` |
| candidate | line-after-empty-list-item | 30 | `"  1. \n\t- "` |
| candidate | inline-math-across-lines | 25 | `$\n$` |
| candidate | indented-fence-closer | 20 | `` ```\n ```\n# `` |
| candidate | setext-in-quote | 20 | `>k\n>-` |
| candidate | indented-code-after-block | 14 | `>\n    d` |
| candidate | emphasis-around-inline-html | 11 | `*<r>*` |
| candidate | setext-under-special-line | 9 | `^a\n---` |
| candidate | comment-block-edge | 5 | `%%\n%%    D` |
| candidate | fence-info-with-backtick | 4 | `` ~~~`\n%% `` |
| candidate | math-across-table-cells | 3 | `\|$\|$\n\|-\|` |
| none | unclassified | 21 | `*\n=\n---` |

`dist/mode-judge/report.json` holds every family with its ten most common minimal notes, and the number of documents behind each key.

## The candidates, confirmed live

`src/oracle/mode-judge-samples.ts` writes out one readable note for each candidate family except `comment-block-edge`, whose five notes show no single behaviour. `scripts/editing-modes-oracle.ts` read each of those notes from Obsidian 1.14.5, in Source mode, Live Preview and Reading view, together with the editor's tree and the worker's metadata. `src/oracle/editing-modes.test.ts` checks that each one still shows a difference of its family on the live editor's tree. They are the `judged` cases of the `-failing` export. Each note says what the two sides do.

Before any of them is reported, a person has to check it in the app. Some may be known limits of Live Preview rather than bugs, such as a heading in a quote with no heading classes, or a note opening with an unclosed `---` read as front matter while it is typed. Forum posts are the owner's call.

## Limits

- The reading view side is this repository's `remark-parse` 8 port, not the live reading view. The port matches Obsidian's tree on every oracle document, and the judged samples' reading view HTML comes from the live app.
- A family is a regular expression over a minimal note, so a rule can take a note that belongs to a later family. The examples in the report are the check.
- Each key is reduced on its first 300 documents only, so a family that shows only in later documents of a common key is missed. A larger `--per-key` finds it, at the cost of a longer run.
- Live Preview renders widgets that the editor's classes do not show, such as tables, callouts, embeds and math. A disagreement that shows only in the rendered widgets is outside the judge.
