# The demo plugin

`src/demo-plugin/` is a private Obsidian plugin that runs this parser inside the app, next to the stock editor and metadata worker. It is never published. Measured on 2026-10-22 against Obsidian 1.14.4.

## Running it

1. `npx jiti scripts/build-demo-plugin.ts` writes `dist/demo-plugin/main.js` and `manifest.json` (`--watch` rebuilds on change).
2. Copy `dist/demo-plugin/` into a test vault as `.obsidian/plugins/markdown-parser-demo/` and enable **Markdown parser demo**.
3. Run its commands from the command palette:
   - **Toggle the editor language** swaps the parser in and out of every open editor. The status bar says `Markdown parser: on` or `off`.
   - **Compare the editor classes of the active note** / **of every note** parses each note with both languages and compares the trees.
   - **Compare the metadata of every note** compares `parseMetadata` with the metadata cache.
   - **Measure parse and keystroke cost on the active note** times a full parse and 50 keystrokes with each language.

Each command shows its report in a modal and keeps it on the plugin as `lastReport`.

`npx jiti scripts/demo-plugin-measure.ts [--vault <dir>] [--lines <n>]` does all of that unattended. It starts an owned Obsidian instance through a global `obsidian-integration-testing` install, copies a real vault's notes into its temporary vault, adds a note of `<n>` lines built from those notes (100,000 by default), installs the build, runs every command and prints the reports as JSON. The default vault is the `obsidian-community-vault` checkout beside this repository. Folders whose names start with `.` and `node_modules` folders are skipped.

## How the swap works

The plugin registers `Prec.highest(language)` as an editor extension. CodeMirror's `language` facet takes its first value, so every editor parses with this parser, and Obsidian's own code reads the tree: the class renderer, live preview, folding, the task checkbox, the callout and the code block's language flair. Turning it off empties the extension array and calls `workspace.updateOptions()`.

Two things had to change for that to work:

- **Obsidian renders classes from two node props of its own.** Its copy of `@codemirror/language` adds `lineClassNodeProp` and `tokenClassNodeProp`, which the public package does not have, and its renderer reads those, not the node names. With a tree whose node names matched the stock tree exactly, the editor showed plain text. `createEditorClassLanguage` now takes `lineClassNodeProperty` and `tokenClassNodeProperty`, and gives the node types of a language made with them the classes in those props, joined by spaces. The plugin passes the app's two props.
- **`StreamLanguage` merges tokens.** When a token follows one of the same type, the stock host extends that token rather than adding one (`mergeTokens`, on by default). The host now does the same, so `- [ ] task` has one `list-1` node after the checkbox, not two.

The build keeps `obsidian`, `electron`, the `@codemirror/*` packages the app provides (`@codemirror/streamparser` is not among them and is bundled), `@lezer/common`, `@lezer/highlight` and `@lezer/lr` external, because the parser must use the app's copies: its `Tree` and `NodeProp` are the ones the editor checks. CodeMirror 5's modes are bundled. `src/editor/sub-modes.ts` loads them with Node's `require` through `runmode.node.js`, and the build turns `node:module` into a table of the mode files and resolves every mode's `require` of the CodeMirror 5 library to `runmode.node.js`.

## What it compares

- **Classes.** For each note, both languages parse the text in a fresh `EditorState`, and the comparison reads both trees the way the oracle reads the live editor. `differing` lists the notes where a character's token classes or a line's line classes differ, the measure the oracle tests score by. `differingNodes` lists the notes whose trees differ node for node.
- **Lazy modes.** Obsidian loads a fenced block's CodeMirror 5 mode the first time a parse meets its language, and that first parse leaves the block plain. The comparison parses every note once with the stock language before it compares, then waits a second for the modes to load.
- **Metadata.** `parseMetadata(text)` against `metadataCache.getFileCache(file)`, compared as JSON values with key order ignored.
- **Cost.** A full parse is `ensureSyntaxTree` to the end of a fresh state, the median of 5. A keystroke is one transaction that inserts a character in the middle of the note in the live editor, together with the parse to the end of the viewport after it. That is the median and the slowest of 50 typed one after another, 16 ms apart: a test instance's window is hidden, and `requestAnimationFrame` hardly fires there. The characters are removed afterwards. Both languages are timed in the same editor, in source mode and in live preview.

## Results

One run of `npx jiti scripts/demo-plugin-measure.ts --lines 100000` on 2026-10-22, Obsidian 1.14.4, on an AMD Ryzen 5 7500F. The vault is the 115 notes of `obsidian-community-vault` plus `long.md`, a note of 100,001 lines and 3,648,939 characters built by repeating them.

**The swap works.** With the parser on, the editor renders the same classes, and live preview draws the same widgets: the fold indicator on a heading, the task checkbox, the callout, and the code block's flair and language highlighting.

**Classes: 0 differences.** On all 116 notes, 282,354 stock nodes, every character and every line gets the same classes from both languages.

**Nodes: 2 notes differ.** Both are the same case: a code span left open inside a quote, where the parser's token is `inline-code_inline-code_quote_quote-1` and the stock one is `inline-code_quote_quote-1`. The class sets are equal, but the two type names differ, so the tokens next to it do not merge and the text renders as more spans than the stock editor's. On the oracle corpus of seed 12345 this shape, duplicated classes in a footnote reference, and tokens with an empty style the host drops make 229 of its 2,128 documents differ node for node.

**Metadata: 0 differences** on 115 notes, which took 48 ms in all. `long.md` is skipped: the comparison leaves out notes over 1,000,000 characters, because `parseMetadata`'s peak memory grows faster than the note (360 MB at 25,000 lines, 2.5 GB at 100,000), and that took the app down.

**Cost.** Medians, in milliseconds, with the slowest keystroke in brackets:

| Note | Mode | Full parse, parser | Full parse, stock | Keystroke, parser | Keystroke, stock |
| :--- | :--- | -----------------: | ----------------: | ----------------: | ---------------: |
| 178 lines | source | 5.0 | 5.1 | 2.0 (5.2) | 4.0 (15.7) |
| 178 lines | live preview | 5.0 | 5.5 | 2.2 (3.4) | 4.2 (6.0) |
| 100,001 lines | source | 811 | 1,041 | 3.6 (8.5) | 3.1 (7.2) |
| 100,001 lines | live preview | 779 | 970 | 87.9 (170.5) | 29.4 (89.6) |

A full parse is about a fifth faster than the stock language's. A keystroke costs about the same in source mode at either length, and less on the short note. In live preview on the long note it costs three times as much. The likely cause is that the parser's re-parse after an edit gives a tree that reaches the document's end (see [the CodeMirror 6 host](cm6-host.md#cost)), while the stock language stops at the viewport, so live preview's plugins see the whole tree change. That is not confirmed yet.

These are single runs, so the smallest times carry the most noise.
