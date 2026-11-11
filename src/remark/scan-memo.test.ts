import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { CORPUS_TEST_TIMEOUT_MS } from '../oracle/oracle-location.ts';
import { parseRemark } from './parse.ts';
import { scanMemoSettings } from './parser.ts';

// The pieces the fuzzed notes are made of: every delimiter a memoized scan or a remembered locator reads, and text.
const PIECES = [
  '*',
  '**',
  '_',
  '__',
  '[',
  ']',
  '[[',
  ']]',
  '](',
  ')',
  '(',
  '!',
  '![',
  '\\',
  '`',
  '``',
  '~~',
  '==',
  '$',
  '$$',
  '%%',
  '#',
  '^',
  '^[',
  '<',
  '>',
  '<a>',
  '</a>',
  '"',
  '\'',
  ' ',
  '  ',
  '\n',
  '\n\n',
  '> ',
  '- ',
  '1. ',
  '|',
  'a',
  'b',
  'word',
  'https://x.y',
  'www.a.b',
  'a@b.c',
  '&amp;',
  '[^1]',
  '[^1]: ',
  '[r]: /u ',
  'é'
];
const NOTES = 4000;
const MAX_PIECES = 60;
// A fixed seed, so a failure names a note that can be re-run.
const SEED = 6134;
// The Park-Miller generator: every product stays below 2 ** 53, so it is exact.
const RANDOM_MULTIPLIER = 48_271;
const RANDOM_MODULUS = 2 ** 31 - 1;

function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * RANDOM_MULTIPLIER) % RANDOM_MODULUS;
    return state / RANDOM_MODULUS;
  };
}

function parseWithoutMemos(note: string): string {
  scanMemoSettings.isEnabled = false;
  try {
    return JSON.stringify(parseRemark(note, { shouldReadSoftLineBreaksAsHard: true }));
  } finally {
    scanMemoSettings.isEnabled = true;
  }
}

describe('scan memos', () => {
  const { minLocatorMemoLength } = scanMemoSettings;

  // Every note here is short, so the locators remember even a short text.
  beforeEach(() => {
    scanMemoSettings.minLocatorMemoLength = 0;
  });

  afterEach(() => {
    scanMemoSettings.isEnabled = true;
    scanMemoSettings.minLocatorMemoLength = minLocatorMemoLength;
  });

  it('give the tree a parse without them gives, on fuzzed notes', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const random = createRandom(SEED);
    for (let index = 0; index < NOTES; index++) {
      const count = Math.floor(random() * MAX_PIECES);
      const note = Array.from({ length: count }, () => PIECES[Math.floor(random() * PIECES.length)] ?? '').join('');
      expect(JSON.stringify(parseRemark(note, { shouldReadSoftLineBreaksAsHard: true })), note).toBe(parseWithoutMemos(note));
    }
  });

  it('give the tree a parse without them gives, on runs of unclosed delimiters', () => {
    const notes = ['*a _b '.repeat(200), '[a '.repeat(200), '[[note]] '.repeat(200), '_a_b_ '.repeat(100), '*a* _b_ [c] '.repeat(100)];
    for (const note of notes) {
      expect(JSON.stringify(parseRemark(note))).toBe(JSON.stringify(withoutMemos(() => parseRemark(note))));
    }
  });
});

function withoutMemos<T>(read: () => T): T {
  scanMemoSettings.isEnabled = false;
  try {
    return read();
  } finally {
    scanMemoSettings.isEnabled = true;
  }
}
