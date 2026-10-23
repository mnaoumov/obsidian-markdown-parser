# The `CachedMetadata` projection

`parseMetadata` in `src/metadata/` gives the `CachedMetadata` Obsidian's metadata worker posts for a document, built from the [`remark-parse` 8 engine](remark.md)'s tree. It is phase 2 of the project. It equals the worker's metadata as JSON, key order included, so the two can be compared with `JSON.stringify` alone.

```ts
import { parseMetadata } from 'obsidian-markdown-parser';

const metadata = parseMetadata('---\ntags: [a]\n---\n# Title [[Note]]\n\n[text](other%20note.md)');
// { links: [...], headings: [...], sections: [...], frontmatter: { tags: ['a'] }, frontmatterPosition: {...}, frontmatterLinks: [] }
```

The types in `src/metadata/types.ts` take the names Obsidian's API gives them (`CachedMetadata`, `LinkCache`, `HeadingCache`, `Pos`, `Loc` and the rest). The one exception is `FootnoteReferenceCache`, Obsidian's `FootnoteRefCache`, renamed by the repository's lint rules. The field keeps the worker's name, `footnoteRefs`.

## What the worker does

The worker parses the document with Obsidian's `remark-parse` 8 and walks the tree. These are its rules, re-expressed from its behaviour and measured against it. Nothing is taken from the app's bundle.

- **Line breaks.** The worker parses with Obsidian's `breaks` option, so a line feed after any spaces in inline content is a `break` node. `parseRemark` takes it as `shouldReadSoftLineBreaksAsHard`, and the projection turns it on. It shows in the text a markdown link shows.
- **Input.** The worker reads the file's bytes as UTF-8, so a byte order mark at the start is no part of the document and every offset counts from after it. `parseMetadata` encodes and decodes its input the same way.
- **Sections.** Each block of the document is a section: its mdast type, `callout` for a blockquote that opens a callout, `comment` for a comment block, `yaml` for front matter. The section carries the block's id when it has one.
- **Headings.** Only headings that are blocks of the document are listed, not those in quotes, lists or footnotes. The text is the source from the start of the heading's first child to the end of its last, trimmed. Markup, links, block ids and inline footnotes stay as written, and a heading with no content is `''`.
- **Markdown links and images.** A link or image whose destination starts with `./` or `../`, or holds no `:`, is an internal link or an embed. Its link is the destination after `decodeURI`, with no-break spaces made spaces, trimmed and in Unicode normal form C. A link whose destination `decodeURI` refuses stays a link and is not listed. An image keeps its destination as it is. A link shows the text of its children, and an image shows its alternative text, a size after a `|` included.
- **The text of a link's children.** A text node, code span or inline math gives its value, a break gives a line feed, and emphasis, strong, strikethrough and highlights give their children's text. A tag gives `#name`, an internal link its displayed text, and an embed its target. An image gives its embed link when its destination is no URL, or else its alternative text with a size after its last `|` taken off, or its title. Comments, raw HTML, block ids, footnote references and numbered inline footnotes give nothing. Each node but a break drops one final line feed from its text, and so does the link.
- **Front matter.** The YAML is parsed with `yaml` 2 and the worker's options. The worker bundles a 2.x release from 2.6.0 or later, and every release from 2.6.0 to 2.9.1 gives its result on 20,000 fuzzed front matters. `frontmatter` and `frontmatterPosition` are set only when it parses to a value of `typeof` `object` that is no array. A `!!binary` value is read with `atob` into a `Uint8Array`, as the browser build the worker bundles reads it. The Node build makes a `Buffer`, which accepts what `atob` refuses.
- **Front matter links.** Every string value at any depth that is a whole `[[link]]`, and every one that is a whole markdown link whose destination is no URL, is listed with its key path, keys and array indexes joined with `.`. A markdown link there is decoded with `decodeURI` but not normalized, and a destination `decodeURI` refuses is kept as it is.
- **Inline footnotes.** Before the walk the worker moves the content of each inline footnote into a footnotes section after the document's blocks. What an inline footnote holds is listed after everything else. The sections end with one of type `text` and one of type `element`, at the start of the line after the last block, a block id later taken out of the tree included. The `element` section takes the last block id the footnotes hold.
- **Tasks.** A task's checkbox is put first in a list item no paragraph opens, which moves the item's end.
- **Empty fields.** Every list the document has nothing for is left out, and so are the block ids when there are none. `frontmatterLinks` is kept when it is empty.

### Where the worker throws

The worker throws on two kinds of front matter. It then posts `null` instead of metadata, and so does `parseMetadata`:

- a string value that is a markdown link with no destination, such as `[text]()` or `[text]( )`;
- an object with a key `hasOwnProperty`, which hides the method the worker calls on it.

## How it is checked

- **The worker oracle.** `scripts/worker-oracle.ts` runs the app's own `worker.js` offline in a Node `vm`, with `atob` and `btoa` as a browser worker has them. It runs on the 36 documents of the conformance corpus and on 3,200 fuzzed documents from eight piece sets: syntax alone, among blocks and lists, and inside quotes, plus headings, markdown links and images, and YAML front matter. It writes each document's whole metadata, or the `null` the worker posted, to `oracle/worker-metadata-obsidian-1.14.4.json`. `src/oracle/worker-metadata.test.ts` pins `parseMetadata` to every one of them by full JSON equality.
- **The live app.** The same test pins it to the metadata the live app gave for all 674 examples of the spec oracle (`oracle/spec-obsidian-1.14.4.json`).
- **Outside the repository**, the same comparison gives 0 differences on 180,000 fuzzed documents from twelve piece sets, among them 27,435 with parsed front matter, 33,868 that list a markdown link or image, and 999 the worker posts `null` for. It gives 0 too on the 41,875 documents the oracle files then held.
- `src/metadata/metadata.test.ts` pins the rules above one by one.
