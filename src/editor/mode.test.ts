import {
  describe,
  expect,
  it
} from 'vitest';

import { areStatesEqual } from './mode.ts';
import { StringStream } from './string-stream.ts';

interface Cyclic {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The test links an existing node back to itself to create a cycle.
  next: Cyclic | null;
  readonly value: number;
}

class Context {
  public constructor(public readonly type: string) {}
}

function cyclic(value: number): Cyclic {
  const node: Cyclic = { next: null, value };
  node.next = node;
  return node;
}

function stream(line: string, lineIndex: number): StringStream {
  return new StringStream({ line, lineIndex, readLine: (): null => null });
}

function token(): null {
  return null;
}

describe('areStatesEqual', () => {
  it('should compare plain objects, arrays and class instances by their contents', () => {
    expect(areStatesEqual({ list: [1, 2], nested: { a: 'x' } }, { list: [1, 2], nested: { a: 'x' } })).toBe(true);
    expect(areStatesEqual({ list: [1, 2] }, { list: [1, 3] })).toBe(false);
    expect(areStatesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(areStatesEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(areStatesEqual(new Context('block'), new Context('block'))).toBe(true);
    expect(areStatesEqual(new Context('block'), { type: 'block' })).toBe(false);
  });

  it('should compare functions and built-in objects by identity', () => {
    expect(areStatesEqual({ token }, { token })).toBe(true);
    expect(areStatesEqual({ token }, { token: (): null => null })).toBe(false);
    const pattern = /x/u;
    expect(areStatesEqual({ pattern }, { pattern })).toBe(true);
    expect(areStatesEqual({ pattern }, { pattern: /x/u })).toBe(false);
  });

  it('should compare a kept line stream by its text', () => {
    expect(areStatesEqual({ line: stream('a', 1) }, { line: stream('a', 5) })).toBe(true);
    expect(areStatesEqual({ line: stream('a', 1) }, { line: stream('b', 1) })).toBe(false);
  });

  it('should compare cyclic states', () => {
    expect(areStatesEqual(cyclic(1), cyclic(1))).toBe(true);
    expect(areStatesEqual(cyclic(1), cyclic(2))).toBe(false);
  });
});
