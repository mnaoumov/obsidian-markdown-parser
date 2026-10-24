# The oracles, and keeping up with Obsidian

Everything this repository claims about Obsidian is checked against oracle files in `oracle/`, each read from a real Obsidian:

| Oracle | Files | Read by | What it holds |
| --- | --- | --- | --- |
| Class spans | `obsidian-<version>-seed-<seed>.json`, one per seed | `scripts/oracle.ts` | The live editor's syntax tree, as class tokens, for every document of the fuzzed corpus (`src/oracle/corpus.ts`) |
| Spec | `spec-obsidian-<version>.json` | `scripts/spec-oracle.ts` | Every CommonMark 0.31.2 and GFM example: the editor's tree, the metadata worker's `CachedMetadata`, and the reading view's DOM with and without strict line breaks |
| Quirk probes | `quirk-probes-obsidian-<version>.json` | `scripts/quirk-probe-oracle.ts` | The reading view's DOM and the worker's sections for each probe of `src/oracle/quirk-probes.ts` |
| Worker metadata | `worker-metadata-obsidian-<version>.json` | `scripts/worker-oracle.ts` | The metadata worker's whole `CachedMetadata`, run offline, on fuzzed documents and the conformance corpus |
| Forum issues | `forum-issues-obsidian-<version>.json` | `scripts/forum-issue-oracle.ts` | The editor's tree, the reading view's DOM with strict line breaks and the worker's `CachedMetadata` for each sample of the parser issues reported on the Obsidian forum (`src/oracle/forum-issues.ts`), and for the stand-in notes their expected metadata is built from |

All of them are pinned to Obsidian 1.14.5. The version, the seeds and the directory are named once, in `src/oracle/oracle-location.ts`, and every suite that checks the parser against Obsidian reads its files through it.

## Re-reading every oracle from another Obsidian

```sh
npm run oracle:refresh -- [--obsidian-version <x.y.z|public-latest|catalyst-latest>] [--out-dir <directory>] [--only classes,spec,quirk-probes,forum-issues,worker] [--skip-drift]
```

It needs a global `obsidian-integration-testing` install, which launches each Obsidian it reads in its own throw-away profile and vault. Without `--obsidian-version` it reads the installed Obsidian.

1. It launches the version once, to learn its exact version number and to take its metadata worker, `worker.js`, from the instance (the app serves it beside its page). The worker goes to a temporary file outside the repository and is deleted when the run ends; none of the app's code is kept.
2. It runs `scripts/oracle.ts` once per pinned seed, with the pinned file's `--per-set`, then `scripts/spec-oracle.ts`, `scripts/quirk-probe-oracle.ts` and `scripts/forum-issue-oracle.ts`, each pinned to that exact version, and `scripts/worker-oracle.ts` on the worker it took, with the pinned file's `--per-set` and `--seed`.
3. It writes the files to `oracle/`, named after the version, beside the pinned ones. A re-read of the pinned version itself goes to a temporary directory instead (`<tmp>/obsidian-oracles-<version>`), so it never overwrites the files the suites check against.
4. It runs the drift report below.

A class-span re-read follows the corpus as it is now. Every pinned file holds the current corpus, 4,228 documents per seed: seeds 3141 and 6174 were first read from it, and the other nine were read again from it on 2026-10-22 and replaced. When a piece set is added or grows, that also moves what a seed draws for the sets after it, so most documents of a later re-read have another text under the same id, and the report counts them as new rather than compared until the files are read again.

## The drift report

```sh
npm run oracle:drift -- --to-version <version> [--to-dir <directory>] [--from-version <version>] [--from-dir <directory>] [--examples <n>] [--skip-tests]
```

It compares each oracle of one version (by default the pinned one, in `oracle/`) with the same oracle of another. A document is matched across the two by its source: a class-span document by its id and the text it was built as, a spec example by its number and markdown, a probe by its markdown, a worker document by its set and text. Per oracle it prints:

- **compared**: the documents both versions read from the same source.
- **changed**: those whose reading differs between the versions, with the first few named.
- **new**: those only the newer read holds.
- **parser exact**: on the editor's classes (every class-span document and spec example) and on the whole `CachedMetadata` (every worker document and spec example), how many the parser matches on each version, and the documents it matches on the older version only.

