import {
  describe,
  expect,
  it
} from 'vitest';

import type { CachedMetadata } from '../../metadata/types.ts';
import type {
  LiveSurfaceFile,
  LiveSurfaceRead
} from './live-surfaces.ts';

import { parseMetadata } from '../../metadata/metadata.ts';
import {
  liveSurfacesOracleFileName,
  oracleObsidianVersion,
  readOracleFile
} from '../oracle-location.ts';
import { liveSurfaceFamilyCounts } from '../release-differential.ts';
import {
  judgeOutline,
  judgeProcessFrontMatter,
  judgeRenameFile,
  LIVE_SURFACE_NOTE_COUNT,
  liveSurfaceDocuments,
  simulateRename
} from './live-surfaces.ts';

// The families the pinned reading falls into: a family that stops being found, or one that appears, fails the suite.
const FOUND_FAMILIES: readonly string[] = [
  'comment-line-offset',
  'editor-reformats-table',
  'front-matter-restyled',
  'outline-embed-source',
  'outline-escaped-bracket',
  'outline-inline-footnote',
  'outline-undefined-reference'
];

const file = readOracleFile(liveSurfacesOracleFileName()) as LiveSurfaceFile;

// A read of a note on which every live surface does what the cache says.
function cleanRead(markdown: string, overrides: Partial<LiveSurfaceRead> = {}): LiveSurfaceRead {
  return {
    backlinks: {},
    cache: parseMetadata(markdown),
    cacheAfterOpen: null,
    id: 'clean',
    markdown,
    outline: [],
    processedText: `---\nlivecheck: 1\n---\n${markdown}`,
    processError: null,
    renamedText: markdown,
    resolvedLinks: {},
    roundTripText: markdown,
    unresolvedLinks: {},
    ...overrides
  };
}

describe('the live surface oracle', () => {
  it('reads the notes liveSurfaceDocuments gives', () => {
    expect(file.reads.map((read) => read.markdown)).toEqual(liveSurfaceDocuments().map((document) => document.markdown));
    expect(file.reads).toHaveLength(LIVE_SURFACE_NOTE_COUNT);
  });

  it('holds the cache parseMetadata gives, read before the note is opened', () => {
    const differing = file.reads.filter((read) => JSON.stringify(read.cache) !== JSON.stringify(parseMetadata(read.markdown, { obsidianVersion: oracleObsidianVersion() }))).map((read) => read.id);
    expect(differing).toEqual([]);
  });

  it('sorts every finding into a known family', () => {
    const families = liveSurfaceFamilyCounts(file).map((family) => family.id);
    expect(families.toSorted((left, right) => left.localeCompare(right))).toEqual(FOUND_FAMILIES);
  });
});

describe('the live surface judges', () => {
  it('simulate a rename by the cache positions, keeping subpaths, aliases and extensions as written', () => {
    const note = '[[target#Heading|a]] ![[image.png]] [t](page.md) [[elsewhere]]\n';
    const metadata: CachedMetadata | null = parseMetadata(note);
    if (metadata === null) {
      throw new Error('The note has no metadata');
    }
    expect(simulateRename(note, metadata)).toBe('[[retitled-target#Heading|a]] ![[retitled-image.png]] [t](retitled-page.md) [[elsewhere]]\n');
  });

  it('see a rename that writes outside the link and one that does not round-trip', () => {
    const note = 'a [[target]]\n';
    expect(judgeRenameFile(cleanRead(note, { renamedText: 'a [[retitled-target]]\n' }))).toEqual([]);
    expect(judgeRenameFile(cleanRead(note, { renamedText: 'A [[retitled-target]]\n' })).map((finding) => finding.key)).toEqual(['renameFile:body']);
    expect(judgeRenameFile(cleanRead(note, { renamedText: 'a [[retitled-target]]\n', roundTripText: 'a [[target|target]]\n' })).map((finding) => finding.key)).toEqual(['renameFile:round-trip']);
  });

  it('nest the outline by heading level and compare its text with Reading view', () => {
    const note = '# A\n\n### B **c**\n\n## D\n';
    const outline = [{ depth: 0, text: 'A' }, { depth: 1, text: 'B c' }, { depth: 1, text: 'D' }];
    expect(judgeOutline(cleanRead(note, { outline }))).toEqual([]);
    const wrong = [{ depth: 0, text: 'A' }, { depth: 2, text: 'B **c**' }, { depth: 1, text: 'D' }];
    expect(judgeOutline(cleanRead(note, { outline: wrong })).map((finding) => finding.key)).toEqual(['outline:depth', 'outline:text']);
  });

  it('see processFrontMatter keep the body and restyle the front matter', () => {
    expect(judgeProcessFrontMatter(cleanRead('Body [[target]]\n'))).toEqual([]);
    const note = '---\ntags: [a]\n---\nBody\n';
    const processedText = '---\ntags:\n  - a\nlivecheck: 1\n---\nBody\n';
    expect(judgeProcessFrontMatter(cleanRead(note, { processedText })).map((finding) => finding.key)).toEqual(['processFrontMatter:restyled']);
  });
});
