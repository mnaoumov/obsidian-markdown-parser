/**
 * @file
 *
 * Obsidian's quirks as markdown-it rules: where Obsidian reads valid CommonMark differently (see `options.ts`).
 *
 * - `setextHeading: 'single-line'`: the `lheading` rule is replaced by one that reads Obsidian's setext heading only, so
 *   the paragraph rule takes every other underline as text, or ends at a `---` thematic break.
 * - `emptyListItem: 'interrupts-paragraph'`: a rule in the paragraph's terminator chain ends a paragraph at an empty
 *   list item, which the list rule then opens.
 * - `softLineBreak: 'hard-break'`: a core rule turns every `softbreak` token into a `hardbreak`.
 * - `looseList: 'blank-line-anywhere'`: a core rule shows the paragraphs of a list the quirk makes loose, as the list
 *   rule does for a loose list.
 * - `htmlBlock`, `linkDefinition`, `gfmTable` and `listItem`: Obsidian's `html_block`, `reference`, `table` and
 *   `list` rules replace markdown-it's. The table rule runs after every other block, as Obsidian tries a table last.
 * - `htmlComment`, `characterReference` and `autolink`: inline rules before `html_inline` and `entity`, and in place
 *   of `autolink`, read Obsidian's comments, references and autolinks.
 *
 * The single-line `lheading` rule, and the `html_block`, `reference`, `table` and `list` rules of the other quirks,
 * are adapted from markdown-it's own, under its MIT license (see `THIRD-PARTY-NOTICES.md`).
 */

import type {
  MarkdownIt,
  StateBlock,
  StateCore,
  StateInline,
  Token
} from 'markdown-it';

import type { ObsidianQuirkFlags } from './options.ts';
import type { ObsidianTableAlignment } from './quirk-rules.ts';

import { hasBlankLineInside } from './loose-list.ts';
import {
  COMMENT_OPEN,
  decodeObsidianCharacterReferences,
  hasObsidianTableLeadingPipe,
  isObsidianHtmlComment,
  isObsidianTableRow,
  matchObsidianAutolink,
  matchObsidianCharacterReference,
  obsidianHtmlBlockKind,
  obsidianTableAlignments,
  obsidianTableCells,
  parseObsidianDefinition
} from './quirk-rules.ts';

// What tokenizing a list item tells its list.
interface ListItemEnd {
  readonly isTight: boolean;
}

// A list item as its marker line opens it: where its content starts, and at which column.
interface ListItemStart {
  readonly contentStart: number;
  readonly indent: number;
  readonly isOrdered: boolean;
  readonly lines: [number, number];
  readonly offset: number;
}

// A list marker: where it starts and ends, and the number of an ordered one.
interface ListMarker {
  readonly end: number;
  readonly isOrdered: boolean;
  readonly start: number;
  readonly value: number;
}

// The link reference definitions markdown-it collects in its environment.
interface ReferenceEnvironment {
  references?: Record<string, ReferenceTarget>;
}

interface ReferenceTarget {
  readonly href: string;
  readonly title: string;
}

type RuleBlock = ReturnType<MarkdownIt['block']['ruler']['getRules']>[number];

const CODE_INDENT = 4;
const TAB_SIZE = 4;
// An item's empty first line and the blank line after it.
const EMPTY_LINE_AND_BLANK = 2;
const ORDERED_DIGITS_RE = /^\d*/u;
const EQUALS_LEVEL = 1;
const DASH_LEVEL = 2;
const SETEXT_LEVELS: Readonly<Record<string, number>> = { '-': DASH_LEVEL, '=': EQUALS_LEVEL };
const BARE_UNDERLINE_RE = /^(?:=+|-+)$/u;
const SETEXT_UNDERLINE_RE = /^(?:=+|-+)[\t ]*$/u;
const LINE_BREAK_RE = /\n/gu;
const EMPTY_LIST_ITEM_RE = /^(?:[*+-]|1[).])[\t ]*$/u;
const TRAILING_WHITESPACE_RE = /[\t ]+$/u;
const QUOTE_OPENS = new Set(['blockquote_open', 'Callout_open']);
const QUOTE_CLOSES = new Set(['blockquote_close', 'Callout_close']);
const LIST_OPENS = new Set(['bullet_list_open', 'ordered_list_open']);
// A list item's paragraph is two levels below its list: the list holds the item, and the item the paragraph.
const PARAGRAPH_LEVEL_IN_LIST = 2;

