/**
 * @file
 *
 * The metadata worker oracle: runs Obsidian's own metadata worker, its `worker.js`, offline in a Node `vm` context, on
 * fuzzed documents built from piece sets of block and inline markdown and the Obsidian syntax, and on every document of
 * the conformance corpus and on a few pinned documents, and writes each document's whole `CachedMetadata`, or the `null` the worker posts where it
 * throws, to `oracle/worker-metadata-obsidian-<version>.json` (`src/oracle/spec/worker-metadata.ts`). Besides the syntax,
 * piece sets of headings, markdown links and images, and YAML front matter cover the rest of the metadata.
 *
 * The worker runs with `atob` and `btoa`, as a browser worker has them: the YAML parser it bundles reads a `!!binary`
 * value with `atob`, and fails the front matter without it.
 *
 * The worker is read from the Obsidian install it names, at run time; nothing of it is kept here. It defaults to the
 * `obsidian-versions` checkout beside this repository, whose `obsidian.asar/package.json` gives the version.
 * `scripts/oracles/oracle-refresh.ts` instead hands it the worker of the instance it reads the other oracles from.
 *
 * Usage: `jiti scripts/capture/worker-oracle.ts [--worker <path to worker.js>] [--obsidian-version <version>] [--per-set <n>]
 * [--seed <n>] [--out-dir <directory>]`.
 */

import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/dprint';
import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createContext,
  runInContext
} from 'node:vm';

import type { CachedMetadata } from '../../src/metadata/types.ts';
import type {
  WorkerMetadataDocument,
  WorkerMetadataOracleFile
} from '../../src/oracle/spec/worker-metadata.ts';

import { CONFORMANCE_CASES } from '../../src/syntax/conformance.ts';

// The app's own `package.json`, beside its `worker.js`.
interface AppPackage {
  readonly version: string;
}

// The message the app posts to its metadata worker: the document, encoded.
interface WorkerMessage {
  readonly data: WorkerMessageData;
}

interface WorkerMessageData {
  readonly metadataCache: ArrayBuffer;
}

interface WorkerScope {
  readonly onmessage?: ($event: WorkerMessage) => void;
  readonly postMessage: (message: unknown) => void;
}

const DEFAULT_PER_SET = 400;
const DEFAULT_SEED = 12_345;
const MAX_LINES = 6;
const FRONTMATTER_ODDS = 8;
const MAX_FRONTMATTER_LINES = 4;
const FINAL_LINE_BREAK_ODDS = 2;
const LCG_MULTIPLIER = 1_103_515_245;
const LCG_INCREMENT = 12_345;
const LCG_MASK = 0x7F_FF_FF_FF;
const LCG_RANGE = 0x80_00_00_00;

