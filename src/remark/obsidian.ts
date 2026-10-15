/**
 * @file
 *
 * The Obsidian syntax as tokenizers and tree transforms of the `remark-parse` 8 engine: front matter, internal links
 * and embeds, tags, `%%` comments, inline and block math, highlights, footnotes with inline notes, and block ids.
 *
 * Their rules are the metadata worker's, which reads them as `remark-parse` 8 tokenizers too, so where the editor
 * reads a construct differently (`docs/syntax.md`), these follow the worker. They are re-expressed from the behaviour
 * the worker shows and measured against its `CachedMetadata`; nothing is taken from the app's bundle.
 */

/* eslint-disable unicorn/prefer-code-point -- The tokenizers measure UTF-16 code units, as the ported ones do. */

import type {
  BlockTokenizerName,
  Eat,
  InlineTokenizer,
  InlineTokenizerName,
  RemarkParser,
  RemarkTokenizers,
  TokenizerResult
} from './parser.ts';
import type {
  RemarkHighlight,
  RemarkNode,
  RemarkParent,
  RemarkRoot
} from './types.ts';

import { BLOCK_TOKENIZERS } from './block.ts';
import { INLINE_TOKENIZERS } from './inline.ts';
import {
  BLOCK_METHODS,
  INLINE_METHODS,
  INTERRUPT_BLOCKQUOTE,
  INTERRUPT_LIST,
  INTERRUPT_PARAGRAPH
} from './parser.ts';

/**
 * What {@link parseInternalLink} reads from the content of an internal link.
 */
export interface InternalLinkParts {
  /**
   * The text after the first `|`, trimmed, or `null` without one.
   */
  readonly alias: null | string;

  /**
   * The text it shows.
   */
  readonly displayText: string;

  /**
   * The target, normalized.
   */
  readonly target: string;
}

interface FootnoteLine {
  readonly contentEnd: number;
  readonly contentStart: number;
  end: number;
  readonly start: number;
}

const TAB = 9;
const LINE_FEED = 10;
const SPACE = 32;
const EXCLAMATION_MARK = 33;
const DOLLAR = 36;
const PERCENT = 37;
const COLON = 58;
const LEFT_BRACKET = 91;
const BACKSLASH = 92;
const RIGHT_BRACKET = 93;
const CARET = 94;
const GRAVE_ACCENT = 96;
const DIGIT_ZERO = 48;
const DIGIT_NINE = 57;
const TAB_SIZE = 4;
const MIN_MATH_FENCE = 2;
const DELIMITER_LENGTH = 2;

/*
 * A footnote definition looks this far into the document, not this far past the line it tests, for a block that ends
 * it: a line that starts past it is never interrupted.
 */
const FOOTNOTE_INTERRUPT_LOOKAHEAD_END = 1024;

