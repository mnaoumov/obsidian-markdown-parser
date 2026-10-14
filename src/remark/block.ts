/**
 * @file
 *
 * The block tokenizers of the `remark-parse` 8 engine: a TypeScript port of `remark-parse` 8.0.3's block tokenizers
 * and their helpers (MIT, Titus Wormer), in `commonmark` and `gfm` mode, with `trim` replaced by
 * `String.prototype.trim`.
 *
 * Three of them carry the edits Obsidian makes to its copy, re-expressed from the behaviour they show:
 *
 * - `blockquote` reads a callout header, `[!type|data]` with an optional fold sign, off the first line and tokenizes
 *   the rest of that line on its own, as the callout's title.
 * - `list` makes a task of any character between the brackets, kept as `checklist`, and strips an item's indentation
 *   past its lazy lines.
 * - `table` keeps to its first row's leading pipe, so a row with the other shape ends the table, reads the whitespace
 *   around each cell as the cell's padding, and so makes a cell of whitespace before a row's first pipe.
 */

/* eslint-disable complexity, no-magic-numbers, no-useless-assignment, no-useless-return, unicorn/consistent-boolean-name, unicorn/explicit-length-check, unicorn/no-break-in-nested-loop, unicorn/no-declarations-before-early-exit, unicorn/no-useless-else, unicorn/prefer-combined-guards, unicorn/prefer-includes-over-repeated-comparisons, unicorn/prefer-simple-condition-first, unicorn/prefer-switch, unicorn/prefer-ternary -- A line-for-line port of upstream tokenizers: their control flow, counters and names stay as upstream wrote them. */

import type {
  BlockTokenizer,
  BlockTokenizerName,
  RemarkParser
} from './parser.ts';
import type {
  RemarkBlockquote,
  RemarkCallout,
  RemarkListItem,
  RemarkNode,
  RemarkPoint,
  RemarkTable,
  RemarkTableAlignment,
  RemarkTableCellPadding,
  RemarkTableRow
} from './types.ts';

type HtmlSequence = readonly [open: RegExp, close: RegExp, interruptsParagraph: boolean];

interface Indentation {
  readonly indent: number;
  readonly stops: Readonly<Record<number, number>>;
}

interface ListItemDraft {
  indent: number;
  trail: string[];
  value: string[];
}

const TAB_SIZE = 4;
const MIN_FENCE_COUNT = 3;
const MAX_HEADING_DEPTH = 6;
const MAX_THEMATIC_BREAK_COUNT = 3;
const MAX_SETEXT_INDENT = 3;
const MIN_TABLE_ROWS = 2;
const MIN_TABLE_COLUMNS = 1;

const BLANK_LINE_RE = /^[ \t]*(?:\n|$)/u;
const TRAILING_LINES_RE = /\n+$/u;
const CALLOUT_RE = /^\[!(?<header>[^\]]+)\](?<fold>[+-]?)(?:\s|$)/u;
const WHITESPACE_RUN_RE = /\s+/gu;
const LOOSE_LIST_ITEM_RE = /\n\n(?!\s*$)/u;
const TASK_ITEM_RE = /^\[(?<character>.)\][ \t]/u;
const BULLET_RE = /^(?<indent>[ \t]*)(?<marker>[*+-]|\d+[.)])(?<spacing> {1,4}(?! )| |\t|$|(?=\n))(?<rest>[^\n]*)/u;
const WHITESPACE_CHARACTER_RE = /\s/u;

// The block HTML element names `remark-parse` 8 knows.
const BLOCK_ELEMENTS = [
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'meta',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'pre',
  'section',
  'source',
  'title',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul'
];

const ATTRIBUTE_NAME = '[a-zA-Z_:][a-zA-Z0-9:._-]*';
const UNQUOTED = String.raw`[^"'=<>\x60\u0000- ]+`;
const ATTRIBUTE_VALUE = `(?:${UNQUOTED}|'[^']*'|"[^"]*")`;
const ATTRIBUTE = String.raw`(?:\s+${ATTRIBUTE_NAME}(?:\s*=\s*${ATTRIBUTE_VALUE})?)`;
const OPEN_TAG = String.raw`<[A-Za-z][A-Za-z0-9\-]*${ATTRIBUTE}*\s*\/?>`;
const CLOSE_TAG = String.raw`<\/[A-Za-z][A-Za-z0-9\-]*\s*>`;

/**
 * An HTML open or close tag at the start of a string.
 */
export const OPEN_CLOSE_TAG_SOURCE = `(?:${OPEN_TAG}|${CLOSE_TAG})`;

/**
 * Any inline HTML at the start of a string: a tag, a comment, a processing instruction, a declaration or CDATA.
 */
export const HTML_TAG_RE = new RegExp(
  String.raw`^(?:${OPEN_TAG}|${CLOSE_TAG}|<!---->|<!--(?:-?[^>-])(?:-?[^-])*-->|<[?].*?[?]>|<![A-Za-z]+\s+[^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)`,
  'u'
);