/* eslint-disable unicorn/prefer-string-repeat -- The piece sets are markdown lines, written as they are. */
const RICH = ['- A', '- B', '  - C', '    - D', '1. E', '10. F', '  1. G', '   - F', '', '', '  ', '    ', 'text', '  text', '    text', '      code', '> q', '> - G', '>', '> ', '>   - H', '>     - D', '> > - K', '> ```', '> %%', '  ```', '```', '````', '~~~', '   ```', '- ```', '- %%', '  %%', '%%', '%% x %%', 'x %%', '$$', '  $$', '$$ x $$', 'x $$', '- $$', '# H', '- ', '- [x] T', '+ L', '\t- D', '\t', '***', '* I', '  * J', '  ~~~', '>   ```', '  %% x', '  - ```'];
const INLINE = ['a [[Note]] b', '![[img.png|200]]', '[[A#B|c]]', '[x](y.md)', '[x](<a b.md>)', '![i](p.png)', '#tag x', 'a #t/b', '#123', 'x[^1] y', '[^1]: def', '[^a]: d ^bid', '^[inline]', '^[]', 'p ^abc', '^abc', 'a *b ^x* c', '`code ^x`', '==hi==', '~~del~~', '%%c ^q%%', '$x$', '[a]: /u "t"', '[a][]', 'https://x.y', '<http://a>', 'x@y.z^ab', '- [ ] [a]: /u', '> [^2]: z', '- item ^li', '  - sub ^ls', '# H ^h', '| a ^c |', '', '', 'text', '---', 'k: [[L]]', 'tags: [a]'];
const SYNTAX = ['[[a|]]', '[[|a]]', String.raw`[[ a \]]`, '![[x.png|100x20]]', '![[a#b^c|d]]', '[[a]]]]', '[[[[a]]', '[[a\nb]]', 'x[[a]]y', '#a#b', '#-x', '#_', '#1a', '# x #t', '*#em*', '(#p)', '#日本', '#a.b', '==a==b==', '====', '== a==', '==a ==', '==🔴red==', '==🟦==', '$ x$', '$x $', '$x$1', '$$x$$', '$$ $$', String.raw`\$x$`, String.raw`$a\$b$`, '$$a$$  ', '^[a [b] c]', '^[a `]` b]', '^[^[n]]', '^[[[L]]]', '[^x]', '[^ x]', '[^]', '[^1]:', '[^1]: a\n    b', '[^1]:\n\n    c', '    [^1]: d', '[^A]: up', 'ref [^A]', '%%a%%', '%%%%', '%% a', 'b %%', '%%[[l]]%%', '%%\n#t\n%%', '$$\nx\n$$', '  $$', '$$$\nx\n$$', 'x ^id', '^id', '^a-b', 'a\n^id', '> ^q', '- ^li', '^[x ^in]', '[a](./b c.md)', '[a](%zz)', '[^1]: x ^d', '[^2]: y', 'a [^2] b [^1]', '%% x %% y', '| [[a|b]] | c |', '- [?] task', '- [/] t ^tid', '\n', '---\nk: v\n---'];
const GAP = ['para', '   para', '    code', '\tcode', '', '', '  ', '> q', '>', '> [!note]', '```', '~~~', '%%', '%% x %%', 'x %%', '%% end', '$$', '$$ x $$', 'x $$', '$$$', '***', '---', '===', '# H', '<div>', '</div>', '<!-- c', 'c -->', '| a | b |', '| - | - |', 'a|b', '-|-', '> ```', '> $$', 'lazy', '\t', '    '];
const HEADING = ['# H', '## a *b* c', '###### x ##', '# a [[l]] ^id', '#', '# ', '#  x  ', '# x #', '# a ^[n] b', '# [t](a.md)', '# #tag', 'text', 'Setext', '===', '---', '  # in', '> # q', '- # li', '    # code', '# a\\', '# a  ', '#\ta', '# `c`', '# $m$', '# ==h==', '# %%c%%', '# a [^1]', '[^1]: d', '', '', '# a ^b', 'x\n===', '# <b>h</b>', '# &amp; e', '# a\u{A0}', '# ![i](p.png)'];
const LINK = ['[t](a.md)', '[t](a%20b.md)', '[t](%zz)', '[t](a%E2.md)', '[t](./x)', '[t](../x:y)', '[t](x:y)', '[t](http://a)', '[t](#h)', '[t](<a b.md>)', '[t](a.md "T")', '[t](a.md \'T\')', '[t]()', '[](a.md)', '[*e* `c` [[w]] #g](a.md)', '[a\nb](c.md)', '[a  \nb](c.md)', '[a\\\nb](c.md)', '[![i](p.png)](a.md)', '[![i|100](http://x/p.png)](a.md)', '[![i](http://p)](a.md)', '![i](p.png)', '![](p.png)', '![i|100](p.png)', '![i|a|20x30](p.png)', '![i](p%20q.png)', '![i](%zz.png)', '![i](http://x/p.png)', '![i](<p q.png>)', '![i](p.png "T")', '[t](a&amp;b.md)', String.raw`[t](a\_b.md)`, '[t](\u{A0}a.md)', '[t](e\u{301}.md)', '[a ^[n] b](x.md)', '[a [^1] b](x.md)', '[^1]: d', '[l]: a.md', '[t][l]', '![i][l]', '<a.md>', '<x:y>', 'www.a.b', 'a@b.c', '[t](a.md) [u](b.md)', '[==h== ~~d~~ $m$](x.md)', '[%%c%%](x.md)', '[a&#10;](x.md)', '[x ^id](y.md)', 'text', '', '', '> [t](a.md)', '- [t](a.md)', '# [t](a.md)', '| [t](a.md) | b |', '|-|-|'];
const YAML = ['a: 1', 'b: [x, y]', 'c: {d: e}', 'k: "[[L|x]]"', 'k: "[[ |a]]"', 'k: "[[a#b#c]]"', String.raw`k: "[[a\\]]"`, 'k: [[L]]', 'x: !!str 1', 'n: 0o17', 'h: 0x1F', 'f: .inf', 'nan: .nan', 'y: yes', 't: 2024-01-02', 'a: &A {p: 1}', 'b: *A', '<<: *A', '%YAML 1.1', '- item', 'm: |\n  block', 'e:', 'e: ~', 'b: !!binary aGVsbG8=', 'b: !!binary a#b', 's: !!set {a, b}', 'o: !!omap [{a: 1}]', 'bad: [', 'tab:\tx', '? complex\n: v', '[a, b]: c', '__proto__: 1', 'hasOwnProperty: 1', 'l: ["[[x]]", "[t](a b.md)"]', 'k: "[t](a b.md)"', 'k: "[t](./a%20b.md)"', 'k: "[t](http://x)"', 'k: "![i](<a b.png>)"', 'k: "[t](%zz)"', 'k: "[t]()"', 'k: "[t]( )"', String.raw`k: "[t](a.md \"T\")"`, 'k: {n: "[[a]]"}', '"": {x: "[[e]]"}', 'k: "[[a]] and [[b]]"', 'x: 9007199254740993', 'x: 1e3', '...', '# c', '---x'];
/* eslint-enable unicorn/prefer-string-repeat -- The piece sets end here. */

