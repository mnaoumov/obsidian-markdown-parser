# The CodeMirror 6 host

`src/editor/language.ts` runs the editor-class tokenizer in CodeMirror 6 as a `Language`, and `src/editor/view.ts` renders its classes. Measured on 2026-10-14.

## Why not `StreamLanguage`

The tokenizer has CodeMirror's stream-parser shape, but `StreamLanguage` gives a mode no way to read the lines after the current one. The markdown mode needs that to see a setext underline under a paragraph line, and HyperMD needs it to see a delimiter row under a table's first row (`stream.lookAhead(1)`). The host is a Lezer `Parser` of its own that reads the document through the parse's `Input`, so `lookAhead` returns the real next line.

## The tree

The tree has the shape the oracle reads from the live editor:

- A line with line classes is a node named by them, sorted and joined by `_`, spanning the line. It holds the line's tokens.
- Every token with a style is a node named the same way, a class the style repeats included, so `hmd-barelink_hmd-barelink_hmd-footnote_hmd-footnote_link` names a footnote label as it does in the editor. A token whose style holds line classes only is a node named `""`, as the indentation continuing a footnote definition is in the editor. A token with no style is left out, as in `StreamLanguage`.
- Lines are grouped into chunks of about 512 characters. A chunk is an anonymous node, which a tree cursor steps through, so line nodes sit at depth 1 as they do in the editor.

- A token right after one of the same type extends it, as `StreamLanguage`'s `mergeTokens` does.

`lineClassesProperty` and `tokenClassesProperty` carry the classes on the node types, so the renderer does not split names on `_`, which a `tag-<name>` class may contain. `editorClasses` puts a token's classes on its text as `cm-<class>` and a line's classes on its `.cm-line`, for the visible ranges.

Obsidian's editor renders the classes itself, from two node props its copy of `@codemirror/language` adds: `lineClassNodeProp` and `tokenClassNodeProp`, each holding the classes joined by spaces. A language made with `createEditorClassLanguage({ lineClassNodeProperty, tokenClassNodeProperty })` puts the classes in the props it is given too, on node types of its own, so the language runs as the editor's language inside Obsidian ([docs/demo-plugin.md](demo-plugin.md)).

The host's tree gives every character and line the same classes as the line tokenizer on all 20,296 documents of the seven oracle corpora. Scored against the live editor's trees directly, it is exact on all of them too. Since 2026-10-22 it is also the live editor's tree node for node, names and merged tokens included, on all 36,608 documents of the eleven class oracles, which `src/editor/language.test.ts` pins.

## Incremental reuse

Each chunk records the tokenizer state after its last line, and how far its lines read: each line's own newline, and the end and newline of any line read ahead. After an edit, a new parse resumes from the last chunk whose reads all end before the edit (and before the 25-character margin `StreamLanguage` keeps from an edited fragment's end). So a paragraph line whose lookahead saw the line now turned into `---` is parsed again, and so is a last line that gains a line after it.

After the edit, the parse also reuses what follows. At each line end past the edit, it looks for a chunk of the old tree that starts at the same text. That chunk must come after a chunk whose stored state equals the state the new parse has reached. When it finds one, the lines from there on give what they gave before, so it takes that chunk and the ones after it. It stops at the first chunk whose reads, lookahead included, reach past the unchanged text the fragment covers. That text ends 25 characters from an edit on either side. Then it parses on from the last reused chunk's state. A reused chunk keeps its tree and gets its line index shifted by the lines the edit added or removed.

Two states are equal when `areLineStatesEqual` (`src/editor/highlight.ts`) says so. It compares the live state as a copy, because the mode's copy drops what it carries only within a line. It compares plain objects, class instances and arrays by their own properties, and functions and built-in objects by identity. A kept line stream is compared by its text, the only part a later line reads. Two states whose tokenizer is a closure made at different times are never equal, so a multi-line string or comment converges only once it closes.

A state inside a fenced code block, or inside a `<script>` or `<style>` element of an HTML block, is no resume point (`isLineStateResumable`), and it is equal to no other state. It holds a CodeMirror 5 mode object made for that block when the block opened, and such a mode keeps state in its closure, outside the state the host can see. The CSS mode keeps the type of the last token in a variable, and a `-` it reads no token from takes that type, so a `-` in a `<style>` element is classed by whatever that mode object tokenized last. A copy of the state shares the mode object, so a parse that went on from a stored state inside the block would class such a `-` by what the earlier parse left in it, which can be a line further down. So:

- A parse after an edit resumes from the last chunk that ends outside such a block, and the block's mode is made again when the parse reaches its opening line, as in a fresh parse.
- Reused chunks stop at the last one that ends outside such a block, unless the parse ends with it.
- The parse goes on to the block's end before it compares states again.

Obsidian 1.14.4's own editor gives a fresh load's classes after the same edits: 800 random edits inside a `<style>`, `<script>`, `css` or `js` block of a 2,000 to 3,000-character body, typed in the live editor and compared over CDP with a fresh load of the edited text, gave 0 differences. Before this rule the host gave 84 differences on the same edits with 512-character chunks, and 19 with `StreamLanguage`'s 2,048.

The rest is what `StreamLanguage` does:

- Each `advance` parses one chunk, and a parse stops at the end of the viewport, so the editor parses the rest in idle time.
- A viewport more than 100,000 characters past the parsed text is parsed from a fresh state.

The suite checks that 400 random edits to a 300-line document, parsed incrementally with 16-character chunks, give the same tree as a fresh parse, and that more than half of them resumed after the document's start. It also checks that more than three quarters reused chunks after the edit, and that together they re-tokenized less than a quarter of the text after their resume points. It checks the two lookahead cases and the appended line with one-line chunks. It checks that an edit reuses everything past the edit's margin, and that an edit opening a fence reuses nothing after it. It also checks that an edit inside a fence or a `<style>` element is parsed to the block's end and reuses what follows it, that such an edit resumes before the block and gives a fresh parse's classes where a resume inside it did not, and that reused chunks ending inside a fence that runs to the document's end are not parsed on from. `reusedLength` (`src/editor/tree-reuse.ts`) measures the reuse: a chunk taken from the old tree shares its array of children with it. Outside the suite, 9,900 random edits across all eleven corpora with 1-, 16- and 512-character chunks gave the same tree as a fresh parse.

## Cost

`scripts/cm6-bench.ts` repeats the texts of the two wider oracle corpora to 10,000 and 100,000 lines. It times a full parse. Then it inserts one character at the start of the line at the document's start, middle and end, and times the re-parse from the old tree's fragments to a viewport 3,000 characters past the edit (about 60 lines of this corpus), and on to the end. `Re-parsed` is how many characters the re-parse to the end tokenized again rather than reused. Medians of 5 runs, Node 26.10.0 on an AMD Ryzen 5 7500F, measured on 2026-10-22. Two runs of the script differed by up to 30%, and up to 50% on the smallest times.

| Lines   | Characters | Full parse | Edit at | Resumed from | Re-parsed | To viewport | To end  |
| ------: | ---------: | ---------: | :------ | -----------: | --------: | ----------: | ------: |
| 10,000  | 61,546     | 24.69 ms   | start   | 0            | 1,042     | 0.63 ms     | 0.82 ms |
| 10,000  | 61,546     | 24.69 ms   | middle  | 30,601       | 981       | 0.35 ms     | 0.49 ms |
| 10,000  | 61,546     | 24.69 ms   | end     | 61,078       | 469       | 0.14 ms     | 0.14 ms |
| 100,000 | 582,536    | 113.53 ms  | start   | 0            | 574       | 0.77 ms     | 0.94 ms |
| 100,000 | 582,536    | 113.53 ms  | middle  | 291,028      | 513       | 0.53 ms     | 0.62 ms |
| 100,000 | 582,536    | 113.53 ms  | end     | 582,106      | 431       | 0.35 ms     | 0.35 ms |

Before the parse reused the chunks after an edit, the re-parse to the end after an edit at the start cost 19.83 ms at 10,000 lines and 100.55 ms at 100,000. It parsed everything after the edit again. Now it re-tokenizes about a chunk around the edit and takes the rest from the old tree, so an edit costs about the same wherever it is and however long the document is. An edit that changes the state of every line after it still costs a parse to the end: one that opens a fence or a multi-line comment, for example. Inside a fenced block or a `<style>` or `<script>` element the parse goes on to the block's end.

Typing 50 characters one after another in the middle costs a median of 0.16 ms per keystroke at 10,000 lines and 0.80 ms at 100,000. Each re-parse resumes from the tree before it and stops at the viewport. Before, those were 0.56 ms and 0.33 ms. A keystroke at 100,000 lines now costs more because its tree reaches the document's end, not the viewport. The parse balances the tree over every reused chunk, and the next keystroke lists the old tree's chunks. In exchange nothing is left for idle time. Before, the rest of the document, 45 ms at 100,000 lines, was parsed again after every keystroke.

Run it with `npx jiti scripts/cm6-bench.ts [--lines <n>]... [--runs <n>]`.