const HTML_SEQUENCES: readonly HtmlSequence[] = [
  [/^<(?:script|pre|style)(?=\s|>|$)/iu, /<\/(?:script|pre|style)>/iu, true],
  [/^<!--/u, /-->/u, true],
  [/^<\?/u, /\?>/u, true],
  [/^<![A-Za-z]/u, />/u, true],
  [/^<!\[CDATA\[/u, /\]\]>/u, true],
  [new RegExp(String.raw`^<\/?(?:${BLOCK_ELEMENTS.join('|')})(?=\s|\/?>|$)`, 'iu'), /^$/u, true],
  [new RegExp(String.raw`^${OPEN_CLOSE_TAG_SOURCE}\s*$`, 'u'), /^$/u, false]
];

/**
 * The block tokenizers.
 */
export const BLOCK_TOKENIZERS: Readonly<Record<BlockTokenizerName, BlockTokenizer>> = {
  atxHeading,
  blankLine,
  blockquote,
  definition,
  fencedCode,
  html: blockHtml,
  indentedCode,
  list,
  paragraph,
  setextHeading,
  table,
  thematicBreak
};

/**
 * Whether a character is whitespace, as `is-whitespace-character` tests it.
 *
 * @param character - The character, or `''`.
 * @returns Whether it is.
 */
export function isWhitespaceCharacter(character: string): boolean {
  return WHITESPACE_CHARACTER_RE.test(character.charAt(0));
}

/**
 * Normalizes a label: whitespace collapsed to a space and lowercased.
 *
 * @param value - The label.
 * @returns The identifier.
 */
export function normalizeIdentifier(value: string): string {
  return value.replaceAll(WHITESPACE_RUN_RE, ' ').toLowerCase();
}

function atxHeading(parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  let length = value.length + 1;
  let index = -1;
  const now = eat.now();
  let subvalue = '';
  let content = '';
  let character = '';
  let queue = '';

  // Eat initial spacing.
  while (++index < length) {
    character = value.charAt(index);

    if (character !== ' ' && character !== '\t') {
      index--;
      break;
    }

    subvalue += character;
  }

  // Eat hashes.
  let depth = 0;

  while (++index <= length) {
    character = value.charAt(index);

    if (character !== '#') {
      index--;
      break;
    }

    subvalue += character;
    depth++;
  }

  if (depth > MAX_HEADING_DEPTH) {
    return;
  }

  if (!depth || value.charAt(index + 1) === '#') {
    return;
  }

  length = value.length + 1;

  // Eat intermediate white space.
  queue = '';

  while (++index < length) {
    character = value.charAt(index);

    if (character !== ' ' && character !== '\t') {
      index--;
      break;
    }

    queue += character;
  }

  if (queue.length === 0 && character && character !== '\n') {
    return;
  }

  if (silent) {
    return true;
  }

  // Eat content.
  subvalue += queue;
  queue = '';
  content = '';

  while (++index < length) {
    character = value.charAt(index);

    if (!character || character === '\n') {
      break;
    }

    if (character !== ' ' && character !== '\t' && character !== '#') {
      content += queue + character;
      queue = '';
      continue;
    }

    while (character === ' ' || character === '\t') {
      queue += character;
      character = value.charAt(++index);
    }

    // A `#` without a queue is part of the content.
    if (content && !queue && character === '#') {
      content += character;
      continue;
    }

    while (character === '#') {
      queue += character;
      character = value.charAt(++index);
    }

    while (character === ' ' || character === '\t') {
      queue += character;
      character = value.charAt(++index);
    }

    index--;
  }

  now.column += subvalue.length;
  now.offset += subvalue.length;
  subvalue += content + queue;

  return eat(subvalue)({
    children: parser.tokenizeInline(content, now),
    depth,
    type: 'heading'
  });
}

