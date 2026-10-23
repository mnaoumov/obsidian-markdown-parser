/**
 * @file
 *
 * The Obsidian syntax, defined once for every parser ecosystem: the node vocabulary and the lexical rules.
 *
 * The rules are written as plain functions over strings, so the `@lezer/markdown` extensions, the micromark adapter and
 * the markdown-it plugin read the same definition. They follow the editor's tokenizer (`src/editor/`), the
 * behaviour measured against Obsidian so far. `docs/syntax.md` lists the rules and where the metadata worker may differ.
 */

/**
 * The names of the syntax nodes the Obsidian syntax adds. Every adapter emits these names.
 */
export const ObsidianNode = {
  BlockId: 'BlockId',
  BlockIdMark: 'BlockIdMark',
  Callout: 'Callout',
  CalloutFold: 'CalloutFold',
  CalloutMark: 'CalloutMark',
  CalloutTitle: 'CalloutTitle',
  CalloutType: 'CalloutType',
  Comment: 'ObsidianComment',
  CommentBlock: 'ObsidianCommentBlock',
  CommentMark: 'ObsidianCommentMark',
  Embed: 'Embed',
  FootnoteDefinition: 'FootnoteDefinition',
  FootnoteLabel: 'FootnoteLabel',
  FootnoteMark: 'FootnoteMark',
  FootnoteReference: 'FootnoteReference',
  FrontMatter: 'FrontMatter',
  FrontMatterContent: 'FrontMatterContent',
  FrontMatterMark: 'FrontMatterMark',
  Highlight: 'Highlight',
  HighlightMark: 'HighlightMark',
  InlineFootnote: 'InlineFootnote',
  InlineMath: 'InlineMath',
  InternalLink: 'InternalLink',
  InternalLinkAlias: 'InternalLinkAlias',
  InternalLinkAliasMark: 'InternalLinkAliasMark',
  InternalLinkMark: 'InternalLinkMark',
  InternalLinkPath: 'InternalLinkPath',
  InternalLinkSubpath: 'InternalLinkSubpath',
  MathBlock: 'MathBlock',
  MathMark: 'MathMark',
  Tag: 'Tag',
  TagMark: 'TagMark',
  TagName: 'TagName',
  Task: 'Task',
  TaskMarker: 'TaskMarker'
} as const;

/**
 * A callout marker, `[!type]` with an optional fold sign, at the start of a quote's first line.
 */
export interface CalloutMarker {
  /**
   * The fold sign, `+` or `-`, or `null` without one.
   */
  readonly fold: null | TextRange;

  /**
   * The marker, from `[` to the `]` or the fold sign.
   */
  readonly mark: TextRange;

  /**
   * The callout type, between `[!` and `]`.
   */
  readonly type: TextRange;
}

/**
 * The start of a footnote definition, as offsets into its line's content.
 */
export interface FootnoteDefinitionStart {
  /**
   * The label, between `[^` and `]:`.
   */
  readonly label: TextRange;

  /**
   * The end of the `]:`.
   */
  readonly markEnd: number;
}

/**
 * The parts of an internal link's content, the text between `[[` and `]]`, as offsets into that content.
 */
export interface InternalLinkParts {
  /**
   * The alias after the first `|`, or `null` without one.
   */
  readonly alias: null | TextRange;

  /**
   * The `|` that opens the alias, or `null` without one.
   */
  readonly aliasMark: null | TextRange;

  /**
   * The link path, before any `#`. It may be empty, as in `[[#Heading]]`.
   */
  readonly path: TextRange;

  /**
   * The subpath from the first `#` on (a heading or a `#^block` reference), or `null` without one.
   */
  readonly subpath: null | TextRange;
}

/**
 * The size of a math delimiter: `1` for `$`, `2` for `$$`.
 */
export type MathDelimiterSize = typeof DISPLAY_MATH_SIZE | typeof INLINE_MATH_SIZE;

/**
 * A node name of the Obsidian syntax.
 */
export type ObsidianNodeName = typeof ObsidianNode[keyof typeof ObsidianNode];

/**
 * A range within a string, end exclusive.
 */
export interface TextRange {
  /**
   * The start offset.
   */
  readonly from: number;

  /**
   * The end offset.
   */
  readonly to: number;
}

/**
 * The characters a tag name is made of: anything but whitespace, ASCII punctuation other than `-`, `/` and `_`, and the
 * General and Supplemental Punctuation blocks.
 */