// How many characters of a footnote definition, from its start, the worker looks in for the marker of a line that ends it.
const FOOTNOTE_DEFINITION_SCAN_LIMIT = 1024;

/*
 * Documents the piece sets do not reach, kept whole: list items and quotes nested in each other, a tab between quote
 * levels included, whose list items the projection once had to be measured on by hand, and a `%%` inside an internal
 * link's content, where the editor opens a comment. Then the shapes of the parser findings another parity harness
 * reported, each checked on the live app: positions on the line that opens a block comment and on a callout's lazy line
 * inside a list item, which the worker reports short or past the text (a rename rewrites a link at that wrong place),
 * comments, footnote references and definitions inside and around them, setext headings in containers, tabs before
 * indented code, task item bodies, a footnote definition whose ender lies past the worker's scan limit, and a link
 * reference definition that takes a quoted paragraph after a blank line as its title.
 */
const PINNED = [
  '- > 1. first',
  '- >\t> 1. a',
  '> -\t> 1. a',
  '- > - > 1. a\n  > b',
  '1. > - a\n   > b',
  '- > 1. a\n  > 2. b',
  '[[a%%b]]',
  '[[a%%b]]%%',
  '%%open\n\n# Heading\n\nbody [^1]\n\n[^1]: x',
  'a %%open\n\n# Heading\n\nbody [^1]\n\n[^1]: x',
  '%% | ![[==mark==]], [[target]]',
  '%%c%% | ![[==mark==]], [[target]]',
  '%%\nhidden\n%% [^a]: sees [^b]\n\n[^b]: b body\n\ntail',
  '- %% see [[target]] here\n  more %%',
  '1. > [!note] T\n> ab cd [[target]] end',
  '1. > [!note] T\n   > ab cd [[target]] end',
  'inline ^[^9] real[^7]',
  '[^1](u)\n\n[^1]: one',
  'use[^1] and [^2]',
  '%%\n[^1]: buried\n%%\n\nuse[^1]\n\n[^1]: real',
  'Text[^1] and more.\n\n%% check [^1] later %%\n\n[^1]: the note',
  '> text\n> ---',
  '- item\n  ===',
  '[ref]: /url\n  \tcode',
  '  \t%%\n[^1]: def',
  '- \tp\n\n  [^1]: def',
  '- item\n\n\t   [^1]: def\n\nuse[^1]',
  '> [!note]\n>\tcode[^2]\n\n[^2]: d',
  '- [ ] 1.\n- [ ] 1) text\n- [ ] - bullet\n- [ ] > quote',
  '- [/] a\n- [-] b\n- [>] c\n- [!] d',
  longFootnoteDefinition(FOOTNOTE_DEFINITION_SCAN_LIMIT - 1, '# ender'),
  longFootnoteDefinition(FOOTNOTE_DEFINITION_SCAN_LIMIT, '# ender'),
  longFootnoteDefinition(FOOTNOTE_DEFINITION_SCAN_LIMIT, '[^2]: second'),
  '[foo]: /url\n\n\'tit [^1]\nle\'\n\n[^1]: x',
  '[1]: https://example.com\n\n"To be or not to be."\n\nNext paragraph.',
  '[1]: https://example.com\n\n"Unclosed quote\n\nNext paragraph with a [link][1].',
  'a[^a[b]c]\n\n[^a[b]: d'
];

/*
 * The piece sets: syntax alone, syntax among blocks and lists, syntax inside quotes, headings, markdown links and
 * images, and inline content under front matter built from YAML pieces.
 */
const SETS: Readonly<Record<string, readonly string[]>> = {
  frontmatter: [...INLINE, ...LINK],
  heading: HEADING,
  inline: INLINE,
  link: LINK,
  mixed: [...GAP, ...RICH, ...INLINE, ...SYNTAX, ...HEADING, ...LINK],
  quote: [...SYNTAX, ...INLINE].map((piece) => `> ${piece.replaceAll('\n', '\n> ')}`),
  rich: [...RICH, ...SYNTAX],
  syntax: SYNTAX
};

