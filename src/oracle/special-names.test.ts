import {
  describe,
  expect,
  it
} from 'vitest';

import type { SpecialNamesFile } from './special-names.ts';

import {
  readOracleFile,
  specialNamesAndroidOracleFileName,
  specialNamesOracleFileName
} from './oracle-location.ts';
import {
  ANDROID_SPECIAL_NAMES,
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

// The same on Android: the desktop's failures but the explorer's, plus the quick switcher for a leading space, a
// trailing space failing as a leading one does, a backslash no surface shows, and the NFC/NFD pair app storage keeps as one
// file.
const ANDROID_FAILURES: readonly string[] = [
  ' x: switcher',
  ' x: link',
  ' x: backlinks',
  ' x: graph',
  ' x: embed',
  ' x: property',
  ' x: rename',
  ' x: move',
  ...SPECIAL_NAME_SURFACES.map((surface) => `x\u{A0}y: ${surface}`),
  ...SPECIAL_NAME_SURFACES.filter((surface) => surface !== 'rename-onto').map((surface) => `caf\u{E9}: ${surface}`),
  ...SPECIAL_NAME_SURFACES.map((surface) => `cafe\u{301}: ${surface}`),
  ...SPECIAL_NAME_SURFACES.map((surface) => String.raw`x\y: ${surface}`),
  ...['link', 'backlinks', 'graph', 'embed', 'property', 'rename', 'move', 'rename-onto'].map((surface) => `x : ${surface}`)
];

const androidFile = readOracleFile(specialNamesAndroidOracleFileName()) as SpecialNamesFile;
const androidVerdicts = judgeSpecialNames(androidFile, ANDROID_SPECIAL_NAMES);

describe('special note names on Android', () => {
  it('fails on exactly the known surfaces', () => {
    const failures: string[] = [];
    for (const { name } of ANDROID_SPECIAL_NAMES) {
      for (const surface of SPECIAL_NAME_SURFACES) {
        if (androidVerdicts.get(name)?.get(surface)?.status === 'fails') {
          failures.push(`${name}: ${surface}`);
        }
      }
    }
    expect(failures).toEqual(ANDROID_FAILURES);
  });

  it('works on every surface for a name Windows cannot store but Android allows, a link through | aside', () => {
    for (const name of ['x|y', 'x.', 'x./y', 'x /y']) {
      const failing = SPECIAL_NAME_SURFACES.filter((surface) => androidVerdicts.get(name)?.get(surface)?.status !== 'ok');
      expect(failing).toEqual(name === 'x|y' ? ['link', 'backlinks', 'graph', 'embed', 'property', 'rename', 'move', 'rename-onto'] : []);
    }
  });

  it('renames a note whose name it refuses away but neither back nor into another folder', () => {
    for (const name of ['x:y', 'x*y', 'x?y', 'x"y', 'x<y', 'x>y']) {
      const read = androidFile.reads[name];
      expect(read?.rename?.resolved).toBe(true);
      expect(read?.rename?.backLink).toMatch(/^<<refused: File name cannot contain/v);
      expect(read?.move?.link).toMatch(/^<<refused: File name cannot contain/v);
      expect(read?.renameOnto.link).toMatch(/^<<refused: File name cannot contain/v);
    }
  });

  it('keeps an NFC name and its NFD partner as one file in app storage, so an edit reaches both names', () => {
    const write = androidFile.shadowWrites.find(({ name }) => name === 'cafe\u{301}');
    expect(write?.nameText).toBe(SHADOW_EDIT_TEXT);
    expect(write?.partnerText).toBe(SHADOW_EDIT_TEXT);
  });

  it(String.raw`refuses \ : * ? " < > in a rename, and saves | and a trailing dot or space`, () => {
    expect(androidFile.renameChecks.filter(({ saved }) => !saved).map(({ name }) => name)).toEqual(['r:s', 'r*s', '.rs', 'r?s', 'r"s', 'r<s', 'r>s', String.raw`r\s`]);
  });
});
