import {
  describe,
  expect,
  it
} from 'vitest';

import type { SelfCheckFinding } from './self-check.ts';

import { CORPUS_TEST_TIMEOUT_MS } from '../oracle-location.ts';
import { judgeEngines } from './engine-differential.ts';
import { generateNotes } from './note-grammar.ts';
import { selfCheckFamilyOf } from './self-check-families.ts';
import {
  judgeConservation,
  judgeEscapes,
  judgeFidelity,
  judgeIndependence,
  judgeNote,
  judgeOffsets,
  judgePadding,
  judgeRename,
  judgeRender,
  judgeShape,
  judgeShift,
  reduceFinding
} from './self-check.ts';

const ACCEPTANCE_NOTES = 4000;
const SAMPLES_PER_KEY = 5;

// The families the judges must find from generated notes alone: every bug reported from a note somebody wrote by hand,
// and the known and by-design behaviours, so their verdicts can be redone from the judges' own output.
const REDISCOVERED_FAMILIES: readonly string[] = [
  'blocks-record',
  'colored-highlight-residue',
  'comment-footnote-backlink',
  'comment-indexed',
  'comment-line-offset',
  'container-heading-uncached',
  'definition-title-across-blank-line',
  'escaped-closer',
  'footnote-block-id-empty-position',
  'footnote-scan-window',
  'heading-raw-source',
  'lazy-callout-offset',
  'unclosed-comment-swallows',
  'undefined-footnote-brackets',
  'utf16-columns'
];

// The families the engine differential must find: the two reported task item shapes, wrong only by the GFM spec, and
// the reported emphasis pairing, which no relation of the engine with itself sees either.
const SPEC_ONLY_FAMILIES: readonly string[] = ['engine-emphasis-pairing', 'task-body-blocks', 'task-status-any-character'];

// Notes every relation holds on, but the escaped closer of their highlights, links and embeds, and the shape of the API.
const CLEAN_NOTES: readonly string[] = [
  '# Heading\n\nText with [[target]], ![[image.png]], #tag and ==mark==.\n',
  '- a [[target]]\n- b #tag\n  - c\n',
  '> quote [[target]]\n\n> [!note] Title\n> body #tag\n',
  'Text[^1].\n\n[^1]: The note.\n',
  'para ^blockid\n\n| a | b |\n| - | - |\n| [[target]] | x |\n'
];

function keysOf(findings: readonly SelfCheckFinding[]): string[] {
  return [...new Set(findings.map((finding) => finding.key))].toSorted((left, right) => left.localeCompare(right));
}

