/**
 * @file
 *
 * The inline tokenizers of the `remark-parse` 8 engine: a TypeScript port of `remark-parse` 8.0.3's inline tokenizers
 * and their locators (MIT, Titus Wormer), in `commonmark` and `gfm` mode, with `trim` replaced by
 * `String.prototype.trim`. Obsidian runs them unedited.
 *
 * They are Obsidian's inline algorithm: each construct is matched by the first tokenizer, in a fixed order, that
 * reads it at the earliest position any of them could start, with no delimiter stack and no flanking rules.
 */

/* eslint-disable complexity, no-magic-numbers, no-useless-assignment, no-useless-return, unicorn/consistent-boolean-name, unicorn/no-declarations-before-early-exit, unicorn/prefer-code-point, unicorn/prefer-combined-guards, unicorn/prefer-else-if, unicorn/prefer-includes-over-repeated-comparisons, unicorn/prefer-simple-condition-first, unicorn/prefer-switch, unicorn/prefer-ternary -- A line-for-line port of upstream tokenizers: their control flow, counters, names and UTF-16 code units stay as upstream wrote them. */

import type {
  Eat,
  InlineTokenizer,
  InlineTokenizerName,
  RemarkParser
} from './parser.ts';
import type {
  RemarkNode,
  RemarkReferenceType
} from './types.ts';

import {
  HTML_TAG_RE,
  isWhitespaceCharacter,
  normalizeIdentifier
} from './block.ts';
import { decodeEntities } from './entities.ts';

const AUTO_LINK_MAILTO = 'mailto:';
const URL_PREFIXES = ['www.', 'http://', 'https://'];
const HTML_LINK_OPEN_RE = /^<a /iu;
const HTML_LINK_CLOSE_RE = /^<\/a>/iu;
const WORD_CHARACTER_RE = /\w/u;
const MIN_BREAK_LENGTH = 2;

/**
 * The inline tokenizers.
 */
export const INLINE_TOKENIZERS: Readonly<Partial<Record<InlineTokenizerName, InlineTokenizer>>> = {
  autoLink: { locator: locateTag, notInLink: true, tokenize: autoLink },
  break: { locator: locateBreak, tokenize: hardBreak },
  code: { locator: locateInlineCode, tokenize: inlineCode },
  deletion: { locator: locateDelete, tokenize: strikethrough },
  email: { locator: locateEmail, notInLink: true, tokenize: email },
  emphasis: { locator: locateEmphasis, tokenize: emphasis },
  escape: { locator: locateEscape, tokenize: escape },
  html: { locator: locateTag, tokenize: inlineHtml },
  link: { locator: locateLink, tokenize: link },
  reference: { locator: locateLink, tokenize: reference },
  strong: { locator: locateStrong, tokenize: strong },
  text: { locator: () => -1, tokenize: text },
  url: { locator: locateUrl, notInLink: true, tokenize: literalUrl }
};

function autoLink(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  let subvalue = '';
  const length = value.length;
  let index = 0;
  let queue = '';
  let hasAtCharacter = false;
  let linkValue = '';
  let character = '';

  if (!value.startsWith('<')) {
    return;
  }

  index++;
  subvalue = '<';

  while (index < length) {
    character = value.charAt(index);

    if (
      isWhitespaceCharacter(character)
      || character === '>'
      || character === '@'
      || (character === ':' && value.charAt(index + 1) === '/')
    ) {
      break;
    }

    queue += character;
    index++;
  }

  if (!queue) {
    return;
  }

  linkValue += queue;
  queue = '';

  character = value.charAt(index);
  linkValue += character;
  index++;

  if (character === '@') {
    hasAtCharacter = true;
  } else {
    if (character !== ':' || value.charAt(index + 1) !== '/') {
      return;
    }

    linkValue += '/';
    index++;
  }

  while (index < length) {
    character = value.charAt(index);

    if (isWhitespaceCharacter(character) || character === '>') {
      break;
    }

    queue += character;
    index++;
  }

  character = value.charAt(index);

  if (!queue || character !== '>') {
    return;
  }

  if (silent) {
    return true;
  }

  linkValue += queue;
  let content = linkValue;
  subvalue += linkValue + character;
  const now = eat.now();
  now.column++;
  now.offset++;

  if (hasAtCharacter) {
    if (linkValue.slice(0, AUTO_LINK_MAILTO.length).toLowerCase() === AUTO_LINK_MAILTO) {
      content = content.slice(AUTO_LINK_MAILTO.length);
      now.column += AUTO_LINK_MAILTO.length;
      now.offset += AUTO_LINK_MAILTO.length;
    } else {
      linkValue = AUTO_LINK_MAILTO + linkValue;
    }
  }

  const children = withTextOnly(parser, () => parser.tokenizeInline(content, now));

  return eat(subvalue)({
    children,
    title: null,
    type: 'link',
    url: decodeEntities(linkValue, { nonTerminated: false })
  });
}

