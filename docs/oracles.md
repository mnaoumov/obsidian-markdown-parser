# The oracles, and keeping up with Obsidian

Everything this repository claims about Obsidian is checked against oracle files in `oracle/`, each read from a real Obsidian:

| Oracle | Files | Read by | What it holds |
| --- | --- | --- | --- |
| Class spans | `obsidian-<version>-seed-<seed>.json`, one per seed | `scripts/oracle.ts` | The live editor's syntax tree, as class tokens, for every document of the fuzzed corpus (`src/oracle/corpus.ts`) |
| Spec | `spec-obsidian-<version>.json` | `scripts/spec-oracle.ts` | Every CommonMark 0.31.2 and GFM example: the editor's tree, the metadata worker's `CachedMetadata`, and the reading view's DOM with and without strict line breaks |
| Quirk probes | `quirk-probes-obsidian-<version>.json` | `scripts/quirk-probe-oracle.ts` | The reading view's DOM and the worker's sections for each probe of `src/oracle/quirk-probes.ts` |
| Worker metadata | `worker-metadata-obsidian-<version>.json` | `scripts/worker-oracle.ts` | The metadata worker's whole `CachedMetadata`, run offline, on fuzzed documents and the conformance corpus |
| Forum issues | `forum-issues-obsidian-<version>.json` | `scripts/forum-issue-oracle.ts` | The editor's tree, the reading view's DOM with strict line breaks and the worker's `CachedMetadata` for each sample, and Source mode's and Live Preview's `.cm-content` for the samples the editing modes and Reading view disagree on (read with the cursor on an appended empty line, which is left out, once math has rendered), of the parser issues reported on the Obsidian forum (`src/oracle/forum-issues.ts`), and for the stand-in notes their expected metadata is built from |
| Editing modes | `editing-modes-obsidian-<version>.json` | `scripts/editing-modes-oracle.ts` | The editor's tree, Source mode's, Live Preview's and the reading view's DOM, read as for the forum issues, and the worker's `CachedMetadata`, for the first 40 documents of each piece set of the main class-span oracle (seed 12345) and for the judged samples of `src/oracle/mode-judge-samples.ts` ([`mode-judge.md`](mode-judge.md)) |
| Live surfaces | `live-surfaces-obsidian-<version>.json` | `scripts/live-surfaces-oracle.ts` | For the first 400 grammar notes of `src/oracle/note-grammar.ts`, written into one vault with the files they link to: the cache before and after the note is opened, `resolvedLinks` and `unresolvedLinks`, the Outline view, `getBacklinksForFile` and the Backlinks view of each linked file, the text after a real `fileManager.renameFile` of every linked file and after renaming them back, and the text after a `processFrontMatter` ([`self-check.md`](self-check.md#the-live-surfaces)). It is left out of dprint, which refuses the lone surrogate a cut astral character leaves in one cached `original` |

All of them are pinned to Obsidian 1.14.5. The version, the seeds and the directory are named once, in `src/oracle/oracle-location.ts`, and every suite that checks the parser against Obsidian reads its files through it.

## Re-reading every oracle from another Obsidian

```sh
npm run oracle:refresh -- [--obsidian-version <x.y.z|public-latest|catalyst-latest>] [--out-dir <directory>] [--only classes,spec,quirk-probes,forum-issues,editing-modes,live-surfaces,worker] [--skip-drift] [--skip-differential]
```

It needs a global `obsidian-integration-testing` install, which launches each Obsidian it reads in its own throw-away profile and vault. Without `--obsidian-version` it reads the installed Obsidian.

1. It launches the version once, to learn its exact version number and to take its metadata worker, `worker.js`, from the instance (the app serves it beside its page). The worker goes to a temporary file outside the repository and is deleted when the run ends; none of the app's code is kept.
2. It runs `scripts/oracle.ts` once per pinned seed, with the pinned file's `--per-set`, then `scripts/spec-oracle.ts`, `scripts/quirk-probe-oracle.ts`, `scripts/forum-issue-oracle.ts`, `scripts/editing-modes-oracle.ts` and `scripts/live-surfaces-oracle.ts`, each pinned to that exact version, and `scripts/worker-oracle.ts` on the worker it took, with the pinned file's `--per-set` and `--seed`.
3. It writes the files to `oracle/`, named after the version, beside the pinned ones. A re-read of the pinned version itself goes to a temporary directory instead (`<tmp>/obsidian-oracles-<version>`), so it never overwrites the files the suites check against.
4. It runs the drift report below, then the release differential.

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

## The release differential

```sh
npm run oracle:differential -- --to-version <version> [--to-dir <directory>] [--from-version <version>] [--from-dir <directory>] [--out-dir <directory>]
```

The drift report asks whether the parser still matches a new build. The differential asks what the build changes in the bugs the judges find ([`mode-judge.md`](mode-judge.md), [`self-check.md`](self-check.md#a-new-obsidian-build)): a family appearing is a new candidate, one vanishing may be a fix to confirm and close on the forum, and a count moving is a family growing or shrinking. `scripts/release-differential.ts` runs, once per version in a child process pointed at that version's files by `ORACLE_OBSIDIAN_VERSION` and `ORACLE_DIRECTORY`:

- **The mode judge** on the class-span trees, spec examples and worker documents. Its editor side is the build's own trees; the spec examples and worker documents are judged on the class tokenizer's prediction for that version.
- **The live surface judges** on the build's live surface oracle (`self-check --count 0 --live-surfaces`).

A judge whose oracle either version lacks is skipped, and the report names the missing file, so a partial re-read (`--only`) still gives the tables it can. Each table names how many documents it judged on each version. When those differ, the corpus moved under the oracles, and a count can move with it rather than with the build: the drift report's `new` column says which documents. It writes `report.md`, and each version's raw `mode-judge.json` and `self-check.json` under `from/` and `to/`, to `dist/release-differential/<from>-to-<to>/`. It is a report, not a gate, and exits 0 unless a judge fails.

Both judges' Reading view side is the `remark-parse` 8 engine, which matches the pinned version. The drift report shows whether a build changed the reading view; until the engine follows such a change, the differential cannot see what it does to the families.

2026-10-25, the first runs. The pinned 1.14.5 against itself moved no family: 45 mode judge families with 9,626 findings over 50,466 documents, and the 8 live surface families with 173 findings over 400 notes, those [`self-check.md`](self-check.md#the-live-surfaces) records. 1.14.4, from the re-read kept in a temporary directory, against 1.14.5 changed 5 mode judge families by 8 findings in all and added or removed none. That came from the corpus, not the build: the class-span corpora of the two are the same texts, but that worker oracle holds 48 documents fewer, so 50,418 were judged. It has no live surface oracle, so that table was skipped.

## Moving to a new Obsidian

1. `npm run oracle:refresh -- --obsidian-version <version>`.
2. Where readings changed, fix the parser until the drift report and the suites are clean on the new files. Read the release differential's report for families that appeared or vanished, and sort each new one into a family, or close its forum topic when one vanished.
3. Change `PINNED_OBSIDIAN_VERSION` to the new version, so the conformance suites and the next report start from it.
4. Re-point what records numbers on particular files rather than checking conformance, and re-record those numbers: the `syntax-score`, `lezer`, `micromark` and `markdown-it` suites and the `adapter-diff`, `cm6-bench`, `oracle-diff` and `syntax-diff` scripts name the pinned version's files themselves. Remove the old files only after that.

## The oracles as test cases for another project

```sh
npm run export:test-cases -- [--out <directory>]
```

writes the pinned spec, quirk probe, metadata worker, forum issue and editing mode oracles as plain JSON into `dist/test-cases/` (`scripts/export-test-cases.ts`, built by `src/oracle/test-case-export.ts`), with a `README.md` on their format, for a project that keeps them next to its own tests. Every value is the spec's, a reference implementation's or Obsidian's own output, and nothing of this repository's code goes with them. The export empties the folder first, so a file an earlier export wrote under another name cannot linger beside its successor, and refuses to when the folder holds a subfolder or a file other than `*.json` and `README.md`.

An `-all` file holds every case of its source and a `-failing` file only the cases Obsidian does not give the expected output on, the same cases under the same ids. A `-spec` file holds the spec's own examples, whose expected HTML is the spec's; a `-no-spec` file holds documents beyond them, whose expected HTML comes from a reference implementation that passes its whole spec suite. By `editor` we mean `Source mode` or `Live Preview`: the `editor-vs-reading-view` files compare the editor with Reading view, and give each of the two modes its own HTML.

- `commonmark-spec-0.31.2-all.json` and `gfm-spec-0.29.0.gfm.13-all.json`: the 652 CommonMark examples and the 22 GFM extension examples, each with the spec's HTML (`commonMarkSpecHtml`), Reading view's (`obsidianReadingViewHtml`, `strictLineBreaks: true`, and `obsidianReadingViewHtmlSoftBreaksAsHard` on the 66 examples the default `false` changes), the worker's `CachedMetadata`, and the `departures` from `SPEC_DIFFERENCES` on the 260 examples that carry one.
- `commonmark-spec-0.31.2-failing.json` and `gfm-spec-0.29.0.gfm.13-failing.json`: the 204 and 7 cases of those files, unchanged and under the same id, whose `obsidianReadingViewHtml` differs from the spec's: the 211 examples the reading view departs on. The other 49 examples with a `departures` entry carry only `soft line breaks are hard`, so their `obsidianReadingViewHtml` matches the spec and they stay in the full files only. A failing file is the full file filtered by `readingViewDifferences`, never a list of its own, so the two cannot drift.
- `commonmark-no-spec-failing.json` and `gfm-no-spec-failing.json`: the 70 of the 117 CommonMark quirk probes and the 27 of the 52 GFM ones (tables and strikethrough) on which the reading view's HTML differs from the reference implementation's, `referenceHtml`, compared as the spec files compare it with the spec's. Each has the reading view's HTML, the worker's sections and a note on the quirk; the 72 probes on which the two agree are left out. The CommonMark reference is [commonmark.js](https://github.com/commonmark/commonmark.js) 0.31.2, the reference implementation, run in the export. The GFM reference is [cmark-gfm](https://github.com/github/cmark-gfm) 0.29.0.gfm.13, the GFM spec's own implementation, with the extensions the spec's tests use; the JavaScript ports of it are older releases, and micromark's GFM extension departs from the spec on purpose (it links `ftp://` nowhere and autolinks inside `<...>`), so `npm run oracle:reference` (`scripts/reference-oracle.ts`) runs it through the Python `cmarkgfm` binding, with `uv`, into `oracle/reference-cmark-gfm-0.29.0.gfm.13.json`, for every spec example and GFM probe. Run it again when a GFM probe is added or changed. `src/oracle/reference-html.test.ts` checks both before they are trusted: commonmark.js gives the spec's HTML on all 652 CommonMark 0.31.2 examples and cmark-gfm on all 22 GFM extension examples, both exactly. The reference HTML goes through a DOM before the comparison, by `parse5`, which gives the spec oracle's `specDom` on every example but 3 where the app's Chromium keeps a processing instruction or escapes `<` in an attribute, none of which a probe's reference HTML holds.
- `metadata-cache-all.json`: the 3,284 worker documents with the worker's whole `CachedMetadata`, `null` on the 31 the worker throws on.
- `metadata-cache-failing.json`: the 44 notes whose metadata the worker drops or misplaces. First the 31 worker documents it throws on, unchanged and under the same id, each with the forum issue of its trigger, sorted by `workerFailureOf` (`src/metadata/metadata.ts`): 17 hold a front matter string that is a markdown link with an empty or blank destination (issue 1) and 14 a key `hasOwnProperty` (issue 2), which wins when a document holds both. No stand-in of them was read, so they carry no `expectedMetadata`. Then the 13 samples of the forum issues where the worker drops or misplaces metadata (issues 1 to 4, and `issue-topic-119821`, reported after the summary), with the worker's `CachedMetadata` (`null` on the 4 where it throws) and, on 9 of them, `expectedMetadata`: for 1 and 2 the worker's metadata of a stand-in note of the same length without the trigger, the property put back; for 3 the worker's own metadata without the two zero-length sections, the block id on the footnote definition; for topic 119821 the worker's own metadata with the link on a `%%` block comment's opening line, or on a callout's unindented `>` line in a list item, moved to where its `[[` is, which is where a rename writes. Issue 4 is front matter whose closing line the worker and the editor read differently, so it carries no expected metadata. The forum issues where the reading view departs from CommonMark are spec examples, so they are in the spec files and not repeated.
- `editor-vs-reading-view-all.json`: every document of the editing mode oracle, 600 corpus documents (the first 40 of each of the 15 piece sets) and the judged samples, and the 14 forum issue samples, each with the three modes' HTML (`obsidianSourceModeHtml` and `obsidianLivePreviewHtml`, the editor's `.cm-content` as the user sees it, and `obsidianReadingViewHtml`), the worker's `CachedMetadata` and its `set`. It carries no judgement: a corpus document's views may agree or not.
- `editor-vs-reading-view-failing.json`: the notes on which the editor and Reading view read a note differently, each under its id in the `-all` file: the 14 samples of the forum issues (issues 5 to 12 of the summary sent to the team, and topic 50661, which had already reported its issue), each with its `forumUrl`, and one note for each new family the mode judge found ([`mode-judge.md`](mode-judge.md)), `issue: judged` with its `family`, each confirmed on the live editor's tree. Each has a one-sentence `note`, the three modes' HTML, `differsIn` naming the editing modes that disagree with Reading view (both, on every case, since both run the same parse) and the worker's `CachedMetadata`.

`src/oracle/test-case-export.test.ts` pins that each full file holds every document of its oracle once, that the departures are the ones the spec suites explain, that the two spec failing files hold exactly the full files' cases the reading view departs on, 211 between them, that the no-spec files hold exactly the probes that differ from the reference, that the failing metadata file holds every worker document the worker throws on, each explained by a known trigger, and the forum files' counts, each editing mode case's three HTMLs against the oracle with one Source mode line per markdown line, that every failing editing mode case is in the `-all` file unchanged, and the expected metadata. `src/oracle/editing-modes.test.ts` pins the parser to the editing mode oracle, the editor's classes and the worker's metadata on every document, and confirms each judged sample on the live editor's tree. `src/oracle/forum-issues.test.ts` pins the parser to the forum issue oracle: the editor's classes and the worker's metadata on every document. It found one gap, fixed with it: the editor closes front matter at `---` followed by spaces or tabs, and styles the whole line.

## The last run

2026-10-22, against Obsidian 1.14.5, the public release that followed 1.14.4. The re-read wrote its files to `oracle/` and took about 2 hours.

- **0 readings changed.** Every document of every oracle came back the same as on 1.14.4: 46,508 class-span documents, all 674 spec examples in the editor, the worker and both reading views, all 169 quirk probes and every worker document. Each 1.14.5 file differs from its 1.14.4 file only in the version it names.
- **The parser matches 1.14.5 exactly as it matched 1.14.4**, and the conformance suites pass on its files. Its CodeMirror 5 is still 5.64.0, so the `codemirror` pin holds.
- **So the pin moved to 1.14.5**, the scripts and suites that name their files were re-pointed, and the 1.14.4 files were removed. The numbers they record did not change, since the readings did not.

### A re-check: 1.15.0 again, and the oracles added since

2026-10-25, against the insider build of 1.15.0 then current, after the editor was seen giving a closing `*` the `formatting-em-end` class. Only the spec, quirk probe and forum issue oracles were re-read, into a temporary directory, the last of them added after the run below.

- **Nothing new changed.** The same 142 spec examples changed in the editor's classes, and nothing else: the worker, both reading views, all 169 quirk probes and all 31 forum issue documents read as on 1.14.5.
- **The parser is exact as before**: 661 of the 674 spec examples' classes on both versions, and all 31 forum issue documents, and the `spec-quirks`, `quirk-probes` and `forum-issues` suites pass on the 1.15.0 files.
- The editing mode oracle was not read: one read of a mode overran the 30-second cap of an eval twice on a loaded machine.

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

The first runs also showed that a renderer whose window is not in front throttles its timers, which held a batch of reads past the 30-second cap of one eval. `scripts/oracle.ts` now makes each read its own eval and waits between reads from Node. The editing mode reads of `scripts/obsidian-reads.ts` hit the same cap on a loaded machine on 2026-10-25, waiting for Source mode's and Live Preview's DOM to settle inside one eval, and now poll it the same way.
