/**
 * @file
 *
 * A seeded grammar of notes for the self-check judges (`self-check.ts`). Where the oracle corpus (`corpus.ts`) joins
 * line fragments, the grammar composes whole constructs: every block of CommonMark, GFM and Obsidian (callouts, `%%`
 * comments, math, footnote definitions, block ids, front matter) holding every inline construct (internal links and
 * embeds, tags, footnote references, highlights, comments, math, escapes), nested in quotes, callouts and list items to
 * a given depth. A container's continuation line is sometimes left lazy, and a filler word is sometimes stretched across
 * the 1,024 and 4,096 character marks, the lengths at which a parser's scan windows end.
 *
 * Each note keeps its top-level blocks and the separator before each, so a judge can read a block alone and in context.
 */

/**
 * One generated note.
 */
export interface GeneratedNote {
  /**
   * Its top-level blocks, in order.
   */
  readonly blocks: readonly string[];

  /**
   * The front matter, with its closing `---` and newline, or `''`.
   */
  readonly frontMatter: string;

  /**
   * A stable identifier: `grammar-<seed>-<index>`.
   */
  readonly id: string;

  /**
   * The separator before each block after the first: `\n` or `\n\n`.
   */
  readonly separators: readonly string[];

  /**
   * The note.
   */
  readonly text: string;
}

/**
 * Options of {@link generateNotes}.
 */
export interface GenerateNotesOptions {
  /**
   * How many notes.
   *
   * @default 1000
   */
  readonly count?: number;

  /**
   * How deep containers nest.
   *
   * @default 3
   */
  readonly maxDepth?: number;

  /**
   * The random seed.
   *
   * @default 20261024
   */
  readonly seed?: number;
}

/**
 * The plain word the grammar uses as filler, and the only word the padding relation stretches.
 */
export const FILLER_WORD = 'lorem';

const DEFAULT_COUNT = 1000;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_SEED = 20_261_024;

const MULBERRY_INCREMENT = 0x6D_2B_79_F5;
const MULBERRY_SHIFT_1 = 15;
const MULBERRY_SHIFT_2 = 7;
const MULBERRY_SHIFT_3 = 14;
const MULBERRY_OR = 61;
const UINT32_RANGE = 0x1_00_00_00_00;

const MAX_BLOCKS = 5;
const MAX_INLINE_ATOMS = 4;
const MAX_HEADING_LEVEL = 6;
const BLANK_SEPARATOR_ONE_IN = 3;
const CONTAINER_ONE_IN = 3;
const FRONT_MATTER_ONE_IN = 8;
const LAZY_ONE_IN = 4;
const LONG_FILLER_ONE_IN = 12;
const SECOND_LINE_ONE_IN = 3;

// Lengths around the marks where a scan window ends: the filler is stretched to one of them, less the line's lead.
// eslint-disable-next-line no-magic-numbers -- The lengths are the data: each sits on, or just before or after, a scan window's end.
const LONG_FILLER_LENGTHS: readonly number[] = [1000, 1010, 1016, 1018, 1019, 1020, 1021, 1022, 1023, 1024, 1030, 4080, 4090, 4094, 4096, 4100];

const INLINE_ATOMS: readonly string[] = [
  FILLER_WORD,
  `${FILLER_WORD} ipsum`,
  'dolor sit',
  '[[target]]',
  '[[target|alias]]',
  '[[target#Heading]]',
  '[[target#^blockid]]',
  '![[image.png]]',
  '![[target#Heading|200]]',
  '#tag',
  '#nested/tag',
  '[^1]',
  '[^note]',
  '[^undefined]',
  '^[inline note]',
  '^[inline ^inblock]',
  '==mark==',
  '==🔴 colored==',
  '==🔴️ selector==',
  '%%hidden%%',
  '%% hidden [[target]] %%',
  '%% see [^1] %%',
  '$x^2$',
  '`code`',
  '[text](page.md)',
  '[text](https://example.com)',
  '![alt](pic.png)',
  '[text][ref]',
  '**strong**',
  '*em*',
  '~~del~~',
  String.raw`\*escaped\*`,
  String.raw`\[[escaped]]`,
  String.raw`\==escaped==`,
  '&amp;',
  'https://example.com',
  '<span>html</span>',
  '"quoted"',
  '(parenthesized)',
  'é',
  '𝒳'
];