/**
 * The `reference` rule of the `linkDefinition` quirk: a link reference definition as Obsidian reads it (see
 * `parseObsidianDefinition`), adapted from markdown-it's own rule, which reads the block's lines the same way. A
 * definition of one line with a setext underline below it is left to the `lheading` rule.
 *
 * @param isSingleLineSetext - Whether setext headings follow the `setextHeading` quirk.
 * @returns The rule.
 */
export function createObsidianReferenceRule(isSingleLineSetext: boolean): RuleBlock {
  return (state, startLine, _endLine, isSilent) => {
    if ((state.sCount[startLine] ?? 0) - state.blkIndent >= CODE_INDENT || !lineText(state, startLine).startsWith('[') || isSetextUnderlineAt(state, startLine + 1, isSingleLineSetext)) {
      return false;
    }
    let text = state.getLines(startLine, startLine + 1, state.blkIndent, false);
    let nextLine = startLine + 1;
    let definition = parseObsidianDefinition(text, false);
    while (definition === 'pending') {
      const more = isReferenceContinuation(state, nextLine) ? state.getLines(nextLine, nextLine + 1, state.blkIndent, false) : null;
      if (more === null) {
        definition = parseObsidianDefinition(text, true);
        break;
      }
      text += `\n${more}`;
      nextLine++;
      definition = parseObsidianDefinition(text, false);
    }
    if (definition === null || definition === 'pending') {
      return false;
    }
    const { utils } = state.md;
    const destination = text.slice(definition.destination.from, definition.destination.to);
    const href = state.md.normalizeLink(utils.unescapeAll(destination.startsWith('<') ? destination.slice(1, -1) : destination));
    if (!state.md.validateLink(href)) {
      return false;
    }
    if (isSilent) {
      return true;
    }
    const label = utils.normalizeReference(text.slice(definition.label.from + 1, definition.label.to - 1));
    const title = definition.title ? utils.unescapeAll(text.slice(definition.title.from + 1, definition.title.to - 1)) : '';
    const env = state.env as ReferenceEnvironment;
    env.references ??= {};
    env.references[label] ??= { href, title };
    const endLine = startLine + 1 + (text.slice(0, definition.length).match(LINE_BREAK_RE)?.length ?? 0);
    const token = state.push('reference_definition', '', 0);
    token.map = [startLine, endLine];
    token.hidden = true;
    token.meta = { label };
    state.line = endLine;
    return true;
  };
}

/**
 * Adds the rules for the quirks asked for. The CommonMark behaviour of every quirk needs none.
 *
 * @param md - The markdown-it instance.
 * @param quirks - The quirks.
 */
export function markdownItQuirks(md: MarkdownIt, quirks: ObsidianQuirkFlags): void {
  if (quirks.setextHeading === 'single-line') {
    md.block.ruler.at('lheading', checkSingleLineSetextHeading);
  }
  if (quirks.emptyListItem === 'interrupts-paragraph') {
    md.block.ruler.before('paragraph', 'obsidian_empty_list_item', (state, startLine, _endLine, isSilent) => isSilent && isEmptyListItem(state, startLine), { alt: ['paragraph'] });
  }
  if (quirks.softLineBreak === 'hard-break') {
    md.core.ruler.after('inline', 'obsidian_hard_line_breaks', hardenLineBreaks);
  }
  if (quirks.looseList === 'blank-line-anywhere') {
    md.core.ruler.after('block', 'obsidian_loose_lists', loosenLists);
  }
  if (quirks.autolink === 'obsidian') {
    md.inline.ruler.at('autolink', checkObsidianAutolink);
  }
  if (quirks.characterReference === 'obsidian') {
    md.inline.ruler.before('entity', 'obsidian_character_reference', checkObsidianCharacterReference);
  }
  if (quirks.listItem === 'obsidian') {
    md.block.ruler.at('list', checkObsidianList, { alt: ['paragraph', 'reference', 'blockquote'] });
  }
  if (quirks.gfmTable === 'obsidian') {
    // In place of markdown-it's table rule, when it is on, and after every other block, as Obsidian tries a table last.
    const ruleCount = md.block.ruler.getRules('').length;
    md.block.ruler.disable('table', true);
    if (md.block.ruler.getRules('').length < ruleCount) {
      md.block.ruler.before('paragraph', 'obsidian_table', checkObsidianTable);
    }
  }
  if (quirks.htmlBlock === 'obsidian') {
    md.block.ruler.at('html_block', checkObsidianHtmlBlock, { alt: ['paragraph', 'reference', 'blockquote'] });
  }
  if (quirks.htmlComment === 'obsidian') {
    md.inline.ruler.before('html_inline', 'obsidian_html_comment', checkObsidianHtmlComment);
  }
}

