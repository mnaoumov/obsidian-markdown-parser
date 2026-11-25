/**
 * @file
 *
 * The release entry point: `npm run version -- <type> [flags]`.
 *
 * The generic release bumps the version, settles `CHANGELOG.md`, commits, tags, pushes and creates the GitHub
 * release. The two packages always share one version, so the metadata package's `package.json` (and its lockfile
 * entry) take the new version in the same release commit. The release carries no assets: both packages are
 * distributed through npm, which `.github/workflows/publish-npm.yml` publishes to from a fresh build when the
 * release is published.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { execFromRoot } from '@mnaoumov/typescript-dev-toolkit/root';
import {
  parseVersionArguments,
  updateVersion
} from '@mnaoumov/typescript-dev-toolkit/version';
import process from 'node:process';

await wrapCliTask(async () => {
  const [, , ...versionArguments] = process.argv;
  const { options, versionUpdateType } = parseVersionArguments(versionArguments);
  await updateVersion(versionUpdateType, {
    ...options,
    getReleaseAssetPaths: () => Promise.resolve([]),
    updateVersionInExtraFiles: updateMetadataPackageVersion
  });
});

async function updateMetadataPackageVersion(newVersion: string): Promise<void> {
  await execFromRoot(['npm', 'version', newVersion, '--workspace', 'packages/metadata', '--no-git-tag-version', '--allow-same-version']);
}
