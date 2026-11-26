/**
 * @file
 *
 * Serves the documentation site with `astro dev`, after generating the guides from `docs/*.md`. A change to a page
 * under `docs/` needs a restart.
 *
 * Usage: `npm run docs:dev`, or `npm run docs:dev -- --port 4399`.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { devDocsSite } from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-site-commands';

import { generateGuides } from './docs-guides.ts';
import { generatePublicApiBarrel } from './docs-public-api.ts';
import { DOCS_SITE_CONFIG } from './docs-site-config.ts';

await wrapCliTask(async () => {
  const root = process.cwd().replaceAll('\\', '/');
  generateGuides(root);
  generatePublicApiBarrel(root);
  await devDocsSite(DOCS_SITE_CONFIG);
});