function countOf(value: string, character: string): number {
  let count = 0;
  let index = value.indexOf(character);

  while (index !== -1) {
    count++;
    index = value.indexOf(character, index + character.length);
  }

  return count;
}

function earliest(first: number, second: number): number {
  if (second === -1) {
    return first;
  }

  if (first === -1) {
    return second;
  }

  return Math.min(first, second);
}

function email(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  let index = 0;
  const length = value.length;
  let firstDot = -1;

  let code = value.charCodeAt(index);

  while (isAlphanumericalCode(code) || code === 43 || code === 45 || code === 46 || code === 95) {
    code = value.charCodeAt(++index);
  }

  if (index === 0) {
    return;
  }

  if (code !== 64) {
    return;
  }

  index++;

  while (index < length) {
    code = value.charCodeAt(index);

    if (isAlphanumericalCode(code) || code === 45 || code === 46 || code === 95) {
      index++;

      if (firstDot === -1 && code === 46) {
        firstDot = index;
      }

      continue;
    }

    break;
  }

  if (firstDot === -1 || firstDot === index || code === 45 || code === 95) {
    return;
  }

  if (code === 46) {
    index--;
  }

  const content = value.slice(0, index);

  if (silent) {
    return true;
  }

  const children = withTextOnly(parser, () => parser.tokenizeInline(content, eat.now()));

  return eat(content)({
    children,
    title: null,
    type: 'link',
    url: AUTO_LINK_MAILTO + decodeEntities(content, { nonTerminated: false })
  });
}

function emphasis(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  let index = 0;
  let character = value.charAt(index);

  if (character !== '*' && character !== '_') {
    return;
  }

  const subvalue = character;
  const marker = character;
  const length = value.length;
  index++;
  let queue = '';
  character = '';

  while (index < length) {
    const previous = character;
    character = value.charAt(index);

    if (character === marker) {
      character = value.charAt(++index);

      if (character !== marker) {
        if (!queue.trim() || previous === marker) {
          return;
        }

        if (marker === '_' && isWordCharacter(character)) {
          queue += marker;
          continue;
        }

        if (silent) {
          return true;
        }

        const now = eat.now();
        now.column++;
        now.offset++;

        return eat(subvalue + queue + marker)({
          children: parser.tokenizeInline(queue, now),
          type: 'emphasis'
        });
      }

      queue += marker;
    }

    if (character === '\\') {
      queue += character;
      character = value.charAt(++index);
    }

    queue += character;
    index++;
  }

  return;
}

function escape(_parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  if (value.startsWith('\\')) {
    const character = value.charAt(1);

    if (character && isEscapable(character)) {
      if (silent) {
        return true;
      }

      return eat(`\\${character}`)(character === '\n' ? { type: 'break' } : { type: 'text', value: character });
    }
  }

  return;
}

