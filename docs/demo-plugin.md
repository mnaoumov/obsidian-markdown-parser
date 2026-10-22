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
- **Cost.** A full parse is `ensureSyntaxTree` to the end of a fresh state, the median of 5. A keystroke is one transaction that inserts a character in the middle of the note in the live editor, together with the parse to the end of the viewport after it. That is the median and the slowest of 50 typed one after another, with a frame between them. The characters are removed afterwards. Both languages are timed in the same editor, in source mode and in live preview.