const WHITESPACE_RE = /\s/u;
const FRONTMATTER_FENCE = '---';
const INTERNAL_LINK_RE = /^(?<embed>!?)\[\[(?<content>.+?)\]\]/u;
const INTERNAL_LINK_START_RE = /!?\[\[/gu;
const TAG_RE = /^#[^\u{2000}-\u{206F}\u{2E00}-\u{2E7F}'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/u;
const NUMBER_TAG_RE = /^#\d+$/u;
const INLINE_BLOCK_ID_RE = /^\^(?<id>[a-zA-Z0-9-]+)$/u;
const BLOCK_ID_RE = /^\^(?<id>[a-zA-Z0-9-]+)(?=$|\n$|\n\n)/u;
const INLINE_COMMENT_RE = /^%%(?<content>.*?)%%/u;
const NO_BREAK_SPACE = '\u{A0}';

// The colored squares and circles that open a highlight to give it a color.
const HIGHLIGHT_COLORS: Readonly<Record<string, string>> = {
  '🔴': 'red',
  '🔵': 'blue',
  '🟠': 'orange',
  '🟡': 'yellow',
  '🟢': 'green',
  '🟣': 'purple',
  '🟥': 'red',
  '🟦': 'blue',
  '🟧': 'orange',
  '🟨': 'yellow',
  '🟩': 'green',
  '🟪': 'purple'
};

/**
 * The block tokenizers with the Obsidian syntax, in the order Obsidian tries them.
 */
export const OBSIDIAN_BLOCK_METHODS: readonly BlockTokenizerName[] = insertAll(BLOCK_METHODS, [
  ['frontmatter', 'blankLine'],
  ['math', 'fencedCode'],
  ['comment', 'fencedCode'],
  ['footnoteDefinition', 'definition'],
  ['blockId', 'paragraph']
]);

/**
 * The inline tokenizers with the Obsidian syntax, in the order Obsidian tries them.
 */
export const OBSIDIAN_INLINE_METHODS: readonly InlineTokenizerName[] = insertAll(INLINE_METHODS, [
  ['internalLink', 'link'],
  ['inlineFootnote', 'reference'],
  ['footnoteReference', 'reference'],
  ['highlight', 'text'],
  ['tag', 'text'],
  ['inlineMath', 'text'],
  ['blockId', 'text'],
  ['comment', 'text']
]);

/*
 * The blocks that end a footnote definition at a line indented less than a tab: those that existed when Obsidian's
 * footnote extension was added, but blank lines, indented code and paragraphs, and other footnote definitions.
 */
const INTERRUPT_FOOTNOTE_DEFINITION: readonly BlockTokenizerName[] = [
  'math',
  'fencedCode',
  'blockquote',
  'atxHeading',
  'thematicBreak',
  'list',
  'setextHeading',
  'html',
  'definition',
  'table',
  'footnoteDefinition'
];

/**
 * The tokenizers of the engine with the Obsidian syntax.
 */
export const OBSIDIAN_TOKENIZERS: RemarkTokenizers = {
  block: {
    ...BLOCK_TOKENIZERS,
    blockId: blockIdBlock,
    comment: commentBlock,
    definition: definitionUnlessFootnote,
    footnoteDefinition,
    frontmatter,
    math: mathBlock
  },
  blockMethods: OBSIDIAN_BLOCK_METHODS,
  inline: {
    ...INLINE_TOKENIZERS,
    blockId: { locator: locateBlockId, tokenize: blockIdInline },
    comment: { locator: locateComment, tokenize: commentInline },
    footnoteReference: { locator: locateFootnoteReference, tokenize: footnoteReference },
    highlight: { locator: locateHighlight, tokenize: highlight },
    inlineFootnote: { locator: locateInlineFootnote, tokenize: inlineFootnote },
    inlineMath: { locator: locateInlineMath, tokenize: inlineMath },
    internalLink: { locator: locateInternalLink, tokenize: internalLink },
    reference: { locator: INLINE_TOKENIZERS.reference?.locator ?? locateNothing, tokenize: referenceUnlessFootnote },
    tag: { locator: locateTag, tokenize: tag }
  },
  inlineMethods: OBSIDIAN_INLINE_METHODS,
  interruptBlockquote: insertAll(INTERRUPT_BLOCKQUOTE, [['math', 'fencedCode', true], ['comment', 'fencedCode', true]]),
  interruptList: insertAll(INTERRUPT_LIST, [['math', 'fencedCode', true], ['comment', 'fencedCode', true]]),
  interruptParagraph: insertAll(INTERRUPT_PARAGRAPH, [['math', 'fencedCode', true], ['comment', 'fencedCode', true]])
};

/**
 * The `break` tokenizer with Obsidian's `breaks` option, which the metadata worker runs: a line feed after any spaces
 * is a hard break, however few the spaces.
 */
export const SOFT_BREAK_AS_HARD_TOKENIZER: InlineTokenizer = {
  locator: INLINE_TOKENIZERS.break?.locator ?? locateNothing,
  tokenize: softBreakAsHard
};

/**
 * Normalizes a link path as Obsidian does: no-break spaces made spaces, trimmed, and in Unicode normal form C.
 *
 * @param path - The path.
 * @returns The normalized path.
 */
export function normalizeLinkPath(path: string): string {
  return path.replaceAll(NO_BREAK_SPACE, ' ').trim().normalize('NFC');
}

/**
 * Reads the content of an internal link, between its brackets: the alias starts at the first `|` that is not the
 * first character, and is trimmed; the target is the text before it, trimmed, with a final backslash taken off and
 * normalized; the text it shows is the alias, or else the target with each run of `#` made ` > `.
 *
 * @param content - The content.
 * @returns The alias, the text it shows and the target.
 */
export function parseInternalLink(content: string): InternalLinkParts {
  const pipe = content.indexOf('|');
  const hasAlias = pipe > 0;
  let target = hasAlias ? content.slice(0, pipe).trim() : content.trim();
  const alias = hasAlias ? content.slice(pipe + 1).trim() : null;
  const displayText = alias ?? target.split('#').filter(Boolean).join(' > ').trim();

  if (target.endsWith('\\')) {
    target = target.slice(0, -1);
  }

  return { alias, displayText, target: normalizeLinkPath(target) };
}

/**
 * Applies the transforms Obsidian runs on the tree that change what it holds: a footnote reference to no definition
 * becomes the text of its label, lowercased, and each block id is attached to its block.
 *
 * A block id that is a block of its own is attached to the block before it and taken out of the tree. A block of the
 * document takes the last block id inside it, and a list item, at any depth, the first inside it outside its nested
 * lists. The inside of an inline footnote is not searched, as Obsidian has moved it out of the tree by then.
 *
 * @param root - The tree, changed in place.
 */
export function transformObsidianTree(root: RemarkRoot): void {
  resolveFootnoteReferences(root);
  attachBlockIds(root);
}

// After `$$`, the whitespace up to and including a line feed; none when a character that is no whitespace comes first.
function afterTrailingLineEnd(value: string, from: number): number {
  for (let index = from; index < value.length; index++) {
    const character = value.charAt(index);
    if (character === '\n') {
      return index + 1;
    }
    if (!WHITESPACE_RE.test(character)) {
      break;
    }
  }
  return from;
}

function attachBlockIds(root: RemarkRoot): void {
  const children = root.children;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];

    if (child?.type === 'blockId') {
      const previous = children[index - 1];
      if (previous) {
        previous.id = child.value;
      }
      children.splice(index, 1);
      index--;
      continue;
    }

    if (child?.type === 'list') {
      forEachListItem(child, (item) => {
        const id = firstBlockIdOutsideLists(item);
        if (id) {
          item.id = id;
        }
      });
      continue;
    }

    const id = child && lastBlockId(child);
    if (id) {
      child.id = id;
    }
  }
}

