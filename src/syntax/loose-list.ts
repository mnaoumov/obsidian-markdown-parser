/**
 * @file
 *
 * Obsidian's rule for a loose list, which every adapter applies with the `looseList: 'blank-line-anywhere'` quirk.
 *
 * Obsidian's parser marks a list item loose when its source holds a blank line followed by more of the item, whatever
 * block the blank line is in, and the list loose when a blank line separates two of its items. A list renders loose
 * when it or any of its items is. Together that is one test on the list's source: a blank line inside it that more of
 * the list follows.
 */

const QUOTE_MARKER_RE = /^[ \t]{0,3}>[ \t]?/u;
const BLANK_RE = /^[ \t]*$/u;

/**
 * Whether a blank line inside a list is followed by more of it.
 *
 * @param source - The list's source, from its first marker to its end.
 * @param quoteDepth - How many quotes hold the list. Their markers are taken off each line before it is checked, so a
 *   quote's empty line counts as blank.
 * @returns Whether the list is loose by Obsidian's rule.
 */
export function hasBlankLineInside(source: string, quoteDepth: number): boolean {
  let hasBlank = false;
  for (const line of source.split('\n').slice(1)) {
    let rest = line;
    for (let depth = 0; depth < quoteDepth; depth++) {
      rest = rest.replace(QUOTE_MARKER_RE, '');
    }
    if (BLANK_RE.test(rest)) {
      hasBlank = true;
    } else if (hasBlank) {
      return true;
    }
  }
  return false;
}
