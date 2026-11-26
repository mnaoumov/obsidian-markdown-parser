/**
 * @file
 *
 * Builds both packages: the whole parser into `dist/lib/` (`tsconfig.build.json`) and the metadata package into
 * `packages/metadata/dist/` (`packages/metadata/tsconfig.build.json`), each as ES modules with declarations, and
 * copies `LICENSE` and `THIRD-PARTY-NOTICES.md` into the metadata package. Nothing here publishes: `scripts/publish-npm.ts` does,
 * from CI.
 *
 * Usage: `npm run build`, then `npm pack` and `npm pack --workspace packages/metadata` give the tarballs.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { resolveToolCommand } from '@mnaoumov/typescript-dev-toolkit/package-manager';
import {
  execFromRoot,
  getRootFolder
} from '@mnaoumov/typescript-dev-toolkit/root';
import {
  copyFileSync,
  rmSync
} from 'node:fs';
import { join } from 'node:path/posix';

await wrapCliTask(main);

async function main(): Promise<void> {
  const root = getRootFolder();

  if (!root) {
    throw new Error('Could not find root folder');
  }

  const metadataPackageFolder = join(root, 'packages', 'metadata');
  rmSync(join(root, 'dist', 'lib'), { force: true, recursive: true });
  rmSync(join(metadataPackageFolder, 'dist'), { force: true, recursive: true });

  await execFromRoot([...resolveToolCommand({ tool: 'tsc' }), '--project', 'tsconfig.build.json']);
  await execFromRoot([...resolveToolCommand({ tool: 'tsc' }), '--project', 'packages/metadata/tsconfig.build.json']);
  for (const fileName of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    copyFileSync(join(root, fileName), join(metadataPackageFolder, fileName));
  }
}
