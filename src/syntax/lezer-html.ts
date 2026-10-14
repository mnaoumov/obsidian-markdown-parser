/**
 * @file
 *
 * Renders a `@lezer/markdown` tree to HTML the way the CommonMark reference implementation does, so the tree can be
 * checked against the CommonMark and GFM spec suites.
 *
 * The tree keeps no text of its own, only node ranges, so the renderer reads the text back from the source: it takes
 * container prefixes (quote marks and list item indentation) off the lines of code and HTML blocks, and strips the
 * leading whitespace of a paragraph's lines, as a CommonMark parser does before it reads inline content.
 *
 * `@lezer/markdown` does not check that a link reference is defined (see `lezer-commonmark.ts`). The renderer looks each
 * label up, and renders a link whose label is undefined as its text with its brackets.
 *
 * The Obsidian nodes are rendered as their content, since the spec suites hold none. This is not the reading view's
 * HTML.
 */

import type {
  SyntaxNode,
  Tree
} from '@lezer/common';

import { decodeString } from 'micromark-util-decode-string';
import { encode } from 'micromark-util-encode';
import { normalizeIdentifier } from 'micromark-util-normalize-identifier';
import { sanitizeUri } from 'micromark-util-sanitize-uri';

/**
 * Options of {@link renderLezerHtml}.
 */
export interface RenderLezerHtmlOptions {
  /**
   * Whether to apply GFM's tag filter, which disarms raw HTML tags such as `<script>` by escaping their `<`.
   */
  readonly tagFilter?: boolean;
}

interface Definition {
  readonly title: null | string;
  readonly url: string;
}

interface LinePosition {
  col: number;
  // The columns left of a tab that a container prefix took only part of.
  partial: number;
  pos: number;
}

interface ListItemLayout {
  // The columns of whitespace a line continuing the item gives up to it.
  readonly indent: number;
  readonly markTo: number;
  // The columns of whitespace after the mark on the item's first line that belong to the mark.
  readonly padding: number;
}

interface Range {
  readonly from: number;
  readonly to: number;
}

interface RenderContext {
  readonly definitions: Map<string, Definition>;
  readonly hasTagFilter: boolean;
  readonly lineStarts: readonly number[];
  readonly listItemLayouts: Map<number, ListItemLayout>;
  out: string;
  tableCellDepth: number;
  readonly text: string;
}

// The output of an inline run so far, and whether the next whitespace starts a line.
interface TextState {
  isAtLineStart: boolean;
  out: string;
}

const InlineMode = {
  // Code span content: line endings become spaces, and nothing is escaped.
  Code: 'code',
  // Text with its markup, rendered to HTML.
  Normal: 'normal',
  // The text of an image description: markup gives only its text.
  Plain: 'plain',
  // The source as written, with each line's container prefix and leading whitespace taken off.
  Raw: 'raw'
} as const;

type InlineMode = typeof InlineMode[keyof typeof InlineMode];

const CODE_INDENT = 4;
const MAX_INDENT = 3;
const TAB_SIZE = 4;
const MAX_LIST_PADDING = 4;
// The two brackets of a link label, and the space a code span may lose on each side.
const PAIR_SIZE = 2;
const HEADING_LEVEL_RE = /\d$/u;
const ORDERED_MARK_RE = /^\d+/u;
const INFO_WORD_RE = /^[^\t ]*/u;
const TRAILING_WHITESPACE_RE = /[\t ]+$/u;
const BLANK_LINE_RE = /^[\t >]*$/u;
const EDGE_PIPES_RE = /^\||\|$/gu;
const SCHEME_RE = /^[a-z][\d+.a-z-]{1,31}:/iu;
const TAG_FILTER_RE = /<(?=\/?(?:iframe|noembed|noframes|plaintext|script|style|textarea|title|xmp)[\s/>])/giu;
const QUOTE_LIKE = new Set(['Blockquote', 'Callout']);
const HTML_BLOCKS = new Set(['CommentBlock', 'HTMLBlock', 'ProcessingInstructionBlock']);
const RAW_INLINE = new Set(['Comment', 'HTMLTag', 'ProcessingInstruction']);
const PARAGRAPHS = new Set(['Paragraph', 'Task']);
const DELIMITED_TAGS: Readonly<Record<string, string>> = {
  Emphasis: 'em',
  Strikethrough: 'del',
  StrongEmphasis: 'strong'
};

