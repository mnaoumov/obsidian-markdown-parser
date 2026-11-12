# Provenance

Where every part of this repository comes from: what is ported from open-source code, what was learned by reading Obsidian's code, what was only measured, and what the committed oracle files hold.

## In short

- **No code of Obsidian's app is in this repository**, and none has ever been committed: no file of the app's bundle, no excerpt of it and no generated copy of it. The history was checked on 2026-10-22 for every file it ever added.
- **Obsidian's code was read, so this is not a clean-room implementation in the strict sense.** A clean room keeps the people who read the original apart from the people who write the new code. Here the same author did both. Reading the app to learn its behaviour is allowed for plugin development under Obsidian's Terms (Restrictions, item iii). What was read is listed below, and every rule taken from it was written fresh and then measured against the running app.
- **The open-source code the app's behaviour descends from is ported under its license**, with the notices in [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
- **The `oracle/` files are the app's output on documents this repository generated**: class names, metadata and rendered HTML. They hold no code. The one exception, `reference-cmark-gfm-0.29.0.gfm.13.json`, is the HTML of `cmark-gfm`, GitHub's open-source GFM implementation, on the same documents.

## What each part is built from

| Part | Built from | Obsidian's code read? |
| --- | --- | --- |
| Class tokenizer (`src/editor/markdown-mode.ts`, `obsidian-mode.ts`) | Ports of the CodeMirror 5 `markdown` mode and HyperMD, both MIT | Yes, for rules the oracle could not settle (below) |
| CodeMirror 5 sub-modes (`src/editor/sub-modes.ts`) | Used from `codemirror@5`, pinned to the release the app bundles | No |
| CodeMirror 6 host, view, demo plugin (`src/editor/language.ts`, `view.ts`, `src/demo-plugin/`) | Written here, on the public CodeMirror 6, Lezer and plugin APIs | No |
| Syntax definition and the three adapters (`src/syntax/`) | Written here; parts adapted from micromark, markdown-it and `@lezer/markdown`, all MIT | No; measured against the live editor |
| Quirk flags (`src/syntax/quirk-rules.ts`) | Re-expressed rules of `remark-parse` 8.0.3 and `parse-entities` 2, MIT | No; measured against the live app |
| `remark-parse` 8 engine (`src/remark/parser.ts`, `block.ts`, `inline.ts`, `entities.ts`, `html.ts`) | Port of `remark-parse` 8.0.3 and its helpers, MIT, with speed-ups written here | For the design of three speed-ups only (below); the port itself, no |
| Obsidian's edits to the `blockquote`, `list` and `table` tokenizers (in `src/remark/block.ts`) | Re-expressed from behaviour | Yes |
| Obsidian syntax in the engine (`src/remark/obsidian.ts`) | Re-expressed from behaviour | Yes |
| `CachedMetadata` projection (`src/metadata/`) | Re-expressed from behaviour; front matter parsed with `yaml` 2 from npm | Yes |
| Spec suites (`spec/`) | The CommonMark 0.31.2 and GFM 0.29 spec examples, CC-BY-SA 4.0 | No |
| Imported test inputs (`src/oracle/remark-obsidian/cases.ts`) | The markdown inputs of `@quartz-community/remark-obsidian`'s test suites, MIT ([remark-obsidian.md](remark-obsidian.md)) | No; measured against the metadata worker |

## What was read

Each was read in an Obsidian 1.14.4 install outside this repository, from the app's own files, sometimes pretty-printed to make them readable. There are five exceptions, all read in the pretty-printed files in the `obsidian-versions` checkout beside this repository: the inline footnote's rule in the editor's mode, read in Obsidian 1.15.0's `app.js`, the footnote reference's rule and the block id's place in the editor's mode, read in Obsidian 1.14.5's `app.js`, the internal link's rule, read in Obsidian 1.14.5's `app.js` and its `lib/codemirror/markdown.js`, how the editor's mode tells HTML and reads a footnote definition's label, read in the same two files of 1.14.5, and the metadata worker's tokenizer factory, read in Obsidian 1.15.1's `worker.js` (last item below):

