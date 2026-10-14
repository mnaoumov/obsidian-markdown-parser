import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildCorpus,
  PIECE_SETS
} from './corpus.ts';

const HAND_WRITTEN = 28;

describe('buildCorpus', () => {
  it('should build the hand-written documents and the requested number per piece set', () => {
    const corpus = buildCorpus({ perSet: 5 });
    expect(corpus).toHaveLength(HAND_WRITTEN + PIECE_SETS.size * 5);
    expect(corpus[0]?.id).toBe('hand-0');
    expect(corpus.at(-1)?.id).toBe('rich-4');
  });

  it('should give the same documents for the same seed and different ones for another', () => {
    expect(buildCorpus({ perSet: 3, seed: 7 })).toEqual(buildCorpus({ perSet: 3, seed: 7 }));
    expect(buildCorpus({ perSet: 3, seed: 7 })).not.toEqual(buildCorpus({ perSet: 3, seed: 8 }));
  });
});