function blankLine(_parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | undefined {
  let subvalue = '';
  let index = 0;
  const length = value.length;

  while (index < length) {
    const match = BLANK_LINE_RE.exec(value.slice(index));

    if (!match) {
      break;
    }

    index += match[0].length;
    subvalue += match[0];
  }

  if (subvalue === '') {
    return;
  }

  if (silent) {
    return true;
  }

  eat(subvalue);
  return;
}

function blockHtml(_parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  const length = value.length;
  let index = 0;

  // Eat initial spacing.
  while (index < length) {
    const character = value.charAt(index);

    if (character !== '\t' && character !== ' ') {
      break;
    }

    index++;
  }

  if (value.charAt(index) !== '<') {
    return;
  }

  let next = value.indexOf('\n', index + 1);
  next = next === -1 ? length : next;
  let line = value.slice(index, next);
  const sequence = HTML_SEQUENCES.find(([open]) => open.test(line));

  if (!sequence) {
    return;
  }

  if (silent) {
    return sequence[2];
  }

  index = next;

  if (!sequence[1].test(line)) {
    while (index < length) {
      next = value.indexOf('\n', index + 1);
      next = next === -1 ? length : next;
      line = value.slice(index + 1, next);

      if (sequence[1].test(line)) {
        if (line) {
          index = next;
        }

        break;
      }

      index = next;
    }
  }

  const subvalue = value.slice(0, index);

  return eat(subvalue)({ type: 'html', value: subvalue });
}

function blockquote(parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  const offsets = parser.offset;
  const now = eat.now();
  let currentLine = now.line;
  let length = value.length;
  const values: string[] = [];
  const contents: string[] = [];
  const indents: number[] = [];
  let index = 0;
  let callout: null | RemarkCallout = null;

  while (index < length) {
    const character = value.charAt(index);

    if (character !== ' ' && character !== '\t') {
      break;
    }

    index++;
  }

  if (value.charAt(index) !== '>') {
    return;
  }

  if (silent) {
    return true;
  }

  index = 0;

  while (index < length) {
    let nextIndex = value.indexOf('\n', index);
    const startIndex = index;
    let prefixed = false;

    if (nextIndex === -1) {
      nextIndex = length;
    }

    while (index < length) {
      const character = value.charAt(index);

      if (character !== ' ' && character !== '\t') {
        break;
      }

      index++;
    }

    if (value.charAt(index) === '>') {
      index++;
      prefixed = true;

      if (value.charAt(index) === ' ') {
        index++;
      }
    } else {
      index = startIndex;
    }

    let content = value.slice(index, nextIndex);

    if (!prefixed && !content.trim()) {
      index = startIndex;
      break;
    }

    if (!prefixed) {
      const rest = value.slice(index);

      // Check whether the following code holds a possible block.
      if (parser.interruptsBlockquote(eat, rest)) {
        break;
      }
    }

    // Obsidian's edit: the first line may open a callout, whose header is no part of the content.
    if (startIndex === 0) {
      const header = CALLOUT_RE.exec(content);
      if (header) {
        callout = calloutOf(header);
        index += header[0].length;
        content = content.slice(header[0].length);
      }
    }

    const line = startIndex === index ? content : value.slice(startIndex, nextIndex);

    indents.push(index - startIndex);
    values.push(line);
    contents.push(content);

    index = nextIndex + 1;
  }

  index = -1;
  length = indents.length;
  const add = eat(values.join('\n'));

  while (++index < length) {
    offsets.set(currentLine, (offsets.get(currentLine) ?? 0) + (indents[index] ?? 0));
    currentLine++;
  }

  const exit = parser.enterBlock();
  const children: RemarkNode[] = [];
  // Obsidian's edit: a callout's title, the rest of its first line, is tokenized on its own.
  if (callout && contents[0]) {
    children.push(...parser.tokenizeBlock(contents.shift() ?? '', now));
    now.line += 1;
  }
  children.push(...parser.tokenizeBlock(contents.join('\n'), now));
  exit();

  return add<RemarkBlockquote>({ callout, children, type: 'blockquote' });
}

function calloutOf(header: RegExpExecArray): RemarkCallout {
  const text = header.groups?.['header'] ?? '';
  const pipe = text.indexOf('|');
  const type = pipe === -1 ? text : text.slice(0, pipe);
  return {
    data: pipe === -1 ? '' : text.slice(pipe + 1),
    fold: header.groups?.['fold'] ?? '',
    type: type.trim().toLowerCase().replaceAll(WHITESPACE_RUN_RE, '-')
  };
}

function definition(parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  let index = 0;
  const length = value.length;
  let subvalue = '';
  let queue = '';
  let character = '';
  let title = '';

  while (index < length) {
    character = value.charAt(index);

    if (character !== ' ' && character !== '\t') {
      break;
    }

    subvalue += character;
    index++;
  }

  character = value.charAt(index);

  if (character !== '[') {
    return;
  }

  index++;
  subvalue += character;
  queue = '';

  while (index < length) {
    character = value.charAt(index);

    if (character === ']') {
      break;
    } else if (character === '\\') {
      queue += character;
      index++;
      character = value.charAt(index);
    }

    queue += character;
    index++;
  }

  if (!queue || value.charAt(index) !== ']' || value.charAt(index + 1) !== ':') {
    return;
  }

  const identifier = queue;
  subvalue += `${queue}]:`;
  index = subvalue.length;
  queue = '';

  while (index < length) {
    character = value.charAt(index);

    if (character !== '\t' && character !== ' ' && character !== '\n') {
      break;
    }

    subvalue += character;
    index++;
  }

  character = value.charAt(index);
  queue = '';
  const beforeUrl = subvalue;

  if (character === '<') {
    index++;

    while (index < length) {
      character = value.charAt(index);

      if (!isEnclosedUrlCharacter(character)) {
        break;
      }

      queue += character;
      index++;
    }

    character = value.charAt(index);

    if (character === '>') {
      subvalue += `<${queue}${character}`;
      index++;
    } else {
      return;
    }
  }

  if (!queue) {
    while (index < length) {
      character = value.charAt(index);

      if (!isUnclosedUrlCharacter(character)) {
        break;
      }

      queue += character;
      index++;
    }

    subvalue += queue;
  }

  if (!queue) {
    return;
  }

  let url = queue;
  queue = '';

  while (index < length) {
    character = value.charAt(index);

    if (character !== '\t' && character !== ' ' && character !== '\n') {
      break;
    }

    queue += character;
    index++;
  }

  character = value.charAt(index);
  let test = '';

  if (character === '"') {
    test = '"';
  } else if (character === '\'') {
    test = '\'';
  } else if (character === '(') {
    test = ')';
  }

  let beforeTitle = '';

  if (!test) {
    queue = '';
    index = subvalue.length;
  } else if (queue) {
    subvalue += queue + character;
    index = subvalue.length;
    queue = '';

    while (index < length) {
      character = value.charAt(index);

      if (character === test) {
        break;
      }

      if (character === '\n') {
        index++;
        character = value.charAt(index);

        if (character === '\n' || character === test) {
          return;
        }

        queue += '\n';
      }

      queue += character;
      index++;
    }

    character = value.charAt(index);

    if (character !== test) {
      return;
    }

    beforeTitle = subvalue;
    subvalue += queue + character;
    index++;
    title = queue;
    queue = '';
  } else {
    return;
  }

  while (index < length) {
    character = value.charAt(index);

    if (character !== '\t' && character !== ' ') {
      break;
    }

    subvalue += character;
    index++;
  }

  character = value.charAt(index);

  if (!character || character === '\n') {
    if (silent) {
      return true;
    }

    const urlStart = eat(beforeUrl).test().end;
    url = parser.decodeRaw(parser.unescape(url), urlStart, false);

    if (title) {
      const titleStart = eat(beforeTitle).test().end;
      title = parser.decodeRaw(parser.unescape(title), titleStart);
    }

    return eat(subvalue)({
      identifier: normalizeIdentifier(identifier),
      label: identifier,
      title: title || null,
      type: 'definition',
      url
    });
  }

  return;
}

function fencedCode(parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  let length = value.length + 1;
  let index = 0;
  let subvalue = '';
  let character = '';

  // Eat initial spacing.
  while (index < length) {
    character = value.charAt(index);

    if (character !== ' ' && character !== '\t') {
      break;
    }

    subvalue += character;
    index++;
  }

  const indent = index;

  // Eat the fence.
  character = value.charAt(index);

  if (character !== '~' && character !== '`') {
    return;
  }

  index++;
  const marker = character;
  let fenceCount = 1;
  subvalue += character;

  while (index < length) {
    character = value.charAt(index);

    if (character !== marker) {
      break;
    }

    subvalue += character;
    fenceCount++;
    index++;
  }

  if (fenceCount < MIN_FENCE_COUNT) {
    return;
  }

  // Eat spacing before the flag.
  while (index < length) {
    character = value.charAt(index);

    if (character !== ' ' && character !== '\t') {
      break;
    }

    subvalue += character;
    index++;
  }

  // Eat the flag.
  let flag = '';
  let queue = '';

  while (index < length) {
    character = value.charAt(index);

    if (character === '\n' || (marker === '`' && character === marker)) {
      break;
    }

    if (character === ' ' || character === '\t') {
      queue += character;
    } else {
      flag += queue + character;
      queue = '';
    }

    index++;
  }

  character = value.charAt(index);

  if (character && character !== '\n') {
    return;
  }

  if (silent) {
    return true;
  }

  const now = eat.now();
  now.column += subvalue.length;
  now.offset += subvalue.length;

  subvalue += flag;
  flag = parser.decodeRaw(parser.unescape(flag), now);

  if (queue) {
    subvalue += queue;
  }

  queue = '';
  let closing = '';
  let exdentedClosing = '';
  let content = '';
  let exdentedContent = '';
  let skip = true;

  // Eat the content.
  while (index < length) {
    character = value.charAt(index);
    content += closing;
    exdentedContent += exdentedClosing;
    closing = '';
    exdentedClosing = '';

    if (character !== '\n') {
      content += character;
      exdentedClosing += character;
      index++;
      continue;
    }

    // The first line feed is ignored; the others are not.
    if (skip) {
      subvalue += character;
      skip = false;
    } else {
      closing += character;
      exdentedClosing += character;
    }

    queue = '';
    index++;

    while (index < length) {
      character = value.charAt(index);

      if (character !== ' ') {
        break;
      }

      queue += character;
      index++;
    }

    closing += queue;
    exdentedClosing += queue.slice(indent);

    if (queue.length >= TAB_SIZE) {
      continue;
    }

    queue = '';

    while (index < length) {
      character = value.charAt(index);

      if (character !== marker) {
        break;
      }

      queue += character;
      index++;
    }

    closing += queue;
    exdentedClosing += queue;

    if (queue.length < fenceCount) {
      continue;
    }

    queue = '';

    while (index < length) {
      character = value.charAt(index);

      if (character !== ' ' && character !== '\t') {
        break;
      }

      closing += character;
      exdentedClosing += character;
      index++;
    }

    if (!character || character === '\n') {
      break;
    }
  }

  subvalue += content + closing;

  // Get the language and the meta from the flag.
  index = -1;
  length = flag.length;
  let lang = '';
  let meta = '';

  while (++index < length) {
    character = flag.charAt(index);

    if (character === ' ' || character === '\t') {
      if (!lang) {
        lang = flag.slice(0, index);
      }
    } else if (lang) {
      meta = flag.slice(index);
      break;
    }
  }

  return eat(subvalue)({
    lang: lang || flag || null,
    meta: meta || null,
    type: 'code',
    value: exdentedContent
  });
}

function getIndentation(value: string): Indentation {
  let index = 0;
  let indent = 0;
  let character = value.charAt(index);
  const stops: Record<number, number> = {};
  let lastIndent = 0;

  while (character === '\t' || character === ' ') {
    const size = character === '\t' ? TAB_SIZE : 1;

    indent += size;

    if (size > 1) {
      indent = Math.floor(indent / size) * size;
    }

    while (lastIndent < indent) {
      stops[++lastIndent] = index;
    }

    character = value.charAt(++index);
  }

  return { indent, stops };
}

function indentedCode(_parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  let index = -1;
  const length = value.length;
  let subvalue = '';
  let content = '';
  let subvalueQueue = '';
  let contentQueue = '';
  let character = '';
  let indent = false;

  while (++index < length) {
    character = value.charAt(index);

    if (indent) {
      indent = false;

      subvalue += subvalueQueue;
      content += contentQueue;
      subvalueQueue = '';
      contentQueue = '';

      if (character === '\n') {
        subvalueQueue = character;
        contentQueue = character;
      } else {
        subvalue += character;
        content += character;

        while (++index < length) {
          character = value.charAt(index);

          if (!character || character === '\n') {
            contentQueue = character;
            subvalueQueue = character;
            break;
          }

          subvalue += character;
          content += character;
        }
      }
    } else if (
      character === ' '
      && value.charAt(index + 1) === character
      && value.charAt(index + 2) === character
      && value.charAt(index + 3) === character
    ) {
      subvalueQueue += ' '.repeat(TAB_SIZE);
      index += 3;
      indent = true;
    } else if (character === '\t') {
      subvalueQueue += character;
      indent = true;
    } else {
      let blankQueue = '';

      while (character === '\t' || character === ' ') {
        blankQueue += character;
        character = value.charAt(++index);
      }

      if (character !== '\n') {
        break;
      }

      subvalueQueue += blankQueue + character;
      contentQueue += character;
    }
  }

  if (content) {
    if (silent) {
      return true;
    }

    return eat(subvalue)({
      lang: null,
      meta: null,
      type: 'code',
      value: content.replace(TRAILING_LINES_RE, '')
    });
  }

  return;
}

function isDecimalCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code >= 48 && code <= 57;
}