- **The editor's mode**, in `app.js` (the HyperMD-derived mode), and **Obsidian's fork of the CodeMirror 5 markdown mode**, in `lib/codemirror/markdown.js`. They were read only for the rules the class oracle could not settle ([`phase-1.md`](phase-1.md)).
- **The vault's file name checks and two URL paths**, in Obsidian 1.14.5's `app.js`, read in the running app to learn what the special note name oracle should measure: the characters the file explorer's rename warns about and the ones it refuses on each platform, which of the two checks its save applies, how `getObsidianUrl` writes an `obsidian://open` URL, and that the `open` action reads its `file` as a link. Nothing was copied: the oracle measures each in the app ([`special-names.md`](special-names.md)).
- **Note composer's methods**, in Obsidian 1.14.5's `app.js`, read in the running app to learn how to drive a merge for the link case oracle: that `mergeFile` takes the note merged into and the note merged away, appends the text unchanged and trashes the merged note, and that only `extractSection`, the split, rewrites the moved text's links. Nothing was copied: the oracle measures the merge in the app ([`link-cases.md`](link-cases.md)).
- **The mobile vault list**, in the `app.js` of Obsidian 1.14.4's Android APK, read to learn where the Android special note name oracle should put its vault: that the app lists its app storage vaults from the folders of Capacitor's `External` directory, and opens the one `mobile-selected-vault` names. Nothing was copied: `scripts/capture/android-vault.ts` creates the folder and selects it, and the oracle checks that the app opened it ([`special-names.md`](special-names.md#on-android)).
- **The metadata worker**, `worker.js`, for three things: which of `remark-parse` 8's tokenizers Obsidian edited, the plugin chain that adds its syntax, and the walk from the tree to `CachedMetadata`.
- **The 1.15.1 metadata worker's tokenizer factory**, the classes that run the block and inline tokenizers in Obsidian 1.15.1's `worker.js`, read on 2026-11-11 to learn why it parses faster than `parseMetadata`. It keeps `remark-parse` 8's structure, and differs in its design: it skips a block tokenizer whose test of the first character and of the first character after indentation fails, picks the inline tokenizers from a table indexed by the first character's code, keeps each line's offset in an array, and keeps a tokenize call's state in an object rather than in closures. Nothing was copied. The block start gates (`BLOCK_STARTS` in `src/remark/block.ts`, and the Obsidian ones in `src/remark/obsidian.ts`) were read from each of this repository's own tokenizers' opening checks, and are pinned against the ungated parse by `src/remark/scan-memo.test.ts`. The inline dispatch table (`dispatchOf` in `src/remark/parser.ts`) indexes the start characters each tokenizer here names, and `LineOffsets` there replaces the `Map` it was.

Before the `remark-parse` engine was written, a throw-away experiment outside the repository ran an engine assembled from `worker.js`'s own code, to learn which of the bundled tokenizers differ from stock `remark-parse` 8. It was used for measurement only and was never committed. Its folder was deleted before 2026-10-22, when it was checked for and found gone. The engine in `src/remark/` was then written from npm `remark-parse` 8.0.3, with Obsidian's edits re-expressed rather than copied.

## What was only measured

Everything else was learned by running the app and reading what it produces:

- the live editor's syntax tree, as class tokens, read over the Chrome DevTools Protocol;
- the metadata worker's `CachedMetadata`, read live from the app and offline by running the worker;
- the reading view's DOM for the spec examples and the quirk probes.

The demo plugin also compares the parser with the stock editor and metadata cache inside a running vault, through the public plugin API.

## How each oracle is produced

The files are listed, with what each holds, in [`oracles.md`](oracles.md). Every document in them was generated by this repository: the fuzzed corpora by `src/oracle/classes/corpus.ts` and the piece sets of `scripts/capture/worker-oracle.ts`, the spec examples from `spec/`, the probes from `src/oracle/spec/quirk-probes.ts`, the forum issue samples from `src/oracle/modes/forum-issues.ts`, which this repository wrote for the reports, the judged samples from `src/oracle/modes/mode-judge-samples.ts`, which it wrote from what the mode judge found, the live surface notes from `src/oracle/checks/note-grammar.ts`, the link parity notes from `src/oracle/links/link-parity.ts`, and the special note names from `src/oracle/links/special-names.ts`. What the files record of Obsidian is its output on those documents.

| Oracle | How it reads Obsidian | What of the app it keeps |
| --- | --- | --- |
| Class spans, spec, quirk probes, forum issues, editing modes | `scripts/capture/oracle.ts`, `spec-oracle.ts`, `quirk-probe-oracle.ts`, `forum-issue-oracle.ts` and `editing-modes-oracle.ts` open the document in a running Obsidian, through `obsidian-integration-testing` and the Chrome DevTools Protocol, and read the editor's tree, the worker's metadata, the reading view's DOM and, for the forum issues and the editing modes, the DOM of Source mode and Live Preview | Class names, `CachedMetadata` and HTML |
| Live surfaces | `scripts/live-surfaces-oracle.ts` writes the notes into the vault of a running Obsidian, through `obsidian-integration-testing` and the Chrome DevTools Protocol, and reads the cache, `resolvedLinks`, the Outline and Backlinks views, and the note's text after `fileManager.renameFile` and `processFrontMatter` | `CachedMetadata`, link counts, the views' text and offsets, and the notes' text |
| Link parity | `scripts/links/link-parity-oracle.ts` writes the target files and then one note per link on the disk of a running Obsidian's vault, through `obsidian-integration-testing` and the Chrome DevTools Protocol. It has the editor's link autocomplete and `fileManager.generateMarkdownLink` write links, and reads the cache, Reading view's first link and where each leads by `parseLinktext`, `getFirstLinkpathDest` and `resolveSubpath`, which a one-line plugin it writes into the vault hands over from the `obsidian` module | The notes' text, cached links, the rendered link's text and `data-href`, and the paths and headings links lead to |
| Special note names | `scripts/links/special-names-oracle.ts` writes the notes and their linkers on the disk of a running Obsidian's vault, through `obsidian-integration-testing` and the Chrome DevTools Protocol (on Android, over `adb` and the DevTools Protocol of the app's WebView, `scripts/capture/android-vault.ts`), and reads the vault's index, the file explorer, an opened leaf, the quick switcher, search, the cache, backlinks, the graph view, a rendered embed, `obsidian://open`, the linkers after `fileManager.renameFile`, and the file explorer's rename of a few typed names | The notes' paths and text, the explorer's titles, the paths each surface offered or opened, the linkers' links, and the rename messages |
| Link cases | `scripts/links/link-cases-oracle.ts` writes the files of each case into a running Obsidian's vault through the vault, through `obsidian-integration-testing` and the Chrome DevTools Protocol, lets each case rename a file, merge a note with note composer or write the links `generateMarkdownLink` gives, and reads the cache and where each link leads by `getFirstLinkpathDest` | The notes' text, cached links, the paths links lead to, and the generated links |
| Worker metadata | `scripts/capture/worker-oracle.ts` loads `worker.js` from an Obsidian install at run time and runs it in a Node `vm` context, posting each document as the app posts it | `CachedMetadata` |
| `cmark-gfm` reference | Not read from Obsidian: `scripts/capture/reference-oracle.ts` runs `cmark-gfm` 0.29.0.gfm.13 through the Python `cmarkgfm` binding on the spec examples and the GFM quirk probes | Nothing of the app; `cmark-gfm`'s HTML |

`scripts/capture/worker-oracle.ts` holds no code of the worker: it reads the file from the install it is pointed at, by default the `obsidian-versions` checkout beside this repository, and `scripts/oracles/oracle-refresh.ts` hands it the worker of the instance it reads, from a temporary file it deletes when the run ends.

The HTML of the reading view carries Obsidian's markup, such as its class names and attributes, as the app renders it. It is output, of the same kind a theme author reads in the developer tools.

## Keeping it this way

- Never copy code from the app's bundle into this repository, nor into a script that stays in it. A script that needs the app runs it from the install, as `scripts/capture/worker-oracle.ts` does.
- A rule learned by reading the app is written fresh and measured, and the doc of its part says that it was read.
- An experiment that has to run the app's own code lives outside the repository and is deleted when it is done.
