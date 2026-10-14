/**
 * @file
 *
 * The metadata worker oracle: runs Obsidian's own metadata worker, its `worker.js`, offline in a Node `vm` context, on
 * fuzzed documents built from piece sets of block and inline markdown and the Obsidian syntax, and on every document of
 * the conformance corpus. It writes the fields of each document's `CachedMetadata` the syntax makes
 * (`src/oracle/worker-syntax.ts`) to `oracle/worker-syntax-obsidian-<version>.json`.
 *
 * The worker is read from the Obsidian install it names, at run time; nothing of it is kept here. It defaults to the
 * `obsidian-versions` checkout beside this repository, whose tag gives the version.
 *
 * Usage: `jiti scripts/worker-oracle.ts [--worker <path to worker.js>] [--obsidian-version <version>] [--per-set <n>]
 * [--seed <n>]`.
 */

import { execFileSync } from 'node:child_process';
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

import type {
  WorkerMetadata,
  WorkerSyntaxDocument,
  WorkerSyntaxOracleFile
} from '../src/oracle/worker-syntax.ts';

import { workerSyntaxOf } from '../src/oracle/worker-syntax.ts';
import { CONFORMANCE_CASES } from '../src/syntax/conformance.ts';
import { format } from './helpers/format.ts';

// The message the app posts to its metadata worker: the document, encoded.
interface WorkerMessage {
  readonly data: WorkerMessageData;
}

interface WorkerMessageData {
  readonly metadataCache: ArrayBuffer;
}

interface WorkerScope {
  onmessage?: (event: WorkerMessage) => void;
  postMessage: (message: unknown) => void;
}

const DEFAULT_PER_SET = 400;
const DEFAULT_SEED = 12_345;
const MAX_LINES = 6;
const FRONTMATTER_ODDS = 8;
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
/* eslint-enable unicorn/prefer-string-repeat -- The piece sets end here. */

// The piece sets: syntax alone, syntax among blocks and lists, and syntax inside quotes.
const SETS: Readonly<Record<string, readonly string[]>> = {
  inline: INLINE,
  mixed: [...GAP, ...RICH, ...INLINE, ...SYNTAX],
  quote: [...SYNTAX, ...INLINE].map((piece) => `> ${piece.replaceAll('\n', '\n> ')}`),
  rich: [...RICH, ...SYNTAX],
  syntax: SYNTAX
};

const { values } = parseArgs({
  options: {
    'obsidian-version': { type: 'string' },
    'per-set': { type: 'string' },
    'seed': { type: 'string' },
    'worker': { type: 'string' }
  }
});

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = values.worker ?? join(repoRoot, '..', 'obsidian-versions', 'obsidian.asar', 'worker.js');
const appVersion = values['obsidian-version'] ?? execFileSync('git', ['describe', '--tags', '--exact-match'], { cwd: dirname(workerPath), encoding: 'utf-8' }).trim();
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

function loadWorker(path: string): (text: string) => WorkerMetadata {
  let last: unknown;
  const scope: WorkerScope = {
    postMessage(message) {
      last = message;
    }
  };
  const context = createContext({ ArrayBuffer, clearTimeout, console, self: scope, setTimeout, TextDecoder, TextEncoder, Uint8Array, URL });
  runInContext('globalThis.window = globalThis;', context);
  runInContext(readFileSync(path, 'utf-8'), context);
  return (text) => {
    last = undefined;
    scope.onmessage?.({ data: { metadataCache: new TextEncoder().encode(text).buffer } });
    return (last ?? {});
  };
}

const docs: WorkerSyntaxDocument[] = Array.from(CONFORMANCE_CASES, (testCase) => ({ set: 'conformance', syntax: workerSyntaxOf(runWorker(testCase.markdown)), text: testCase.markdown }));

for (const [set, pieces] of Object.entries(SETS)) {
  for (let index = 0; index < perSet; index++) {
    const lines: string[] = [];
    const count = 1 + random(MAX_LINES);
    for (let line = 0; line < count; line++) {
      lines.push(pieces[random(pieces.length)] ?? '');
    }
    const frontmatter = random(FRONTMATTER_ODDS) === 0 ? '---\na: 1\n---\n' : '';
    const text = `${frontmatter}${lines.join('\n')}${random(FINAL_LINE_BREAK_ODDS) === 0 ? '' : '\n'}`;
    docs.push({ set, syntax: workerSyntaxOf(runWorker(text)), text });
  }
}

const oracleFile: WorkerSyntaxOracleFile = { docs, meta: { appVersion, perSet, seed } };
const outFile = join(repoRoot, 'oracle', `worker-syntax-obsidian-${appVersion}.json`);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(oracleFile)}\n`);
// The repository's dprint check covers `oracle/`, and its layout is not `JSON.stringify`'s.
await format({ paths: [outFile] });
console.log(`Wrote ${String(docs.length)} documents to ${outFile}`);