function isEnclosedUrlCharacter(character: string): boolean {
  return character !== '>' && character !== '[' && character !== ']';
}

function isUnclosedUrlCharacter(character: string): boolean {
  return character !== '[' && character !== ']' && !isWhitespaceCharacter(character);
}

function list(parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  let index = 0;
  let length = value.length;
  let start: null | number = null;
  let queue = '';
  let ordered = false;
  let character = '';
  let marker = '';
  let previousEmpty = false;
  let empty = false;
  let item: ListItemDraft | undefined;
  let spread = false;

  while (index < length) {
    character = value.charAt(index);

    if (character !== '\t' && character !== ' ') {
      break;
    }

    index++;
  }

  character = value.charAt(index);

  if (character === '*' || character === '+' || character === '-') {
    marker = character;
    ordered = false;
  } else {
    ordered = true;
    queue = '';

    while (index < length) {
      character = value.charAt(index);

      if (!isDecimalCharacter(character)) {
        break;
      }

      queue += character;
      index++;
    }

    character = value.charAt(index);

    if (!queue || !(character === '.' || character === ')')) {
      return;
    }

    // An ordered list interrupts a paragraph only when it starts at 1.
    if (silent && queue !== '1') {
      return;
    }

    start = Number(queue);
    marker = character;
  }

  character = value.charAt(++index);

  if (character !== ' ' && character !== '\t' && character !== '\n' && character !== '') {
    return;
  }

  if (silent) {
    return true;
  }

  index = 0;
  const items: ListItemDraft[] = [];
  let allLines: string[] = [];
  let emptyLines: string[] = [];

  while (index < length) {
    let nextIndex = value.indexOf('\n', index);
    const startIndex = index;
    let prefixed = false;
    let indented = false;

    if (nextIndex === -1) {
      nextIndex = length;
    }

    let size = 0;

    while (index < length) {
      character = value.charAt(index);

      if (character === '\t') {
        size += TAB_SIZE - (size % TAB_SIZE);
      } else if (character === ' ') {
        size++;
      } else {
        break;
      }

      index++;
    }

    if (item && size >= item.indent) {
      indented = true;
    }

    character = value.charAt(index);
    let currentMarker: null | string = null;

    if (!indented) {
      if (character === '*' || character === '+' || character === '-') {
        currentMarker = character;
        index++;
        size++;
      } else {
        queue = '';

        while (index < length) {
          character = value.charAt(index);

          if (!isDecimalCharacter(character)) {
            break;
          }

          queue += character;
          index++;
        }

        character = value.charAt(index);
        index++;

        if (queue && (character === '.' || character === ')')) {
          currentMarker = character;
          size += queue.length + 1;
        }
      }

      if (currentMarker) {
        character = value.charAt(index);

        if (character === '\t') {
          size += TAB_SIZE - (size % TAB_SIZE);
          index++;
        } else if (character === ' ') {
          const end = index + TAB_SIZE;

          while (index < end) {
            if (value.charAt(index) !== ' ') {
              break;
            }

            index++;
            size++;
          }

          if (index === end && value.charAt(index) === ' ') {
            index -= TAB_SIZE - 1;
            size -= TAB_SIZE - 1;
          }
        } else if (character !== '\n' && character !== '') {
          currentMarker = null;
        }
      }
    }

    if (currentMarker) {
      if (marker !== currentMarker) {
        break;
      }

      prefixed = true;
    } else {
      if (item) {
        indented = size >= item.indent || size > TAB_SIZE;
      }

      prefixed = false;
      index = startIndex;
    }

    const line = value.slice(startIndex, nextIndex);
    const content = startIndex === index ? line : value.slice(index, nextIndex);

    if ((currentMarker === '*' || currentMarker === '_' || currentMarker === '-') && thematicBreak(parser, eat, line, true)) {
      break;
    }

    previousEmpty = empty;
    empty = !prefixed && !content.trim().length;

    if (indented && item) {
      item.value = [...item.value, ...emptyLines, line];
      allLines = [...allLines, ...emptyLines, line];
      emptyLines = [];
    } else if (prefixed) {
      if (emptyLines.length !== 0 && item) {
        spread = true;
        item.value.push('');
        item.trail = [...emptyLines];
      }

      item = { indent: size, trail: [], value: [line] };

      items.push(item);
      allLines = [...allLines, ...emptyLines, line];
      emptyLines = [];
    } else if (empty) {
      emptyLines.push(line);
    } else {
      if (previousEmpty) {
        break;
      }

      if (parser.interruptsList(eat, line)) {
        break;
      }

      if (item) {
        item.value = [...item.value, ...emptyLines, line];
      }
      allLines = [...allLines, ...emptyLines, line];
      emptyLines = [];
    }

    index = nextIndex + 1;
  }

  const node = eat(allLines.join('\n')).reset({
    children: [],
    ordered,
    spread,
    start,
    type: 'list'
  });

  const exitList = parser.enterList();
  const exitBlock = parser.enterBlock();
  index = -1;
  length = items.length;

  while (++index < length) {
    const draft = items[index];
    if (!draft) {
      continue;
    }
    const itemValue = draft.value.join('\n');
    const now = eat.now();

    eat(itemValue)(listItem(parser, itemValue, now), node);

    let trail = draft.trail.join('\n');

    if (index !== length - 1) {
      trail += '\n';
    }

    eat(trail);
  }

  exitList();
  exitBlock();

  return node;
}