/**
 * Renders a `@lezer/markdown` tree to HTML as the CommonMark reference implementation renders the document.
 *
 * @param text - The document the tree was parsed from.
 * @param tree - The tree.
 * @param options - The rendering options.
 * @returns The HTML.
 */
export function renderLezerHtml(text: string, tree: Tree, options: RenderLezerHtmlOptions = {}): string {
  const { tagFilter = false } = options;
  const lineStarts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1);
  }
  const cx: RenderContext = {
    definitions: new Map(),
    hasTagFilter: tagFilter,
    lineStarts,
    listItemLayouts: new Map(),
    out: '',
    tableCellDepth: 0,
    text
  };
  collectDefinitions(cx, tree);
  renderBlocks(cx, tree.topNode, false);
  return cx.out;
}

function alignmentOf(cell: string): null | string {
  const spec = cell.trim();
  const isLeft = spec.startsWith(':');
  const isRight = spec.endsWith(':');
  if (isLeft && isRight) {
    return 'center';
  }
  if (isLeft) {
    return 'left';
  }
  return isRight ? 'right' : null;
}

// The delimiter row is one node, with no cell nodes, so its cells are read from its text.
function alignmentsOf(cx: RenderContext, delimiterRow: SyntaxNode | undefined): (null | string)[] {
  return delimiterRow ? cx.text.slice(delimiterRow.from, delimiterRow.to).trim().replaceAll(EDGE_PIPES_RE, '').split('|').map((cell) => alignmentOf(cell)) : [];
}

// The cells of a table row, as the ranges between its pipes, without the empty ones outside its edge pipes.
function cellsOf(cx: RenderContext, row: SyntaxNode): Range[] {
  const pipes = childrenOf(row).filter((child) => child.name === 'TableDelimiter');
  const bounds = [row.from, ...pipes.flatMap((pipe) => [pipe.from, pipe.to]), row.to];
  const cells: Range[] = [];
  for (let index = 0; index < bounds.length; index += PAIR_SIZE) {
    cells.push({ from: bounds[index] ?? row.from, to: bounds[index + 1] ?? row.to });
  }
  if (pipes.length === 0) {
    return cells;
  }
  if (isBlankCell(cx, cells[0])) {
    cells.shift();
  }
  if (isBlankCell(cx, cells.at(-1))) {
    cells.pop();
  }
  return cells;
}

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

function collectDefinitions(cx: RenderContext, tree: Tree): void {
  tree.iterate({
    enter: (reference) => {
      if (reference.name !== 'LinkReference') {
        return true;
      }
      const node = reference.node;
      const label = node.getChild('LinkLabel');
      if (label) {
        const key = normalizeIdentifier(inlineSource(cx, label, label.from + 1, label.to - 1));
        if (!cx.definitions.has(key)) {
          cx.definitions.set(key, definitionOf(cx, node, node));
        }
      }
      return false;
    }
  });
}

function columnAt(cx: RenderContext, lineStart: number, pos: number): number {
  let col = 0;
  for (let index = lineStart; index < pos; index++) {
    col = cx.text[index] === '\t' ? col + TAB_SIZE - (col % TAB_SIZE) : col + 1;
  }
  return col;
}

