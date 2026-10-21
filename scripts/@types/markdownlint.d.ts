/**
 * @file
 *
 * The types of `markdownlint`, which `tsconfig.json` maps the package to in place of its own.
 *
 * Its own entry point `lib/exports.d.mts` (0.42.0) re-exports `resolveModule` from `lib/resolve-module.d.cts`, which
 * mixes `export =` with named type exports and is rejected with TS2309. `build:compile` reaches that file through
 * `scripts/markdownlint-cli2-config.ts`, whose `@mnaoumov/typescript-dev-toolkit` config schema imports `Rule` from
 * the package, with `skipLibCheck` off. `Rule` is all this repo's type graph takes from the package, so this file
 * re-exports it from `lib/markdownlint.d.mts`, which checks. Delete this file and its `paths` entry once a release of
 * the package ships a `resolve-module.d.cts` that checks.
 */

// eslint-disable-next-line import-x/no-relative-packages -- The package's export map exposes no subpath for this file.
export type { Rule } from '../../node_modules/markdownlint/lib/markdownlint.mjs';