function listItem(parser: RemarkParser, value: string, position: RemarkPoint): RemarkListItem {
  const offsets = parser.offset;
  let itemValue = normalListItem(parser, value, position);
  let checked: boolean | null = null;
  let checklist: null | string = null;

  // Obsidian's edit: any character between the brackets makes a task, checked unless it is a space.
  const task = TASK_ITEM_RE.exec(itemValue);

  if (task) {
    const indent = task[0].length;
    checklist = task.groups?.['character'] ?? '';
    checked = checklist !== ' ';
    offsets.set(position.line, (offsets.get(position.line) ?? 0) + indent);
    itemValue = itemValue.slice(indent);
  }

  return {
    checked,
    checklist,
    children: parser.tokenizeBlock(itemValue, position),
    spread: LOOSE_LIST_ITEM_RE.test(itemValue),
    type: 'listItem'
  };
}

function normalListItem(parser: RemarkParser, value: string, position: RemarkPoint): string {
  const offsets = parser.offset;
  let line = position.line;
  let max = '';
  let bullet = '';
  let rest = '';

  // Replace the bullet with spaces, so the indentation removal below strips it.
  const replaced = value.replace(BULLET_RE, (...parameters: unknown[]) => {
    const groups = parameters.at(-1) as Record<string, string | undefined>;
    const indent = groups['indent'] ?? '';
    let marker = groups['marker'] ?? '';
    const spacing = groups['spacing'] ?? '';
    bullet = indent + marker + spacing;
    rest = groups['rest'] ?? '';

    // The first nine numbered items can indent with an extra space, when the bullet did not take a final space.
    if (Number(marker) < 10 && bullet.length % 2 === 1) {
      marker = ` ${marker}`;
    }

    max = indent + ' '.repeat(marker.length) + spacing;

    return max + rest;
  });

  const lines = replaced.split('\n');
  const trimmedLines = removeIndentation(replaced, getIndentation(max).indent).split('\n');

  // The first line may have lost more than its bullet above.
  trimmedLines[0] = rest;

  offsets.set(line, (offsets.get(line) ?? 0) + bullet.length);
  line++;

  for (let index = 1; index < lines.length; index++) {
    offsets.set(line, (offsets.get(line) ?? 0) + (lines[index]?.length ?? 0) - (trimmedLines[index]?.length ?? 0));
    line++;
  }

  return trimmedLines.join('\n');
}

