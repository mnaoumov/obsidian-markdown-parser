/**
 * @file
 *
 * This repository's documentation site, shared by `astro.config.ts` and the `docs:*` scripts.
 */

import type { DocsSiteConfig } from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-site-config';

/**
 * The flat barrel of the public API that `scripts/docs/docs-public-api.ts` writes, relative to the repository root.
 */
export const PUBLIC_API_BARREL = 'docs/src/generated-public-api.ts';

export const DOCS_SITE_CONFIG: DocsSiteConfig = {
  apiIndexIntro: [
    'Every export of `@mnaoumov/obsidian-markdown-parser`, which its root entry re-exports from the narrower entry points',
    '`./editor`, `./lezer`, `./mdast`, `./markdown-it`, `./syntax`, `./remark` and `./metadata`.',
    '',
    'The `./remark` and `./metadata` exports are also published on their own, without the editor or CodeMirror',
    'dependencies, as `@mnaoumov/obsidian-markdown-parser-metadata`. The [API overview](/obsidian-markdown-parser/guides/api/)',
    'says which entry point and which package each one comes from.'
  ].join('\n'),
  publicApiEntry: PUBLIC_API_BARREL,
  repo: 'obsidian-markdown-parser',
  repoHomepage: 'set',
  title: 'obsidian-markdown-parser'
};