// An autolink as Obsidian reads it, as markdown-it's `autolink` rule gives one.
function checkObsidianAutolink(state: StateInline, isSilent: boolean): boolean {
  if (state.src.charAt(state.pos) !== '<') {
    return false;
  }
  const autolink = matchObsidianAutolink(state.src.slice(state.pos, state.posMax));
  if (!autolink) {
    return false;
  }
  const url = state.md.normalizeLink(decodeObsidianCharacterReferences(autolink.url, true));
  if (!state.md.validateLink(url)) {
    return false;
  }
  if (!isSilent) {
    const open = state.push('link_open', 'a', 1);
    open.attrSet('href', url);
    open.markup = 'autolink';
    open.info = 'auto';
    const text = state.push('text', '', 0);
    text.content = decodeObsidianCharacterReferences(autolink.text);
    const close = state.push('link_close', 'a', -1);
    close.markup = 'autolink';
    close.info = 'auto';
  }
  state.pos += autolink.length;
  return true;
}

// A character reference as Obsidian reads it, as markdown-it's `entity` rule gives one.
function checkObsidianCharacterReference(state: StateInline, isSilent: boolean): boolean {
  if (state.src.charAt(state.pos) !== '&') {
    return false;
  }
  const reference = matchObsidianCharacterReference(state.src.slice(state.pos, state.posMax));
  if (!reference) {
    return false;
  }
  if (!isSilent) {
    const token = state.push('text_special', '', 0);
    token.content = reference.value;
    token.markup = state.src.slice(state.pos, state.pos + reference.length);
    token.info = 'entity';
  }
  state.pos += reference.length;
  return true;
}

/*
 * An HTML block as Obsidian reads it, adapted from markdown-it's `html_block` rule. It runs to the line that holds its
 * end, or to the line before an empty one, or to the end of its container.
 */
function checkObsidianHtmlBlock(state: StateBlock, startLine: number, endLine: number, isSilent: boolean): boolean {
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= CODE_INDENT || !state.md.options.html) {
    return false;
  }
  const firstLine = lineText(state, startLine);
  const kind = firstLine.startsWith('<') ? obsidianHtmlBlockKind(firstLine) : null;
  if (!kind) {
    return false;
  }
  if (isSilent) {
    return kind.canInterrupt;
  }
  let nextLine = startLine + 1;
  if (!kind.end?.test(firstLine)) {
    for (; nextLine < endLine; nextLine++) {
      if (kind.end === null && isEmptyLine(state, nextLine)) {
        break;
      }
      if ((state.sCount[nextLine] ?? 0) < state.blkIndent && (kind.end === null || !state.isEmpty(nextLine))) {
        break;
      }
      if (kind.end?.test(lineText(state, nextLine))) {
        nextLine++;
        break;
      }
    }
  }
  state.line = nextLine;
  const token = state.push('html_block', '', 0);
  token.map = [startLine, nextLine];
  token.content = state.getLines(startLine, nextLine, state.blkIndent, true);
  return true;
}

// A `<!--` that opens no comment of CommonMark 0.30 is text.
function checkObsidianHtmlComment(state: StateInline, isSilent: boolean): boolean {
  const rest = state.src.slice(state.pos, state.posMax);
  if (!state.md.options.html || !rest.startsWith(COMMENT_OPEN) || isObsidianHtmlComment(rest)) {
    return false;
  }
  if (!isSilent) {
    state.pending += '<';
  }
  state.pos++;
  return true;
}

/*
 * A list as Obsidian structures it (see `ObsidianQuirkFlags.listItem`), adapted from markdown-it's `list` rule. An
 * ordered marker takes any number of digits; an item whose first line is empty has its content right after its marker,
 * and runs on over blank lines; a line indented more than four columns past the list continues an item whose content
 * is further right; and a marker of the list indented less than an item's content opens the next item, and ends a
 * paragraph of the item before it.
 */