function hardBreak(_parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  const length = value.length;
  let index = -1;
  let queue = '';

  while (++index < length) {
    const character = value.charAt(index);

    if (character === '\n') {
      if (index < MIN_BREAK_LENGTH) {
        return;
      }

      if (silent) {
        return true;
      }

      queue += character;

      return eat(queue)({ type: 'break' });
    }

    if (character !== ' ') {
      return;
    }

    queue += character;
  }

  return;
}

function inlineCode(_parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  let length = value.length;
  let index = 0;
  let closingFenceStart: number | undefined;
  let closingFenceEnd: number | undefined;
  let found = false;

  while (index < length) {
    if (value.charCodeAt(index) !== 96) {
      break;
    }

    index++;
  }

  if (index === 0 || index === length) {
    return;
  }

  let openingFenceEnd = index;
  let next = value.charCodeAt(index);
  let code = NaN;

  while (index < length) {
    code = next;
    next = value.charCodeAt(index + 1);

    if (code === 96) {
      closingFenceStart ??= index;

      closingFenceEnd = index + 1;

      if (next !== 96 && closingFenceEnd - closingFenceStart === openingFenceEnd) {
        found = true;
        break;
      }
    } else if (closingFenceStart !== undefined) {
      closingFenceStart = undefined;
      closingFenceEnd = undefined;
    }

    index++;
  }

  if (!found || closingFenceStart === undefined || closingFenceEnd === undefined) {
    return;
  }

  if (silent) {
    return true;
  }

  // Remove the first and last space or line feed, when both exist and the content holds other characters.
  index = openingFenceEnd;
  length = closingFenceStart;
  code = value.charCodeAt(index);
  next = value.charCodeAt(length - 1);
  found = false;

  if (length - index > 2 && (code === 32 || code === 10) && (next === 32 || next === 10)) {
    index++;
    length--;

    while (index < length) {
      code = value.charCodeAt(index);

      if (code !== 32 && code !== 10) {
        found = true;
        break;
      }

      index++;
    }

    if (found) {
      openingFenceEnd++;
      closingFenceStart--;
    }
  }

  return eat(value.slice(0, closingFenceEnd))({
    type: 'inlineCode',
    value: value.slice(openingFenceEnd, closingFenceStart)
  });
}

function inlineHtml(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  const length = value.length;

  if (!value.startsWith('<') || length < 3) {
    return;
  }

  const character = value.charAt(1);

  if (!isAlphabeticalCode(character.charCodeAt(0)) && character !== '?' && character !== '!' && character !== '/') {
    return;
  }

  const match = HTML_TAG_RE.exec(value);

  if (!match) {
    return;
  }

  if (silent) {
    return true;
  }

  const subvalue = match[0];

  if (!parser.inLink && HTML_LINK_OPEN_RE.test(subvalue)) {
    parser.inLink = true;
  } else if (parser.inLink && HTML_LINK_CLOSE_RE.test(subvalue)) {
    parser.inLink = false;
  }

  return eat(subvalue)({ type: 'html', value: subvalue });
}

