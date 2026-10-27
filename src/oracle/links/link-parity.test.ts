import {
  describe,
  expect,
  it
} from 'vitest';

import type { LinkParityFile } from './link-parity.ts';

import { parseMetadata } from '../../metadata/metadata.ts';
import { compareCodeUnits } from '../classes/score.ts';
import {
  linkParityOracleFileName,
  readOracleFile
} from '../oracle-location.ts';
import {
  HEADING_COLLISIONS,
  judgeLinkParity,
  linkParityCases
} from './link-parity.ts';

// Every subject one format cannot express, or neither can: a subject that changes verdict, or a new one, fails the suite.
const GAPS: readonly string[] = [
  'target x[[y: wikilink-gap',
  'target x]]y: wikilink-gap',
  'target x#y: neither',
  'target #x: neither',
  'target x#^y: neither',
  'target  x: markdown-gap',
  'target x&#35;y: neither',
  'target x y: not-indexed',
  'display a]]b: wikilink-gap',
  'display a[[b: wikilink-gap',
  'display   a: wikilink-gap',
  'display a  : wikilink-gap',
  'display [[t]]: wikilink-gap'
];

// Every link Obsidian writes that misses what it was written for.
const WRITTEN_FAILURES: readonly string[] = [
  'target x[y: autocomplete markdown wrong-text',
  'target x[y: api markdown wrong-text',
  'target x]y: autocomplete markdown wrong-target',
  'target x]y: api markdown wrong-target',
  'target x[[y: autocomplete wikilink wrong-target',
  'target x[[y: autocomplete markdown wrong-text',
  'target x[[y: api wikilink wrong-target',
  'target x[[y: api markdown wrong-text',
  'target x]]y: autocomplete wikilink wrong-target',
  'target x]]y: autocomplete markdown wrong-target',
  'target x]]y: api wikilink wrong-target',
  'target x]]y: api markdown wrong-target',
  'target x#y: autocomplete wikilink wrong-target',
  'target x#y: autocomplete markdown wrong-target',
  'target x#y: api wikilink wrong-target',
  'target x#y: api markdown wrong-target',
  'target #x: autocomplete wikilink wrong-target',
  'target #x: autocomplete markdown wrong-target',
  'target #x: api wikilink wrong-target',
  'target #x: api markdown wrong-target',
  'target ^x: autocomplete markdown wrong-text',
  'target ^x: api markdown wrong-text',
  'target x#^y: autocomplete wikilink wrong-target',
  'target x#^y: autocomplete markdown wrong-target',
  'target x#^y: api wikilink wrong-target',
  'target x#^y: api markdown wrong-target',
  'target x%y: autocomplete markdown wrong-target',
  'target x%y: api markdown wrong-target',
  'target x%%y: autocomplete markdown wrong-target',
  'target x%%y: api markdown wrong-target',
  'target x%%y%%z: autocomplete markdown wrong-target',
  'target x%%y%%z: api markdown wrong-target',
  'target x(y: autocomplete markdown wrong-target',
  'target x(y: api markdown wrong-target',
  'target x)y: autocomplete markdown wrong-target',
  'target x)y: api markdown wrong-target',
  'target x==y==z: autocomplete markdown wrong-text',
  'target x==y==z: api markdown wrong-text',
  'target x~~y~~z: autocomplete markdown wrong-text',
  'target x~~y~~z: api markdown wrong-text',
  'target  x: autocomplete wikilink wrong-target',
  'target  x: autocomplete markdown wrong-target',
  'target  x: api wikilink wrong-target',
  'target  x: api markdown wrong-target',
  'target x&amp;y: autocomplete markdown wrong-target',
  'target x&amp;y: api markdown wrong-target',
  'target x&#35;y: autocomplete wikilink wrong-target',
  'target x&#35;y: autocomplete markdown wrong-target',
  'target x&#35;y: api wikilink wrong-target',
  'target x&#35;y: api markdown wrong-target',
  'target x y: autocomplete wikilink not-offered',
  'target x y: autocomplete markdown not-offered',
  'target x y: api wikilink not-offered',
  'target x y: api markdown not-offered',
  'heading a[[b]]c: autocomplete markdown wrong-target',
  'heading a[[b]]c: api wikilink wrong-target',
  'heading a]]b: autocomplete markdown wrong-target',
  'heading a]]b: api wikilink wrong-target',
  'heading a]b: autocomplete markdown wrong-target',
  'heading a|b: api wikilink wrong-target',
  'heading a#b: api wikilink wrong-target',
  'heading a#b: api markdown wrong-target',
  'heading a%b: autocomplete markdown wrong-target',
  'heading a%b: api markdown wrong-target',
  'heading a%%b%%c: api markdown wrong-target',
  'heading a:b: api markdown wrong-target',
  'heading a #t b: api wikilink wrong-target',
  'heading a #t b: api markdown wrong-target',
  'heading a&amp;b: autocomplete markdown wrong-target',
  'heading a&amp;b: api markdown wrong-target',
  'heading [[t]] x: autocomplete markdown wrong-target',
  'heading [[t]] x: api wikilink wrong-target',
  'display a]b: api markdown wrong-target',
  'display a]]b: api wikilink wrong-text',
  'display a]]b: api markdown wrong-target',
  'display a[b: api markdown wrong-text',
  'display a[[b: api wikilink wrong-target',
  'display a[[b: api markdown wrong-text',
  'display a%%b%%c: api markdown wrong-text',
  'display a*b*: api markdown wrong-text',
  'display a`b`: api markdown wrong-text',
  'display   a: api wikilink wrong-text',
  'display a  : api wikilink wrong-text',
  'display a&amp;b: api markdown wrong-text',
  'display [[t]]: api wikilink wrong-text',
  'display [[t]]: api markdown wrong-target',
  String.raw`display a\|b: api markdown wrong-text`
];