function checkObsidianList(state: StateBlock, startLine: number, endLine: number, isSilent: boolean): boolean {
  let marker = (state.sCount[startLine] ?? 0) - state.blkIndent < CODE_INDENT ? readListMarker(state, startLine) : null;
  // A marker short of the paragraph's container ends the paragraph however far it is indented, as the next item.
  const isTerminatingParagraph = isSilent && state.parentType === 'paragraph' && (state.sCount[startLine] ?? 0) >= state.blkIndent;
  if (!marker || (isTerminatingParagraph && (marker.value !== 1 || state.skipSpaces(marker.end) >= (state.eMarks[startLine] ?? 0)))) {
    return false;
  }
  if (isSilent) {
    return true;
  }
  const { isOrdered } = marker;
  const delimiter = state.src.charAt(marker.end - 1);
  const listTokenIndex = state.tokens.length;
  const listLines = openList(state, startLine, marker, delimiter);
  let nextLine = startLine;
  let isTight = true;
  let isPreviousEmptyEnd = false;
  const parentIndent = state.blkIndent;
  const oldParentType = state.parentType;
  state.parentType = 'list';
  while (marker) {
    const item = openListItem(state, nextLine, marker, delimiter);
    const isItemTight = tokenizeListItem(state, nextLine, endLine, item, parentIndent).isTight;
    isTight &&= isItemTight && !isPreviousEmptyEnd;
    isPreviousEmptyEnd = state.line - nextLine > 1 && state.isEmpty(state.line - 1);
    state.push('list_item_close', 'li', -1).markup = delimiter;
    nextLine = state.line;
    item.lines[1] = nextLine;
    marker = nextSiblingMarker(state, nextLine, endLine, item, delimiter);
  }
  state.push(isOrdered ? 'ordered_list_close' : 'bullet_list_close', isOrdered ? 'ol' : 'ul', -1).markup = delimiter;
  listLines[1] = nextLine;
  state.line = nextLine;
  state.parentType = oldParentType;
  if (isTight) {
    markTightParagraphs(state, listTokenIndex);
  }
  return true;
}

/*
 * A table as Obsidian reads it (see `ObsidianQuirkFlags.gfmTable`), with the tokens of markdown-it's own `table` rule.
 * It interrupts no paragraph, and its cells are inline content as written.
 */
function checkObsidianTable(state: StateBlock, startLine: number, endLine: number, isSilent: boolean): boolean {
  const delimiterLine = startLine + 1;
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= CODE_INDENT || delimiterLine >= endLine || (state.sCount[delimiterLine] ?? 0) < state.blkIndent) {
    return false;
  }
  const header = rowText(state, startLine);
  const delimiter = rowText(state, delimiterLine);
  const hasLeadingPipe = hasObsidianTableLeadingPipe(header);
  const alignments = isObsidianTableRow(header) && isObsidianTableRow(delimiter) && hasObsidianTableLeadingPipe(delimiter) === hasLeadingPipe ? obsidianTableAlignments(delimiter) : null;
  if (!alignments) {
    return false;
  }
  if (isSilent) {
    return true;
  }
  let nextLine = delimiterLine + 1;
  while (nextLine < endLine && (state.sCount[nextLine] ?? 0) >= state.blkIndent && isObsidianTableRowOf(rowText(state, nextLine), hasLeadingPipe)) {
    nextLine++;
  }
  state.push('table_open', 'table', 1).map = [startLine, nextLine];
  state.push('thead_open', 'thead', 1).map = [startLine, delimiterLine + 1];
  pushTableRow(state, startLine, header, 'th', alignments);
  state.push('thead_close', 'thead', -1);
  if (nextLine > delimiterLine + 1) {
    state.push('tbody_open', 'tbody', 1).map = [delimiterLine + 1, nextLine];
    for (let line = delimiterLine + 1; line < nextLine; line++) {
      pushTableRow(state, line, rowText(state, line), 'td', alignments);
    }
    state.push('tbody_close', 'tbody', -1);
  }
  state.push('table_close', 'table', -1);
  state.line = nextLine;
  return true;
}

/*
 * Obsidian's setext heading: one line of text, and an underline right below it that starts its line and ends with its
 * marker. Adapted from markdown-it's `lheading` rule, which reads CommonMark's.
 */
