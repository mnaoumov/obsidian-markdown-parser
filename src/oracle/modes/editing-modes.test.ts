import {
  describe,
  expect,
  it
} from 'vitest';

import type { EditingModesFile } from './editing-modes.ts';

import { parseMetadata } from '../../metadata/metadata.ts';
import { compareDocument } from '../classes/score.ts';
import {
  CORPUS_TEST_TIMEOUT_MS,
  editingModesOracleFileName,
  oracleObsidianVersion,
  readOracleFile
} from '../oracle-location.ts';
import { editingModesDocuments } from './editing-modes.ts';
import { familyOf } from './mode-families.ts';
import { JUDGED_SAMPLES } from './mode-judge-samples.ts';
import {
  differenceKey,
  judgeModes,
  reduceDifference
} from './mode-judge.ts';

const ORACLE = readOracleFile(editingModesOracleFileName()) as EditingModesFile;

describe('the editing mode oracle', () => {
  it('holds every document once, in order', () => {
    expect(ORACLE.reads.map((read) => [read.id, read.set, read.markdown])).toEqual(editingModesDocuments().map((document) => [document.id, document.set, document.markdown]));
  });

  it('is the editor\'s classes that the class tokenizer gives, on every character and line of every document', () => {
    const differing = ORACLE.reads.filter((read) => compareDocument({ id: read.id, nodes: read.nodes, set: read.set, text: read.markdown }, { obsidianVersion: oracleObsidianVersion() }).differences.length > 0);
    expect(differing.map((read) => read.id)).toEqual([]);
  }, CORPUS_TEST_TIMEOUT_MS);

  it('is the metadata that the projection gives on every document', () => {
    const differing = ORACLE.reads.filter((read) => JSON.stringify(parseMetadata(read.markdown, { obsidianVersion: oracleObsidianVersion() })) !== JSON.stringify(read.metadata));
    expect(differing.map((read) => read.id)).toEqual([]);
  }, CORPUS_TEST_TIMEOUT_MS);

  it('confirms every judged sample on the live editor\'s tree: a difference of its family is still there', () => {
    const unconfirmed = JUDGED_SAMPLES.filter((sample) => {
      const read = ORACLE.reads.find((candidate) => candidate.id === sample.id);
      if (read === undefined) {
        return true;
      }
      const keys = new Set(judgeModes(read.markdown, read.nodes).map((difference) => differenceKey(difference)));
      return [...keys].every((key) => familyOf(key, reduceDifference(read.markdown, key))?.id !== sample.family);
    });
    expect(unconfirmed.map((sample) => sample.id)).toEqual([]);
  });
});