// The headings a link to the second of two headings still reaches: the others land on the first.
const DISTINCT_SECOND_HEADINGS: readonly string[] = ['a\'b', 'a-b', 'a_b'];

const file = readOracleFile(linkParityOracleFileName()) as LinkParityFile;

describe('the link parity oracle', () => {
  it('reads every case once', () => {
    expect(Object.keys(file.reads).toSorted(compareCodeUnits)).toEqual(linkParityCases().map((linkCase) => linkCase.id).toSorted(compareCodeUnits));
  });

  it('finds the same gaps between the formats', () => {
    const subjects = judgeLinkParity(file);
    expect(subjects.filter((subject) => subject.verdict !== 'parity').map((subject) => `${subject.kind} ${subject.subject}: ${subject.verdict}`)).toEqual(GAPS);
  });

  it('finds the same links Obsidian writes wrong', () => {
    const failures = judgeLinkParity(file).flatMap((subject) => subject.written.filter((written) => written.outcome !== 'ok').map((written) => `${subject.kind} ${subject.subject}: ${written.writer} ${written.format} ${written.outcome}`));
    expect(failures).toEqual(WRITTEN_FAILURES);
  });

  it('reaches a second heading only when it differs from the first by an apostrophe, a hyphen or an underscore', () => {
    expect(file.collisions.map((collision) => collision.second)).toEqual(HEADING_COLLISIONS.map((collision) => collision.second));
    expect(file.collisions.filter((collision) => collision.rawReach === 1).map((collision) => collision.second)).toEqual(DISTINCT_SECOND_HEADINGS);
    expect(file.collisions.filter((collision) => collision.autocompleteReach === 1).map((collision) => collision.second)).toEqual(DISTINCT_SECOND_HEADINGS);
  });

  it('gives the cached link and display text of every case from the parser', () => {
    for (const linkCase of linkParityCases()) {
      const read = file.reads[linkCase.id];
      const metadata = parseMetadata(read?.text ?? '');
      const reference = metadata?.links?.[0] ?? metadata?.embeds?.[0] ?? null;
      expect([reference?.link ?? null, reference?.displayText ?? null], linkCase.id).toEqual([read?.cacheLink, read?.cacheDisplay]);
    }
  });
});