function checkSingleLineSetextHeading(state: StateBlock, startLine: number, endLine: number): boolean {
  const underlineLine = startLine + 1;
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= CODE_INDENT || underlineLine >= endLine || state.sCount[underlineLine] !== state.blkIndent) {
    return false;
  }
  const underline = lineText(state, underlineLine);
  const level = SETEXT_LEVELS[underline.charAt(0)];
  if (level === undefined || !BARE_UNDERLINE_RE.test(underline)) {
    return false;
  }
  const content = state.getLines(startLine, underlineLine, state.blkIndent, false).trim();
  state.line = underlineLine + 1;
  const open = state.push('heading_open', `h${String(level)}`, 1);
  open.markup = underline.charAt(0);
  open.map = [startLine, state.line];
  const inline = state.push('inline', '', 0);
  inline.content = content;
  inline.map = [startLine, state.line - 1];
  inline.children = [];
  const close = state.push('heading_close', `h${String(level)}`, -1);
  close.markup = underline.charAt(0);
  return true;
}

// Every soft line break becomes a hard one, which drops the whitespace before it as a hard break of spaces does.
function hardenLineBreaks(state: StateCore): void {
  for (const token of state.tokens) {
    const children = token.children ?? [];
    for (const [index, child] of children.entries()) {
      if (child.type !== 'softbreak') {
        continue;
      }
      child.type = 'hardbreak';
      child.tag = 'br';
      const before = children[index - 1];
      if (before?.type === 'text') {
        before.content = before.content.replace(TRAILING_WHITESPACE_RE, '');
      }
    }
  }
}
// A line with nothing after its container markup but whitespace those containers take.
function isEmptyLine(state: StateBlock, line: number): boolean {
  return state.isEmpty(line) && (state.sCount[line] ?? 0) <= state.blkIndent;
}

function isEmptyListItem(state: StateBlock, line: number): boolean {
  return (state.sCount[line] ?? 0) - state.blkIndent < CODE_INDENT && EMPTY_LIST_ITEM_RE.test(lineText(state, line));
}

// Whether a block another rule opens there ends the list.
function isListTerminatedAt(state: StateBlock, line: number, endLine: number): boolean {
  return state.md.block.ruler.getRules('list').some((rule) => rule(state, line, endLine, true));
}

function isObsidianTableRowOf(text: string, hasLeadingPipe: boolean): boolean {
  return isObsidianTableRow(text) && hasObsidianTableLeadingPipe(text) === hasLeadingPipe;
}

// Whether a line continues the block a reference opens: it is no blank line, and no other block interrupts there.
function isReferenceContinuation(state: StateBlock, line: number): boolean {
  if (line >= state.lineMax || state.isEmpty(line)) {
    return false;
  }
  if ((state.sCount[line] ?? 0) - state.blkIndent >= CODE_INDENT || (state.sCount[line] ?? 0) < 0) {
    return true;
  }
  const parentType = state.parentType;
  state.parentType = 'reference';
  const isInterrupted = state.md.block.ruler.getRules('reference').some((rule) => rule(state, line, state.lineMax, true));
  state.parentType = parentType;
  return !isInterrupted;
}

// Whether a line is a setext underline below a paragraph's line, as the `lheading` rule in use reads it.
function isSetextUnderlineAt(state: StateBlock, line: number, isSingleLineSetext: boolean): boolean {
  if (line >= state.lineMax || (state.sCount[line] ?? 0) < state.blkIndent) {
    return false;
  }
  const text = lineText(state, line);
  return isSingleLineSetext ? state.sCount[line] === state.blkIndent && BARE_UNDERLINE_RE.test(text) : (state.sCount[line] ?? 0) - state.blkIndent < CODE_INDENT && SETEXT_UNDERLINE_RE.test(text);
}

// The block tokenizer's tightness, read after it ran.
function isStateTight(state: StateBlock): boolean {
  return state.tight;
}

function lineContentStart(state: StateBlock, line: number): number {
  return (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice((state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0), state.eMarks[line]);
}

// Shows the paragraphs of every list that a blank line inside makes loose.
function loosenLists(state: StateCore): void {
  const lineStarts = [0];
  for (let index = state.src.indexOf('\n'); index !== -1; index = state.src.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1);
  }
  let quoteDepth = 0;
  for (const [index, token] of state.tokens.entries()) {
    if (QUOTE_OPENS.has(token.type)) {
      quoteDepth++;
    } else if (QUOTE_CLOSES.has(token.type)) {
      quoteDepth--;
    } else if (LIST_OPENS.has(token.type) && token.map) {
      const [startLine, endLine] = token.map;
      const source = state.src.slice(lineStarts[startLine] ?? 0, lineStarts[endLine] ?? state.src.length);
      if (hasBlankLineInside(source, quoteDepth)) {
        showListParagraphs(state.tokens, index);
      }
    }
  }
}

