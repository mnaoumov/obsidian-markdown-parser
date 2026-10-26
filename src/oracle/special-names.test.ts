import {
  describe,
  expect,
  it
} from 'vitest';

import type { SpecialNamesFile } from './special-names.ts';

import {
  readOracleFile,
  specialNamesOracleFileName
} from './oracle-location.ts';
import {
  judgeSpecialNames,
  SHADOW_EDIT_TEXT,
  SPECIAL_NAME_SURFACES,
  SPECIAL_NAMES,
  specialNameText
} from './special-names.ts';

// Every surface that fails for a name where the help does not already warn: a surface that starts or stops failing fails
// the suite.
const FAILURES: readonly string[] = [
  ' x: link',
  ' x: backlinks',
  ' x: graph',
  ' x: embed',
  ' x: property',
  ' x: rename',
  ' x: move',
  ...SPECIAL_NAME_SURFACES.map((surface) => `x\u{A0}y: ${surface}`),
  ...SPECIAL_NAME_SURFACES.map((surface) => `cafe\u{301}: ${surface}`)
];

const file = readOracleFile(specialNamesOracleFileName()) as SpecialNamesFile;
const verdicts = judgeSpecialNames(file);

describe('special note names', () => {
  it('fails on exactly the known surfaces', () => {
    const failures: string[] = [];
    for (const { name } of SPECIAL_NAMES) {
      for (const surface of SPECIAL_NAME_SURFACES) {
        if (verdicts.get(name)?.get(surface)?.status === 'fails') {
          failures.push(`${name}: ${surface}`);
        }
      }
    }
    expect(failures).toEqual(FAILURES);
  });

  it('opens a note named like a link to a heading as the note that has the heading', () => {
    expect(file.reads['m#n']?.uri?.opened).toBe('special-names/m.md');
  });

  it('indexes a shadowed name\'s partner and writes an edit of the shared note to the partner\'s file only', () => {
    for (const write of file.shadowWrites) {
      const index = SPECIAL_NAMES.findIndex(({ name }) => name === write.name);
      expect(write.partnerText).toBe(SHADOW_EDIT_TEXT);
      expect(write.nameText).toBe(specialNameText(index));
    }
    expect(file.shadowWrites.map(({ name }) => name)).toEqual(['x\u{A0}y', 'cafe\u{301}']);
  });

  it('warns about # ^ [ ] in a rename and saves it, and refuses what the file system cannot store and a leading dot', () => {
    expect(file.renameChecks.filter(({ saved }) => !saved).map(({ name }) => name)).toEqual(['r|s', 'r:s', 'r*s', '.rs']);
    expect(file.renameChecks.filter(({ message }) => message?.startsWith('Links will not work') === true).map(({ name }) => name)).toEqual([
      'r#s',
      'r^s',
      'r[s',
      'r]s'
    ]);
  });
});
