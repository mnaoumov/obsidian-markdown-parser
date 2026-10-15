/* eslint-disable import-x/no-nodejs-modules -- The test runs in Node and reads the oracles from disk. */
import { readFileSync } from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules -- Only the fixture imports above need Node. */
import {
  describe,
  expect,
  it
} from 'vitest';

import type { CachedMetadata } from '../metadata/types.ts';
import type { SpecOracleFile } from './spec-oracle-file.ts';
import type { WorkerMetadataOracleFile } from './worker-metadata.ts';

import { parseMetadata } from '../metadata/metadata.ts';
import { exampleKey } from './spec-quirks.ts';

const ORACLE_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle');
const WORKER_ORACLE = JSON.parse(readFileSync(join(ORACLE_DIRECTORY, 'worker-metadata-obsidian-1.14.4.json'), 'utf-8')) as WorkerMetadataOracleFile;
const SPEC_ORACLE = JSON.parse(readFileSync(join(ORACLE_DIRECTORY, 'spec-obsidian-1.14.4.json'), 'utf-8')) as SpecOracleFile;

describe('the CachedMetadata projection', () => {
  it('gives the metadata worker\'s whole metadata on every document of the worker oracle', () => {
    const differing = WORKER_ORACLE.docs.filter((document) => JSON.stringify(parseMetadata(document.text)) !== JSON.stringify(document.metadata));
    expect(differing.map((document) => document.text)).toEqual([]);
  });

  it('gives the live app\'s whole metadata on every spec example', () => {
    const differing = SPEC_ORACLE.examples.filter((read) => JSON.stringify(parseMetadata(read.markdown)) !== JSON.stringify(read.metadata));
    expect(differing.map((read) => exampleKey(read))).toEqual([]);
  });

  it('holds every field of the metadata, and every artefact of the worker, in the worker oracle', () => {
    const all = WORKER_ORACLE.docs.map((document) => document.metadata);
    const metadata = all.filter((item): item is CachedMetadata => item !== null);
    expect(all.includes(null)).toBe(true);
    for (const field of ['links', 'embeds', 'tags', 'headings', 'footnotes', 'footnoteRefs', 'referenceLinks', 'listItems', 'blocks', 'frontmatter', 'frontmatterPosition'] as const) {
      expect(metadata.some((item) => item[field] !== undefined)).toBe(true);
    }
    expect(metadata.some((item) => (item.frontmatterLinks?.length ?? 0) > 0)).toBe(true);
    expect(metadata.some((item) => (item.links ?? []).some((link) => !link.original.startsWith('[[')))).toBe(true);
    expect(metadata.some((item) => (item.embeds ?? []).some((embed) => !embed.original.startsWith('![[')))).toBe(true);
    expect(metadata.some((item) => (item.links ?? []).some((link) => link.displayText.includes('\n')))).toBe(true);
    expect(metadata.some((item) => (item.footnotes ?? []).some((footnote) => footnote.id.startsWith('[inline')))).toBe(true);
    for (const type of ['comment', 'math', 'yaml', 'footnoteDefinition', 'callout', 'element']) {
      expect(metadata.some((item) => (item.sections ?? []).some((section) => section.type === type))).toBe(true);
    }
  });
});