Then it runs the suites that check the parser against Obsidian (`highlight`, `language`, `spec-quirks`, `quirk-probes` and `worker-metadata`) on the newer version's files, by setting `ORACLE_OBSIDIAN_VERSION` and `ORACLE_DIRECTORY`. That covers what the report does not score itself: the reading view's HTML of the spec examples and the probes, and every quirk the suites explain. It exits 1 when the parser newly differs anywhere or a suite fails.

The parser's score is shown on both versions because it is not 100% everywhere on the pinned one: 25 spec examples differ in the editor's classes on 1.14.5 too. A new version is judged by what it changes, not by that baseline.

## Moving to a new Obsidian

1. `npm run oracle:refresh -- --obsidian-version <version>`.
2. Where readings changed, fix the parser until the drift report and the suites are clean on the new files.
3. Change `PINNED_OBSIDIAN_VERSION` to the new version, so the conformance suites and the next report start from it.
4. Re-point what records numbers on particular files rather than checking conformance, and re-record those numbers: the `syntax-score`, `lezer`, `micromark` and `markdown-it` suites and the `adapter-diff`, `cm6-bench`, `oracle-diff` and `syntax-diff` scripts name the pinned version's files themselves. Remove the old files only after that.

## The oracles as test cases for another project

```sh
npm run export:test-cases -- [--out <directory>]
```

writes the pinned spec, quirk probe, metadata worker and forum issue oracles as plain JSON into `dist/test-cases/` (`scripts/export-test-cases.ts`, built by `src/oracle/test-case-export.ts`), with a `README.md` on their format, for a project that keeps them next to its own tests. Every value is the spec's or Obsidian's own output, and nothing of this repository's code goes with them.

