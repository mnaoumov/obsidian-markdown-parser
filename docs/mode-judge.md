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

For each key, `reduceDifference` delta-debugs the note over its lines and then over its graphemes, down to a minimal note that keeps the difference. `src/oracle/mode-families.ts` then sorts each minimal note into a family. The first family whose rule matches takes it, so the more specific families come first. There are five kinds of family:

- **known:** a forum issue already reports it: one of the 14 samples of `src/oracle/forum-issues.ts`, or an open topic someone else filed, named by the family's `forumUrl`.
- **expected:** the editor shows it by design or as a known limit of Live Preview. The first such family is the line tokenizer styling an emphasis, highlight or strikethrough mark that it has not seen closed, or that the reading view does not pair, up to the end of its paragraph, and a code mark up to the end of its line, as the mark is typed. The others were judged in the app, and a `forumUrl` names the topic the team closed, where there is one.
- **quirk:** the reading view departs from CommonMark where the editor follows it. The spec and quirk probe oracles already measure these.
- **minor:** confirmed in the app and judged not worth reporting, since only a note nobody writes on purpose shows it.
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
| expected | unclosed-front-matter | 705 | `---` |
| candidate | fence-in-quote-nested-quote | 338 | `` >```\n>> `` |
| expected ([topic 104674](https://forum.obsidian.md/t/104674)) | html-block-ends-at-line | 321 | `"</v>\n- "` |
| expected | empty-list-item | 313 | `-` |
| minor | lazy-line-after-empty-quote-line | 284 | `>\n-` |
| known ([topic 14361](https://forum.obsidian.md/t/14361)) | tag-after-mark | 276 | `*#t*` |
| candidate | triple-backtick-mid-line | 257 | `` -```\n- `` |
| known ([topic 73772](https://forum.obsidian.md/t/73772)) | heading-in-quote | 172 | `>#` |
| minor | table-with-empty-cells | 157 | `\|\|\n\|-\|` |
| expected | block-on-list-item-first-line | 154 | `- >` |
| minor | line-after-indented-code | 134 | `\t-\n%%` |
| minor | indented-code-in-container | 126 | `1.     Q` |
| known ([topic 38847](https://forum.obsidian.md/t/38847)) | unfinished-html-tag | 124 | `"<v\n- [x] "` |
| minor | highlight-across-lines | 100 | `==q\n==p==` |
| minor | four-dollars | 83 | `$$$$\nt` |
| expected ([topic 30367](https://forum.obsidian.md/t/30367)) | ordered-item-interrupts-paragraph | 83 | `"t\n9. "` |
| expected ([topic 29589](https://forum.obsidian.md/t/29589)) | inline-html-before-internal-link | 80 | `<u>[[L]]` |
| minor | highlight-closer-after-space | 75 | `==a ==c==` |
| expected | one-dash-setext-underline | 69 | `x\n-` |
| minor | brackets-in-internal-link | 39 | `[[[[]]` |
| minor | line-after-empty-list-item | 30 | `"  1. \n\t- "` |
| known ([topic 53589](https://forum.obsidian.md/t/53589)) | inline-math-across-lines | 25 | `$\n$` |
| candidate | indented-fence-closer | 20 | `` ```\n ```\n# `` |
| known ([topic 34124](https://forum.obsidian.md/t/34124)) | setext-in-quote | 20 | `>k\n>-` |
| minor | indented-code-after-block | 14 | `>\n    d` |
| expected ([topic 29589](https://forum.obsidian.md/t/29589)) | emphasis-around-inline-html | 11 | `*<r>*` |
| minor | setext-under-special-line | 9 | `^a\n---` |
| candidate | comment-block-edge | 5 | `%%\n%%    D` |
| minor | fence-info-with-backtick | 4 | `` ~~~`\n%% `` |
| minor | math-across-table-cells | 3 | `\|$\|$\n\|-\|` |
| none | unclassified | 21 | `*\n=\n---` |

`dist/mode-judge/report.json` holds every family with its ten most common minimal notes, and the number of documents behind each key.

## The new families, confirmed live and judged

`src/oracle/mode-judge-samples.ts` writes out one readable note for each family the run found new, except `comment-block-edge`, whose five notes show no single behaviour. `scripts/editing-modes-oracle.ts` read each of those notes from Obsidian 1.14.5, in Source mode, Live Preview and Reading view, together with the editor's tree and the worker's metadata. `src/oracle/editing-modes.test.ts` checks that each one still shows a difference of its family on the live editor's tree. They are the `judged` cases of the `-failing` export. Each note says what the two sides do.

Each of the 29 notes was judged on 2026-10-24 from its live read in all three modes, with realistic variants run through the judge, and the forum's Bug reports and Bug graveyard were searched for each. The kind in the table above is the verdict:

1. **Still candidates, to report (3):** `triple-backtick-mid-line` (`` Use ```js for fences `` mid-line makes the rest of the note, headings included, inline code in the editor), `indented-fence-closer` (a closing fence indented by one to three spaces leaves the rest of the note code in the editor) and `fence-in-quote-nested-quote` (Live Preview draws a nested quote border on a `>>` line inside a quoted fence). No forum topic reports them. Posting is the owner's call.
2. **Known, already reported by an open topic (5):** `heading-in-quote` and `setext-in-quote` (headings in a quote), `tag-after-mark` (`*#tag*`), `unfinished-html-tag` (`a<b` in prose takes the next lines, past an empty line, into a tag, so a heading after it loses its classes) and `inline-math-across-lines`.
3. **Expected, by design or a known limit (8):** `unclosed-front-matter`, `empty-list-item` and `one-dash-setext-underline` are what the editor shows while front matter or a list item is being typed. `block-on-list-item-first-line` is Live Preview's lack of block nesting in list items. The other four have a topic the team closed: Live Preview renders inline HTML as a widget, which drops the internal links inside it (`inline-html-before-internal-link`) and the emphasis around it (`emphasis-around-inline-html`). The other two follow CommonMark in the reading view: an HTML block runs on to the next empty line (`html-block-ends-at-line`), and only an item numbered 1 interrupts a paragraph (`ordered-item-interrupts-paragraph`).
4. **Minor (13):** the remaining families show only in notes nobody writes on purpose, such as `||\n|-|`, `[[[[Note]]`, `$$$$` or `==a ==b==`. Their realistic variants agree on both sides: `==a\nb==`, `==if a == b==`, `# H\n    code` and `> quote\n>\n- item` give no difference.

The heading in a quote is no metadata heading either, since the worker leaves every heading in a quote out of `headings`.

## Limits

- The reading view side is this repository's `remark-parse` 8 port, not the live reading view. The port matches Obsidian's tree on every oracle document, and the judged samples' reading view HTML comes from the live app.
- A family is a regular expression over a minimal note, so a rule can take a note that belongs to a later family. The examples in the report are the check.
- Each key is reduced on its first 300 documents only, so a family that shows only in later documents of a common key is missed. A larger `--per-key` finds it, at the cost of a longer run.
- Live Preview renders widgets that the editor's classes do not show, such as tables, callouts, embeds and math. A disagreement that shows only in the rendered widgets is outside the judge.
