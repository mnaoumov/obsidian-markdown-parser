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
 *
 * The single-line `lheading` rule is adapted from markdown-it's own, under its MIT license (see
 * `THIRD-PARTY-NOTICES.md`).
 */

import type {
  MarkdownIt,
  StateBlock,
  StateCore,
  StateInline,
  Token
} from 'markdown-it';

import type { ObsidianQuirkFlags } from './options.ts';

import { hasBlankLineInside } from './loose-list.ts';
import {
  COMMENT_OPEN,
  decodeObsidianCharacterReferences,
  isObsidianHtmlComment,
  matchObsidianAutolink,
  matchObsidianCharacterReference,
  obsidianHtmlBlockKind,
  parseObsidianDefinition
} from './quirk-rules.ts';

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