const { values } = parseArgs({
  options: {
    'obsidian-version': { type: 'string' },
    'out-dir': { type: 'string' },
    'per-set': { type: 'string' },
    'seed': { type: 'string' },
    'worker': { type: 'string' }
  }
});

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workerPath = values.worker ?? join(repoRoot, '..', 'obsidian-versions', 'obsidian.asar', 'worker.js');
const appPackagePath = join(dirname(workerPath), 'package.json');
const appVersion = values['obsidian-version'] ?? (JSON.parse(readFileSync(appPackagePath, 'utf-8')) as AppPackage).version;
const perSet = Number(values['per-set'] ?? DEFAULT_PER_SET);
const seed = Number(values.seed ?? DEFAULT_SEED);

const runWorker = loadWorker(workerPath);
const random = createRandom(seed);

// A seeded generator of whole numbers below a limit, so a seed always gives one corpus.
function createRandom(initialSeed: number): (limit: number) => number {
  let state = initialSeed;
  return (limit) => {
    // eslint-disable-next-line no-bitwise -- The generator's step keeps 31 bits.
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) & LCG_MASK;
    return Math.floor((state / LCG_RANGE) * limit);
  };
}

// Front matter: a line of the default `a: 1`, now and then, or, in the `frontmatter` set, lines of YAML pieces.
function frontmatterOf(set: string): string {
  if (set === 'frontmatter') {
    const lines = Array.from({ length: 1 + random(MAX_FRONTMATTER_LINES) }, () => YAML[random(YAML.length)] ?? '');
    return `---\n${lines.join('\n')}\n---\n`;
  }
  return random(FRONTMATTER_ODDS) === 0 ? '---\na: 1\n---\n' : '';
}

function loadWorker(path: string): (text: string) => CachedMetadata | null {
  let last: CachedMetadata | null = null;
  const scope: WorkerScope = {
    postMessage(message) {
      last = message as CachedMetadata | null;
    }
  };
  // The worker logs a warning for some YAML and an error where it throws; the oracle records the outcome instead.
  const quietConsole = { ...console, error: noop, warn: noop };
  const context = createContext({ ArrayBuffer, atob, btoa, clearTimeout, console: quietConsole, self: scope, setTimeout, TextDecoder, TextEncoder, Uint8Array, URL });
  runInContext('globalThis.window = globalThis;', context);
  runInContext(readFileSync(path, 'utf-8'), context);
  return (text) => {
    last = null;
    scope.onmessage?.({ data: { metadataCache: new TextEncoder().encode(text).buffer } });
    return last;
  };
}

// A footnote definition of lazy lines whose next line, `ender`, starts `enderOffset` characters after the definition's start.
function longFootnoteDefinition(enderOffset: number, ender: string): string {
  const LINE = 'word word word';
  let definition = '[^1]: x';
  while (definition.length + 1 + LINE.length < enderOffset - 1) {
    definition += `\n${LINE}`;
  }
  definition = `${definition}\n`.padEnd(enderOffset - 1, 'w');
  return `${definition}\n${ender}\n\nafter\n\nuse[^1] and [^2]`;
}

function noop(): void {
  // Nothing to log.
}

const docs: WorkerMetadataDocument[] = Array.from(CONFORMANCE_CASES, (testCase) => ({ metadata: runWorker(testCase.markdown), set: 'conformance', text: testCase.markdown }));

for (const [set, pieces] of Object.entries(SETS)) {
  for (let index = 0; index < perSet; index++) {
    const lines: string[] = [];
    const count = 1 + random(MAX_LINES);
    for (let line = 0; line < count; line++) {
      lines.push(pieces[random(pieces.length)] ?? '');
    }
    const text = `${frontmatterOf(set)}${lines.join('\n')}${random(FINAL_LINE_BREAK_ODDS) === 0 ? '' : '\n'}`;
    docs.push({ metadata: runWorker(text), set, text });
  }
}

// After the piece sets, so the seed still gives them the same documents.
for (const text of PINNED) {
  docs.push({ metadata: runWorker(text), set: 'pinned', text });
}

const oracleFile: WorkerMetadataOracleFile = { docs, meta: { appVersion, perSet, seed } };
const outFile = join(values['out-dir'] ?? join(repoRoot, 'oracle'), `worker-metadata-obsidian-${appVersion}.json`);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(oracleFile)}\n`);
// The repository's dprint check covers `oracle/`, and its layout is not `JSON.stringify`'s.
await format({ paths: [outFile] });
console.log(`Wrote ${String(docs.length)} documents to ${outFile}`);
