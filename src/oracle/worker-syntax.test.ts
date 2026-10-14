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

import type { SpecOracleFile } from './spec-oracle-file.ts';
import type {
  WorkerMetadata,
  WorkerSyntaxOracleFile
} from './worker-syntax.ts';

import { parseRemark } from '../remark/parse.ts';
import { exampleKey } from './spec-quirks.ts';
import {
  engineSyntaxOf,
  workerSyntaxOf
} from './worker-syntax.ts';

const ORACLE_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle');
const WORKER_ORACLE = JSON.parse(readFileSync(join(ORACLE_DIRECTORY, 'worker-syntax-obsidian-1.14.4.json'), 'utf-8')) as WorkerSyntaxOracleFile;
const SPEC_ORACLE = JSON.parse(readFileSync(join(ORACLE_DIRECTORY, 'spec-obsidian-1.14.4.json'), 'utf-8')) as SpecOracleFile;

describe('the Obsidian syntax of the remark-parse 8 engine', () => {
  it('gives the metadata worker\'s nodes and positions on every document of the worker oracle', () => {
    const differing = WORKER_ORACLE.docs.filter((document) => JSON.stringify(engineSyntaxOf(document.text, parseRemark(document.text))) !== JSON.stringify(document.syntax));
    expect(differing.map((document) => document.text)).toEqual([]);
  });

  it('gives the live app\'s metadata on every spec example', () => {
    const differing = SPEC_ORACLE.examples.filter((read) => {
      const engine = engineSyntaxOf(read.markdown, parseRemark(read.markdown));
      return JSON.stringify(engine) !== JSON.stringify(workerSyntaxOf(read.metadata as WorkerMetadata));
    });
    expect(differing.map((read) => exampleKey(read))).toEqual([]);
  });

  it('holds every construct of the syntax in the worker oracle', () => {
    const syntax = WORKER_ORACLE.docs.map((document) => document.syntax);
    expect(syntax.some((document) => document.links.length > 0)).toBe(true);
    expect(syntax.some((document) => document.embeds.length > 0)).toBe(true);
    expect(syntax.some((document) => document.tags.length > 0)).toBe(true);
    expect(syntax.some((document) => document.footnotes.some(([id]) => id.startsWith('[inline')))).toBe(true);
    expect(syntax.some((document) => document.footnoteReferences.length > 0)).toBe(true);
    expect(syntax.some((document) => document.blocks.length > 0)).toBe(true);
    for (const type of ['comment', 'math', 'yaml', 'footnoteDefinition', 'callout', 'element']) {
      expect(syntax.some((document) => document.sections.some(([section]) => section === type))).toBe(true);
    }
  });
});