function paragraph(parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  let index = value.indexOf('\n');
  const length = value.length;

  while (index < length) {
    // Eat everything when no line feed follows.
    if (index === -1) {
      index = length;
      break;
    }

    // Stop at a blank line.
    if (value.charAt(index + 1) === '\n') {
      break;
    }

    // Following indented lines are part of the paragraph.
    let size = 0;
    let position = index + 1;
    let character = '';

    while (position < length) {
      character = value.charAt(position);

      if (character === '\t') {
        size = TAB_SIZE;
        break;
      } else if (character === ' ') {
        size++;
      } else {
        break;
      }

      position++;
    }

    if (size >= TAB_SIZE && character !== '\n') {
      index = value.indexOf('\n', index + 1);
      continue;
    }

    const rest = value.slice(index + 1);

    // Check whether the following code holds a possible block.
    if (parser.interruptsParagraph(eat, rest)) {
      break;
    }

    position = index;
    index = value.indexOf('\n', index + 1);

    if (index !== -1 && value.slice(position, index).trim() === '') {
      index = position;
      break;
    }
  }

  let subvalue = value.slice(0, index);

  if (silent) {
    return true;
  }

  const now = eat.now();
  subvalue = subvalue.replace(TRAILING_LINES_RE, '');

  return eat(subvalue)({
    children: parser.tokenizeInline(subvalue, now),
    type: 'paragraph'
  });
}