// Atoms a paragraph may open on, beside the inline atoms: shapes a block before it may take for its own.
const PARAGRAPH_OPENERS: readonly string[] = ['"quoted text"', '(parenthesized text)', '\'single quoted\''];

const CALLOUT_TYPES: readonly string[] = ['note', 'tip', 'warning'];

const LIST_MARKERS: readonly string[] = ['- ', '* ', '1. ', '2) ', '- [ ] ', '- [x] ', '1. [ ] '];

type Rand = (k: number) => number;

const CONTAINER_KINDS = 3;
const CODE_INDENT_WIDTH = 4;
const FOUR_SPACES = ' '.repeat(CODE_INDENT_WIDTH);
const COIN_SIDES = 2;

type LeafBlock = (rand: Rand, blockId: string) => string[];

function definition(rand: Rand): string[] {
  return [isHeads(rand) ? '[ref]: https://example.com' : '[ref]: page.md "Title"'];
}

function openedParagraph(rand: Rand, blockId: string): string[] {
  const opener = pick(rand, PARAGRAPH_OPENERS);
  return [isHeads(rand) ? opener : `${opener} ${inline(rand, 0)}${blockId}`];
}

function paragraph(rand: Rand, blockId: string): string[] {
  const lines = [inline(rand, 0)];
  if (rand(SECOND_LINE_ONE_IN) === 0) {
    lines.push(inline(rand, 0));
  }
  return [...lines.slice(0, -1), `${lines.at(-1) ?? ''}${blockId}`];
}

// The leaf blocks; definitions and paragraphs opening on a quote or a parenthesis are listed twice, since what they do to each other needs both in a row.
const LEAF_BLOCKS: readonly LeafBlock[] = [
  (rand, blockId): string[] => {
    const level = 1 + rand(MAX_HEADING_LEVEL);
    return [`${'#'.repeat(level)} ${inline(rand, level + 1)}${blockId}`];
  },
  (rand): string[] => [inline(rand, 0), isHeads(rand) ? '===' : '---'],
  (rand): string[] => ['%%', inline(rand, 0), '%%'],
  (rand): string[] => {
    // A `%%` that opens a block comment with text on its line, closed on a later line or never.
    const lines = [`%% ${inline(rand, '%% '.length)}`, inline(rand, 0)];
    return isHeads(rand) ? [...lines, '%%'] : lines;
  },
  (rand): string[] => {
    const label = isHeads(rand) ? '1' : 'note';
    const lines = [`[^${label}]: ${inline(rand, label.length + '[^]: '.length)}`];
    if (rand(SECOND_LINE_ONE_IN) === 0) {
      lines.push(`${FOUR_SPACES}${inline(rand, FOUR_SPACES.length)}`);
    }
    return lines;
  },
  definition,
  definition,
  (rand): string[] => ['| a | b |', '| - | - |', `| ${inline(rand, '| '.length)} | ${FILLER_WORD} |`],
  (): string[] => ['```', 'code [[not a link]] #nottag', '```'],
  (): string[] => ['$$', 'x^2 + [[not a link]]', '$$'],
  (): string[] => ['***'],
  openedParagraph,
  openedParagraph,
  paragraph,
  paragraph
];

/**
 * Generates notes. The same options always give the same notes.
 *
 * @param options - How many notes, how deep and which seed.
 * @returns The notes.
 */
