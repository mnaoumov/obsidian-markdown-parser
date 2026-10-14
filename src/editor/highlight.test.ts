/* eslint-disable import-x/no-nodejs-modules -- The suite runs in Node and reads the oracle fixtures from disk. */
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

import type { OracleFile } from '../oracle/oracle-file.ts';
import type { LineState } from './highlight.ts';

import {
  compareCodeUnits,
  compareDocument
} from '../oracle/score.ts';
import {
  highlight,
  highlightLines
} from './highlight.ts';

const ORACLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oracle');

/*
 * The documents each oracle still disagrees on. A change that fixes one must remove it here, and a change that
 * breaks another fails the suite.
 */
const KNOWN_DIFFERENCES = new Map<string, readonly string[]>([
  ['obsidian-1.14.4-seed-12345.json', ['inline-83']],
  ['obsidian-1.14.4-seed-4242.json', ['inline-34', 'inline-206']],
  ['obsidian-1.14.4-seed-777.json', ['inline-280']]
]);

function readOracle(name: string): OracleFile {
  return JSON.parse(readFileSync(join(ORACLE_DIR, name), 'utf-8')) as OracleFile;
}

describe('highlight', () => {
  for (const [name, known] of KNOWN_DIFFERENCES) {
    it(`should match the live editor on every document of ${name} but the known differences`, () => {
      const oracle = readOracle(name);
      const differing = oracle.docs.filter((document) => compareDocument(document).differences.length > 0).map((document) => document.id);
      expect(differing).toEqual(known);
    });
  }

  it('should give a line its classes and a span its token classes', () => {
    const [heading, quote] = highlight('# Title\n> quote');
    expect(heading?.classes).toEqual(['HyperMD-header', 'HyperMD-header-1']);
    expect(heading?.spans.map((s) => [s.from, s.to, s.classes.toSorted(compareCodeUnits).join(' ')])).toEqual([
      [0, 2, 'formatting formatting-header formatting-header-1 header header-1'],
      [2, 7, 'header header-1']
    ]);
    expect(quote?.classes).toEqual(['HyperMD-quote', 'HyperMD-quote-1']);
  });

  it('should resume from the state after any line with the same result', () => {
    const oracle = readOracle('obsidian-1.14.4-seed-12345.json');
    for (const document of oracle.docs) {
      const lines = document.text.split('\n');
      const states: LineState[] = [];
      const full = highlightLines({
        lines,
        onLineEnd: (lineIndex, state) => {
          states[lineIndex] = state;
        }
      });
      for (let k = 0; k < lines.length - 1; k++) {
        const resumed = highlightLines({ lines, startLine: k + 1, ...(states[k] && { state: states[k] }) });
        expect(resumed).toEqual(full.slice(k + 1));
      }
    }
  });
});