function isAlphabeticalCode(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

function isAlphanumericalCode(code: number): boolean {
  return isAlphabeticalCode(code) || isDecimalCode(code);
}

function isDecimalCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isEscapable(character: string): boolean {
  return '\\`*{}[]()#+-.!_>~|\n"$%&\',/:;<=?@^'.includes(character);
}

function isGfmAtext(code: number): boolean {
  return isAlphanumericalCode(code) || code === 43 || code === 45 || code === 46 || code === 95;
}

function isWordCharacter(character: string): boolean {
  return WORD_CHARACTER_RE.test(character.charAt(0));
}

function link(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  let subvalue = '';
  let index = 0;
  let character = value.charAt(0);
  let closed = false;
  let opening = 0;
  let isImage = false;
  let subqueue = '';
  let title = '';
  let marker = '';
  let url = '';

  // Detect whether this is an image.
  if (character === '!') {
    isImage = true;
    subvalue = character;
    character = value.charAt(++index);
  }

  // Eat the opening.
  if (character !== '[') {
    return;
  }

  // Exit when this is a link and the tokenizer is already inside one.
  if (!isImage && parser.inLink) {
    return;
  }

  subvalue += character;
  let queue = '';
  index++;

  // Eat the content.
  const length = value.length;
  const now = eat.now();
  let depth = 0;

  now.column += index;
  now.offset += index;

  while (index < length) {
    character = value.charAt(index);
    subqueue = character;

    if (character === '`') {
      // Inline code in the link content.
      let count = 1;

      while (value.charAt(index + 1) === '`') {
        subqueue += character;
        index++;
        count++;
      }

      if (!opening) {
        opening = count;
      } else if (count >= opening) {
        opening = 0;
      }
    } else if (character === '\\') {
      // Brackets can be escaped.
      index++;
      subqueue += value.charAt(index);
    } else if (character === '[') {
      // In `gfm` mode, brackets in code still count.
      depth++;
    } else if (character === ']') {
      if (depth) {
        depth--;
      } else {
        if (value.charAt(index + 1) !== '(') {
          return;
        }

        subqueue += '(';
        closed = true;
        index++;

        break;
      }
    }

    queue += subqueue;
    subqueue = '';
    index++;
  }

  // Eat the content's closing.
  if (!closed) {
    return;
  }

  const content = queue;
  subvalue += queue + subqueue;
  index++;

  // Eat white space.
  while (index < length) {
    character = value.charAt(index);

    if (!isWhitespaceCharacter(character)) {
      break;
    }

    subvalue += character;
    index++;
  }

  // Eat the URL.
  character = value.charAt(index);
  queue = '';
  let beforeUrl = subvalue;

  if (character === '<') {
    index++;
    beforeUrl += '<';

    while (index < length) {
      character = value.charAt(index);

      if (character === '>') {
        break;
      }

      if (character === '\n') {
        return;
      }

      queue += character;
      index++;
    }

    if (value.charAt(index) !== '>') {
      return;
    }

    subvalue += `<${queue}>`;
    url = queue;
    index++;
  } else {
    character = '';
    subqueue = '';

    while (index < length) {
      character = value.charAt(index);

      if (subqueue && (character === '"' || character === '\'' || character === '(')) {
        break;
      }

      if (isWhitespaceCharacter(character)) {
        break;
      }

      if (character === '(') {
        depth++;
      } else if (character === ')') {
        if (depth === 0) {
          break;
        }

        depth--;
      }

      queue += subqueue;
      subqueue = '';

      if (character === '\\') {
        queue += '\\';
        character = value.charAt(++index);
      }

      queue += character;

      index++;
    }

    subvalue += queue;
    url = queue;
    index = subvalue.length;
  }

  // Eat white space.
  queue = '';

  while (index < length) {
    character = value.charAt(index);

    if (!isWhitespaceCharacter(character)) {
      break;
    }

    queue += character;
    index++;
  }

  character = value.charAt(index);
  subvalue += queue;
  let beforeTitle = '';

  // Eat the title.
  if (queue && (character === '"' || character === '\'' || character === '(')) {
    index++;
    subvalue += character;
    queue = '';
    marker = character === '(' ? ')' : character;
    beforeTitle = subvalue;

    // The marker cannot occur inside the title.
    while (index < length) {
      character = value.charAt(index);

      if (character === marker) {
        break;
      }

      if (character === '\\') {
        queue += '\\';
        character = value.charAt(++index);
      }

      index++;
      queue += character;
    }

    character = value.charAt(index);

    if (character !== marker) {
      return;
    }

    title = queue;
    subvalue += queue + character;
    index++;

    while (index < length) {
      character = value.charAt(index);

      if (!isWhitespaceCharacter(character)) {
        break;
      }

      subvalue += character;
      index++;
    }
  }

  if (value.charAt(index) !== ')') {
    return;
  }

  if (silent) {
    return true;
  }

  subvalue += ')';

  url = parser.decodeRaw(parser.unescape(url), eat(beforeUrl).test().end, false);

  if (title) {
    const titleStart = eat(beforeTitle).test().end;
    title = parser.decodeRaw(parser.unescape(title), titleStart);
  }

  if (isImage) {
    return eat(subvalue)({
      alt: parser.decodeRaw(parser.unescape(content), now) || null,
      title: title || null,
      type: 'image',
      url
    });
  }

  const exit = parser.enterLink();
  const children = parser.tokenizeInline(content, now);
  exit();

  return eat(subvalue)({
    children,
    title: title || null,
    type: 'link',
    url
  });
}

function literalUrl(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  const length = value.length;
  let protocolless = false;
  let index = 0;

  // `WWW.` does not work.
  if (value.startsWith('www.')) {
    protocolless = true;
    index = 4;
  } else if (value.slice(0, 7).toLowerCase() === 'http://') {
    index = 7;
  } else if (value.slice(0, 8).toLowerCase() === 'https://') {
    index = 8;
  } else {
    return;
  }

  // Act as if the start were a dot.
  let previousDot = index - 1;

  // Parse a valid domain.
  const start = index;
  const dots: number[] = [];
  let code = NaN;

  while (index < length) {
    code = value.charCodeAt(index);

    if (code === 46) {
      // Dots may not follow each other.
      if (previousDot === index - 1) {
        break;
      }

      dots.push(index);
      previousDot = index;
      index++;
      continue;
    }

    if (isAlphanumericalCode(code) || code === 45 || code === 95) {
      index++;
      continue;
    }

    break;
  }

  // Ignore a final dot.
  if (code === 46) {
    dots.pop();
    index--;
  }

  // Without dots, exit.
  if (dots[0] === undefined) {
    return;
  }

  // An underscore in the last two domain parts ends it: `www.sub_domain.example.com` is a link, `www.ex_ample.com` is not.
  const lastTwoPartsStart = dots.length < 2 ? start : (dots.at(-2) ?? 0) + 1;

  if (value.slice(lastTwoPartsStart, index).includes('_')) {
    return;
  }

  if (silent) {
    return true;
  }

  let end = index;
  const pathStart = index;

  // Parse a path.
  while (index < length) {
    code = value.charCodeAt(index);

    if (isWhitespaceCharacter(String.fromCharCode(code)) || code === 60) {
      break;
    }

    index++;

    if (
      code !== 33
      && code !== 42
      && code !== 44
      && code !== 46
      && code !== 58
      && code !== 63
      && code !== 95
      && code !== 126
    ) {
      end = index;
    }
  }

  index = end;

  // A path ending in more closing than opening parentheses drops the extra ones.
  if (value.charCodeAt(index - 1) === 41) {
    let path = value.slice(pathStart, index);
    const leftCount = countOf(path, '(');
    let rightCount = countOf(path, ')');

    while (rightCount > leftCount) {
      index = pathStart + path.lastIndexOf(')');
      path = value.slice(pathStart, index);
      rightCount--;
    }
  }

  if (value.charCodeAt(index - 1) === 59) {
    // A final semicolon is no part of the URL either.
    index--;

    // Nor is a final character reference.
    if (isAlphabeticalCode(value.charCodeAt(index - 1))) {
      end = index - 2;

      while (isAlphabeticalCode(value.charCodeAt(end))) {
        end--;
      }

      if (value.charCodeAt(end) === 38) {
        index = end;
      }
    }
  }

  const content = value.slice(0, index);
  let urlValue = decodeEntities(content, { nonTerminated: false });

  if (protocolless) {
    urlValue = `http://${urlValue}`;
  }

  const children = withTextOnly(parser, () => parser.tokenizeInline(content, eat.now()));

  return eat(content)({ children, title: null, type: 'link', url: urlValue });
}

function locateBreak(_parser: RemarkParser, value: string, fromIndex: number): number {
  let index = value.indexOf('\n', fromIndex);

  while (index > fromIndex) {
    if (value.charAt(index - 1) !== ' ') {
      break;
    }

    index--;
  }

  return index;
}

function locateDelete(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('~~', fromIndex);
}

function locateEmail(_parser: RemarkParser, value: string, fromIndex: number): number {
  let from = fromIndex;

  // An `@` with no address character before it is skipped, and the search goes on after it.
  for (;;) {
    const at = value.indexOf('@', from);

    if (at === -1) {
      return -1;
    }

    if (at === from || !isGfmAtext(value.charCodeAt(at - 1))) {
      from = at + 1;
      continue;
    }

    let position = at;

    while (position > from && isGfmAtext(value.charCodeAt(position - 1))) {
      position--;
    }

    return position;
  }
}

function locateEmphasis(_parser: RemarkParser, value: string, fromIndex: number): number {
  return earliest(value.indexOf('*', fromIndex), value.indexOf('_', fromIndex));
}

function locateEscape(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('\\', fromIndex);
}

function locateInlineCode(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('`', fromIndex);
}

function locateLink(_parser: RemarkParser, value: string, fromIndex: number): number {
  const linkIndex = value.indexOf('[', fromIndex);
  const imageIndex = value.indexOf('![', fromIndex);

  if (imageIndex === -1) {
    return linkIndex;
  }

  // A link is always found when an image is.
  return Math.min(linkIndex, imageIndex);
}

function locateStrong(_parser: RemarkParser, value: string, fromIndex: number): number {
  return earliest(value.indexOf('**', fromIndex), value.indexOf('__', fromIndex));
}

function locateTag(_parser: RemarkParser, value: string, fromIndex: number): number {
  return value.indexOf('<', fromIndex);
}

function locateUrl(_parser: RemarkParser, value: string, fromIndex: number): number {
  let min = -1;

  for (const prefix of URL_PREFIXES) {
    const position = value.indexOf(prefix, fromIndex);

    if (position !== -1 && (min === -1 || position < min)) {
      min = position;
    }
  }

  return min;
}

function reference(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  let character = value.charAt(0);
  let index = 0;
  const length = value.length;
  let intro = '';
  let isImage = false;
  let referenceType: RemarkReferenceType = 'shortcut';
  let identifier = '';
  let bracketed = false;

  // Check whether this is an image.
  if (character === '!') {
    isImage = true;
    intro = character;
    character = value.charAt(++index);
  }

  if (character !== '[') {
    return;
  }

  index++;
  intro += character;
  let queue = '';

  // Eat the text.
  let depth = 0;

  while (index < length) {
    character = value.charAt(index);

    if (character === '[') {
      bracketed = true;
      depth++;
    } else if (character === ']') {
      if (!depth) {
        break;
      }

      depth--;
    }

    if (character === '\\') {
      queue += '\\';
      character = value.charAt(++index);
    }

    queue += character;
    index++;
  }

  let subvalue = queue;
  const content = queue;
  character = value.charAt(index);

  if (character !== ']') {
    return;
  }

  index++;
  subvalue += character;
  queue = '';

  character = value.charAt(index);

  if (character === '[') {
    identifier = '';
    queue += character;
    index++;

    while (index < length) {
      character = value.charAt(index);

      if (character === '[' || character === ']') {
        break;
      }

      if (character === '\\') {
        identifier += '\\';
        character = value.charAt(++index);
      }

      identifier += character;
      index++;
    }

    character = value.charAt(index);

    if (character === ']') {
      referenceType = identifier ? 'full' : 'collapsed';
      queue += identifier + character;
      index++;
    } else {
      identifier = '';
    }

    subvalue += queue;
    queue = '';
  } else {
    if (!content) {
      return;
    }

    identifier = content;
  }

  // Brackets cannot be inside the identifier.
  if (referenceType !== 'full' && bracketed) {
    return;
  }

  subvalue = intro + subvalue;

  if (!isImage && parser.inLink) {
    return;
  }

  if (silent) {
    return true;
  }

  const now = eat.now();
  now.column += intro.length;
  now.offset += intro.length;
  identifier = referenceType === 'full' ? identifier : content;

  if (isImage) {
    return eat(subvalue)({
      alt: parser.decodeRaw(parser.unescape(content), now) || null,
      identifier: normalizeIdentifier(identifier),
      label: identifier,
      referenceType,
      type: 'imageReference'
    });
  }

  const exit = parser.enterLink();
  const children = parser.tokenizeInline(content, now);
  exit();

  return eat(subvalue)({
    children,
    identifier: normalizeIdentifier(identifier),
    label: identifier,
    referenceType,
    type: 'linkReference'
  });
}

function strikethrough(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  let character = '';
  let previous = '';
  let preceding = '';
  let subvalue = '';

  if (!value.startsWith('~~') || isWhitespaceCharacter(value.charAt(2))) {
    return;
  }

  let index = 1;
  const length = value.length;
  const now = eat.now();
  now.column += 2;
  now.offset += 2;

  while (++index < length) {
    character = value.charAt(index);

    if (character === '~' && previous === '~' && (!preceding || !isWhitespaceCharacter(preceding))) {
      if (silent) {
        return true;
      }

      return eat(`~~${subvalue}~~`)({
        children: parser.tokenizeInline(subvalue, now),
        type: 'delete'
      });
    }

    subvalue += previous;
    preceding = previous;
    previous = character;
  }

  return;
}

function strong(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  let index = 0;
  let character = value.charAt(index);

  if ((character !== '*' && character !== '_') || value.charAt(++index) !== character) {
    return;
  }

  const marker = character;
  const subvalue = marker + marker;
  const length = value.length;
  index++;
  let queue = '';
  character = '';

  while (index < length) {
    character = value.charAt(index);

    if (character === marker && value.charAt(index + 1) === marker) {
      character = value.charAt(index + 2);

      if (character !== marker) {
        if (!queue.trim()) {
          return;
        }

        if (silent) {
          return true;
        }

        const now = eat.now();
        now.column += 2;
        now.offset += 2;

        return eat(subvalue + queue + subvalue)({
          children: parser.tokenizeInline(queue, now),
          type: 'strong'
        });
      }
    }

    if (character === '\\') {
      queue += character;
      character = value.charAt(++index);
    }

    queue += character;
    index++;
  }

  return;
}

function text(parser: RemarkParser, eat: Eat, value: string, silent: boolean): boolean | RemarkNode | undefined {
  if (silent) {
    return true;
  }

  const tokenizers = parser.inlineTokenizers;
  let min = value.length;

  for (const name of parser.tokenizers.inlineMethods) {
    const tokenizer = tokenizers[name];

    if (name === 'text' || !tokenizer) {
      continue;
    }

    const position = tokenizer.locator(parser, value, 1);

    if (position !== -1 && position < min) {
      min = position;
    }
  }

  const subvalue = value.slice(0, min);
  const now = eat.now();

  parser.decode(subvalue, now, (content, source) => {
    eat(source ?? content)({ type: 'text', value: content });
  });

  return;
}

// Reads `read` with every inline tokenizer but `text` removed, inside a link, as autolinks read their content.
function withTextOnly(parser: RemarkParser, read: () => RemarkNode[]): RemarkNode[] {
  const tokenizers = parser.inlineTokenizers;
  const exit = parser.enterLink();
  parser.inlineTokenizers = tokenizers.text ? { text: tokenizers.text } : {};
  try {
    return read();
  } finally {
    parser.inlineTokenizers = tokenizers;
    exit();
  }
}

/* eslint-enable complexity, no-magic-numbers, no-useless-assignment, no-useless-return, unicorn/consistent-boolean-name, unicorn/no-declarations-before-early-exit, unicorn/prefer-code-point, unicorn/prefer-combined-guards, unicorn/prefer-else-if, unicorn/prefer-includes-over-repeated-comparisons, unicorn/prefer-simple-condition-first, unicorn/prefer-switch, unicorn/prefer-ternary -- The port ends here. */