export function generateNotes(options: GenerateNotesOptions = {}): GeneratedNote[] {
  const { count = DEFAULT_COUNT, maxDepth = DEFAULT_MAX_DEPTH, seed = DEFAULT_SEED } = options;
  const rand = mulberry32(seed);
  const notes: GeneratedNote[] = [];
  for (let index = 0; index < count; index++) {
    const blockCount = 1 + rand(MAX_BLOCKS);
    const blocks: string[] = [];
    const separators: string[] = [];
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
      if (blockIndex > 0) {
        separators.push(rand(BLANK_SEPARATOR_ONE_IN) === 0 ? '\n' : '\n\n');
      }
      blocks.push(block(rand, maxDepth).join('\n'));
    }
    const frontMatter = rand(FRONT_MATTER_ONE_IN) === 0 ? '---\nk: "[[target]]"\ntags: [a]\n---\n' : '';
    notes.push({ blocks, frontMatter, id: `grammar-${String(seed)}-${String(index)}`, separators, text: joinBlocks(blocks, separators, frontMatter) });
  }
  return notes;
}

/**
 * Joins a note's blocks back into text, as {@link generateNotes} does.
 *
 * @param blocks - The blocks.
 * @param separators - The separator before each block after the first.
 * @param frontMatter - The front matter, or `''`.
 * @returns The note.
 */
export function joinBlocks(blocks: readonly string[], separators: readonly string[], frontMatter = ''): string {
  return `${frontMatter + blocks.map((text, index) => (separators[index - 1] ?? '') + text).join('')}\n`;
}

function block(rand: Rand, depth: number): string[] {
  return depth > 0 && rand(CONTAINER_ONE_IN) === 0 ? container(rand, depth) : leafBlock(rand);
}

function container(rand: Rand, depth: number): string[] {
  const inner = block(rand, depth - 1);
  const isLazy = rand(LAZY_ONE_IN) === 0;
  switch (rand(CONTAINER_KINDS)) {
    case 0: {
      return prefixLines(inner, '> ', isLazy ? '' : '> ');
    }
    case 1: {
      const type = pick(rand, CALLOUT_TYPES);
      const title = isHeads(rand) ? '' : ` ${inline(rand, 0)}`;
      return [`> [!${type}]${title}`, ...prefixLines(inner, '> ', isLazy ? '' : '> ')];
    }
    default: {
      const marker = pick(rand, LIST_MARKERS);
      return prefixLines(inner, marker, isLazy ? '' : ' '.repeat(marker.replace(/\[.\] $/u, '').length));
    }
  }
}

function inline(rand: Rand, lead: number): string {
  const atoms: string[] = [];
  const count = 1 + rand(MAX_INLINE_ATOMS);
  for (let index = 0; index < count; index++) {
    atoms.push(pick(rand, INLINE_ATOMS));
  }
  if (rand(LONG_FILLER_ONE_IN) === 0) {
    const used = lead + atoms.join(' ').length + 1;
    const length = Math.max(1, pick(rand, LONG_FILLER_LENGTHS) - used - FILLER_WORD.length);
    atoms.push(FILLER_WORD + 'x'.repeat(length));
  }
  return atoms.join(' ');
}

function isHeads(rand: Rand): boolean {
  return rand(COIN_SIDES) === 0;
}

function leafBlock(rand: Rand): string[] {
  const blockId = isHeads(rand) ? ' ^blockid' : '';
  return pick(rand, LEAF_BLOCKS)(rand, blockId);
}
/* eslint-disable no-bitwise -- Mulberry32 is defined by its 32-bit integer operations. */
// Mulberry32: the corpus's linear congruential generator makes some runs of draws impossible, such as a definition and then a
// paragraph opening on a quote.
function mulberry32(seed: number): Rand {
  let state = seed >>> 0;
  return (k): number => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> MULBERRY_SHIFT_1), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> MULBERRY_SHIFT_2), mixed | MULBERRY_OR);
    return Math.floor((((mixed ^ (mixed >>> MULBERRY_SHIFT_3)) >>> 0) / UINT32_RANGE) * k);
  };
}
/* eslint-enable no-bitwise -- Only Mulberry32 needs them. */

function pick<Item>(rand: Rand, items: readonly Item[]): Item {
  const item = items[rand(items.length)];
  if (item === undefined) {
    throw new Error('Cannot pick from an empty list');
  }
  return item;
}

function prefixLines(lines: readonly string[], first: string, rest: string): string[] {
  return lines.map((line, index) => (index === 0 ? first : rest) + line);
}
