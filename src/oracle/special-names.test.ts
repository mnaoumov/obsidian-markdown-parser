import {
  describe,
  expect,
  it
} from 'vitest';

import type { SpecialNamesFile } from './special-names.ts';

import {
  PINNED_ANDROID_OBSIDIAN_VERSION,
  readOracleFile,
  specialNamesAndroidOracleFileName,
  specialNamesNormalizationAndroidOracleFileName,
  specialNamesNormalizationOracleFileName,
  specialNamesOracleFileName
} from './oracle-location.ts';
import {
  ANDROID_SPECIAL_NAMES,
  judgeSpecialNames,
  NORMALIZATION_NAMES,
  SHADOW_EDIT_TEXT,
  SPECIAL_NAME_SURFACES,
  SPECIAL_NAMES,
  SPECIAL_NAMES_FORMS_FOLDER,
  specialNamePath,
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

// The normalization sweep: every file a shadowed spelling hides fails everywhere, but the first rename onto its NFC path;
// every later rename onto that path, the kept name's included, is refused, since the first took it; and the note kept
// for three spellings, which a hidden NFC file strands once it is moved.
const NORMALIZATION_FAILURES: readonly string[] = [
  ...SPECIAL_NAME_SURFACES.filter((surface) => surface !== 'rename-onto').map((surface) => `o\u{323}\u{302}: ${surface}`),
  'o\u{302}\u{323}: rename-onto',
  ...SPECIAL_NAME_SURFACES.filter((surface) => surface !== 'rename-onto').map((surface) => `n\u{E9}\u{439}: ${surface}`),
  ...SPECIAL_NAME_SURFACES.map((surface) => `ne\u{301}\u{438}\u{306}: ${surface}`),
  'n\u{E9}\u{438}\u{306}: rename',
  'n\u{E9}\u{438}\u{306}: move',
  'n\u{E9}\u{438}\u{306}: rename-onto',
  ...SPECIAL_NAME_SURFACES.filter((surface) => surface !== 'rename-onto').map((surface) => `pe\u{301}\u{438}\u{306}: ${surface}`),
  ...SPECIAL_NAME_SURFACES.map((surface) => `p\u{E9}\u{438}\u{306}: ${surface}`),
  'p\u{E9}\u{439}: rename-onto'
];
const DESTINATION_EXISTS = '<<refused: Destination file already exists!>>';

const normalizationFile = readOracleFile(specialNamesNormalizationOracleFileName()) as SpecialNamesFile;
const normalizationVerdicts = judgeSpecialNames(normalizationFile, NORMALIZATION_NAMES);
const normalization = normalizationFile.normalization ?? {};
const keptNames = NORMALIZATION_NAMES.filter(({ shadows }) => shadows === undefined).map(({ name }) => name);

describe('note names in neither normal form', () => {
  it('fails on exactly the known surfaces', () => {
    const failures: string[] = [];
    for (const { name } of NORMALIZATION_NAMES) {
      for (const surface of SPECIAL_NAME_SURFACES) {
        if (normalizationVerdicts.get(name)?.get(surface)?.status === 'fails') {
          failures.push(`${name}: ${surface}`);
        }
      }
    }
    expect(failures).toEqual(NORMALIZATION_FAILURES);
  });

  it('indexes every kept name under its NFC path, reading the file under the name it was written with', () => {
    for (const name of keptNames) {
      expect(normalizationFile.reads[name]?.indexed).toBe(specialNamePath(name.normalize('NFC')));
      expect(normalization[name]?.realpath).toBe(specialNamePath(name));
    }
  });

  it('keeps the spelling written last, whichever normal form it is in', () => {
    expect(normalizationFile.shadowWrites.map(({ name, partner }) => [name, partner])).toEqual([
      ['o\u{323}\u{302}', 'o\u{302}\u{323}'],
      ['n\u{E9}\u{439}', 'n\u{E9}\u{438}\u{306}'],
      ['ne\u{301}\u{438}\u{306}', 'n\u{E9}\u{438}\u{306}'],
      ['pe\u{301}\u{438}\u{306}', 'p\u{E9}\u{439}'],
      ['p\u{E9}\u{438}\u{306}', 'p\u{E9}\u{439}']
    ]);
    for (const write of normalizationFile.shadowWrites) {
      expect(write.partnerText).toBe(SHADOW_EDIT_TEXT);
      expect(write.nameText).toBe(specialNameText(NORMALIZATION_NAMES.findIndex(({ name }) => name === write.name)));
    }
  });

  it('finds a note by getAbstractFileByPath under its NFC spelling only', () => {
    for (const read of Object.values(normalization)) {
      for (const lookup of read.lookups) {
        expect(lookup.found !== null).toBe(lookup.form === 'nfc' || lookup.form === 'both');
      }
    }
  });

  it('resolves a link typed in any spelling, and opens it from Reading view, as the NFC note', () => {
    for (const { name } of NORMALIZATION_NAMES) {
      const typedLinks = normalization[name]?.typedLinks ?? [];
      for (const typed of typedLinks) {
        expect(typed.resolved).toBe(specialNamePath(name.normalize('NFC')));
        expect(typed.cached).toBe(typed.kind === 'wikilink' ? `special-names/${name.normalize('NFC')}` : specialNamePath(name.normalize('NFC')));
        expect(typed.href).toBe(typed.cached);
        expect(typed.opened).toBe(specialNamePath(name.normalize('NFC')));
      }
    }
  });

  it('creates a second note when the editor follows a link typed in any spelling but NFC', () => {
    for (const { name } of NORMALIZATION_NAMES) {
      const notePath = specialNamePath(name.normalize('NFC'));
      const typedLinks = normalization[name]?.typedLinks ?? [];
      for (const typed of typedLinks) {
        const isNfc = typed.form === 'nfc' || typed.form === 'both';
        const duplicate = `special-names/${name.normalize('NFC')} 1.md`;
        expect(typed.followed).toBe(isNfc ? notePath : duplicate);
        expect(typed.created).toEqual(isNfc ? [] : [duplicate]);
      }
    }
  });

  it('applies no compatibility normalization: a name and its NFKC are two notes', () => {
    for (const name of ['\u{FB01}x', 'fix', '\u{FF21}x', 'Ax', 'x\u{B2}', 'x2']) {
      expect(normalizationFile.reads[name]?.indexed).toBe(specialNamePath(name));
      expect(normalizationFile.reads[name]?.text).toBe(specialNameText(NORMALIZATION_NAMES.findIndex((candidate) => candidate.name === name)));
    }
  });

  it('accepts a rename to another spelling of the same name and changes nothing on disk', () => {
    for (const [name, read] of Object.entries(normalization)) {
      const formRenames = read.formRenames ?? [];
      for (const rename of formRenames) {
        expect(rename.refusal).toBeNull();
        expect(rename.path).toBe(`${SPECIAL_NAMES_FORMS_FOLDER}/${name.normalize('NFC')}.md`);
        expect(rename.realpath).toBe(`${SPECIAL_NAMES_FORMS_FOLDER}/${name}.md`);
      }
    }
  });

  it('stores a file renamed or moved and back, or renamed onto a name, under the NFC spelling', () => {
    // The kept mixed `néй` is stranded in the moved folder: see the last case.
    const roundTripped = keptNames.filter((kept) => kept !== 'n\u{E9}\u{438}\u{306}');
    for (const name of roundTripped) {
      expect(normalization[name]?.realpathAfterRenames).toBe(specialNamePath(name.normalize('NFC')));
    }
    for (const name of ['m\u{E9}\u{438}\u{306}', 'ke\u{301}\u{439}', 'e\u{302}\u{323}']) {
      expect(normalization[name]?.ontoRealpath).toBe(`special-names/onto/${name.normalize('NFC')}.md`);
    }
  });

  it('cannot move a note back once a hidden file holds the NFC spelling of its path', () => {
    const read = normalizationFile.reads['n\u{E9}\u{438}\u{306}'];
    expect(read?.move?.resolved).toBe(true);
    expect(read?.move?.backLink).toBe(DESTINATION_EXISTS);
    expect(normalization['n\u{E9}\u{438}\u{306}']?.realpathAfterRenames).toBeNull();
  });
});

// The normalization sweep on Android: app storage keeps one file for every spelling of a name that canonical equivalence
// or full case folding makes equal, named as the spelling written first and holding the text written last. Every other
// spelling of such a name fails everywhere, and so does the kept one, whose text is another name's, but the first rename
// onto its NFC path.
const ANDROID_FOLDS: readonly (readonly string[])[] = [
  ['o\u{323}\u{302}', 'o\u{302}\u{323}'],
  ['n\u{E9}\u{439}', 'ne\u{301}\u{438}\u{306}', 'n\u{E9}\u{438}\u{306}'],
  ['pe\u{301}\u{438}\u{306}', 'p\u{E9}\u{438}\u{306}', 'p\u{E9}\u{439}'],
  ['\u{FB01}x', 'fix']
];
const ANDROID_NORMALIZATION_FAILURES: readonly string[] = ANDROID_FOLDS.flatMap(([kept = '', ...others]) => [
  ...SPECIAL_NAME_SURFACES.filter((surface) => surface !== 'rename-onto').map((surface) => `${kept}: ${surface}`),
  ...others.flatMap((other) => SPECIAL_NAME_SURFACES.map((surface) => `${other}: ${surface}`))
]);

const androidNormalizationFile = readOracleFile(specialNamesNormalizationAndroidOracleFileName()) as SpecialNamesFile;
const androidNormalizationVerdicts = judgeSpecialNames(androidNormalizationFile, NORMALIZATION_NAMES);
const androidNormalization = androidNormalizationFile.normalization ?? {};
const androidFolded = new Set(ANDROID_FOLDS.flat());
// `fix` is the one name whose file system spelling is not canonically equivalent to the kept one, so nothing in the vault
// holds its NFC path.
const androidReachable = NORMALIZATION_NAMES.map(({ name }) => name).filter((name) => name !== 'fix');

describe('note names in neither normal form on Android', () => {
  it('holds every name and every spelling probe', () => {
    expect(androidNormalizationFile.meta.appVersion).toBe(PINNED_ANDROID_OBSIDIAN_VERSION);
    expect(Object.keys(androidNormalization)).toHaveLength(NORMALIZATION_NAMES.length);
    for (const { name } of NORMALIZATION_NAMES) {
      expect(androidNormalization[name]?.lookups.length).toBeGreaterThan(0);
      expect(androidNormalization[name]?.typedLinks.length).toBeGreaterThan(0);
    }
    expect(androidNormalizationFile.shadowWrites).toHaveLength(5);
  });

  it('fails on exactly the known surfaces', () => {
    const failures: string[] = [];
    for (const { name } of NORMALIZATION_NAMES) {
      for (const surface of SPECIAL_NAME_SURFACES) {
        if (androidNormalizationVerdicts.get(name)?.get(surface)?.status === 'fails') {
          failures.push(`${name}: ${surface}`);
        }
      }
    }
    expect(failures.toSorted((a, b) => a.localeCompare(b))).toEqual(ANDROID_NORMALIZATION_FAILURES.toSorted((a, b) => a.localeCompare(b)));
  });

  it('folds equal spellings into one file, named as the first written and holding the last written text', () => {
    for (const fold of ANDROID_FOLDS) {
      const [kept = ''] = fold;
      const last = fold.at(-1) ?? '';
      expect(androidNormalizationFile.reads[kept]?.indexed).toBe(specialNamePath(kept.normalize('NFC')));
      expect(androidNormalization[kept]?.realpath).toBe(specialNamePath(kept));
      expect(androidNormalizationFile.reads[kept]?.text).toBe(specialNameText(NORMALIZATION_NAMES.findIndex(({ name }) => name === last)));
      for (const other of fold.slice(1)) {
        expect(androidNormalizationFile.reads[other]?.indexed).toBeNull();
      }
    }
  });

  it('edits one file for every spelling of a folded name', () => {
    for (const write of androidNormalizationFile.shadowWrites) {
      expect(write.nameText).toBe(SHADOW_EDIT_TEXT);
      expect(write.partnerText).toBe(SHADOW_EDIT_TEXT);
    }
  });

  it('indexes every other name under its NFC path, reading the file under the name it was written with, as on the desktop', () => {
    for (const { name } of NORMALIZATION_NAMES) {
      if (androidFolded.has(name)) {
        continue;
      }
      expect(androidNormalizationFile.reads[name]?.indexed).toBe(specialNamePath(name.normalize('NFC')));
      expect(androidNormalization[name]?.realpath).toBe(specialNamePath(name));
    }
  });

  it('finds a note by getAbstractFileByPath under its NFC spelling only, as on the desktop', () => {
    for (const name of androidReachable) {
      const lookups = androidNormalization[name]?.lookups ?? [];
      for (const lookup of lookups) {
        expect(lookup.found !== null).toBe(lookup.form === 'nfc' || lookup.form === 'both');
      }
    }
  });

  it('resolves a typed link as the NFC note, and creates a second note when the editor follows one not in NFC, as on the desktop', () => {
    for (const name of androidReachable) {
      const notePath = specialNamePath(name.normalize('NFC'));
      const typedLinks = androidNormalization[name]?.typedLinks ?? [];
      for (const typed of typedLinks) {
        const isNfc = typed.form === 'nfc' || typed.form === 'both';
        expect(typed.resolved).toBe(notePath);
        expect(typed.opened).toBe(notePath);
        expect(typed.followed).toBe(isNfc ? notePath : `special-names/${name.normalize('NFC')} 1.md`);
        expect(typed.created).toEqual(isNfc ? [] : [`special-names/${name.normalize('NFC')} 1.md`]);
      }
    }
  });

  it('cannot create the note a link to fix names, since the file system already holds ﬁx', () => {
    const typedLinks = androidNormalization['fix']?.typedLinks ?? [];
    for (const typed of typedLinks) {
      expect(typed.resolved).toBeNull();
      expect(typed.followed).toBeNull();
      expect(typed.created).toEqual([]);
    }
  });

  it('keeps a full-width letter and a superscript apart from their NFKC', () => {
    for (const name of ['\u{FF21}x', 'Ax', 'x\u{B2}', 'x2']) {
      expect(androidNormalizationFile.reads[name]?.indexed).toBe(specialNamePath(name));
    }
  });

  it('accepts a rename to another spelling of the same name and changes nothing on disk, as on the desktop', () => {
    for (const read of Object.values(androidNormalization)) {
      const formRenames = read.formRenames ?? [];
      const originalRealpath = formRenames[0]?.realpath;
      for (const rename of formRenames) {
        expect(rename.refusal).toBeNull();
        expect(rename.path).toBe(rename.path?.normalize('NFC'));
        expect(rename.realpath).toBe(originalRealpath);
      }
    }
  });

  it('stores every note renamed or moved and back under its NFC spelling, and strands none', () => {
    for (const { name } of NORMALIZATION_NAMES) {
      if (androidNormalizationFile.reads[name]?.indexed !== null) {
        expect(androidNormalization[name]?.realpathAfterRenames).toBe(specialNamePath(name.normalize('NFC')));
      }
    }
    expect(androidNormalizationFile.reads['n\u{E9}\u{439}']?.move?.backResolved).toBe(true);
  });
});