// As markdown-it's list rule does: hides the paragraphs of a tight list.
function markTightParagraphs(state: StateBlock, listIndex: number): void {
  const level = state.level + PARAGRAPH_LEVEL_IN_LIST;
  for (let index = listIndex + PARAGRAPH_LEVEL_IN_LIST; index < state.tokens.length - PARAGRAPH_LEVEL_IN_LIST; index++) {
    const token = state.tokens[index];
    if (token?.level !== level || token.type !== 'paragraph_open') {
      continue;
    }
    const close = state.tokens[index + PARAGRAPH_LEVEL_IN_LIST];
    if (close) {
      close.hidden = true;
    }
    token.hidden = true;
    index += PARAGRAPH_LEVEL_IN_LIST;
  }
}

// The marker of the next item of a list, after the item before it: one of the same kind, indented short of its content.
function nextSiblingMarker(state: StateBlock, line: number, endLine: number, item: ListItemStart, delimiter: string): ListMarker | null {
  const sCount = state.sCount[line] ?? 0;
  if (line >= endLine || sCount < state.blkIndent || (sCount - state.blkIndent >= CODE_INDENT && sCount >= item.indent) || isListTerminatedAt(state, line, endLine)) {
    return null;
  }
  const marker = readListMarker(state, line);
  return marker?.isOrdered === item.isOrdered && state.src.charAt(marker.end - 1) === delimiter ? marker : null;
}

// Opens a list at its first marker, and gives the range of its lines, to be closed.
function openList(state: StateBlock, line: number, marker: ListMarker, delimiter: string): [number, number] {
  const open = state.push(marker.isOrdered ? 'ordered_list_open' : 'bullet_list_open', marker.isOrdered ? 'ol' : 'ul', 1);
  if (marker.isOrdered && marker.value !== 1) {
    open.attrSet('start', String(marker.value));
  }
  const lines: [number, number] = [line, 0];
  open.map = lines;
  open.markup = delimiter;
  return lines;
}

// Opens a list item at its marker: its content starts after the marker's whitespace, or right after an empty line's marker.
function openListItem(state: StateBlock, line: number, marker: ListMarker, markup: string): ListItemStart {
  const max = state.eMarks[line] ?? 0;
  const initial = (state.sCount[line] ?? 0) + marker.end - marker.start;
  let offset = initial;
  let pos = marker.end;
  for (; pos < max; pos++) {
    const char = state.src.charAt(pos);
    if (char === '\t') {
      offset += TAB_SIZE - ((offset + (state.bsCount[line] ?? 0)) % TAB_SIZE);
    } else if (char === ' ') {
      offset++;
    } else {
      break;
    }
  }
  let indentAfterMarker = pos >= max ? 0 : offset - initial;
  if (indentAfterMarker > CODE_INDENT) {
    indentAfterMarker = 1;
  }
  const token = state.push('list_item_open', 'li', 1);
  token.markup = markup;
  const lines: [number, number] = [line, 0];
  token.map = lines;
  if (marker.isOrdered) {
    token.info = state.src.slice(marker.start, marker.end - 1);
  }
  return { contentStart: pos, indent: initial + indentAfterMarker, isOrdered: marker.isOrdered, lines, offset };
}

// A table row's cells, cut or padded to the columns of its delimiter row.
function pushTableRow(state: StateBlock, line: number, text: string, tag: 'td' | 'th', alignments: readonly ObsidianTableAlignment[]): void {
  const cells = obsidianTableCells(text);
  state.push('tr_open', 'tr', 1).map = [line, line + 1];
  for (const [column, alignment] of alignments.entries()) {
    const open = state.push(`${tag}_open`, tag, 1);
    if (alignment) {
      open.attrSet('style', `text-align:${alignment}`);
    }
    const cell = cells[column];
    const inline = state.push('inline', '', 0);
    inline.content = cell ? text.slice(cell.from, cell.to) : '';
    inline.map = [line, line + 1];
    inline.children = [];
    state.push(`${tag}_close`, tag, -1);
  }
  state.push('tr_close', 'tr', -1);
}

