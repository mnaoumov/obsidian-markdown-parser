# The CodeMirror 6 host

`src/editor/language.ts` runs the editor-class tokenizer in CodeMirror 6 as a `Language`, and `src/editor/view.ts` renders its classes. Measured on 2026-10-14.

## Why not `StreamLanguage`

The tokenizer has CodeMirror's stream-parser shape, but `StreamLanguage` gives a mode no way to read the lines after the current one. The markdown mode needs that to see a setext underline under a paragraph line, and HyperMD needs it to see a delimiter row under a table's first row (`stream.lookAhead(1)`). The host is a Lezer `Parser` of its own that reads the document through the parse's `Input`, so `lookAhead` returns the real next line.

## The tree

The tree has the shape the oracle reads from the live editor:

- A line with line classes is a node named by them, sorted and joined by `_`, spanning the line. It holds the line's tokens.
- Every token with classes is a node named the same way. A token with no classes is left out, as in `StreamLanguage`.
- Lines are grouped into chunks of about 512 characters. A chunk is an anonymous node, which a tree cursor steps through, so line nodes sit at depth 1 as they do in the editor.

`lineClassesProperty` and `tokenClassesProperty` carry the classes on the node types, so the renderer does not split names on `_`, which a `tag-<name>` class may contain. `editorClasses` puts a token's classes on its text as `cm-<class>` and a line's classes on its `.cm-line`, for the visible ranges.

The host's tree gives every character and line the same classes as the line tokenizer on all 20,296 documents of the seven oracle corpora. Scored against the live editor's trees directly, it has the tokenizer's single difference, `rich-41` of seed 2718.

## Incremental reuse

Each chunk records the tokenizer state after its last line, and how far its lines read: each line's own newline, and the end and newline of any line read ahead. After an edit, a new parse resumes from the last chunk whose reads all end before the edit (and before the 25-character margin `StreamLanguage` keeps from an edited fragment's end). So a paragraph line whose lookahead saw the line now turned into `---` is parsed again, and so is a last line that gains a line after it.

The rest is what `StreamLanguage` does:

- Only a prefix is reused. Everything after the edit is parsed again, from the resumed state.
- Each `advance` parses one chunk, and a parse stops at the end of the viewport, so the editor parses the rest in idle time.
- A viewport more than 100,000 characters past the parsed text is parsed from a fresh state.

The suite checks that 400 random edits to a 300-line document, parsed incrementally with 16-character chunks, give the same tree as a fresh parse, and that more than half of them resumed after the document's start. It also checks the two lookahead cases and the appended line with one-line chunks.

## Cost

`scripts/cm6-bench.ts` repeats the texts of the two wider oracle corpora to 10,000 and 100,000 lines. It times a full parse, then inserts one character at the start of the line at the document's start, middle and end and times the re-parse from the old tree's fragments to a viewport 3,000 characters past the edit (about 60 lines of this corpus), and on to the end. Medians of 5 runs, Node 26.10.0 on an AMD Ryzen 5 7500F. Two runs of the script differed by up to 30%.

| Lines   | Characters | Full parse | Edit at | Resumed from | To viewport | To end    |
| ------: | ---------: | ---------: | :------ | -----------: | ----------: | --------: |
| 10,000  | 61,546     | 22.44 ms   | start   | 0            | 2.50 ms     | 19.83 ms  |
| 10,000  | 61,546     | 22.44 ms   | middle  | 30,601       | 0.61 ms     | 6.05 ms   |
| 10,000  | 61,546     | 22.44 ms   | end     | 61,078       | 0.11 ms     | 0.11 ms   |
| 100,000 | 582,536    | 101.54 ms  | start   | 0            | 2.43 ms     | 100.55 ms |
| 100,000 | 582,536    | 101.54 ms  | middle  | 291,028      | 0.34 ms     | 45.15 ms  |
| 100,000 | 582,536    | 101.54 ms  | end     | 582,106      | 0.05 ms     | 0.05 ms   |

Typing 50 characters one after another in the middle, each re-parse resuming from the tree before it and stopping at the viewport, costs a median of 0.56 ms per keystroke at 10,000 lines and 0.33 ms at 100,000.

So the cost of an edit is the cost of the viewport after it, whatever the document's size. The parse after the viewport costs as much as parsing the rest of the document. The editor does that work in idle time, and an edit near the start repeats almost all of it. Reusing the chunks after an edit would need a test that the state after a re-parsed line equals the old state at the same line, and the mode's state holds sub-mode states and tokenizer functions. That is not built.

Run it with `npx jiti scripts/cm6-bench.ts [--lines <n>]... [--runs <n>]`.
