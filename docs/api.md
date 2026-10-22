# API overview

The parser ships as two packages, both `private` (see [AGENTS.md](../AGENTS.md#l1-status-private)): nothing is published, and a consumer installs a tarball made by `npm pack`.

- **`obsidian-markdown-parser`** is everything: the editor's classes, the three syntax adapters, the remark engine and the metadata. It depends on CodeMirror 6, `@lezer/*`, `codemirror@5`, micromark and mdast, markdown-it, `yaml` and three entity tables.
- **`obsidian-markdown-parser-metadata`** (`packages/metadata/`) is the metadata projection and the remark engine it is built from, and nothing else. It depends on `yaml`, `character-entities-legacy`, `character-reference-invalid` and `decode-named-character-reference` only.

The metadata package exists for a consumer that needs only `CachedMetadata`, such as a mock of Obsidian's metadata cache, and must not pull in an editor. Its source is the same `src/remark/` and `src/metadata/` the root package builds, compiled by `packages/metadata/tsconfig.build.json`. `src/entries/metadata-package.test.ts` pins that their import closure reaches no other module and no package beyond those four, at the root package's versions.

## Building and installing

```sh
npm run build                                   # dist/lib/ and packages/metadata/dist/
npm pack                                        # obsidian-markdown-parser-<version>.tgz
npm pack --workspace packages/metadata          # obsidian-markdown-parser-metadata-<version>.tgz
```

Then, in the consumer, `npm install <path to the tarball>`. Both packages are ES modules with TypeScript declarations, for Node 22 or later and for bundlers.

## Entry points

Every entry point of the root package is a subpath of it, and the root (`obsidian-markdown-parser`) exports all of them at once.

### `obsidian-markdown-parser/editor`

- `highlight`, `highlightLines` and `LineState`: the classes Obsidian's editor puts on every character and line, resumable from any line outside a fenced block or a script or style element (`isLineStateResumable`, [phase-1.md](phase-1.md)).
- `editorClassLanguage` and `createEditorClassLanguage`: that tokenizer as a CodeMirror 6 `Language`, with the editor's tree shape and incremental re-parsing ([cm6-host.md](cm6-host.md)).
- `editorClasses` and `editorClassDecorations`: its classes rendered as the editor renders them ([cm6-host.md](cm6-host.md)).

### `obsidian-markdown-parser/lezer`

- `parse`, `obsidianParser` and `createObsidianParser`: the `@lezer/markdown` tree with the Obsidian syntax ([syntax.md](syntax.md)).
- `obsidianMarkdown`, `createObsidianMarkdown` and `obsidianSyntax`: that syntax as `@lezer/markdown` extensions ([syntax.md](syntax.md)).
- `renderLezerHtml` and `commonMarkFixes`: a Lezer tree rendered as CommonMark's reference implementation does, for the spec suites ([spec-suites.md](spec-suites.md)).

### `obsidian-markdown-parser/mdast`

- `parseMdast`: the mdast tree with the Obsidian syntax ([syntax.md](syntax.md#the-micromark-and-mdast-adapter)).
- `micromarkObsidianMarkdown`, `createMicromarkObsidianMarkdown` and `mdastObsidianMarkdown`: that syntax as micromark and `mdast-util-from-markdown` extensions.
- `micromarkQuirksHtml`: micromark's events rendered with Obsidian's quirks ([spec-suites.md](spec-suites.md)).

### `obsidian-markdown-parser/markdown-it`

- `parseMarkdownIt`, `markdownItObsidianSyntax` and `createObsidianMarkdownIt`: the syntax as a markdown-it plugin, with tokens named after `ObsidianNode` ([syntax.md](syntax.md#the-markdown-it-plugin)).

### `obsidian-markdown-parser/syntax`

What the `lezer`, `mdast` and `markdown-it` adapters share:

- `ObsidianNode`: the names of the syntax nodes.
- `CONFORMANCE_CASES`: the corpus every adapter is checked against.
- The options: a preset (`commonmark`, `gfm` or `obsidian`, the default) with any of its flags turned on or off, `resolveObsidianSyntax` and `resolveObsidianQuirks` to read them, and `ObsidianQuirkFlags` for where Obsidian reads valid CommonMark differently, all off in every preset ([spec-suites.md](spec-suites.md)).

### `obsidian-markdown-parser/remark`

- `parseRemark`: the mdast tree Obsidian's reading view and metadata worker parse, from a port of `remark-parse` 8 with Obsidian's edits ([remark.md](remark.md)).
- `renderRemarkHtml`: that tree rendered as `remark-html` does.

### `obsidian-markdown-parser/metadata`

- `parseMetadata`: the `CachedMetadata` the metadata worker posts for a document, equal to it as JSON, or `null` where the worker throws ([metadata.md](metadata.md)).

The metadata package has two entry points: its root (`obsidian-markdown-parser-metadata`), which is `./metadata` above, and `obsidian-markdown-parser-metadata/remark`, which is `./remark` above.

## Example

```ts
import { parseMetadata } from 'obsidian-markdown-parser-metadata';

const metadata = parseMetadata('---\ntags: [a]\n---\n# Title\n\nSee [[Note]] #tag ^id\n');
// metadata?.links?.[0]?.link === 'Note', metadata?.blocks?.['id'], metadata?.frontmatter?.['tags'] ...
```

```ts
import { LanguageSupport } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  editorClasses,
  editorClassLanguage
} from 'obsidian-markdown-parser/editor';

const state = EditorState.create({ doc: '# Title', extensions: [new LanguageSupport(editorClassLanguage), editorClasses] });
new EditorView({ parent: document.body, state });
```

## Checked by

`npm run build` compiles both packages, and `src/entries/metadata-package.test.ts` checks that each package's `exports` names exactly the entry files its build compiles. A consumer installing both tarballs, type-checking an import of every entry point under `"moduleResolution": "NodeNext"` with `skipLibCheck` off, and running them in Node, was verified when the packages were added; the metadata consumer's `node_modules` held only the four dependencies above and `character-entities`, which `decode-named-character-reference` depends on.