function blockIdBlock(_parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const match = BLOCK_ID_RE.exec(value);
  if (!match) {
    return;
  }
  return isSilent || eat(match[0])({ type: 'blockId', value: match.groups?.['id'] ?? '' });
}

// Only the rest of the inline content, to its end, can be a block id.
function blockIdInline(_parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const match = INLINE_BLOCK_ID_RE.exec(value);
  if (!match) {
    return;
  }
  return isSilent || eat(match[0])({ type: 'blockId', value: match.groups?.['id'] ?? '' });
}

/*
 * A line opening with `%%`, after any spaces, with no `%` after it on the line, runs to the next `%%`, wherever it is,
 * or to the end of its container. Its text is tokenized as inline content from the block's start, not the text's.
 */
function commentBlock(parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const length = value.length;
  let index = skip(value, 0, SPACE);

  if (value.charCodeAt(index) !== PERCENT || value.charCodeAt(index + 1) !== PERCENT) {
    return;
  }

  index += DELIMITER_LENGTH;
  const contentStart = index;

  for (; index < length; index++) {
    const code = value.charCodeAt(index);
    if (code === PERCENT) {
      return;
    }
    if (code === LINE_FEED) {
      break;
    }
  }

  if (isSilent) {
    return true;
  }

  const close = value.indexOf('%%', index);
  const contentEnd = close === -1 ? length : close;
  const end = close === -1 ? length : close + DELIMITER_LENGTH;
  const content = value.slice(contentStart, contentEnd);
  const start = eat.now();
  const add = eat(value.slice(0, end));

  return add({ children: parser.tokenizeInline(content, start), type: 'obsidianCommentBlock', value: content });
}

