import {
  describe,
  expect,
  it
} from 'vitest';

import {
  classSetsOf,
  compareDocument,
  lineStartsOf,
  toNodes
} from './score.ts';

describe('lineStartsOf', () => {
  it('should give the offset of every line', () => {
    expect(lineStartsOf('a\nbc\n')).toEqual([0, 2, 5]);
  });
});

describe('classSetsOf', () => {
  it('should read line classes from a line node and token classes from its children', () => {
    const sets = classSetsOf('# H', [[0, 3, 1, 'HyperMD-header_HyperMD-header-1'], [0, 2, 2, 'formatting_header'], [2, 3, 2, 'header']]);
    expect([...sets.line[0] ?? []]).toEqual(['HyperMD-header', 'HyperMD-header-1']);
    expect([...sets.tok[0] ?? []]).toEqual(['formatting', 'header']);
    expect([...sets.tok[2] ?? []]).toEqual(['header']);
  });
});

describe('toNodes', () => {
  it('should encode classes the way the editor tree names its nodes', () => {
    expect(toNodes([{ classes: ['B', 'A'], from: 0, spans: [{ classes: ['y', 'x'], from: 0, to: 1 }], to: 1 }])).toEqual([
      [0, 1, 1, 'A_B'],
      [0, 1, 2, 'x_y']
    ]);
  });
});

describe('compareDocument', () => {
  it('should report each class the prediction misses or adds', () => {
    const comparison = compareDocument({ id: 'x', nodes: [[0, 1, 1, 'em']], set: 'hand', text: 'a' });
    expect(comparison.differences).toEqual([{ cls: 'em', kind: 'missed', line: 0, pos: 0 }]);
  });
});