/*
 * Removes the smallest indentation of the lines from every line. Obsidian's edit: a line with no indentation, a lazy
 * line, does not stop the removal; it is left as it is.
 */
function removeIndentation(value: string, maximum: number): string {
  const values = value.split('\n');
  let position = values.length + 1;
  let minIndent = Infinity;
  const matrix: Readonly<Record<number, number>>[] = [];

  values.unshift(`${' '.repeat(maximum)}!`);

  while (position--) {
    const indentation = getIndentation(values[position] ?? '');

    matrix[position] = indentation.stops;

    if ((values[position] ?? '').trim().length === 0) {
      continue;
    }

    if (indentation.indent && indentation.indent > 0 && indentation.indent < minIndent) {
      minIndent = indentation.indent;
    }
  }

  if (minIndent !== Infinity) {
    position = values.length;

    while (position--) {
      const stops = matrix[position] ?? {};
      let index = minIndent;

      while (index && !Object.hasOwn(stops, index)) {
        index--;
      }

      const stop = stops[index];
      values[position] = stop === undefined ? values[position] ?? '' : (values[position] ?? '').slice(stop + 1);
    }
  }

  values.shift();

  return values.join('\n');
}

function setextHeading(parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  const now = eat.now();
  const length = value.length;
  let index = -1;
  let subvalue = '';
  let character = '';

  // Eat initial indentation.
  while (++index < length) {
    character = value.charAt(index);

    if (character !== ' ' || index >= MAX_SETEXT_INDENT) {
      index--;
      break;
    }

    subvalue += character;
  }

  // Eat the content.
  let content = '';
  let queue = '';

  while (++index < length) {
    character = value.charAt(index);

    if (character === '\n') {
      index--;
      break;
    }

    if (character === ' ' || character === '\t') {
      queue += character;
    } else {
      content += queue + character;
      queue = '';
    }
  }

  now.column += subvalue.length;
  now.offset += subvalue.length;
  subvalue += content + queue;

  // The content must be followed by a line feed and a marker.
  character = value.charAt(++index);
  const marker = value.charAt(++index);

  if (character !== '\n' || (marker !== '=' && marker !== '-')) {
    return;
  }

  subvalue += character;

  // Eat the underline.
  queue = marker;
  const depth = marker === '=' ? 1 : 2;

  while (++index < length) {
    character = value.charAt(index);

    if (character !== marker) {
      if (character !== '\n') {
        return;
      }

      index--;
      break;
    }

    queue += character;
  }

  if (silent) {
    return true;
  }

  return eat(subvalue + queue)({
    children: parser.tokenizeInline(content, now),
    depth,
    type: 'heading'
  });
}