- `commonmark-0.31.2.json` and `gfm-0.29.0.gfm.13.json`: the 652 CommonMark examples and the 22 GFM extension examples, each with the spec's HTML (`commonMarkSpecHtml`), the reading view's (`obsidianHtml`, `strictLineBreaks: true`, and `obsidianHtmlSoftBreaksAsHard` on the 66 examples the default `false` changes), the worker's `CachedMetadata`, and the `departures` from `SPEC_DIFFERENCES` on the 260 examples that carry one.
- `commonmark-0.31.2-departures.json` and `gfm-0.29.0.gfm.13-departures.json`: the 204 and 7 cases of those files, unchanged and under the same id, whose `obsidianHtml` differs from the spec's: the 211 examples the reading view departs on. The other 49 examples with a `departures` entry carry only `soft line breaks are hard`, so their `obsidianHtml` matches the spec and they stay in the full files only. A departure file is the full file filtered by `readingViewDifferences`, never a list of its own, so the two cannot drift.
- `reading-view-quirks.json`: the 169 quirk probes, with the reading view's HTML, the worker's sections and a note on the quirk. The spec has no example for them, so they carry no spec HTML.
- `metadata-cache.json`: the 3,255 worker documents with the worker's whole `CachedMetadata`.
- `editor-vs-reading-view.json`: the 14 samples of the forum issues where the editor and the reading view read a note differently (issues 5 to 12 of the summary sent to the team, and topic 50661, which had already reported its issue), each with its `forumUrl`, a one-sentence `note`, `editorLines` (per line, the line classes and the token spans with their classes, from the editor's tree), the reading view's HTML and the worker's `CachedMetadata`.
- `metadata-cache-issues.json`: the 10 samples of the forum issues where the worker drops or misplaces metadata (issues 1 to 4), with the worker's `CachedMetadata` (`null` on the 4 where it throws) and, on 6 of them, `expectedMetadata`: for 1 and 2 the worker's metadata of a stand-in note of the same length without the trigger, the property put back; for 3 the worker's own metadata without the two zero-length sections, the block id on the footnote definition. Issue 4 is front matter whose closing line the worker and the editor read differently, so it carries no expected metadata. The forum issues where the reading view departs from CommonMark are spec examples, so they are in the spec files and not repeated.

`src/oracle/test-case-export.test.ts` pins that each full file holds every document of its oracle once, that the departures are the ones the spec suites explain, that the two departure files hold exactly the full files' cases the reading view departs on, 211 between them, and the forum files' counts, their editor lines against the editor's tree, and the expected metadata. `src/oracle/forum-issues.test.ts` pins the parser to the forum issue oracle: the editor's classes and the worker's metadata on every document. It found one gap, fixed with it: the editor closes front matter at `---` followed by spaces or tabs, and styles the whole line.

## The last run

2026-10-22, against Obsidian 1.14.5, the public release that followed 1.14.4. The re-read wrote its files to `oracle/` and took about 2 hours.

- **0 readings changed.** Every document of every oracle came back the same as on 1.14.4: 46,508 class-span documents, all 674 spec examples in the editor, the worker and both reading views, all 169 quirk probes and every worker document. Each 1.14.5 file differs from its 1.14.4 file only in the version it names.
- **The parser matches 1.14.5 exactly as it matched 1.14.4**, and the conformance suites pass on its files. Its CodeMirror 5 is still 5.64.0, so the `codemirror` pin holds.
- **So the pin moved to 1.14.5**, the scripts and suites that name their files were re-pointed, and the 1.14.4 files were removed. The numbers they record did not change, since the readings did not.

### The run before: 1.15.0, an insider build

2026-10-22, against Obsidian 1.15.0, an insider build (the public release was then 1.14.5). The re-read went to a temporary directory and took about 70 minutes; the files were not added to `oracle/`, and the pin stayed on 1.14.4.

- **Only the editor's classes changed.** 2,121 readings changed, all of them editor classes: 1,979 class-span documents and 142 spec examples. The metadata worker, both reading views of every spec example and every quirk probe read the same as on 1.14.4.
- **What changed is two rules for formatting marks.** A mark that closes emphasis, strong emphasis, strikethrough or a code span, a quote's fence included, also carries `formatting-<kind>-end`, and a `***` that opens both emphases carries `formatting-em` beside `formatting-strong` ([`phase-1.md`](phase-1.md#inline-syntax)).
- **The tokenizer now takes the version** (`obsidianVersion` on `highlight`, `highlightLines` and `createEditorClassLanguage`), and the suites and the scripts pass each oracle's own. With it the parser is exact on every one of 1.15.0's 46,508 class-span documents, and on 649 of its 674 spec examples, the same 25 left as on 1.14.4. The drift report finds no document the parser newly differs on, and the conformance suites pass on 1.15.0's files.
- The demo plugin passes the running app's `apiVersion`, so its class comparison is 0 on 1.15.0 as on 1.14.4 ([`demo-plugin.md`](demo-plugin.md)).

### The first run: 1.14.4 itself

2026-10-22, against Obsidian 1.14.4 itself, since no newer release existed (1.14.5 was still a draft; the installed app, `public-latest` and `catalyst-latest` all launched 1.14.4). The re-read went to a temporary directory and took about 40 minutes, most of it the eleven class-span oracles.

- **0 readings changed.** Every document both reads hold came back identical: 12,311 class-span documents, all 674 spec examples in the editor, the worker and both reading views, all 169 quirk probes and every worker document. A re-read of an unchanged Obsidian is deterministic, so a change the report shows on a new version is the version's.
- **The parser matched every compared document**, as on the pinned files.
- **8 new documents differ.** The corpus gained its `mark` piece set after the pinned files of seeds 777, 1414, 2026 and 9001 were read, so those files never held it, and the re-reads show the tokenizer missing a rule there: an unclosed highlight on an earlier line puts `highlight` on a later line's inline math in the editor. The pinned seeds 3141 and 6174, read from the current corpus, did not happen to draw such a document. So the conformance suites failed on the re-read on exactly these 8. Probing the live editor showed the rule is wider than highlights: `$` math wears every `strong`, `em`, `strikethrough` and `highlight` span open around it ([`phase-1.md`](phase-1.md)). The tokenizer now follows it, and all eleven re-reads are exact.
- The spec examples' editor classes were 649 of 674 exact on both reads: the 25 others differ on the pinned file too.
- The class-span re-reads of the nine seeds read from older corpora then replaced their pinned files, so every pinned file holds the current corpus, and the suites and scripts that record numbers on them were re-recorded.

The first runs also showed that a renderer whose window is not in front throttles its timers, which held a batch of reads past the 30-second cap of one eval. `scripts/oracle.ts` now makes each read its own eval and waits between reads from Node.
