/* eslint-disable import-x/no-nodejs-modules -- The suite runs in Node and reads an oracle fixture from disk. */
import type { Tree } from '@lezer/common';

import { TreeFragment } from '@lezer/common';
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

import type { OracleFile } from '../../oracle/oracle-file.ts';
import type { OutlineEntry } from '../conformance.ts';

import { CORPUS_TEST_TIMEOUT_MS } from '../../oracle/oracle-location.ts';
import { CONFORMANCE_CASES } from '../conformance.ts';
import {
  isObsidianNodeName,
  ObsidianNode
} from '../spec.ts';
import { obsidianParser } from './lezer.ts';

const ORACLE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'oracle', 'obsidian-1.14.5-seed-12345.json');
const EDITED_DOCUMENTS = 400;
const EDIT_SEED = 7;
const RANDOM_MULTIPLIER = 1_103_515_245;
const RANDOM_INCREMENT = 12_345;
const RANDOM_MODULUS = 2 ** 31;
const MAX_DELETED = 3;
const INSERTIONS = ['%%', '$$', '\n', '[[', ']]', '> ', '- [ ] ', '#t ', '==', '---\n', 'x'];

function nodesOf(tree: Tree): string[] {
  const nodes: string[] = [];
  tree.iterate({
    enter(node) {
      nodes.push(`${node.name} ${String(node.from)}-${String(node.to)}`);
    }
  });
  return nodes;
}

function outlineOf(tree: Tree, text: string): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  tree.iterate({
    enter(node) {
      if (isObsidianNodeName(node.name)) {
        outline.push([node.name, text.slice(node.from, node.to)]);
      }
    }
  });
  return outline;
}

describe('obsidianParser', () => {
  for (const testCase of CONFORMANCE_CASES) {
    it(`should pass the conformance case: ${testCase.name}`, () => {
      expect(outlineOf(obsidianParser.parse(testCase.markdown), testCase.markdown)).toEqual(testCase.expected);
    });
  }

  it('should give a callout its title, and its lines after the title as content', () => {
    const text = '> [!note] Title\n> - item\n>\n> body';
    const tree = obsidianParser.parse(text);
    const callout = tree.topNode.firstChild;
    const children: string[] = [];
    for (let child = callout?.firstChild ?? null; child; child = child.nextSibling) {
      children.push(child.name);
    }
    expect(callout?.name).toBe(ObsidianNode.Callout);
    expect(children).toEqual(['QuoteMark', ObsidianNode.CalloutMark, ObsidianNode.CalloutTitle, 'QuoteMark', 'BulletList', 'QuoteMark', 'Paragraph']);
  });

  it('should parse a footnote definition\'s content as markdown', () => {
    const text = '[^1]: a [[link]]\n\n    - item';
    const tree = obsidianParser.parse(text);
    const names: string[] = [];
    tree.iterate({
      enter(node) {
        names.push(node.name);
      }
    });
    expect(names).toEqual(expect.arrayContaining([ObsidianNode.FootnoteDefinition, 'Paragraph', ObsidianNode.InternalLink, 'BulletList', 'ListItem']));
    expect(tree.topNode.firstChild?.to).toBe(text.length);
  });

  it('should give an incremental parse after an edit the tree of a full parse', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const oracle = JSON.parse(readFileSync(ORACLE_FILE, 'utf-8')) as OracleFile;
    let seed = EDIT_SEED;
    function random(n: number): number {
      seed = (seed * RANDOM_MULTIPLIER + RANDOM_INCREMENT) % RANDOM_MODULUS;
      return seed % n;
    }
    for (const document of oracle.docs.slice(0, EDITED_DOCUMENTS)) {
      const before = document.text;
      const tree = obsidianParser.parse(before);
      const from = random(before.length + 1);
      const to = Math.min(before.length, from + random(MAX_DELETED + 1));
      const inserted = INSERTIONS[random(INSERTIONS.length)] ?? '';
      const after = before.slice(0, from) + inserted + before.slice(to);
      const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [{ fromA: from, fromB: from, toA: to, toB: from + inserted.length }]);
      const incremental = obsidianParser.parse(after, fragments);
      expect(nodesOf(incremental), `${document.id}: ${JSON.stringify(after)}`).toEqual(nodesOf(obsidianParser.parse(after)));
    }
  });
});