// `%%text%%` on one line.
function commentInline(parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const match = INLINE_COMMENT_RE.exec(value);
  if (!match) {
    return;
  }
  if (isSilent) {
    return true;
  }
  const content = match.groups?.['content'] ?? '';
  const start = shifted(eat, DELIMITER_LENGTH);
  const add = eat(match[0]);
  return add({ children: parser.tokenizeInline(content, start), type: 'obsidianComment', value: content });
}

// A `[^label]:` line is a footnote definition, never a link reference definition.
function definitionUnlessFootnote(parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const index = skipWhitespace(value, 0);
  if (value.charCodeAt(index) !== LEFT_BRACKET || value.charCodeAt(index + 1) === CARET) {
    return;
  }
  return BLOCK_TOKENIZERS.definition?.(parser, eat, value, isSilent);
}

function firstBlockIdOutsideLists(item: RemarkNode): string | undefined {
  if (!('children' in item) || item.type === 'inlineFootnote') {
    return undefined;
  }
  for (const child of item.children) {
    if (child.type === 'blockId') {
      return child.value;
    }
    if (child.type === 'list') {
      continue;
    }
    const id = firstBlockIdOutsideLists(child);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

/*
 * `[^label]:`, after any spaces and tabs, with a label of no whitespace. The definition goes on over lines indented by
 * more than a tab, over lines that follow a line with content unless a block that ends it starts them, and over
 * blank lines; a line indented less than a tab after a blank line ends it. Each line's content starts at its first
 * character past its indentation, or past a tab's width of it.
 */
// eslint-disable-next-line complexity -- One pass over the lines, with the indentation and content of each.
function footnoteDefinition(parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  // One past the end, where `charCodeAt` gives `NaN` and the last line is closed.
  const limit = value.length + 1;
  let index = skipWhitespace(value, 0);

  if (value.charCodeAt(index) !== LEFT_BRACKET || value.charCodeAt(index + 1) !== CARET) {
    return;
  }

  index += DELIMITER_LENGTH;
  const labelStart = index;
  let labelEnd: number | undefined;

  for (; index < limit; index++) {
    const code = value.charCodeAt(index);
    if (code === LINE_FEED || code === TAB || code === SPACE || Number.isNaN(code)) {
      return;
    }
    if (code === RIGHT_BRACKET) {
      labelEnd = index;
      index++;
      break;
    }
  }

  if (labelEnd === undefined || labelStart === labelEnd || value.charCodeAt(index) !== COLON) {
    return;
  }

  index++;

  if (isSilent) {
    return true;
  }

  const label = value.slice(labelStart, labelEnd);
  const start = eat.now();
  const lines: FootnoteLine[] = [];
  let lineStart = 0;
  // The columns of indentation read on the line so far, until its content starts.
  let indent: number | undefined = 0;
  let contentStart: number | undefined = index;
  let previous: FootnoteLine | undefined;

  for (; index < limit; index++) {
    const code = value.charCodeAt(index);

    if (code === LINE_FEED || Number.isNaN(code)) {
      previous = { contentEnd: index, contentStart: contentStart ?? index, end: index, start: lineStart };
      lines.push(previous);
      if (code === LINE_FEED) {
        lineStart = index + 1;
        indent = 0;
        contentStart = undefined;
        previous.end = lineStart;
      }
    } else if (indent !== undefined) {
      if (code === SPACE || code === TAB) {
        indent += code === SPACE ? 1 : TAB_SIZE - (indent % TAB_SIZE);
        if (indent > TAB_SIZE) {
          indent = undefined;
          contentStart = index;
        }
      } else {
        const isEnded = indent < TAB_SIZE && previous !== undefined
          && (previous.contentStart === previous.contentEnd
            || parser.interrupts(INTERRUPT_FOOTNOTE_DEFINITION, eat, value.slice(index, FOOTNOTE_INTERRUPT_LOOKAHEAD_END)));
        if (isEnded) {
          break;
        }
        indent = undefined;
        contentStart = index;
      }
    }
  }

  let count = lines.length;
  while (count > 1 && isBlankLine(lines[count - 1])) {
    count--;
  }
  const last = lines[count - 1];
  if (count === 1 && isBlankLine(last)) {
    count = 0;
  }

  const add = eat(value.slice(0, last?.contentEnd ?? 0));
  const offsets = parser.offset;
  const content: string[] = [];

  for (let lineIndex = 0; lineIndex < count; lineIndex++) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }
    const lineNumber = start.line + lineIndex;
    offsets.set(lineNumber, (offsets.get(lineNumber) ?? 0) + line.contentStart - line.start);
    content.push(value.slice(line.contentStart, line.end));
  }

  const exit = parser.enterBlock();
  const children = parser.tokenizeBlock(content.join(''), start);
  exit();

  return add({ children, identifier: label.toLowerCase(), label, type: 'footnoteDefinition' });
}

