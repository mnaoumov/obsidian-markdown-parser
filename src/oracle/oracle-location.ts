/**
 * @file
 *
 * Where the oracle files live and which Obsidian version they were read from.
 *
 * The suites read the version pinned here. `ORACLE_OBSIDIAN_VERSION` and `ORACLE_DIRECTORY` point the suites that check
 * the parser against Obsidian at another version's oracles instead, which is how `scripts/oracle-drift.ts` asks whether
 * the parser still matches a newer Obsidian.
 */

/* eslint-disable import-x/no-nodejs-modules -- The oracles are files read from disk in Node. */
import {
  readdirSync,
  readFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules -- Only the imports above need Node. */

/**
 * The Obsidian version every oracle file in `oracle/` was read from.
 */
export const PINNED_OBSIDIAN_VERSION = '1.14.5';

/**
 * The seed of the class-span oracle the suites use where one is enough.
 */
export const MAIN_CLASS_ORACLE_SEED = 12_345;

/**
 * The timeout of a test that runs a whole corpus: an oracle file, a spec suite or a long run of random edits. Such a test
 * takes up to about 2 s on an idle machine and over a minute on a loaded one, far past vitest's default of 5000 ms. A
 * quick test keeps that default, so it still fails fast when it hangs.
 */
export const CORPUS_TEST_TIMEOUT_MS = 300_000;

/**
 * The environment variable that names the Obsidian version the suites read their oracles from.
 */
export const ORACLE_VERSION_VARIABLE = 'ORACLE_OBSIDIAN_VERSION';

/**
 * The environment variable that names the directory the suites read their oracles from.
 */
export const ORACLE_DIRECTORY_VARIABLE = 'ORACLE_DIRECTORY';

/**
 * The repository's own oracle directory.
 */
export const PINNED_ORACLE_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle');

/**
 * The seeds of the pinned class-span oracles, one file each, in ascending order. An oracle of another version is read
 * for the same seeds.
 */
export const CLASS_ORACLE_SEEDS: readonly number[] = readdirSync(PINNED_ORACLE_DIRECTORY)
  .map((name) => /^obsidian-(?<version>.+)-seed-(?<seed>\d+)\.json$/.exec(name)?.groups)
  .filter((groups) => groups?.['version'] === PINNED_OBSIDIAN_VERSION)
  .map((groups) => Number(groups?.['seed']))
  .toSorted((a, b) => a - b);

/**
 * The name of a class-span oracle file.
 *
 * @param seed - The corpus seed.
 * @param version - The Obsidian version.
 * @returns The file name.
 */
export function classOracleFileName(seed: number, version = oracleObsidianVersion()): string {
  return `obsidian-${version}-seed-${String(seed)}.json`;
}

/**
 * The name of an editing mode oracle file.
 *
 * @param version - The Obsidian version.
 * @returns The file name.
 */
export function editingModesOracleFileName(version = oracleObsidianVersion()): string {
  return `editing-modes-obsidian-${version}.json`;
}

/**
 * The name of a forum issue oracle file.
 *
 * @param version - The Obsidian version.
 * @returns The file name.
 */
export function forumIssueOracleFileName(version = oracleObsidianVersion()): string {
  return `forum-issues-obsidian-${version}.json`;
}

/**
 * The name of a link parity oracle file.
 *
 * @param version - The Obsidian version.
 * @returns The file name.
 */
export function linkParityOracleFileName(version = oracleObsidianVersion()): string {
  return `link-parity-obsidian-${version}.json`;
}

/**
 * The name of a live surface oracle file.
 *
 * @param version - The Obsidian version.
 * @returns The file name.
 */
export function liveSurfacesOracleFileName(version = oracleObsidianVersion()): string {
  return `live-surfaces-obsidian-${version}.json`;
}

/**
 * The directory the suites read their oracles from.
 *
 * @returns The directory.
 */
export function oracleDirectory(): string {
  return process.env[ORACLE_DIRECTORY_VARIABLE] ?? PINNED_ORACLE_DIRECTORY;
}

/**
 * The Obsidian version the suites read their oracles from.
 *
 * @returns The version.
 */
export function oracleObsidianVersion(): string {
  return process.env[ORACLE_VERSION_VARIABLE] ?? PINNED_OBSIDIAN_VERSION;
}

/**
 * The name of a quirk probe oracle file.
 *
 * @param version - The Obsidian version.
 * @returns The file name.
 */
export function quirkProbeOracleFileName(version = oracleObsidianVersion()): string {
  return `quirk-probes-obsidian-${version}.json`;
}

/**
 * Reads an oracle file.
 *
 * @param fileName - The file name.
 * @param directory - The directory it is in.
 * @returns The parsed file.
 */
export function readOracleFile(fileName: string, directory = oracleDirectory()): unknown {
  return JSON.parse(readFileSync(join(directory, fileName), 'utf-8'));
}

/**
 * The name of a spec oracle file.
 *
 * @param version - The Obsidian version.
 * @returns The file name.
 */
export function specOracleFileName(version = oracleObsidianVersion()): string {
  return `spec-obsidian-${version}.json`;
}

/**
 * The name of a metadata worker oracle file.
 *
 * @param version - The Obsidian version.
 * @returns The file name.
 */
export function workerMetadataOracleFileName(version = oracleObsidianVersion()): string {
  return `worker-metadata-obsidian-${version}.json`;
}
