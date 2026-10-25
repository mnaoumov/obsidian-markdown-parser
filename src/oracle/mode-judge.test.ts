import {
  describe,
  expect,
  it
} from 'vitest';

import type { ForumIssueFile } from './forum-issues.ts';

import { EDITOR_VS_READING_VIEW_SAMPLES } from './forum-issues.ts';
import {
  familyOf,
  MODE_FAMILIES
} from './mode-families.ts';
import { JUDGED_SAMPLES } from './mode-judge-samples.ts';
import {
  differenceKey,
  judgeModes,
  judgeModesPredicted,
  parseDifferenceKey,
  reduceDifference
} from './mode-judge.ts';
import {
  forumIssueOracleFileName,
  readOracleFile
} from './oracle-location.ts';

const FORUM = readOracleFile(forumIssueOracleFileName()) as ForumIssueFile;

// Notes on which both sides read every construct the same.
const AGREEING_NOTES: readonly string[] = [
  '# Heading\n\ntext with **bold**, *em*, ==hl==, ~~del~~, `code`, $x$, [[Link]], ![[Embed]] and #tag\n',
  '- a\n- [ ] task\n  - nested\n1. one\n\n> quote\n> > nested\n',
  '```js\nconst a = 1;\n```\n',
  '---\na: 1\n---\nbody\n',
  '%% comment %%\n\n%%\nblock\n%%\n',
  '| a | b |\n|---|---|\n| 1 | 2 |\n',
  '***\n\nSetext\n===\n',
  '$$\nx^2\n$$\n',
  '> [!note] Title\n> body\n',
  'Text[^1]\n\n[^1]: Note ^abc\n'
];

function familiesOf(markdown: string): (null | string)[] {
  const keys = [...new Set(judgeModesPredicted(markdown).map((difference) => differenceKey(difference)))];
  return keys.map((key) => familyOf(key, reduceDifference(markdown, key))?.id ?? null);
}

describe('the mode judge', () => {
  it('flags every forum issue sample, on the editor\'s own tree', () => {
    const missed = EDITOR_VS_READING_VIEW_SAMPLES.filter((sample) => {
      const read = FORUM.reads.find((candidate) => candidate.markdown === sample.markdown);
      return read === undefined || judgeModes(read.markdown, read.nodes).length === 0;
    });
    expect(missed.map((sample) => sample.id)).toEqual([]);
  });

  it('puts some difference of every forum issue sample into a family of its issue', () => {
    const unmatched = EDITOR_VS_READING_VIEW_SAMPLES.filter((sample) => {
      const issues = new Set(familiesOf(sample.markdown).map((id) => MODE_FAMILIES.find((family) => family.id === id)?.issue));
      return !issues.has(sample.issue);
    });
    // The `===` run of issue 5 reduces to a highlight mark left open, which the editor shows by design.
    expect(unmatched.map((sample) => sample.id)).toEqual(['issue-5-1']);
  });

  it('flags no difference on notes both sides read the same', () => {
    expect(AGREEING_NOTES.filter((note) => judgeModesPredicted(note).length > 0)).toEqual([]);
  });

  it('puts some difference of every judged sample into its family', () => {
    const unmatched = JUDGED_SAMPLES.filter((sample) => !familiesOf(sample.markdown).includes(sample.family));
    expect(unmatched.map((sample) => sample.id)).toEqual([]);
  });

  it('has a judged sample for every candidate family but the comment block edges', () => {
    const sampled = new Set(JUDGED_SAMPLES.map((sample) => sample.family));
    const unsampled = MODE_FAMILIES.filter((family) => family.kind === 'candidate' && !sampled.has(family.id)).map((family) => family.id);
    expect(unsampled).toEqual(['comment-block-edge']);
  });

  it('marks a run of characters that crosses a line break in its key', () => {
    const keys = judgeModesPredicted('$a\nb$\n').map((difference) => differenceKey(difference));
    expect(keys).toEqual(['readingView:math+']);
    expect(parseDifferenceKey('readingView:math+')).toEqual({ fact: 'math', isMultiline: true, side: 'readingView' });
  });

  it('reduces a note to a minimal one that keeps the difference', () => {
    expect(reduceDifference('Some text.\n\n> # Heading\n\nMore text.\n', 'readingView:heading-1')).toBe('>#');
  });
});
