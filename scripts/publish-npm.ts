/**
 * @file
 *
 * The npm publish entry point `.github/workflows/publish-npm.yml` runs: publishes the whole parser and then the
 * metadata package, under the `beta` dist-tag for a pre-release and `latest` otherwise. Both share the root
 * package's version.
 *
 * A package whose version is already on npm is skipped, so a re-run of the workflow after a partial or manual
 * publish (the first version of each package is published by hand, because npm trusted publishing cannot create a
 * package) publishes only what is missing.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { readPackageJson } from '@mnaoumov/typescript-dev-toolkit/npm';
import { publish } from '@mnaoumov/typescript-dev-toolkit/npm-publish';
import { execFromRoot } from '@mnaoumov/typescript-dev-toolkit/root';
import { isPreRelease } from '@mnaoumov/typescript-dev-toolkit/version';

const METADATA_PACKAGE_NAME = '@mnaoumov/obsidian-markdown-parser-metadata';

await wrapCliTask(async () => {
  const { name, version } = await readPackageJson();
  if (!name || !version) {
    throw new Error('package.json declares no name or no version.');
  }
  const isBeta = isPreRelease(version);

  if (await isVersionPublished(name, version)) {
    console.warn(`${name}@${version} is already on npm; skipping it.`);
  } else {
    await publish(isBeta);
  }

  if (await isVersionPublished(METADATA_PACKAGE_NAME, version)) {
    console.warn(`${METADATA_PACKAGE_NAME}@${version} is already on npm; skipping it.`);
  } else {
    await execFromRoot(['npm', 'publish', '--workspace', 'packages/metadata', '--tag', isBeta ? 'beta' : 'latest']);
  }
});

async function isVersionPublished(packageName: string, version: string): Promise<boolean> {
  // `npm view` prints the version when it exists and fails with E404 for a missing version or package.
  const result = await execFromRoot(['npm', 'view', `${packageName}@${version}`, 'version'], {
    isQuiet: true,
    shouldIgnoreExitCode: true,
    shouldIncludeDetails: true
  });
  return result.exitCode === 0 && result.stdout.trim() === version;
}