// Takes up to `columns` columns of whitespace, splitting a tab when only part of it is taken.
function consumeWhitespace(cx: RenderContext, position: LinePosition, columns: number, lineEnd: number): void {
  let left = columns;
  while (left > 0) {
    if (position.partial > 0) {
      const taken = Math.min(position.partial, left);
      position.partial -= taken;
      position.col += taken;
      left -= taken;
    } else if (position.pos < lineEnd && cx.text[position.pos] === ' ') {
      position.pos++;
      position.col++;
      left--;
    } else if (position.pos < lineEnd && cx.text[position.pos] === '\t') {
      const width = TAB_SIZE - (position.col % TAB_SIZE);
      position.pos++;
      position.partial = Math.max(width - left, 0);
      position.col += Math.min(width, left);
      left -= Math.min(width, left);
    } else {
      return;
    }
  }
}

function containersOf(node: SyntaxNode): SyntaxNode[] {
  const containers: SyntaxNode[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (QUOTE_LIKE.has(parent.name) || parent.name === 'ListItem') {
      containers.unshift(parent);
    }
  }
  return containers;
}

// Starts a new line of output unless one has just started, as the reference renderer's `cr` does.
function cr(cx: RenderContext): void {
  if (cx.out !== '' && !cx.out.endsWith('\n')) {
    cx.out += '\n';
  }
}

// The destination and title of an inline link or a link reference definition.
function definitionOf(cx: RenderContext, owner: SyntaxNode, node: SyntaxNode): Definition {
  const url = node.getChild('URL');
  const title = node.getChild('LinkTitle');
  return {
    title: title ? decodeString(inlineSource(cx, owner, title.from + 1, title.to - 1)) : null,
    url: url ? decodeString(unwrapDestination(inlineSource(cx, owner, url.from, url.to))) : ''
  };
}

// The content lines of fenced code: the lines after the opening fence, up to the closing one or the block's end.
function fencedCodeLines(cx: RenderContext, node: SyntaxNode): number[] {
  const marks = childrenOf(node).filter((child) => child.name === 'CodeMark');
  const close = marks.length > 1 ? marks.at(-1) : undefined;
  const openLine = lineIndexAt(cx, node.from);
  let lastLine = close ? lineIndexAt(cx, close.from) - 1 : lineIndexAt(cx, node.to);
  // An unclosed block that ends with the document's last line ending holds no line after it.
  if (!close && lastLine > openLine && node.to === cx.lineStarts[lastLine]) {
    lastLine--;
  }
  const lines: number[] = [];
  for (let line = openLine + 1; line <= lastLine; line++) {
    lines.push(line);
  }
  return lines;
}

// The columns of whitespace before a fence, which its content lines give up too.
function fenceIndent(cx: RenderContext, node: SyntaxNode, containers: readonly SyntaxNode[]): number {
  const openLine = lineIndexAt(cx, node.from);
  const opening = linePosition(cx, openLine, containers);
  return columnAt(cx, cx.lineStarts[openLine] ?? 0, node.from) - opening.col + opening.partial;
}

function filterTags(cx: RenderContext, html: string): string {
  return cx.hasTagFilter ? html.replaceAll(TAG_FILTER_RE, '&lt;') : html;
}

// Whether the text between two blocks holds a line with nothing but whitespace and quote marks.
function hasBlankLine(gap: string): boolean {
  return gap.split('\n').slice(1, -1).some((line) => BLANK_LINE_RE.test(line));
}

function inlineSource(cx: RenderContext, node: SyntaxNode, from: number, to: number): string {
  return renderInline(cx, node, { from, to }, InlineMode.Raw);
}

function isBlankCell(cx: RenderContext, cell: Range | undefined): boolean {
  return cell !== undefined && cx.text.slice(cell.from, cell.to).trim() === '';
}

function isLoose(cx: RenderContext, list: SyntaxNode): boolean {
  const items = childrenOf(list).filter((child) => child.name === 'ListItem');
  return items.some((item, index) => {
    const next = items[index + 1];
    if (next && hasBlankLine(cx.text.slice(item.to, next.from))) {
      return true;
    }
    const blocks = childrenOf(item).filter((child) => !child.name.endsWith('Mark'));
    return blocks.some((block, blockIndex) => {
      const before = blocks[blockIndex - 1];
      return before !== undefined && hasBlankLine(cx.text.slice(before.to, block.from));
    });
  });
}

