import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  EditingModesDocument,
  EditingModesFile,
  EditingModesRead
} from './editing-modes.ts';

import { validateEditingModesCheckpoint } from './editing-modes-checkpoint.ts';

const DOCUMENTS: readonly EditingModesDocument[] = [
  { id: 'alpha', markdown: '# Alpha', set: 'syntax' },
  { id: 'bravo', markdown: '*Bravo*', set: 'inline' }
];
const META = { appVersion: '1.15.0', userAgent: 'oracle browser' };

function checkpoint(documents: readonly EditingModesDocument[] = DOCUMENTS.slice(0, 1)): EditingModesFile {
  const reads: EditingModesRead[] = documents.map((document) => ({
    ...document,
    html: '<p>measured output</p>',
    livePreviewHtml: '<div>live preview</div>',
    metadata: { headings: [{ heading: 'Alpha' }] },
    nodes: [],
    sourceModeHtml: '<div>source</div>'
  }));
  return { meta: META, reads };
}

describe('validateEditingModesCheckpoint', () => {
  it('should retain the measured reads of an exact corpus prefix', () => {
    const saved = checkpoint();
    expect(validateEditingModesCheckpoint({ checkpoint: saved, documents: DOCUMENTS, meta: META })).toBe(saved.reads);
  });

  it('should accept an empty or complete checkpoint', () => {
    expect(validateEditingModesCheckpoint({ checkpoint: checkpoint([]), documents: DOCUMENTS, meta: META })).toEqual([]);
    expect(validateEditingModesCheckpoint({ checkpoint: checkpoint(DOCUMENTS), documents: DOCUMENTS, meta: META })).toHaveLength(2);
  });

  it('should reject mixing readings from different app or browser versions', () => {
    for (const meta of [{ ...META, appVersion: '1.14.5' }, { ...META, userAgent: 'another browser' }]) {
      expect(() => validateEditingModesCheckpoint({ checkpoint: checkpoint(), documents: DOCUMENTS, meta })).toThrow('version');
    }
  });

  it('should reject a changed, reordered or extended prefix', () => {
    for (
      const documents of [
        [{ id: 'changed', markdown: '# Alpha', set: 'syntax' }],
        [{ id: 'alpha', markdown: '# Changed', set: 'syntax' }],
        [{ id: 'alpha', markdown: '# Alpha', set: 'changed' }],
        DOCUMENTS.toReversed(),
        [...DOCUMENTS, ...DOCUMENTS]
      ]
    ) {
      expect(() => validateEditingModesCheckpoint({ checkpoint: checkpoint(documents), documents: DOCUMENTS, meta: META })).toThrow('corpus');
    }
  });
});