// `[^label]`, with a label of no whitespace.
function footnoteReference(_parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  if (value.charCodeAt(0) !== LEFT_BRACKET || value.charCodeAt(1) !== CARET) {
    return;
  }

  const limit = value.length + 1;
  let index = DELIMITER_LENGTH;
  let labelEnd: number | undefined;

  for (; index < limit; index++) {
    const code = value.charCodeAt(index);
    if (code === LINE_FEED || code === TAB || code === SPACE || Number.isNaN(code)) {
      return;
    }
    if (code === RIGHT_BRACKET) {
      labelEnd = index;
      index++;
      break;
    }
  }

  if (labelEnd === undefined || labelEnd === DELIMITER_LENGTH) {
    return;
  }
  if (isSilent) {
    return true;
  }

  const label = value.slice(DELIMITER_LENGTH, labelEnd);
  return eat(value.slice(0, index))({ identifier: label.toLowerCase(), label, type: 'footnoteReference' });
}

function forEachListItem(node: RemarkNode, callback: (item: RemarkNode) => void): void {
  if (node.type === 'listItem') {
    callback(node);
  }
  if ('children' in node && node.type !== 'inlineFootnote') {
    for (const child of node.children) {
      forEachListItem(child, callback);
    }
  }
}

// A first line `---`, up to the next line that opens with `---`, at the very start of the document.
function frontmatter(parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  if (!parser.atStart || !value.startsWith(`${FRONTMATTER_FENCE}\n`)) {
    return;
  }

  let close = value.indexOf(FRONTMATTER_FENCE, FRONTMATTER_FENCE.length);
  while (close !== -1 && value.charAt(close - 1) !== '\n') {
    close = value.indexOf(FRONTMATTER_FENCE, close + FRONTMATTER_FENCE.length);
  }

  if (close === -1) {
    return;
  }
  return isSilent || eat(value.slice(0, close + FRONTMATTER_FENCE.length))({ type: 'yaml', value: value.slice(FRONTMATTER_FENCE.length + 1, close - 1) });
}

/*
 * `==` before a non-space, closed by the first `==` after a character that is no whitespace. Four `=` open nothing. A
 * colored square or circle opening the text gives the highlight its color and is no part of its content.
 */
function highlight(parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  if (!value.startsWith('==') || value.startsWith('====') || WHITESPACE_RE.test(value.charAt(DELIMITER_LENGTH))) {
    return;
  }

  const content = highlightContent(value);
  if (content === undefined) {
    return;
  }
  if (isSilent) {
    return true;
  }

  const marker = String.fromCodePoint(content.codePointAt(0) ?? 0);
  const color = HIGHLIGHT_COLORS[marker] ?? null;
  const markerLength = color ? marker.length : 0;
  const start = shifted(eat, DELIMITER_LENGTH + markerLength);
  const add = eat(`==${content}==`);
  const node: RemarkHighlight = { children: parser.tokenizeInline(content.slice(markerLength), start), color, type: 'highlight' };
  return add(node);
}

/*
 * `$tex$` and `$$tex$$`. A single `$` opens before a character that is no space or tab, and closes at a `$` after one,
 * not before a digit; a backslash escapes the character after it. `$$` closes at the next `$$`, and takes the
 * whitespace after it up to and including a line feed. `\$` is the text `$`.
 */