function lineEndOf(cx: RenderContext, line: number): number {
  const next = cx.lineStarts[line + 1];
  return next === undefined ? cx.text.length : next - 1;
}

function lineIndexAt(cx: RenderContext, pos: number): number {
  let low = 0;
  let high = cx.lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / PAIR_SIZE);
    if ((cx.lineStarts[middle] ?? 0) <= pos) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/*
 * Where a line's content starts once the prefixes of its containers are taken off. A lazy line, which misses a quote's
 * `>`, keeps the rest of its prefixes.
 */
function linePosition(cx: RenderContext, line: number, containers: readonly SyntaxNode[]): LinePosition {
  const lineStart = cx.lineStarts[line] ?? 0;
  const lineEnd = lineEndOf(cx, line);
  const position: LinePosition = { col: 0, partial: 0, pos: lineStart };
  for (const container of containers) {
    if (QUOTE_LIKE.has(container.name)) {
      const saved = { ...position };
      consumeWhitespace(cx, position, MAX_INDENT, lineEnd);
      if (position.partial > 0 || cx.text[position.pos] !== '>') {
        return saved;
      }
      position.pos++;
      position.col++;
      consumeWhitespace(cx, position, 1, lineEnd);
    } else if (container.from >= lineStart && container.from <= lineEnd) {
      const layout = listItemLayout(cx, container, position);
      position.col = columnAt(cx, lineStart, layout.markTo);
      position.pos = layout.markTo;
      position.partial = 0;
      consumeWhitespace(cx, position, layout.padding, lineEnd);
    } else {
      consumeWhitespace(cx, position, listItemLayout(cx, container, position).indent, lineEnd);
    }
  }
  return position;
}

function lineRange(cx: RenderContext, from: number, to: number): number[] {
  const lines: number[] = [];
  for (let line = lineIndexAt(cx, from); line <= lineIndexAt(cx, to); line++) {
    lines.push(line);
  }
  return lines;
}

function lineText(cx: RenderContext, line: number, containers: readonly SyntaxNode[], extraIndent: number): string {
  const position = linePosition(cx, line, containers);
  consumeWhitespace(cx, position, extraIndent, lineEndOf(cx, line));
  return ' '.repeat(position.partial) + cx.text.slice(position.pos, lineEndOf(cx, line));
}

// The layout of a list item, measured on its first line from `before`, where its containers' prefixes end.
function listItemLayout(cx: RenderContext, item: SyntaxNode, before: LinePosition): ListItemLayout {
  const cached = cx.listItemLayouts.get(item.from);
  if (cached) {
    return cached;
  }
  const markTo = item.getChild('ListMark')?.to ?? item.from;
  const line = lineIndexAt(cx, markTo);
  const lineStart = cx.lineStarts[line] ?? 0;
  const lineEnd = lineEndOf(cx, line);
  const markEndCol = columnAt(cx, lineStart, markTo);
  let padding = 1;
  if (cx.text.slice(markTo, lineEnd).trim() !== '') {
    const probe: LinePosition = { col: markEndCol, partial: 0, pos: markTo };
    consumeWhitespace(cx, probe, Number.MAX_SAFE_INTEGER, lineEnd);
    const spaces = probe.col - markEndCol;
    padding = spaces > MAX_LIST_PADDING ? 1 : spaces;
  }
  const layout: ListItemLayout = { indent: markEndCol + padding - before.col, markTo, padding };
  cx.listItemLayouts.set(item.from, layout);
  return layout;
}

// The label a reference link is looked up by: its own label, or its text for a collapsed or shortcut reference.
function referenceLabel(cx: RenderContext, node: SyntaxNode, label: null | SyntaxNode, textRange: Range): string {
  return label && label.to - label.from > PAIR_SIZE ? inlineSource(cx, node, label.from + 1, label.to - 1) : inlineSource(cx, node, textRange.from, textRange.to);
}

