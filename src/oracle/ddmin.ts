/**
 * @file
 *
 * Delta debugging: reduces a note to a minimal one that still has some property, over its lines and then over its
 * characters. The mode judge and the self-check judges reduce their findings with it.
 */

const HALVES = 2;

/**
 * Reduces a note to a minimal one that `isKept` still holds for: delta debugging over its lines, then over its
 * graphemes.
 *
 * @param text - The note, which `isKept` holds for.
 * @param isKept - Whether a candidate keeps the property.
 * @returns The reduced note.
 */
export function minimizeNote(text: string, isKept: (candidate: string) => boolean): string {
  const lines = minimizeSequence(text.split('\n'), (candidate) => isKept(candidate.join('\n')));
  // Graphemes, so a reduction never splits an emoji or a combining mark.
  const graphemes = Array.from(new Intl.Segmenter().segment(lines.join('\n')), (segment) => segment.segment);
  return minimizeSequence(graphemes, (candidate) => isKept(candidate.join(''))).join('');
}

/**
 * Zeller's ddmin: drops ever smaller chunks of `items` while `isKept` still holds, down to chunks of one.
 *
 * @param items - The items, which `isKept` holds for.
 * @param isKept - Whether a candidate keeps the property.
 * @returns The items left.
 */
export function minimizeSequence<Item>(items: readonly Item[], isKept: (candidate: readonly Item[]) => boolean): readonly Item[] {
  let current = items;
  let chunks = HALVES;
  while (current.length >= HALVES) {
    const complement = keptComplement(current, Math.ceil(current.length / chunks), isKept);
    if (complement !== null) {
      current = complement;
      chunks = Math.max(chunks - 1, HALVES);
      continue;
    }
    if (chunks >= current.length) {
      break;
    }
    chunks = Math.min(chunks * HALVES, current.length);
  }
  return current;
}

// The first of `items` less one chunk of `size` that `isKept` still holds for, or `null`.
function keptComplement<Item>(items: readonly Item[], size: number, isKept: (candidate: readonly Item[]) => boolean): null | readonly Item[] {
  for (let start = 0; start < items.length; start += size) {
    const complement = [...items.slice(0, start), ...items.slice(start + size)];
    if (complement.length > 0 && isKept(complement)) {
      return complement;
    }
  }
  return null;
}
