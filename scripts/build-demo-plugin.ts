/**
 * @file
 *
 * Builds the private demo plugin (`src/demo-plugin/`) into `dist/demo-plugin/`: `main.js` and `manifest.json`, ready
 * to copy into a vault's `.obsidian/plugins/markdown-parser-demo/`. The plugin is never published.
 *
 * Obsidian hands a plugin its own copies of the `@codemirror/*` and `@lezer/*` packages it runs, and the parser must use those,
 * so they stay external; `@codemirror/streamparser` is not among them and is bundled. CodeMirror 5's modes are bundled: `src/editor/sub-modes.ts` loads them with Node's `require`, through
 * `runmode.node.js` standing in for the full CodeMirror 5 library. In the bundle `node:module` becomes a table of the
 * mode files, and every mode's `require` of the library resolves to `runmode.node.js`, which is what the require cache
 * trick does in Node.
 *
 * Usage: `jiti scripts/build-demo-plugin.ts [--watch]`.
 */

import type { Plugin } from 'esbuild';

import {
  build,
  context
} from 'esbuild';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { compareCodeUnits } from '../src/oracle/score.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDirectory = join(root, 'dist', 'demo-plugin');
const codeMirror5Directory = join(root, 'node_modules', 'codemirror');
const runModePath = join(codeMirror5Directory, 'addon', 'runmode', 'runmode.node.js');
const LIBRARY_REQUIRE_RE = /^(?:\.\.\/)+lib\/codemirror(?:\.js)?$/u;
const REQUIRE_CACHE_LINE_RE = /^require\.cache\[.*$/gmu;

const { values } = parseArgs({ options: { watch: { default: false, type: 'boolean' } } });

const codeMirror5Plugin: Plugin = {
  name: 'codemirror5-modes',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: goFilter(/^node:module$/u) }, () => ({ namespace: 'codemirror5-require', path: 'node:module' }));
    // eslint-disable-next-line unicorn/name-replacements -- esbuild's option name.
    pluginBuild.onLoad({ filter: goFilter(/.*/u), namespace: 'codemirror5-require' }, () => ({ contents: codeMirror5RequireModule(), loader: 'js', resolveDir: root }));
    pluginBuild.onResolve({ filter: goFilter(LIBRARY_REQUIRE_RE) }, (parameters) => (parameters.resolveDir.startsWith(codeMirror5Directory) ? { path: runModePath } : undefined));
    // The require cache trick has nothing to do in a bundle, where every mode's `require` of the library already resolves here.
    pluginBuild.onLoad({ filter: goFilter(/runmode\.node\.js$/u) }, (parameters) => ({ contents: readFileSync(parameters.path, 'utf-8').replaceAll(REQUIRE_CACHE_LINE_RE, ''), loader: 'js' }));
  }
};

const options = {
  bundle: true,
  // `sub-modes.ts` hands `import.meta.url` to `createRequire`, which the bundle's table ignores.
  define: { 'import.meta.url': '""' },
  entryPoints: [join(root, 'src', 'demo-plugin', 'main.ts')],
  external: ['obsidian', 'electron', ...['autocomplete', 'collab', 'commands', 'language', 'lint', 'search', 'state', 'view'].map((name) => `@codemirror/${name}`), '@lezer/common', '@lezer/highlight', '@lezer/lr'],
  format: 'cjs' as const,
  logLevel: 'info' as const,
  outfile: join(outDirectory, 'main.js'),
  platform: 'browser' as const,
  plugins: [codeMirror5Plugin],
  sourcemap: 'inline' as const,
  target: 'es2024'
};

mkdirSync(outDirectory, { recursive: true });
copyFileSync(join(root, 'src', 'demo-plugin', 'manifest.json'), join(outDirectory, 'manifest.json'));
if (values.watch) {
  const buildContext = await context(options);
  await buildContext.watch();
} else {
  await build(options);
}

// A module whose `createRequire` gives a `require` that loads the mode files `sub-modes.ts` asks for from the bundle.
function codeMirror5RequireModule(): string {
  const ids = ['codemirror/addon/runmode/runmode.node.js', 'codemirror/mode/meta.js'];
  const names = readdirSync(join(codeMirror5Directory, 'mode')).toSorted(compareCodeUnits);
  for (const name of names) {
    if (existsSync(join(codeMirror5Directory, 'mode', name, `${name}.js`))) {
      ids.push(`codemirror/mode/${name}/${name}.js`);
    }
  }
  const entries = ids.map((id) => `  ${JSON.stringify(id)}: () => require(${JSON.stringify(id)})`).join(',\n');
  return [
    `const modules = {\n${entries}\n};`,
    'export function createRequire() {',
    '  return (id) => {',
    '    const load = modules[id];',
    '    if (!load) {',
    '      throw new Error(\'Cannot find module \' + id);',
    '    }',
    '    return load();',
    '  };',
    '}',
    ''
  ].join('\n');
}

// The esbuild bundler runs a filter as a Go regular expression, which takes no flags: the pattern is passed without its `u`.
function goFilter(pattern: RegExp): RegExp {
  return new RegExp(pattern.source);
}