// The content of a highlight `value` opens: up to the first `==` after a character that is no whitespace.
function highlightContent(value: string): string | undefined {
  // The content read so far lags one character behind the cursor, so the `=` before a closing one is not in it.
  let content = '';
  let previous = '';
  let beforePrevious = '';

  for (let index = DELIMITER_LENGTH; index < value.length; index++) {
    const character = value.charAt(index);
    if (character === '=' && previous === '=' && !(beforePrevious && WHITESPACE_RE.test(beforePrevious))) {
      return content;
    }
    content += previous;
    beforePrevious = previous;
    previous = character;
  }

  return undefined;
}

/*
 * `^[text]`, closed by the `]` that balances its brackets, outside code spans and past backslash escapes. The text is
 * inline content.
 */
function inlineFootnote(parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  if (value.charCodeAt(0) !== CARET || value.charCodeAt(1) !== LEFT_BRACKET) {
    return;
  }

  const limit = value.length + 1;
  let index = DELIMITER_LENGTH;
  let depth = 0;
  // The length of the backtick run that opened the code span the cursor is in.
  let codeFence: number | undefined;
  let contentEnd: number | undefined;

  while (contentEnd === undefined && index < limit) {
    const code = value.charCodeAt(index);

    if (Number.isNaN(code)) {
      return;
    }

    if (code === GRAVE_ACCENT) {
      const run = skip(value, index, GRAVE_ACCENT) - index;
      if (codeFence === undefined) {
        codeFence = run;
      } else if (codeFence === run) {
        codeFence = undefined;
      }
      index += run;
      continue;
    }

    if (codeFence !== undefined) {
      index++;
      continue;
    }

    if (code === BACKSLASH) {
      index += DELIMITER_LENGTH;
      continue;
    }

    if (code === LEFT_BRACKET) {
      depth++;
    } else if (code === RIGHT_BRACKET) {
      if (depth === 0) {
        contentEnd = index;
      } else {
        depth--;
      }
    }
    index++;
  }

  if (contentEnd === undefined) {
    return;
  }
  if (isSilent) {
    return true;
  }

  const start = shifted(eat, DELIMITER_LENGTH);
  const add = eat(value.slice(0, index));
  return add({ children: parser.tokenizeInline(value.slice(DELIMITER_LENGTH, contentEnd), start), type: 'inlineFootnote' });
}

function inlineMath(_parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const length = value.length;
  const isEscaped = value.charCodeAt(0) === BACKSLASH;
  let index = isEscaped ? 1 : 0;

  if (value.charCodeAt(index) !== DOLLAR) {
    return;
  }

  index++;

  if (isEscaped) {
    return isSilent || eat(value.slice(0, index))({ type: 'text', value: '$' });
  }

  const isDisplay = value.charCodeAt(index) === DOLLAR;
  if (isDisplay) {
    index++;
  }

  if (!isDisplay && isSpaceOrTab(value.charCodeAt(index))) {
    return;
  }

  const contentStart = index;
  let contentEnd: number | undefined;

  for (; index < length; index++) {
    const code = value.charCodeAt(index);

    if (code === BACKSLASH) {
      index++;
      continue;
    }

    if (code !== DOLLAR) {
      continue;
    }

    const next = value.charCodeAt(index + 1);
    const isClosing = isDisplay
      ? next === DOLLAR
      : !isSpaceOrTab(value.charCodeAt(index - 1)) && !(next >= DIGIT_ZERO && next <= DIGIT_NINE);

    if (isClosing) {
      contentEnd = index;
      index++;
      if (isDisplay) {
        index = afterTrailingLineEnd(value, index + 1);
      }
      break;
    }
  }

  if (contentEnd === undefined) {
    return;
  }
  return isSilent || eat(value.slice(0, index))({ display: isDisplay, type: 'inlineMath', value: value.slice(contentStart, contentEnd) });
}

function insertAll<Name extends string>(methods: readonly Name[], insertions: readonly (readonly [name: Name, anchor: Name, isAfter?: boolean])[]): Name[] {
  const result = [...methods];
  for (const [name, anchor, isAfter] of insertions) {
    const index = result.indexOf(anchor);
    result.splice(index + (isAfter ? 1 : 0), 0, name);
  }
  return result;
}

/*
 * `[[target|alias]]` or `![[target|alias]]` on one line, closed by the first `]]`, with no `[[` inside. The alias starts
 * at the first `|` that is not the first character.
 */