function renderAutolink(cx: RenderContext, node: SyntaxNode, mode: InlineMode): string {
  const url = node.name === 'URL' ? node : node.getChild('URL');
  const target = url ? cx.text.slice(url.from, url.to) : '';
  let href = target;
  if (node.name === 'URL' && target.startsWith('www.')) {
    href = `http://${target}`;
  } else if (!SCHEME_RE.test(target)) {
    href = `mailto:${target}`;
  }
  return mode === InlineMode.Plain ? encode(target) : `<a href="${sanitizeUri(href)}">${encode(target)}</a>`;
}

function renderBlock(cx: RenderContext, node: SyntaxNode, isTight: boolean): void {
  const name = node.name;
  if (PARAGRAPHS.has(name)) {
    renderParagraph(cx, node, isTight);
  } else if (name.startsWith('ATXHeading') || name.startsWith('SetextHeading')) {
    renderHeading(cx, node);
  } else if (QUOTE_LIKE.has(name)) {
    cr(cx);
    cx.out += '<blockquote>\n';
    renderBlocks(cx, node, false);
    cr(cx);
    cx.out += '</blockquote>';
    cr(cx);
  } else {
    switch (name) {
      case 'BulletList':
      case 'OrderedList': {
        renderList(cx, node);

        break;
      }
      case 'CodeBlock':
      case 'FencedCode': {
        renderCode(cx, node);

        break;
      }
      case 'HorizontalRule': {
        cr(cx);
        cx.out += '<hr />';
        cr(cx);

        break;
      }
      default: {
        if (HTML_BLOCKS.has(name)) {
          const containers = containersOf(node);
          cr(cx);
          cx.out += filterTags(cx, lineRange(cx, node.from, node.to).map((line) => lineText(cx, line, containers, 0)).join('\n'));
          cr(cx);
        } else if (name === 'Table') {
          renderTable(cx, node);
        } else if (name === 'FootnoteDefinition') {
          renderBlocks(cx, node, false);
        }
      }
    }
  }
}

function renderBlocks(cx: RenderContext, parent: SyntaxNode, isTight: boolean): void {
  for (const child of childrenOf(parent)) {
    renderBlock(cx, child, isTight);
  }
}

function renderCode(cx: RenderContext, node: SyntaxNode): void {
  const containers = containersOf(node);
  const lines = node.name === 'FencedCode' ? fencedCodeLines(cx, node) : lineRange(cx, node.from, node.to);
  const indent = node.name === 'FencedCode' ? fenceIndent(cx, node, containers) : CODE_INDENT;
  const infoNode = node.getChild('CodeInfo');
  const info = infoNode ? INFO_WORD_RE.exec(decodeString(cx.text.slice(infoNode.from, infoNode.to)))?.[0] ?? '' : '';
  const content = lines.map((line) => `${lineText(cx, line, containers, indent)}\n`).join('');
  const languageClass = info ? ` class="language-${encode(info)}"` : '';
  cr(cx);
  cx.out += `<pre><code${languageClass}>${encode(content)}</code></pre>`;
  cr(cx);
}

function renderCodeSpan(cx: RenderContext, node: SyntaxNode, mode: InlineMode): string {
  const marks = childrenOf(node).filter((child) => child.name === 'CodeMark');
  let code = renderInline(cx, node, { from: marks[0]?.to ?? node.from, to: marks.at(-1)?.from ?? node.to }, InlineMode.Code);
  if (cx.tableCellDepth > 0) {
    code = code.replaceAll(String.raw`\|`, '|');
  }
  if (code.length > PAIR_SIZE && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
    code = code.slice(1, -1);
  }
  return mode === InlineMode.Plain ? encode(code) : `<code>${encode(code)}</code>`;
}

function renderDelimited(cx: RenderContext, node: SyntaxNode, mode: InlineMode): string {
  const marks = childrenOf(node).filter((child) => child.name.endsWith('Mark'));
  const inner = renderInline(cx, node, { from: marks[0]?.to ?? node.from, to: marks.at(-1)?.from ?? node.to }, mode);
  const tag = DELIMITED_TAGS[node.name] ?? 'span';
  return mode === InlineMode.Plain ? inner : `<${tag}>${inner}</${tag}>`;
}