function readListMarker(state: StateBlock, line: number): ListMarker | null {
  const ordered = skipOrderedListMarker(state, line);
  const start = lineContentStart(state, line);
  if (ordered >= 0) {
    return { end: ordered, isOrdered: true, start, value: Number(state.src.slice(start, ordered - 1)) };
  }
  const bullet = skipBulletListMarker(state, line);
  return bullet >= 0 ? { end: bullet, isOrdered: false, start, value: 1 } : null;
}

// A line's text after the markup of its containers, as a table row reads it.
function rowText(state: StateBlock, line: number): string {
  return state.getLines(line, line + 1, state.blkIndent, false);
}

function showListParagraphs(tokens: readonly Token[], listIndex: number): void {
  const list = tokens[listIndex];
  if (!list) {
    return;
  }
  const paragraphLevel = list.level + PARAGRAPH_LEVEL_IN_LIST;
  for (let index = listIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token || token.level < list.level || (token.level === list.level && token.nesting === -1)) {
      return;
    }
    if (token.level === paragraphLevel && (token.type === 'paragraph_open' || token.type === 'paragraph_close')) {
      token.hidden = false;
    }
  }
}

function skipBulletListMarker(state: StateBlock, line: number): number {
  const pos = lineContentStart(state, line);
  const marker = state.src.charAt(pos);
  if (marker !== '*' && marker !== '-' && marker !== '+') {
    return -1;
  }
  return pos + 1 < (state.eMarks[line] ?? 0) && !state.md.utils.isSpace(state.src.codePointAt(pos + 1) ?? 0) ? -1 : pos + 1;
}

// An ordered marker: any number of digits, then `.` or `)`.
function skipOrderedListMarker(state: StateBlock, line: number): number {
  const start = lineContentStart(state, line);
  const max = state.eMarks[line] ?? 0;
  const digits = ORDERED_DIGITS_RE.exec(state.src.slice(start, max))?.[0].length ?? 0;
  const pos = start + digits + 1;
  const delimiter = state.src.charAt(start + digits);
  if (digits === 0 || (delimiter !== '.' && delimiter !== ')')) {
    return -1;
  }
  return pos < max && !state.md.utils.isSpace(state.src.codePointAt(pos) ?? 0) ? -1 : pos;
}

/*
 * Tokenizes a list item's content, and says whether it is tight. A line indented more than four columns past the list,
 * but short of the item's content, is read as if it reached the content, unless it is a marker of the list, which opens
 * the next item.
 */
function tokenizeListItem(state: StateBlock, line: number, endLine: number, item: ListItemStart, parentIndent: number): ListItemEnd {
  const isOldTight = state.tight;
  const oldTShift = state.tShift[line] ?? 0;
  const oldSCount = state.sCount[line] ?? 0;
  const oldListIndent = state.listIndent;
  const raised: [number, number][] = [];
  for (let next = line + 1; next < endLine; next++) {
    const sCount = state.sCount[next] ?? 0;
    if (!(!state.isEmpty(next) && sCount - parentIndent > CODE_INDENT && sCount < item.indent && skipBulletListMarker(state, next) < 0 && skipOrderedListMarker(state, next) < 0)) {
      continue;
    }

    raised.push([next, sCount]);
    state.sCount[next] = item.indent;
  }
  state.listIndent = state.blkIndent;
  state.blkIndent = item.indent;
  state.tight = true;
  state.tShift[line] = item.contentStart - (state.bMarks[line] ?? 0);
  state.sCount[line] = item.offset;
  state.md.block.tokenize(state, line, endLine);
  // An item whose first line is empty and whose content follows a blank line is loose.
  const isTight = isStateTight(state) && !(item.contentStart >= (state.eMarks[line] ?? 0) && state.line - line > EMPTY_LINE_AND_BLANK && state.isEmpty(line + 1));
  state.blkIndent = state.listIndent;
  state.listIndent = oldListIndent;
  state.tShift[line] = oldTShift;
  state.sCount[line] = oldSCount;
  state.tight = isOldTight;
  for (const [next, sCount] of raised) {
    state.sCount[next] = sCount;
  }
  return { isTight };
}