function table(parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  // Get the rows: lines with a pipe after their first character.
  let index = 0;
  let lineCount = 0;
  let length = value.length + 1;
  const lines: string[] = [];
  let leadingPipe = false;

  while (index < length) {
    let lineIndex = value.indexOf('\n', index);
    const pipeIndex = value.indexOf('|', index + 1);

    if (lineIndex === -1) {
      lineIndex = value.length;
    }

    if (pipeIndex === -1 || pipeIndex > lineIndex) {
      if (lineCount < MIN_TABLE_ROWS) {
        return;
      }

      break;
    }

    const line = value.slice(index, lineIndex);

    // Obsidian's edit: every row starts with a pipe if the first does, and none does if it does not.
    if (lineCount === 0) {
      leadingPipe = line.startsWith('|');
    } else if (line.startsWith('|') !== leadingPipe) {
      break;
    }

    lines.push(line);
    lineCount++;
    index = lineIndex + 1;
  }

  // Parse the alignment row.
  const subvalue = lines.join('\n');
  const alignments = lines.splice(1, 1)[0] ?? '';
  index = 0;
  length = alignments.length;
  lineCount--;
  let alignment: false | RemarkTableAlignment = false;
  const align: RemarkTableAlignment[] = [];
  let hasDash: boolean | null = null;
  let first: boolean | undefined;

  while (index < length) {
    const character = alignments.charAt(index);

    if (character === '|') {
      hasDash = null;

      if (alignment === false) {
        if (first === false) {
          return;
        }
      } else {
        align.push(alignment);
        alignment = false;
      }

      first = false;
    } else if (character === '-') {
      hasDash = true;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- No alignment yet, `false`, becomes `null` too.
      alignment ||= null;
    } else if (character === ':') {
      if (alignment === 'left') {
        alignment = 'center';
      } else if (hasDash && alignment === null) {
        alignment = 'right';
      } else {
        alignment = 'left';
      }
    } else if (!isWhitespaceCharacter(character)) {
      return;
    }

    index++;
  }

  if (alignment !== false) {
    align.push(alignment);
  }

  // Exit without enough columns.
  if (align.length < MIN_TABLE_COLUMNS) {
    return;
  }

  if (silent) {
    return true;
  }

  // Parse the rows.
  let position = -1;
  const rows: RemarkTableRow[] = [];

  const node = eat(subvalue).reset<RemarkTable>({ align, children: rows, type: 'table' });

  while (++position < lineCount) {
    const line = lines[position] ?? '';
    const row: RemarkTableRow = { children: [], type: 'tableRow' };

    // Eat a line feed when this is not the first row.
    if (position) {
      eat('\n');
    }

    // Eat the row.
    eat(line).reset(row, node);

    length = line.length + 1;
    index = 0;
    let cell = '';
    let preamble = true;

    while (index < length) {
      const character = line.charAt(index);

      if (character === '' || character === '|') {
        if (preamble) {
          eat(character);
        } else {
          // Obsidian's edit: the whitespace around a cell is part of it, as its padding.
          if (cell || character) {
            const padding = tableCellPadding(cell);
            const now = eat.now();
            now.offset += padding.start;
            now.column += padding.start;

            eat(cell)({
              children: parser.tokenizeInline(cell.slice(padding.start, cell.length - padding.end), now),
              padding,
              type: 'tableCell'
            }, row);
          }

          eat(character);

          cell = '';
        }
      } else {
        cell += character;

        if (character === '\\' && index !== length - 2) {
          cell += line.charAt(index + 1);
          index++;
        }
      }

      preamble = false;
      index++;
    }

    // Eat the alignment row.
    if (!position) {
      eat(`\n${alignments}`);
    }
  }

  return node;
}

function tableCellPadding(cell: string): RemarkTableCellPadding {
  let start = 0;
  let end = 0;
  while (start < cell.length && (cell[start] === ' ' || cell[start] === '\t')) {
    start++;
  }
  while (cell.length - end - 1 >= start && (cell[cell.length - end - 1] === ' ' || cell[cell.length - end - 1] === '\t')) {
    end++;
  }
  return { end, start };
}

function thematicBreak(_parser: RemarkParser, eat: Parameters<BlockTokenizer>[1], value: string, silent: boolean): boolean | RemarkNode | undefined {
  let index = -1;
  const length = value.length + 1;
  let subvalue = '';
  let character = '';

  while (++index < length) {
    character = value.charAt(index);

    if (character !== '\t' && character !== ' ') {
      break;
    }

    subvalue += character;
  }

  if (character !== '*' && character !== '-' && character !== '_') {
    return;
  }

  const marker = character;
  subvalue += character;
  let markerCount = 1;
  let queue = '';

  while (++index < length) {
    character = value.charAt(index);

    if (character === marker) {
      markerCount++;
      subvalue += queue + marker;
      queue = '';
    } else if (character === ' ') {
      queue += character;
    } else if (markerCount >= MAX_THEMATIC_BREAK_COUNT && (!character || character === '\n')) {
      subvalue += queue;

      if (silent) {
        return true;
      }

      return eat(subvalue)({ type: 'thematicBreak' });
    } else {
      return;
    }
  }

  return;
}

/* eslint-enable complexity, no-magic-numbers, no-useless-assignment, no-useless-return, unicorn/consistent-boolean-name, unicorn/explicit-length-check, unicorn/no-break-in-nested-loop, unicorn/no-declarations-before-early-exit, unicorn/no-useless-else, unicorn/prefer-combined-guards, unicorn/prefer-includes-over-repeated-comparisons, unicorn/prefer-simple-condition-first, unicorn/prefer-switch, unicorn/prefer-ternary -- The port ends here. */