function renderHeading(cx: RenderContext, node: SyntaxNode): void {
  const level = HEADING_LEVEL_RE.exec(node.name)?.[0] ?? '1';
  const marks = childrenOf(node).filter((child) => child.name === 'HeaderMark');
  let range: Range = { from: node.from, to: marks.at(-1)?.from ?? node.to };
  if (node.name.startsWith('ATX')) {
    const [open, close] = marks;
    range = { from: open?.to ?? node.from, to: close?.from ?? node.to };
  }
  cr(cx);
  cx.out += `<h${level}>${renderInline(cx, node, range, InlineMode.Normal).trim()}</h${level}>`;
  cr(cx);
}

// Renders the inline content of `node` in `range`: the text between its children, and its children.
function renderInline(cx: RenderContext, node: SyntaxNode, range: Range, mode: InlineMode): string {
  const state: TextState = { isAtLineStart: false, out: '' };
  const isVerbatim = mode === InlineMode.Code || mode === InlineMode.Raw;
  let pos = range.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= range.from || child.from >= range.to) {
      continue;
    }
    renderText(cx, state, { from: pos, to: child.from }, mode);
    pos = child.to;
    if (child.name === 'QuoteMark') {
      continue;
    }

    // A hard break takes its line ending, so the next line's leading whitespace is still to strip.
    state.isAtLineStart = child.name === 'HardBreak';
    state.out += isVerbatim ? renderInline(cx, child, { from: Math.max(child.from, range.from), to: Math.min(child.to, range.to) }, mode) : renderInlineNode(cx, child, mode);
  }
  renderText(cx, state, { from: pos, to: range.to }, mode);
  return state.out;
}

function renderInlineNode(cx: RenderContext, node: SyntaxNode, mode: InlineMode): string {
  switch (node.name) {
    case 'Autolink':
    case 'URL': {
      return renderAutolink(cx, node, mode);
    }
    case 'Emphasis':
    case 'Strikethrough':
    case 'StrongEmphasis': {
      return renderDelimited(cx, node, mode);
    }
    case 'Entity': {
      return encode(decodeString(cx.text.slice(node.from, node.to)));
    }
    case 'Escape': {
      return encode(cx.text.slice(node.from + 1, node.to));
    }
    case 'HardBreak': {
      return mode === InlineMode.Plain ? '\n' : '<br />\n';
    }
    case 'Image':
    case 'Link': {
      return renderLink(cx, node, mode);
    }
    case 'InlineCode': {
      return renderCodeSpan(cx, node, mode);
    }
    default: {
      return RAW_INLINE.has(node.name) ? filterTags(cx, inlineSource(cx, node, node.from, node.to)) : renderInline(cx, node, node, mode);
    }
  }
}

function renderLink(cx: RenderContext, node: SyntaxNode, mode: InlineMode): string {
  const [open, close, destinationOpen] = childrenOf(node).filter((child) => child.name === 'LinkMark');
  const textRange: Range = { from: open?.to ?? node.from, to: close?.from ?? node.to };
  const isInline = destinationOpen !== undefined && destinationOpen.from === close?.to && cx.text[destinationOpen.from] === '(';
  const label = node.getChild('LinkLabel');
  const definition = isInline ? definitionOf(cx, node, node) : cx.definitions.get(normalizeIdentifier(referenceLabel(cx, node, label, textRange)));
  if (!definition) {
    // An undefined reference is no link: its brackets and label are text.
    const rest = label ? encode(decodeString(inlineSource(cx, node, label.from, label.to))) : '';
    return `${encode(cx.text.slice(node.from, textRange.from))}${renderInline(cx, node, textRange, mode)}]${rest}`;
  }
  const title = definition.title === null ? '' : ` title="${encode(definition.title)}"`;
  if (node.name === 'Image') {
    const alt = renderInline(cx, node, textRange, InlineMode.Plain);
    return mode === InlineMode.Plain ? alt : `<img src="${sanitizeUri(definition.url)}" alt="${alt}"${title} />`;
  }
  const text = renderInline(cx, node, textRange, mode);
  return mode === InlineMode.Plain ? text : `<a href="${sanitizeUri(definition.url)}"${title}>${text}</a>`;
}

