import {
  describe,
  expect,
  it
} from 'vitest';

import type { LinkCasesFile } from './link-cases.ts';

import { parseMetadata } from '../metadata/metadata.ts';
import {
  judgeLinkCases,
  LINK_CASES
} from './link-cases.ts';
import {
  linkCasesOracleFileName,
  readOracleFile
} from './oracle-location.ts';

// Every link that does not reach its file, by case and link: a link that starts or stops failing fails the suite.
const FAILURES: readonly string[] = [
  'folder-root-collision: [x](A.md)',
  'extensionless: [[file]]',
  'extensionless: [x](file)',
  'extensionless: ![[file]]',
  'extensionless: [[link-cases/extensionless/file]]',
  'extensionless-generated: [[link-cases/extensionless/file]]',
  'extensionless-generated: [](link-cases/extensionless/file)',
  'merge-relative-links: ![](../assets/i.png)',
  'merge-relative-links: ![](./j.png)',
  'merge-relative-links: [[../assets/i.png]]'
];

const file = readOracleFile(linkCasesOracleFileName()) as LinkCasesFile;
const verdicts = judgeLinkCases(file);

describe('link cases', () => {
  it('fails on exactly the known links', () => {
    const failures: string[] = [];
    for (const { id } of LINK_CASES) {
      const caseVerdicts = verdicts.get(id) ?? [];
      for (const verdict of caseVerdicts) {
        if (verdict.status === 'fails') {
          failures.push(`${id}: ${verdict.original}`);
        }
      }
    }
    expect(failures).toEqual(FAILURES);
  });

  it('sends a wikilink to the root note of a shared name by design', () => {
    expect(verdicts.get('folder-root-collision')?.map(({ status }) => status)).toEqual(['expected', 'fails', 'ok', 'ok']);
  });

  it('caches as many links as each case expects', () => {
    for (const linkCase of LINK_CASES) {
      expect(file.reads[linkCase.id]?.links.length, linkCase.id).toBe(linkCase.expected.length);
    }
  });

  it('gives the cached links of every case\'s note', () => {
    for (const { id } of LINK_CASES) {
      const read = file.reads[id];
      const metadata = parseMetadata(read?.text ?? '');
      const links = [...metadata?.links ?? [], ...metadata?.embeds ?? []]
        .toSorted((a, b) => a.position.start.offset - b.position.start.offset)
        .map(({ link, original }) => [link, original]);
      expect(links, id).toEqual(read?.links.map(({ link, original }) => [link, original]));
    }
  });
});