const TAG_NAME_RE = /^[^\u{2000}-\u{206F}\u{2E00}-\u{2E7F}'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/u;
const DIGITS_RE = /^\d+$/u;
const BLOCK_ID_RE = /^\^[A-Za-z0-9-]+$/u;
const CALLOUT_RE = /^\[!(?<type>[^\]\n]+)\](?<fold>[+-]?)/u;
const TASK_RE = /^\[(?<marker>[^\n])\](?=\s)/u;
const FOOTNOTE_DEFINITION_RE = /^\[\^(?<label>[^\]\n]+)\]:/u;
const MATH_INLINE_OPEN_RE = /^\$[^\s$]/u;
const MATH_INLINE_CLOSABLE_RE = /[^\s\\]\$/u;
// The length of the two-character openers `[^`, `^[` and `[!`.
const OPENER_LENGTH = 2;
const INLINE_MATH_SIZE = 1;
const DISPLAY_MATH_SIZE = 2;
const HIGHLIGHT_DELIMITER_MIN_LENGTH = 2;
const NODE_NAMES: ReadonlySet<string> = new Set(Object.values(ObsidianNode).map(String));

/**
 * Whether a highlight delimiter can open a highlight: it must be followed by a character that is no whitespace and no
 * `>`. Any delimiter closes an open highlight.
 *
 * @param after - The character after the delimiter, or `''` at the end of the text.
 * @returns `true` when the highlight can open.
 */
export function canOpenHighlightBefore(after: string): boolean {
  return after !== '' && !/^[\s>]$/u.test(after);
}

/**
 * Whether a `#` can open a tag after the given character: at the start of a line, or after whitespace.
 *
 * @param before - The character before the `#`, or `''` at the start of the text.
 * @returns `true` when a tag can open.
 */
export function canOpenTagAfter(before: string): boolean {
  return before === '' || /^\s$/u.test(before);
}

/**
 * Reads the size of a run of `=` that opens or closes a highlight.
 *
 * @param text - The text from the first `=` of the run.
 * @returns The length of the run. {@link isHighlightDelimiter} tells whether it is a highlight delimiter.
 */
export function equalsRunLength(text: string): number {
  let length = 0;
  while (text[length] === '=') {
    length++;
  }
  return length;
}

/**
 * Finds the `%%` that closes a comment.
 *
 * @param text - The text after the opening `%%`.
 * @returns The offset of the closing `%%`, or `-1` when there is none.
 */
export function findCommentClose(text: string): number {
  return text.indexOf('%%');
}

/**
 * Finds where an internal link's content ends: the first `]]`, with no `]` or line break before it.
 *
 * @param text - The text after the opening `[[`.
 * @returns The length of the content, or `-1` when the link does not close.
 */
export function findInternalLinkEnd(text: string): number {
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (ch === ']') {
      return text[index + 1] === ']' ? index : -1;
    }
    if (ch === '\n') {
      return -1;
    }
  }
  return -1;
}

/**
 * Finds the delimiter that closes math: the first `$` or `$$` that no backslash escapes.
 *
 * @param text - The text after the opening delimiter.
 * @param size - The size of the opening delimiter.
 * @returns The offset of the closing delimiter, or `-1` when there is none.
 */
export function findMathClose(text: string, size: MathDelimiterSize): number {
  const delimiter = '$'.repeat(size);
  for (let index = text.indexOf(delimiter); index !== -1; index = text.indexOf(delimiter, index + 1)) {
    if (text[index - 1] !== '\\') {
      return index;
    }
  }
  return -1;
}

/**
 * The character before a run of `=` that {@link isHighlightDelimiter} takes.
 *
 * @param lineBefore - The text of the run's line before it, with its container marks removed or blanked out.
 * @returns Its last character, or `''` when it is only whitespace.
 */
export function highlightDelimiterBefore(lineBefore: string): string {
  return /\S/u.test(lineBefore) ? lineBefore.slice(-1) : '';
}

/**
 * Whether the text from a `^` to the end of its line is a block id.
 *
 * @param text - The text from the `^` to the end of the line.
 * @returns `true` for a block id.
 */
export function isBlockId(text: string): boolean {
  return BLOCK_ID_RE.test(text);
}

/**
 * Whether a line opens or closes front matter. Front matter opens on the document's first line.
 *
 * @param line - The line, without its line break.
 * @returns `true` for `---`.
 */
export function isFrontMatterFence(line: string): boolean {
  return line === '---';
}

/**
 * Whether a run of `=` is a highlight delimiter, as the editor toggles a highlight on it: a run of two or more `=`,
 * except a run of exactly two with a space on each side.
 *
 * @param before - The character before the run, or `''` when only indentation and container marks come before it on
 *   its line.
 * @param length - The length of the run.
 * @param after - The character after the run, or `''` at the end of the text.
 * @returns `true` when the run is a delimiter. Any other run is text.
 */
export function isHighlightDelimiter(before: string, length: number, after: string): boolean {
  return length > HIGHLIGHT_DELIMITER_MIN_LENGTH || (length === HIGHLIGHT_DELIMITER_MIN_LENGTH && (before !== ' ' || after !== ' '));
}

/**
 * Whether a node name is one of the Obsidian syntax's.
 *
 * @param name - The node name.
 * @returns `true` for a name in {@link ObsidianNode}.
 */