function renderList(cx: RenderContext, list: SyntaxNode): void {
  const isTight = !isLoose(cx, list);
  let startAttribute = '';
  if (list.name === 'OrderedList') {
    const mark = list.getChild('ListItem')?.getChild('ListMark');
    const start = Number(ORDERED_MARK_RE.exec(mark ? cx.text.slice(mark.from, mark.to) : '1')?.[0] ?? '1');
    startAttribute = start === 1 ? '' : ` start="${String(start)}"`;
  }
  const tag = list.name === 'OrderedList' ? 'ol' : 'ul';
  cr(cx);
  cx.out += `<${tag}${startAttribute}>\n`;
  for (const item of childrenOf(list)) {
    if (item.name !== 'ListItem') {
      continue;
    }

    cx.out += '<li>';
    renderBlocks(cx, item, isTight);
    cx.out += '</li>';
    cr(cx);
  }
  cx.out += `</${tag}>`;
  cr(cx);
}

// A paragraph, which a tight list renders without its tags.
function renderParagraph(cx: RenderContext, node: SyntaxNode, isTight: boolean): void {
  const content = renderInline(cx, node, node, InlineMode.Normal).trimEnd();
  if (isTight) {
    cx.out += content;
    return;
  }
  cr(cx);
  cx.out += `<p>${content}</p>`;
  cr(cx);
}

function renderTable(cx: RenderContext, table: SyntaxNode): void {
  const rows = childrenOf(table);
  const header = rows.find((row) => row.name === 'TableHeader');
  const alignments = alignmentsOf(cx, rows.find((row) => row.name === 'TableDelimiter'));
  const body = rows.filter((row) => row.name === 'TableRow');
  cr(cx);
  cx.out += '<table>\n<thead>\n';
  if (header) {
    renderTableRow(cx, header, 'th', alignments);
  }
  cx.out += '</thead>\n';
  if (body.length > 0) {
    cx.out += '<tbody>\n';
    for (const row of body) {
      renderTableRow(cx, row, 'td', alignments);
    }
    cx.out += '</tbody>\n';
  }
  cx.out += '</table>';
  cr(cx);
}

function renderTableRow(cx: RenderContext, row: SyntaxNode, tag: string, alignments: readonly (null | string)[]): void {
  const cells = cellsOf(cx, row);
  cx.out += '<tr>\n';
  for (const [index, alignment] of alignments.entries()) {
    const cell = cells[index];
    const align = alignment ? ` align="${alignment}"` : '';
    let content = '';
    if (cell) {
      cx.tableCellDepth++;
      content = renderInline(cx, row, cell, InlineMode.Normal).trim();
      cx.tableCellDepth--;
    }
    cx.out += `<${tag}${align}>${content}</${tag}>\n`;
  }
  cx.out += '</tr>\n';
}

// Renders the text between inline nodes, stripping each line's leading whitespace, and its trailing one in text.
function renderText(cx: RenderContext, state: TextState, range: Range, mode: InlineMode): void {
  const isVerbatim = mode === InlineMode.Code || mode === InlineMode.Raw;
  for (let index = range.from; index < range.to; index++) {
    const ch = cx.text[index] ?? '';
    if (ch === '\n') {
      if (!isVerbatim) {
        state.out = state.out.replace(TRAILING_WHITESPACE_RE, '');
      }
      state.out += mode === InlineMode.Code ? ' ' : '\n';
      state.isAtLineStart = true;
    } else if (!state.isAtLineStart || (ch !== ' ' && ch !== '\t')) {
      state.isAtLineStart = false;
      state.out += isVerbatim ? ch : encode(ch);
    }
  }
}

function unwrapDestination(destination: string): string {
  return destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination;
}
