# obsidian-markdown-parser

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![CI](https://img.shields.io/github/actions/workflow/status/mnaoumov/obsidian-markdown-parser/ci.yml?branch=main&label=CI)](https://github.com/mnaoumov/obsidian-markdown-parser/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/mnaoumov/obsidian-markdown-parser)](https://github.com/mnaoumov/obsidian-markdown-parser/blob/main/LICENSE)

A parser for Obsidian-flavoured markdown that gives the same answers as Obsidian itself: the classes its editor puts on every character, the syntax tree of wikilinks, embeds, tags, comments, math, highlights, footnotes, block ids and callouts, the HTML of its reading view, and the `CachedMetadata` its metadata worker posts for a note.

Tools that read an Obsidian vault outside the app (publishers, linters, static-site generators, test mocks, editors) each re-implement that syntax, and each gets its edge cases a little differently from Obsidian. This project defines the Obsidian syntax once, measures every reading against a running Obsidian, and ships it for the main JavaScript markdown ecosystems: `@lezer/markdown` and CodeMirror 6, micromark with mdast, markdown-it, and a port of the `remark-parse` 8 engine that Obsidian's reading view and metadata worker run.

> [!NOTE]
> Unofficial: not affiliated with or endorsed by Obsidian.

## Status

Released on npm from 1.0.0, following semantic versioning: a breaking change to the API waits for a major version. Measured against Obsidian 1.15.1 on desktop (1.14.4 on Android):

1. **Editor classes:** every character and line of all 46,508 documents in eleven fuzzed corpora gets the live editor's classes ([phase-1.md](docs/phase-1.md)).
2. **Metadata:** `parseMetadata` equals the worker's `CachedMetadata` as JSON, key order included, on 3,743 documents run through the app's own worker and on the live app's metadata of all 674 spec examples ([metadata.md](docs/metadata.md)).
3. **Spec conformance:** with the `commonmark` preset, the micromark and markdown-it adapters pass all 652 examples of the CommonMark 0.31.2 suite and the Lezer tree passes 651 ([spec-suites.md](docs/spec-suites.md)).
4. **Live parsing:** the editor tokenizer resumes from any line and reuses the old parse after an edit, so an edit at the start of a 100,000-line document re-parses in under 1 ms ([cm6-host.md](docs/cm6-host.md)).

What is not done yet is in [the write-up](docs/write-up.md).

## What it gives you

| Entry point | Gives |
| --- | --- |
| `@mnaoumov/obsidian-markdown-parser/editor` | `highlight` and `highlightLines`: the classes Obsidian's editor puts on every character and line. `editorClassLanguage`: that tokenizer as a CodeMirror 6 `Language`, with incremental re-parsing. |
| `@mnaoumov/obsidian-markdown-parser/lezer` | `parse`: the `@lezer/markdown` tree with the Obsidian syntax, and `obsidianMarkdown`, the syntax as `@lezer/markdown` extensions. |
| `@mnaoumov/obsidian-markdown-parser/mdast` | `parseMdast`: an mdast tree with the Obsidian syntax, and the micromark and `mdast-util-from-markdown` extensions behind it. |
| `@mnaoumov/obsidian-markdown-parser/markdown-it` | `parseMarkdownIt`: markdown-it tokens with the Obsidian syntax, and `markdownItObsidianSyntax`, the markdown-it plugin. |
| `@mnaoumov/obsidian-markdown-parser/remark` | `parseRemark`: the tree Obsidian's reading view and metadata worker parse, and `renderRemarkHtml`, its HTML. |
| `@mnaoumov/obsidian-markdown-parser/metadata` | `parseMetadata`: the `CachedMetadata` Obsidian's metadata worker posts for a note. |
| `@mnaoumov/obsidian-markdown-parser-metadata` | The same `parseMetadata` and remark engine as a separate package with four small dependencies and no editor or CodeMirror. |

The root `@mnaoumov/obsidian-markdown-parser` exports all of them. Every adapter takes the same options: a preset (`commonmark`, `gfm` or `obsidian`, the default) with any of its flags turned on or off, and Obsidian's departures from the spec as flags of their own. The full list is in [api.md](docs/api.md).

## Usage

The metadata Obsidian's metadata cache would hold for a note:

```ts
import { parseMetadata } from '@mnaoumov/obsidian-markdown-parser-metadata';

const metadata = parseMetadata('---\ntags: [project]\n---\n# Title\n\nSee [[Other note#Heading|alias]], #tag and ==highlight==. ^block-id\n');
metadata?.links?.[0]?.link; // 'Other note#Heading'
metadata?.links?.[0]?.displayText; // 'alias'
metadata?.tags?.[0]?.tag; // '#tag'
metadata?.frontmatter; // { tags: ['project'] }
```

The classes Obsidian's editor gives each line and span:

```ts
import { highlight } from '@mnaoumov/obsidian-markdown-parser/editor';

const lines = highlight('# Title\nSee [[Other note]]');
lines[0]?.classes; // ['HyperMD-header', 'HyperMD-header-1']
lines[0]?.spans[0]?.classes; // ['formatting', 'formatting-header', 'formatting-header-1', 'header', 'header-1']
```

The same tokenizer as the language of a CodeMirror 6 editor:

```ts
import { LanguageSupport } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  editorClasses,
  editorClassLanguage
} from '@mnaoumov/obsidian-markdown-parser/editor';

const state = EditorState.create({ doc: '# Title', extensions: [new LanguageSupport(editorClassLanguage), editorClasses] });
new EditorView({ parent: document.body, state });
```

The Obsidian syntax in each ecosystem:

```ts
import { parse } from '@mnaoumov/obsidian-markdown-parser/lezer';
import { parseMarkdownIt } from '@mnaoumov/obsidian-markdown-parser/markdown-it';
import { parseMdast } from '@mnaoumov/obsidian-markdown-parser/mdast';

parse('See [[Other note]] and #tag'); // Lezer tree: Document > Paragraph > InternalLink, Tag ...
parseMdast('See [[Other note]] and #tag'); // mdast: { type: 'internalLink', path: 'Other note', ... }
parseMarkdownIt('See [[Other note]] and #tag'); // tokens: InternalLink_open, InternalLinkPath, ..., Tag_open ...
```

The reading view's HTML:

```ts
import { parseRemark, renderRemarkHtml } from '@mnaoumov/obsidian-markdown-parser/remark';

renderRemarkHtml(parseRemark('See [[Other note]] and ==hi==\n'));
// <p>See <a class="internal-link" data-href="Other note" href="Other note">Other note</a> and <mark>hi</mark></p>
```

## Installation

```sh
npm install @mnaoumov/obsidian-markdown-parser
```

Or, for the metadata projection alone, without the editor or CodeMirror dependencies:

```sh
npm install @mnaoumov/obsidian-markdown-parser-metadata
```

Both packages are ES modules with TypeScript declarations, for Node 22 or later and for bundlers.

## How it works

It is three engines, not one, because Obsidian's three outputs come from three kinds of parser: the editor's classes from a CodeMirror 5 line tokenizer (ported here and hosted in CodeMirror 6), the syntax tree from `@lezer/markdown` with Obsidian extensions, and the reading view and metadata from a port of `remark-parse` 8 with Obsidian's edits. Why each output needs its engine, and what a single engine would take, is in [architecture.md](docs/architecture.md).

Nothing is matched to a description of Obsidian's behaviour. Each reading is matched to oracles read from a running Obsidian over the Chrome DevTools Protocol and from its metadata worker, and the pinned Obsidian version can be moved with one command that reports what changed ([oracles.md](docs/oracles.md)). What is ported from open-source code, what was learned by reading Obsidian's code, and what was only measured is in [provenance.md](docs/provenance.md).

## How it tests Obsidian

The oracles and engines also make a test suite for Obsidian itself. Each finder below sorts what it finds into families with verdicts:

1. **Spec suites** compare Obsidian's readings of every CommonMark and GFM spec example with the spec ([spec-suites.md](docs/spec-suites.md)).
2. **The mode judge** compares Source mode and Live Preview with Reading view on every oracle document (`npm run mode-judge`, [mode-judge.md](docs/mode-judge.md)).
3. **The self-check judges** find where Obsidian is wrong but consistent with itself, through reference-free relations over generated notes: positions slice their construct, a prefix shifts everything, a rename leaves the rest alone, and the cache agrees with Reading view (`npm run self-check`, [self-check.md](docs/self-check.md)).
4. **The engine differential** finds where Obsidian is wrong only by the spec, by rendering generated CommonMark and GFM notes with Reading view's engine and with `micromark`, `markdown-it` and `commonmark.js` (`npm run self-check -- --engines`).
5. **Link parity** finds what a wikilink can express and a markdown link cannot, and the other way round (`npm run link-parity`, [link-parity.md](docs/link-parity.md)).
6. **Special note names** finds what each vault surface does with a note whose name holds a character Obsidian warns about, one link syntax reserves, or one the vault normalizes, on desktop and Android (`npm run special-names`, [special-names.md](docs/special-names.md)).
7. **Link cases** finds where a link leads in vault shapes from forum reports: a name a root note and a folder note share, a renamed note with spaces, a file with no extension, and a note composer merge across folders (`npm run link-cases`, [link-cases.md](docs/link-cases.md)).

## Documentation

1. [API](docs/api.md): the packages, their entry points and what each exports.
2. [Architecture](docs/architecture.md): the three engines and why.
3. [Syntax](docs/syntax.md), [remark engine](docs/remark.md) and [metadata](docs/metadata.md): the rules each follows and how they are checked.
4. [Spec suites](docs/spec-suites.md): CommonMark and GFM results, and Obsidian's departures from them.
5. [Oracles](docs/oracles.md): how Obsidian is measured, and how to move to a new version.
6. [Development](docs/development.md): building, checking, releasing and measuring from a clone.
7. [Write-up](docs/write-up.md): the goals, the result per goal, and the known gaps.

## See also

[My other Obsidian resources](https://mnaoumov.dev/obsidian/)

| Library | Features | How `obsidian-markdown-parser` differs |
| --- | --- | --- |
| [`@moritzrs/micromark-extension-ofm`](https://github.com/MoritzRS/obsidian-ext) | micromark extensions for callouts, tags, wikilinks and embeds; `mdast-util-ofm` and `remark-ofm` beside it | Covers part of the same syntax for micromark; adds highlights, comments, math, footnotes and block ids, Obsidian's positions, and the other ecosystems |
| [`@quartz-community/remark-obsidian`](https://github.com/quartz-community/remark-obsidian) | remark plugin on a vendored `remark-parse` 8 with Obsidian's readers; `legacy` and `strict` presets; measured against Obsidian; writes its nodes back with `remark-stringify`; Quartz's parser | Same goal for the reading view tree; adds the editor's classes, the `CachedMetadata` projection, Lezer and markdown-it adapters and incremental parsing; omits writing back to markdown |
| [`@silicajs/remark-obsidian`](https://github.com/agdevhq/silica/tree/main/packages/remark-obsidian) | remark plugin for wikilinks, embeds with sizes, callouts, highlights, comments, block ids, inline footnotes and tags; serializes them; tag helpers | Covers part of the same syntax for remark; adds Obsidian's exact readings measured against the app, metadata and the editor's classes; omits serializing and tag helpers |
| [`lezer-markdown-obsidian`](https://github.com/erykwalder/lezer-markdown-obsidian) | `@lezer/markdown` extensions for comments, footnotes, tags, internal links, highlights and front matter; a best-effort match, not checked against the app | Same goal for Lezer; adds measured parity with the live editor, its CSS classes and the other ecosystems |
| [`markdown-it-obsidian-callouts`](https://github.com/ebullient/markdown-it-obsidian-callouts) | markdown-it callouts and Admonition code blocks rendered as Obsidian's callout HTML with its icons | Narrower than it for callout rendering; adds the rest of the syntax as tokens; omits icons and Admonition blocks |
| [`mdian`](https://github.com/ngtrio/mdian) | remark and rehype plugins for wikilinks, embeds, highlights, comments and callouts; React preset; heading and block anchors; external video embeds | Covers part of the same syntax for parsing; adds Obsidian's exact readings, metadata and the editor's classes; omits rendering components and external embeds |
| [`obsidian-markdown`](https://github.com/gordonbrander/obsidian-markdown) | markdown-it renderer for Obsidian Flavored Markdown; web components for notes and properties; a written specification with a test suite | Same goal for markdown-it rendering; adds parity measured against the running app, metadata and the editor's classes; omits web components and a prose specification |
| [`remark-obsidian`](https://github.com/johackim/remark-obsidian) | remark plugin for callouts, highlights, strikethrough, wikilinks and note embeds, rendered as links | Covers part of the same syntax; adds the rest of it, Obsidian's positions and metadata |

Last searched for similar libraries on 2026-11-25.

## Changelog

All notable changes to this project will be documented in the [CHANGELOG](./CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. Before a change to the parser, run the checks in [development.md](docs/development.md); a change that moves a measured number updates the page that states it.

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

### Filing an issue (for AI agents and humans)

Open issues through the [issue forms](https://github.com/mnaoumov/obsidian-markdown-parser/issues/new/choose), not as blank issues.

Filing from the CLI or the API (`gh issue create --body`, or an AI agent filing for you) skips the form, and `gh issue create --template` cannot load an issue form. In that case, open the matching form in [`.github/ISSUE_TEMPLATE/`](https://github.com/mnaoumov/obsidian-markdown-parser/tree/HEAD/.github/ISSUE_TEMPLATE), copy every field as a `### <label>` heading in the form's order, and fill in each one. Always state the version you used and your operating system.

## License

© [Michael Naumov](https://github.com/mnaoumov/). Released under the [MIT License](LICENSE). Code ported from open-source projects keeps its own license, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
