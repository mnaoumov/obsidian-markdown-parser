import {
  describe,
  expect,
  it
} from 'vitest';

import {
  diffFamilies,
  formatDifferential
} from './release-differential.ts';

describe('the release differential', () => {
  it('sorts each family into appeared, vanished, changed or unchanged', () => {
    const from = [{ id: 'b', kind: 'bug', total: 3 }, { id: 'c', kind: 'minor', total: 1 }, { id: 'd', kind: 'known', total: 2 }];
    const to = [{ id: 'a', kind: 'unclassified', total: 4 }, { id: 'b', kind: 'bug', total: 3 }, { id: 'd', kind: 'known', total: 5 }];
    expect(diffFamilies(from, to)).toEqual([
      { change: 'appeared', from: 0, id: 'a', kind: 'unclassified', to: 4 },
      { change: 'vanished', from: 1, id: 'c', kind: 'minor', to: 0 },
      { change: 'changed', from: 2, id: 'd', kind: 'known', to: 5 },
      { change: 'unchanged', from: 3, id: 'b', kind: 'bug', to: 3 }
    ]);
  });

  it('writes a summary line per table, and a skipped table with its reason', () => {
    const report = formatDifferential({ from: '1.0.0', to: '1.1.0' }, [
      { documents: { from: 10, to: 12 }, from: [{ id: 'a', kind: 'bug', total: 1 }], name: 'Mode judge', to: [{ id: 'a', kind: 'bug', total: 1 }] },
      { documents: { from: 5, to: 5 }, from: [{ id: 'a', kind: 'bug', total: 1 }], name: 'Live surfaces', to: [] },
      { name: 'Self-check', skipped: 'no worker oracle of 1.1.0' }
    ]);
    expect(report).toContain('- Mode judge: no family moved\n- Live surfaces: 0 appeared, 1 vanished, 0 changed\n- Self-check: skipped\n');
    expect(report).toContain('| `a` | bug | 1 | 0 | vanished |');
    expect(report).toContain('Judged 10 documents on 1.0.0 and 12 on 1.1.0.\n\nThe two versions\' oracles hold different documents');
    expect(report.match(/hold different documents/gu)).toHaveLength(1);
    expect(report).toContain('Skipped: no worker oracle of 1.1.0.');
  });
});
