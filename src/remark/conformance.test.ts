import {
  describe,
  expect,
  it
} from 'vitest';

import {
  engineOutline,
  expectedOutline
} from '../oracle/remark-outline.ts';
import { CONFORMANCE_CASES } from '../syntax/conformance.ts';

/*
 * The cases where the metadata worker, which the engine reads as, and the editor, which the outline follows, differ.
 * `docs/remark.md` explains each; each was checked against the worker itself.
 */
const DIFFERENCES: readonly string[] = [
  // `[[a]b]]` is a link: the worker's link content may hold a `]`.
  'internal link content holds no ] and no line break',
  // `===` opens with its first `==` and closes with its first `==` after a non-space, so `===x===` is `=x` highlighted.
  'a run of three or more = is a highlight mark',
  // A `==` opens before any character that is no whitespace, `>` included.
  'a highlight does not open before >',
  // The worker reads the syntax inside a comment, and lists what it finds.
  'inline comment hides the syntax inside it',
  // An inline comment is on one line; one left open is text.
  'an unclosed comment runs to the end of its paragraph',
  'comment block spans blank lines',
  // A `%%` line interrupts the paragraph and opens a comment block.
  'a %% line closes the comment its paragraph left open',
  // A reference to no definition is text.
  'footnote reference',
  'footnote reference with an empty label',
  // A definition opens a line of any container, a quote's too.
  'a definition must open its line, so in a quote it is a reference'
];

describe('the conformance corpus', () => {
  it('is read as the editor reads it, but where the metadata worker reads it otherwise', () => {
    const differing = CONFORMANCE_CASES
      .filter((testCase) => JSON.stringify(engineOutline(testCase.markdown)) !== JSON.stringify(expectedOutline(testCase.expected)))
      .map((testCase) => testCase.name);
    expect(differing).toEqual(DIFFERENCES);
  });
});
