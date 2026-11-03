/**
 * @file
 *
 * Validates saved editing-mode readings before a bounded capture resumes them.
 */

import type { SpecOracleMeta } from '../spec/spec-oracle-file.ts';
import type {
  EditingModesDocument,
  EditingModesFile,
  EditingModesRead
} from './editing-modes.ts';

/**
 * The saved readings and the corpus and runtime they must still match.
 */
export interface ValidateEditingModesCheckpointParams {
  readonly checkpoint: EditingModesFile;
  readonly documents: readonly EditingModesDocument[];
  readonly meta: SpecOracleMeta;
}

/**
 * Validates a checkpoint before any measured reading is reused.
 *
 * @param params - The checkpoint and the current capture inputs.
 * @returns The unchanged measured readings.
 */
export function validateEditingModesCheckpoint(params: ValidateEditingModesCheckpointParams): readonly EditingModesRead[] {
  const { checkpoint, documents, meta } = params;
  if (checkpoint.meta.appVersion !== meta.appVersion || checkpoint.meta.userAgent !== meta.userAgent) {
    throw new Error('The editing-mode checkpoint version does not match the app and browser version');
  }
  if (checkpoint.reads.length > documents.length) {
    throw new Error('The editing-mode checkpoint is longer than the current corpus');
  }
  for (const [index, read] of checkpoint.reads.entries()) {
    const document = documents[index];
    if (read.id !== document?.id || read.markdown !== document.markdown || read.set !== document.set) {
      throw new Error(`The editing-mode checkpoint does not match the corpus at document ${String(index)}`);
    }
  }
  return checkpoint.reads;
}