export function isObsidianNodeName(name: string): name is ObsidianNodeName {
  return NODE_NAMES.has(name);
}

/**
 * Reads a callout marker at the start of a quote's content.
 *
 * @param text - The quote's content on its first line, after the `>` and its space.
 * @returns The marker, or `null` when it is none.
 */
export function matchCalloutMarker(text: string): CalloutMarker | null {
  const match = CALLOUT_RE.exec(text);
  const type = match?.groups?.['type'];
  const fold = match?.groups?.['fold'];
  if (match === null || type === undefined || fold === undefined) {
    return null;
  }
  const typeEnd = OPENER_LENGTH + type.length;
  const foldFrom = typeEnd + 1;
  return {
    fold: fold === '' ? null : { from: foldFrom, to: foldFrom + 1 },
    mark: { from: 0, to: match[0].length },
    type: { from: OPENER_LENGTH, to: typeEnd }
  };
}

/**
 * Reads the start of a footnote definition, `[^label]:`, at the start of a line's content.
 *
 * @param text - The line's content.
 * @returns The label's range and the end of the `]:`, or `null` when it is none.
 */
export function matchFootnoteDefinition(text: string): FootnoteDefinitionStart | null {
  const match = FOOTNOTE_DEFINITION_RE.exec(text);
  const label = match?.groups?.['label'];
  return match === null || label === undefined ? null : { label: { from: OPENER_LENGTH, to: OPENER_LENGTH + label.length }, markEnd: match[0].length };
}

/**
 * Reads a footnote reference, `[^label]`.
 *
 * @param text - The text from the `[`.
 * @returns The length of the reference, or `0` when it is none.
 */
export function matchFootnoteReference(text: string): number {
  if (!text.startsWith('[^')) {
    return 0;
  }
  const close = text.indexOf(']', OPENER_LENGTH);
  return close <= OPENER_LENGTH || text.slice(OPENER_LENGTH, close).includes('\n') ? 0 : close + 1;
}

/**
 * Reads an inline footnote, `^[text]`. Its text holds no `]` and no line break.
 *
 * @param text - The text from the `^`.
 * @returns The length of the inline footnote, or `0` when it is none.
 */
export function matchInlineFootnote(text: string): number {
  if (!text.startsWith('^[')) {
    return 0;
  }
  const close = text.indexOf(']', OPENER_LENGTH);
  return close === -1 || text.slice(OPENER_LENGTH, close).includes('\n') ? 0 : close + 1;
}

/**
 * Reads the size of the math delimiter at a `$`.
 *
 * @param text - The text from the `$` to the end of its line.
 * @returns `2` for `$$`, `1` for `$` before a non-space that a later `$` after a non-space can close, and `0` when the
 *   `$` opens no math.
 */
export function matchMathOpen(text: string): 0 | MathDelimiterSize {
  if (text.startsWith('$$')) {
    return DISPLAY_MATH_SIZE;
  }
  return MATH_INLINE_OPEN_RE.test(text) && MATH_INLINE_CLOSABLE_RE.test(text.slice(1)) ? INLINE_MATH_SIZE : 0;
}

/**
 * Reads a tag name after its `#`.
 *
 * @param text - The text after the `#`.
 * @returns The length of the tag name, or `0` when no tag opens (no tag characters, or digits only).
 */
export function matchTagName(text: string): number {
  const name = TAG_NAME_RE.exec(text)?.[0] ?? '';
  return DIGITS_RE.test(name) ? 0 : name.length;
}

/**
 * Reads a task marker, `[c]` for any single character `c` followed by whitespace, at the start of a list item.
 *
 * @param text - The list item's content.
 * @returns The length of the marker, or `0` when it is none.
 */
export function matchTaskMarker(text: string): number {
  return TASK_RE.exec(text)?.[0].length ?? 0;
}

/**
 * Splits an internal link's content into its path, subpath and alias.
 *
 * @param content - The text between `[[` and `]]`.
 * @returns The parts, as offsets into `content`.
 */
export function splitInternalLink(content: string): InternalLinkParts {
  const pipe = content.indexOf('|');
  // In a table, the alias pipe is escaped as `\|`, and the backslash belongs to the pipe.
  const aliasMarkFrom = pipe > 0 && content[pipe - 1] === '\\' ? pipe - 1 : pipe;
  const targetEnd = pipe === -1 ? content.length : aliasMarkFrom;
  const hash = content.slice(0, targetEnd).indexOf('#');
  const pathEnd = hash === -1 ? targetEnd : hash;
  return {
    alias: pipe === -1 ? null : { from: pipe + 1, to: content.length },
    aliasMark: pipe === -1 ? null : { from: aliasMarkFrom, to: pipe + 1 },
    path: { from: 0, to: pathEnd },
    subpath: hash === -1 ? null : { from: hash, to: targetEnd }
  };
}
