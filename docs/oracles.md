# The oracles, and keeping up with Obsidian

Everything this repository claims about Obsidian is checked against oracle files in `oracle/`, each read from a real Obsidian:

| Oracle | Files | Read by | What it holds |
| --- | --- | --- | --- |
| Class spans | `obsidian-<version>-seed-<seed>.json`, one per seed | `scripts/oracle.ts` | The live editor's syntax tree, as class tokens, for every document of the fuzzed corpus (`src/oracle/corpus.ts`) |
| Spec | `spec-obsidian-<version>.json` | `scripts/spec-oracle.ts` | Every CommonMark 0.31.2 and GFM example: the editor's tree, the metadata worker's `CachedMetadata`, and the reading view's DOM with and without strict line breaks |
| Quirk probes | `quirk-probes-obsidian-<version>.json` | `scripts/quirk-probe-oracle.ts` | The reading view's DOM and the worker's sections for each probe of `src/oracle/quirk-probes.ts` |
| Worker metadata | `worker-metadata-obsidian-<version>.json` | `scripts/worker-oracle.ts` | The metadata worker's whole `CachedMetadata`, run offline, on fuzzed documents and the conformance corpus |

All of them are pinned to Obsidian 1.14.4. The version, the seeds and the directory are named once, in `src/oracle/oracle-location.ts`, and every suite that checks the parser against Obsidian reads its files through it.

## Re-reading every oracle from another Obsidian

```sh
npm run oracle:refresh -- [--obsidian-version <x.y.z|public-latest|catalyst-latest>] [--out-dir <directory>] [--only classes,spec,quirk-probes,worker] [--skip-drift]
```

It needs a global `obsidian-integration-testing` install, which launches each Obsidian it reads in its own throw-away profile and vault. Without `--obsidian-version` it reads the installed Obsidian.

1. It launches the version once, to learn its exact version number and to take its metadata worker, `worker.js`, from the instance (the app serves it beside its page). The worker goes to a temporary file outside the repository and is deleted when the run ends; none of the app's code is kept.
2. It runs `scripts/oracle.ts` once per pinned seed, with the pinned file's `--per-set`, then `scripts/spec-oracle.ts` and `scripts/quirk-probe-oracle.ts`, each pinned to that exact version, and `scripts/worker-oracle.ts` on the worker it took, with the pinned file's `--per-set` and `--seed`.
3. It writes the files to `oracle/`, named after the version, beside the pinned ones. A re-read of the pinned version itself goes to a temporary directory instead (`<tmp>/obsidian-oracles-<version>`), so it never overwrites the files the suites check against.
4. It runs the drift report below.

A class-span re-read follows the corpus as it is now, and the corpus has changed since most pinned files were read: piece sets were added and grew, which also moves what the seed draws for the sets after them. Only seeds 3141 and 6174 were read from the current corpus. For the others most documents now have another text under the same id, and the report counts them as new rather than compared.

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

The parser's score is shown on both versions because it is not 100% everywhere on the pinned one: 25 spec examples differ in the editor's classes on 1.14.4 too. A new version is judged by what it changes, not by that baseline.

## Moving to a new Obsidian

1. `npm run oracle:refresh -- --obsidian-version <version>`.
2. Where readings changed, fix the parser until the drift report and the suites are clean on the new files.
3. Change `PINNED_OBSIDIAN_VERSION` to the new version, so the conformance suites and the next report start from it.
4. Re-point what records numbers on particular files rather than checking conformance, and re-record those numbers: the `syntax-score`, `lezer`, `micromark` and `markdown-it` suites and the `adapter-diff`, `cm6-bench`, `oracle-diff` and `syntax-diff` scripts name their 1.14.4 files themselves. Remove the old files only after that.

## The last run

2026-10-22, against Obsidian 1.14.4 itself, since no newer release existed (1.14.5 was still a draft; the installed app, `public-latest` and `catalyst-latest` all launched 1.14.4). The re-read went to a temporary directory and took about 40 minutes, most of it the eleven class-span oracles.

- **0 readings changed.** Every document both reads hold came back identical: 12,311 class-span documents, all 674 spec examples in the editor, the worker and both reading views, all 169 quirk probes and every worker document. A re-read of an unchanged Obsidian is deterministic, so a change the report shows on a new version is the version's.
- **The parser matched every compared document**, as on the pinned files.
- **8 new documents differ.** The corpus gained its `mark` piece set after the pinned files of seeds 777, 1414, 2026 and 9001 were read, so those files never held it, and the re-reads show the tokenizer missing a rule there: an unclosed highlight on an earlier line puts `highlight` on a later line's inline math in the editor. The pinned seeds 3141 and 6174, read from the current corpus, did not happen to draw such a document. So the conformance suites failed on the re-read on exactly these 8. Probing the live editor showed the rule is wider than highlights: `$` math wears every `strong`, `em`, `strikethrough` and `highlight` span open around it ([`phase-1.md`](phase-1.md)). The tokenizer now follows it, and all eleven re-reads are exact.
- The spec examples' editor classes were 649 of 674 exact on both reads: the 25 others differ on the pinned file too.

The first runs also showed that a renderer whose window is not in front throttles its timers, which held a batch of reads past the 30-second cap of one eval. `scripts/oracle.ts` now makes each read its own eval and waits between reads from Node.
