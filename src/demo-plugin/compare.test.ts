import {
  describe,
  expect,
  it
} from 'vitest';

import { editorClassLanguage } from '../editor/language.ts';
import {
  findClassDifference,
  findNodeListDifference,
  findValueDifference,
  median,
  readTreeNodes
} from './compare.ts';

describe('readTreeNodes', () => {
  it('should list the line and token nodes below the chunks', () => {
    const nodes = readTreeNodes(editorClassLanguage.parser.parse('# Title\nplain'));
    expect(nodes).toContainEqual([0, 7, 1, 'HyperMD-header_HyperMD-header-1']);
    expect(nodes.every((node) => node[2] > 0)).toBe(true);
  });
});

describe('findNodeListDifference', () => {
  it('should find nothing in equal lists', () => {
    expect(findNodeListDifference([[0, 1, 1, 'a']], [[0, 1, 1, 'a']])).toBeNull();
  });

  it('should find the first node that differs', () => {
    expect(findNodeListDifference([[0, 1, 1, 'a'], [1, 2, 1, 'b']], [[0, 1, 1, 'a'], [1, 2, 1, 'c']])).toEqual({
      actual: [1, 2, 1, 'c'],
      expected: [1, 2, 1, 'b'],
      index: 1
    });
  });

  it('should find a list that ends early', () => {
    expect(findNodeListDifference([[0, 1, 1, 'a']], [])).toEqual({ actual: null, expected: [0, 1, 1, 'a'], index: 0 });
  });
});

describe('findClassDifference', () => {
  it('should ignore how the classes are split into nodes', () => {
    expect(findClassDifference('ab', [[0, 2, 1, 'x']], [[0, 1, 1, 'x'], [1, 2, 1, 'x_x']])).toBeNull();
  });

  it('should find the first character or line whose classes differ', () => {
    expect(findClassDifference('ab', [[0, 2, 1, 'x']], [[0, 1, 1, 'x']])).toEqual({ index: 1, kind: 'character' });
    expect(findClassDifference('a\nb', [[2, 3, 1, 'HyperMD-quote']], [])).toEqual({ index: 1, kind: 'line' });
  });
});

describe('findValueDifference', () => {
  it('should ignore key order and undefined properties', () => {
    const reordered = Object.fromEntries([['d', undefined], ['b', [1, { c: 2 }]], ['a', 1]]);
    expect(findValueDifference({ a: 1, b: [1, { c: 2 }] }, reordered)).toBeNull();
  });

  it('should give the path of the first difference', () => {
    expect(findValueDifference({ a: [{ b: 1 }] }, { a: [{ b: 2 }] })).toBe('$.a[0].b');
    expect(findValueDifference({ a: [1] }, { a: [1, 2] })).toBe('$.a');
    expect(findValueDifference({ a: 1 }, { a: 1, b: 2 })).toBe('$.b');
    expect(findValueDifference(null, {})).toBe('$');
    expect(findValueDifference(undefined, undefined)).toBeNull();
  });
});

describe('median', () => {
  it('should take the middle value or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});
