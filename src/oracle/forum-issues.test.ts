import {
  describe,
  expect,
  it
} from 'vitest';

import type { ForumIssueFile } from './forum-issues.ts';

import { parseMetadata } from '../metadata/metadata.ts';
import { forumIssueDocuments } from './forum-issues.ts';
import {
  forumIssueOracleFileName,
  oracleObsidianVersion,
  readOracleFile
} from './oracle-location.ts';
import { compareDocument } from './score.ts';

const ORACLE = readOracleFile(forumIssueOracleFileName()) as ForumIssueFile;

describe('the forum issue oracle', () => {
  it('holds every document once, in order', () => {
    expect(ORACLE.reads.map((read) => read.markdown)).toEqual(forumIssueDocuments());
  });

  it('is the editor\'s classes that the class tokenizer gives, on every character and line of every document', () => {
    const differing = ORACLE.reads.filter((read) => compareDocument({ id: read.markdown, nodes: read.nodes, set: 'forum', text: read.markdown }, { obsidianVersion: oracleObsidianVersion() }).differences.length > 0);
    expect(differing.map((read) => read.markdown)).toEqual([]);
  });

  it('is the metadata that the projection gives on every document', () => {
    const differing = ORACLE.reads.filter((read) => JSON.stringify(parseMetadata(read.markdown)) !== JSON.stringify(read.metadata));
    expect(differing.map((read) => read.markdown)).toEqual([]);
  });
});