describe('the self-check judges', () => {
  it('flag nothing but the escaped closer on notes every other relation holds on', () => {
    const keys = CLEAN_NOTES.flatMap((note) => keysOf(judgeNote(note)).map((key) => `${note}: ${key}`));
    expect(keys.filter((key) => !/: (?:escape:(?:highlight|internalLink|embed)-closer|shape:.*)$/u.test(key))).toEqual([]);
  });

  it('see a link on a line that opens a block comment placed 2 characters early', () => {
    expect(keysOf(judgeOffsets('%% see [[target]] here\nmore\n%%\n'))).toEqual(['offset:links']);
  });

  it('see a rename corrupt a link on a callout line that continues a list item', () => {
    const findings = judgeRename('1. > [!note] T\n> ab cd [[target]] end\n');
    expect(findings.map((finding) => finding.detail)).toEqual(['renaming "[target]] " gives the line "> ab cd [[[renamed]]end"']);
  });

  it('see a long footnote definition swallow the heading after it', () => {
    expect(keysOf(judgePadding('[^1]: lorem\n# Heading\n'))).toContain('padding:headings');
  });

  it('see a quoted paragraph after a definition and a blank line vanish', () => {
    const note = '[1]: https://example.com\n\n"To be or not to be."\n\nNext paragraph.\n';
    expect(keysOf(judgeConservation(note))).toEqual(['conservation:definition']);
    expect(keysOf(judgeIndependence(note))).toEqual(['independence:sections']);
  });

  it('read a block that would open front matter alone after a blank line, as it stands in the note', () => {
    expect(judgeIndependence('Intro\n\n---\nk: v\n---\n')).toEqual([]);
    expect(judgeIndependence('\n\n---\nk: v\n---')).toEqual([]);
  });

  it('see an undefined footnote reference lose its brackets', () => {
    expect(keysOf(judgeFidelity('A claim[^source] I will cite later.\n'))).toEqual(['fidelity:paragraph']);
  });

  it('see a footnote reference in a comment counted, and a quoted heading left out of the cache', () => {
    expect(keysOf(judgeRender('Text[^1].\n\n%% check [^1] later %%\n\n[^1]: The note.\n'))).toEqual(['render:footnoteRefs-only-in-cache-in-comment']);
    expect(keysOf(judgeRender('Intro\n\n> # Quoted heading\n'))).toEqual(['render:headings-only-in-render']);
  });

  it('see a backslash before a closing delimiter ignored and one before an opening delimiter honored', () => {
    expect(keysOf(judgeEscapes('a ==text== b [[target]]\n'))).toEqual(['escape:highlight-closer', 'escape:internalLink-closer']);
    expect(keysOf(judgeEscapes('a $x$ b\n'))).toEqual([]);
  });

  it('see blocks as a record and columns counted in UTF-16 code units', () => {
    expect(keysOf(judgeShape('para [[target]] ^blockid\n'))).toEqual(['shape:blocks-record', 'shape:columns-astral', 'shape:columns-combining']);
    expect(keysOf(judgeShape('[[target]] at the start\n'))).toEqual([]);
  });

  it('keep every position when a paragraph is prepended', () => {
    expect(judgeShift('- a\n  - b [[target]]\n\n# H #tag\n')).toEqual([]);
  });

  it('reduce a finding to a minimal note', () => {
    expect(reduceFinding('Some text.\n\n> # Heading\n\nMore text.\n', 'render:headings-only-in-render')).toBe('>#');
  });

  it('see a task item\'s text read as blocks, and any character read as a task status, where the references agree', () => {
    expect(keysOf(judgeEngines('- [ ] # Heading\n'))).toEqual(['engines:obsidian:h1-vs-text']);
    expect(keysOf(judgeEngines('- [?] task\n'))).toEqual(['engines:obsidian:li [x]-vs-li']);
    expect(judgeEngines('- [x] done ~~struck~~\n- [ ] open https://example.com\n\n| a | b |\n| - | - |\n| c | d |\n')).toEqual([]);
    expect(reduceFinding('Intro.\n\n- [ ] # Heading\n', 'engines:obsidian:h1-vs-text')).toBe('- [ ] #');
  });

  it('see strong emphasis closed inside emphasis by one run paired otherwise, where the references agree', () => {
    expect(keysOf(judgeEngines('*italic **bold&italic***\n'))).toEqual(['engines:obsidian:text-vs-em']);
    expect(selfCheckFamilyOf('engines:obsidian:text-vs-em', reduceFinding('*italic **bold&italic***\n', 'engines:obsidian:text-vs-em'))?.id).toBe('engine-emphasis-pairing');
  });

  it('name the reference alone when the references disagree, and leave the engine unjudged', () => {
    expect(keysOf(judgeEngines('"\n>2)\n'))).toEqual(['engines:references:micromark-alone:p-vs-ol']);
  });

  it('rediscover the families wrong only by the spec from generated notes of CommonMark and GFM alone', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const families = new Set<string>();
    const samples = new Map<string, string[]>();
    const generated = generateNotes({ count: ACCEPTANCE_NOTES, syntax: 'gfm' });
    for (const note of generated) {
      for (const finding of judgeEngines(note.text)) {
        const list = samples.get(finding.key) ?? [];
        if (list.length < SAMPLES_PER_KEY) {
          list.push(note.text);
        }
        samples.set(finding.key, list);
      }
    }
    for (const [key, notes] of samples) {
      for (const note of notes) {
        families.add(selfCheckFamilyOf(key, reduceFinding(note, key))?.id ?? `unclassified:${key}`);
      }
    }
    expect(SPEC_ONLY_FAMILIES.filter((id) => !families.has(id))).toEqual([]);
    expect([...families].filter((id) => id.startsWith('unclassified:'))).toEqual([]);
  });

  it('rediscover every family of hand-reported shapes from generated notes alone', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const samples = new Map<string, string[]>();
    const generated = generateNotes({ count: ACCEPTANCE_NOTES });
    for (const note of generated) {
      for (const finding of judgeNote(note.text)) {
        const list = samples.get(finding.key) ?? [];
        if (list.length < SAMPLES_PER_KEY) {
          list.push(note.text);
        }
        samples.set(finding.key, list);
      }
    }
    const families = new Set<string>();
    for (const [key, notes] of samples) {
      for (const note of notes) {
        families.add(selfCheckFamilyOf(key, reduceFinding(note, key))?.id ?? `unclassified:${key}`);
      }
    }
    expect(REDISCOVERED_FAMILIES.filter((id) => !families.has(id))).toEqual([]);
    expect([...families].filter((id) => id.startsWith('unclassified:'))).toEqual([]);
  });
});
