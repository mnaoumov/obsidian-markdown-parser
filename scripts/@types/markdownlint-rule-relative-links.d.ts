/**
 * @file
 *
 * The types of `markdownlint-rule-relative-links`, which `tsconfig.json` maps the package to in place of its own.
 *
 * Its own `src/index.d.ts` (5.1.3) does `import type MarkdownIt from "markdown-it"` and uses it as a type, which
 * markdown-it 15's bundled types reject with TS2749: their default export is a value, and the instance type is the
 * named `MarkdownIt` export. `build:compile` reaches that file through `scripts/markdownlint-cli2-config.ts` with
 * `skipLibCheck` off. Delete this file and its `paths` entry once a release of the rule ships types that check
 * against markdown-it 15.
 */

import type { MarkdownIt } from 'markdown-it';
import type { Rule } from 'markdownlint';

declare const relativeLinksRule: Rule;
// eslint-disable-next-line import-x/no-default-export -- The package's own entry point exports the rule as its default.
export default relativeLinksRule;

export declare const markdownIt: MarkdownIt;
