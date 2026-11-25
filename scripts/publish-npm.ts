/**
 * @file
 *
 * The npm publish entry point `.github/workflows/publish-npm.yml` runs: publishes the whole parser and then the
 * metadata package, under the `beta` dist-tag for a pre-release and `latest` otherwise. Both share the root
 * package's version.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { readPackageJson } from '@mnaoumov/typescript-dev-toolkit/npm';
import { publish } from '@mnaoumov/typescript-dev-toolkit/npm-publish';
import { execFromRoot } from '@mnaoumov/typescript-dev-toolkit/root';
import { isPreRelease } from '@mnaoumov/typescript-dev-toolkit/version';

await wrapCliTask(async () => {
  const { version } = await readPackageJson();
  if (!version) {
    throw new Error('package.json declares no version.');
  }
  const isBeta = isPreRelease(version);
  await publish(isBeta);
  await execFromRoot(['npm', 'publish', '--workspace', 'packages/metadata', '--tag', isBeta ? 'beta' : 'latest']);
});
