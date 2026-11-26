/**
 * @file
 *
 * Builds the documentation site into `docs/dist`: the guides from `docs/*.md`, the API reference, the Open Graph
 * cards and every link check, with the shared site of `@mnaoumov/typescript-dev-toolkit`.
 *
 * Usage: `npm run docs:build`.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { buildDocsSite } from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-site-commands';

import { generateGuides } from './docs-guides.ts';
import { generatePublicApiBarrel } from './docs-public-api.ts';
import { DOCS_SITE_CONFIG } from './docs-site-config.ts';

await wrapCliTask(async () => {
  const root = process.cwd().replaceAll('\\', '/');
  generateGuides(root);
  generatePublicApiBarrel(root);
  await buildDocsSite(DOCS_SITE_CONFIG);
});