function internalLink(_parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const match = INTERNAL_LINK_RE.exec(value);
  const content = match?.groups?.['content']?.trim();

  if (!match || content === undefined || content.includes('[[')) {
    return;
  }
  if (isSilent) {
    return true;
  }

  return eat(match[0])({ ...parseInternalLink(content), type: match.groups?.['embed'] ? 'embed' : 'internalLink' });
}

function isBlankLine(line: FootnoteLine | undefined): boolean {
  return line !== undefined && line.contentStart === line.contentEnd;
}

function isSpaceOrTab(code: number): boolean {
  return code === SPACE || code === TAB;
}

function lastBlockId(node: RemarkNode): string | undefined {
  if (node.type === 'blockId') {
    return node.value;
  }
  if (!('children' in node) || node.type === 'inlineFootnote') {
    return undefined;
  }
  let id: string | undefined;
  for (const child of node.children) {
    id = lastBlockId(child) ?? id;
  }
  return id;
}

// A `^` at the start of no inline content, after whitespace.
function locateBlockId(_parser: RemarkParser, value: string, fromIndex: number): number {
  for (let index = value.indexOf('^', fromIndex); index !== -1; index = value.indexOf('^', index + 1)) {
    if (index <= 0) {
      return -1;
    }
    if (WHITESPACE_RE.test(value.charAt(index - 1))) {
      return index;
    }
  }
  return -1;
}

function locateComment(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('%%', fromIndex);
}

function locateFootnoteReference(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('[', fromIndex);
}

function locateHighlight(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('==', fromIndex);
}

function locateInlineFootnote(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('^[', fromIndex);
}

function locateInlineMath(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('$', fromIndex);
}

function locateInternalLink(_parser: RemarkParser, value: string, fromIndex: number): number {
  INTERNAL_LINK_START_RE.lastIndex = fromIndex;
  return INTERNAL_LINK_START_RE.exec(value)?.index ?? -1;
}

// A `#` at the start of the inline content, or after whitespace.
function locateNothing(): number {
  return -1;
}

function locateTag(_parser: RemarkParser, value: string, fromIndex: number): number {
  for (let index = value.indexOf('#', fromIndex); index !== -1; index = value.indexOf('#', index + 1)) {
    if (index <= 0 || WHITESPACE_RE.test(value.charAt(index - 1))) {
      return index;
    }
  }
  return -1;
}

/*
 * A line of two or more `$`, after any spaces, with no `$` after them on the line, and a line after it. It runs to a
 * line whose only `$` close it, at least as many as opened it, after any content, or to the end of its container. Each
 * line loses as many leading spaces as the opening line had.
 */
// eslint-disable-next-line complexity -- One pass over the lines, with the closing rule.
function mathBlock(_parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const length = value.length;
  const indent = skip(value, 0, SPACE);
  let index = skip(value, indent, DOLLAR);
  const fenceSize = index - indent;

  if (fenceSize < MIN_MATH_FENCE) {
    return;
  }

  index = skip(value, index, SPACE);
  const firstLineStart = index;

  for (; index < length; index++) {
    const code = value.charCodeAt(index);
    if (code === DOLLAR) {
      return;
    }
    if (code === LINE_FEED) {
      break;
    }
  }

  if (value.charCodeAt(index) !== LINE_FEED) {
    return;
  }
  if (isSilent) {
    return true;
  }

  const lines: string[] = [];
  if (firstLineStart !== index) {
    lines.push(value.slice(firstLineStart, index));
  }

  let lineStart = index + 1;
  // A line's end is looked for from its second character, so an empty line runs on into the next.
  let lineEnd = nextLineEnd(value, lineStart);

  while (lineStart < length) {
    let trimmedEnd = lineEnd;
    while (trimmedEnd > lineStart && value.charCodeAt(trimmedEnd - 1) === SPACE) {
      trimmedEnd--;
    }
    let closeSize = 0;
    while (trimmedEnd > lineStart && value.charCodeAt(trimmedEnd - 1) === DOLLAR) {
      closeSize++;
      trimmedEnd--;
    }

    const isClosing = fenceSize <= closeSize && value.indexOf('$', lineStart) === trimmedEnd;
    let contentStart = lineStart;
    let contentEnd = isClosing ? trimmedEnd : lineEnd;

    while (contentStart <= contentEnd && contentStart - lineStart < indent && value.charCodeAt(contentStart) === SPACE) {
      contentStart++;
    }

    if (isClosing) {
      while (contentEnd > contentStart && value.charCodeAt(contentEnd - 1) === SPACE) {
        contentEnd--;
      }
      if (contentStart !== contentEnd) {
        lines.push(value.slice(contentStart, contentEnd));
      }
      break;
    }

    lines.push(value.slice(contentStart, contentEnd));
    lineStart = lineEnd + 1;
    lineEnd = nextLineEnd(value, lineStart);
  }

  return eat(value.slice(0, lineEnd))({ type: 'math', value: lines.join('\n') });
}

function nextLineEnd(value: string, lineStart: number): number {
  const index = value.indexOf('\n', lineStart + 1);
  return index === -1 ? value.length : index;
}

// `[` not followed by `^`, or `![` not followed by `^`: a footnote is no link reference.
function referenceUnlessFootnote(parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const index = value.charCodeAt(0) === EXCLAMATION_MARK ? 1 : 0;
  if (value.charCodeAt(index) !== LEFT_BRACKET || value.charCodeAt(index + 1) === CARET) {
    return;
  }
  return INLINE_TOKENIZERS.reference?.tokenize(parser, eat, value, isSilent);
}

/*
 * A footnote reference to no definition becomes the text of its label, lowercased. A reference inside an inline
 * footnote is left as it is, as Obsidian has moved the inline footnote's content out of the tree by then.
 */
function resolveFootnoteReferences(root: RemarkRoot): void {
  const identifiers = new Set<string>();

  visit(root, (node) => {
    if (node.type === 'footnoteDefinition') {
      identifiers.add(node.identifier);
    }
  });

  visit(root, (node, parent, index) => {
    if (node.type !== 'footnoteReference' || identifiers.has(node.identifier)) {
      return;
    }

    const text: RemarkNode = { type: 'text', value: node.identifier };
    if (node.position) {
      text.position = node.position;
    }
    parent.children[index] = text;
  });
}

/**
 * The point `distance` characters after the current one.
 *
 * @param eat - The eat function.
 * @param distance - The distance.
 * @returns The point.
 */
function shifted(eat: Eat, distance: number): ReturnType<Eat['now']> {
  const point = eat.now();
  point.column += distance;
  point.offset += distance;
  return point;
}

function skip(value: string, from: number, code: number): number {
  let index = from;
  while (index < value.length && value.charCodeAt(index) === code) {
    index++;
  }
  return index;
}

function skipWhitespace(value: string, from: number): number {
  let index = from;
  while (isSpaceOrTab(value.charCodeAt(index))) {
    index++;
  }
  return index;
}

function softBreakAsHard(_parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const index = skip(value, 0, SPACE);
  if (value.charCodeAt(index) !== LINE_FEED) {
    return;
  }
  return isSilent || eat(value.slice(0, index + 1))({ type: 'break' });
}

/*
 * `#` followed by characters that are no whitespace, ASCII punctuation but `-`, `/` and `_`, or General or
 * Supplemental Punctuation. A name of digits only is no tag.
 */
function tag(_parser: RemarkParser, eat: Eat, value: string, isSilent: boolean): TokenizerResult {
  const match = TAG_RE.exec(value);
  if (!match || NUMBER_TAG_RE.test(match[0])) {
    return;
  }
  return isSilent || eat(match[0])({ name: match[0].slice(1), type: 'tag' });
}

// Visits the tree in document order, but the inside of inline footnotes.
function visit(node: RemarkNode, visitor: (node: RemarkNode, parent: RemarkParent, index: number) => void): void {
  if (!('children' in node) || node.type === 'inlineFootnote') {
    return;
  }
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index];
    if (!child) {
      continue;
    }

    visitor(child, node, index);
    visit(child, visitor);
  }
}

/* eslint-enable unicorn/prefer-code-point -- The tokenizers end here. */
