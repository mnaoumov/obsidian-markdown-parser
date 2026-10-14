/**
 * @file
 *
 * Renders the engine's tree as HTML, in the shape `remark-html` 13 gives with `sanitize: false`: a TypeScript port of
 * the handlers of `mdast-util-to-hast` 10 and of `mdurl`'s `encode` (both MIT). The HTML is serialized as a browser
 * serializes a DOM, so it compares with the reading view's: raw HTML is passed through as it is.
 */

/* eslint-disable no-magic-numbers, unicorn/prefer-code-point -- `mdurl`'s encoder works on UTF-16 code units, with the code points upstream wrote. */

import type {
  RemarkDefinition,
  RemarkImageReference,
  RemarkLinkReference,
  RemarkList,
  RemarkListItem,
  RemarkNode,
  RemarkParent,
  RemarkRoot,
  RemarkTable
} from './types.ts';

type HastAttributes = Record<string, boolean | number | string | undefined>;

interface HastElement {
  readonly attributes: HastAttributes;
  children: HastNode[];
  readonly tagName: string;
  readonly type: 'element';
}

type HastNode = HastElement | HastRaw | HastText;

interface HastRaw {
  readonly type: 'raw';
  readonly value: string;
}

interface HastText {
  readonly type: 'text';
  value: string;
}

interface RenderContext {
  readonly definitions: ReadonlyMap<string, RemarkDefinition>;
}

const VOID_ELEMENTS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'input']);
const LINE_ENDING_WHITESPACE_RE = /[ \t]*(?<ending>\r?\n|\r)[ \t]*/gu;
const LEADING_WHITESPACE_RE = /^\s+/u;
const LANGUAGE_RE = /^[^ \t]+(?=[ \t]|$)/u;
const LINE_ENDING_RE = /\r?\n|\r/gu;
const ESCAPED_RE = /^[\da-f]{2}$/iu;
const URL_SAFE = ';/?:@&=+$,-_.!~*\'()#';
const ALPHANUMERIC_RE = /^[\da-z]$/iu;

/**
 * Renders a tree as HTML.
 *
 * @param tree - The tree.
 * @returns The HTML.
 */
export function renderRemarkHtml(tree: RemarkRoot): string {
  const definitions = new Map<string, RemarkDefinition>();
  collectDefinitions(tree, definitions);
  const context: RenderContext = { definitions };
  const html = serializeAll(wrap(all(context, tree)));
  return html && !html.endsWith('\n') ? `${html}\n` : html;
}

function all(context: RenderContext, parent: RemarkParent): HastNode[] {
  const values: HastNode[] = [];
  let index = -1;

  for (const node of parent.children) {
    index++;
    const result = one(context, node, parent);

    if (result === null) {
      continue;
    }

    // Whitespace after a hard break is dropped, from a node, not from the nodes of a hard break or an unresolved reference.
    if (index && parent.children[index - 1]?.type === 'break' && !Array.isArray(result)) {
      const head = result;
      if (head.type === 'text') {
        head.value = head.value.replace(LEADING_WHITESPACE_RE, '');
      } else if (head.type === 'element') {
        const [child] = head.children;
        if (child?.type === 'text') {
          child.value = child.value.replace(LEADING_WHITESPACE_RE, '');
        }
      }
    }

    values.push(...(Array.isArray(result) ? result : [result]));
  }

  return values;
}

function collectDefinitions(node: RemarkNode, definitions: Map<string, RemarkDefinition>): void {
  if (node.type === 'definition') {
    const id = node.identifier.toUpperCase();
    if (!definitions.has(id)) {
      definitions.set(id, node);
    }
  }
  if ('children' in node) {
    for (const child of node.children) {
      collectDefinitions(child, definitions);
    }
  }
}

function element(tagName: string, attributes: HastAttributes = {}, children: HastNode[] = []): HastElement {
  return { attributes, children, tagName, type: 'element' };
}

function encodeUrl(value: string): string {
  let result = '';

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);

    // An escape that is already there stays.
    if (code === 0x25 && index + 2 < value.length && ESCAPED_RE.test(value.slice(index + 1, index + 3))) {
      result += value.slice(index, index + 3);
      index += 2;
      continue;
    }

    if (code < 128) {
      const character = String.fromCharCode(code);
      result += ALPHANUMERIC_RE.test(character) || URL_SAFE.includes(character) ? character : `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
      continue;
    }

    if (code >= 0xD8_00 && code <= 0xDF_FF) {
      const nextCode = value.charCodeAt(index + 1);
      if (code <= 0xDB_FF && index + 1 < value.length && nextCode >= 0xDC_00 && nextCode <= 0xDF_FF) {
        result += encodeURIComponent(value.slice(index, index + 2));
        index++;
        continue;
      }
      result += '%EF%BF%BD';
      continue;
    }

    result += encodeURIComponent(value.charAt(index));
  }

  return result;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('\u{A0}', '&nbsp;');
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\u{A0}', '&nbsp;');
}

function image(alt: null | string, url: string, title: null | string): HastElement {
  // eslint-disable-next-line unicorn/name-replacements -- The HTML attribute.
  return element('img', { alt: alt ?? undefined, src: encodeUrl(url), title: title ?? undefined });
}

function isLoose(list: RemarkList): boolean {
  return list.spread || list.children.some((child) => child.type === 'listItem' && child.spread);
}

function listItem(context: RenderContext, node: RemarkListItem, parent: RemarkParent): HastElement {
  const result = all(context, node);
  const isLooseItem = parent.type === 'list' ? isLoose(parent) : node.spread;
  const attributes: HastAttributes = {};
  const wrapped: HastNode[] = [];

  if (typeof node.checked === 'boolean') {
    let [head] = result;
    if (head?.type !== 'element' || head.tagName !== 'p') {
      head = element('p');
      result.unshift(head);
    }

    if (head.children.length > 0) {
      head.children.unshift({ type: 'text', value: ' ' });
    }

    head.children.unshift(element('input', { checked: node.checked, disabled: true, type: 'checkbox' }));

    attributes['class'] = 'task-list-item';
  }

  let last: HastNode | undefined;
  for (const [index, child] of result.entries()) {
    const isParagraph = child.type === 'element' && child.tagName === 'p';

    // A line ending before each node, but a tight item's first paragraph.
    if (isLooseItem || index !== 0 || !isParagraph) {
      wrapped.push({ type: 'text', value: '\n' });
    }

    if (isParagraph && !isLooseItem) {
      wrapped.push(...child.children);
    } else {
      wrapped.push(child);
    }
    last = child;
  }

  // A final line ending.
  if (last && (isLooseItem || !(last.type === 'element' && last.tagName === 'p'))) {
    wrapped.push({ type: 'text', value: '\n' });
  }

  return element('li', attributes, wrapped);
}

// eslint-disable-next-line complexity -- One handler per node type, as `mdast-util-to-hast` has.
function one(context: RenderContext, node: RemarkNode, parent: RemarkParent): HastNode | HastNode[] | null {
  switch (node.type) {
    case 'blockquote': {
      return element('blockquote', {}, wrap(all(context, node), true));
    }
    case 'break': {
      return [element('br'), { type: 'text', value: '\n' }];
    }
    case 'code': {
      const language = node.lang ? LANGUAGE_RE.exec(node.lang) : null;
      const code = element('code', language ? { class: `language-${language[0]}` } : {}, [{ type: 'text', value: node.value ? `${node.value}\n` : '' }]);
      return element('pre', {}, [code]);
    }
    case 'definition': {
      return null;
    }
    case 'delete': {
      return element('del', {}, all(context, node));
    }
    case 'emphasis': {
      return element('em', {}, all(context, node));
    }
    case 'heading': {
      return element(`h${String(node.depth)}`, {}, all(context, node));
    }
    case 'html': {
      return { type: 'raw', value: node.value };
    }
    case 'image': {
      return image(node.alt, node.url, node.title);
    }
    case 'imageReference': {
      const definition = context.definitions.get(node.identifier.toUpperCase());
      return definition ? image(node.alt, definition.url, definition.title) : revert(context, node);
    }
    case 'inlineCode': {
      return element('code', {}, [{ type: 'text', value: node.value.replaceAll(LINE_ENDING_RE, ' ') }]);
    }
    case 'link': {
      return element('a', { href: encodeUrl(node.url), title: node.title ?? undefined }, all(context, node));
    }
    case 'linkReference': {
      const definition = context.definitions.get(node.identifier.toUpperCase());
      return definition ? element('a', { href: encodeUrl(definition.url), title: definition.title ?? undefined }, all(context, node)) : revert(context, node);
    }
    case 'list': {
      const attributes: HastAttributes = {};
      if (typeof node.start === 'number' && node.start !== 1) {
        attributes['start'] = node.start;
      }
      const items = all(context, node);
      if (items.some((item) => item.type === 'element' && item.attributes['class'] === 'task-list-item')) {
        attributes['class'] = 'contains-task-list';
      }
      return element(node.ordered ? 'ol' : 'ul', attributes, wrap(items, true));
    }
    case 'listItem': {
      return listItem(context, node, parent);
    }
    case 'paragraph': {
      return element('p', {}, all(context, node));
    }
    case 'root': {
      return wrap(all(context, node));
    }
    case 'strong': {
      return element('strong', {}, all(context, node));
    }
    case 'table': {
      return table(context, node);
    }
    case 'tableCell':
    case 'tableRow': {
      return element('div', {}, all(context, node));
    }
    case 'text': {
      return { type: 'text', value: node.value.replaceAll(LINE_ENDING_WHITESPACE_RE, '$<ending>') };
    }
    case 'thematicBreak': {
      return element('hr');
    }
    default: {
      throw new Error('Unknown node type');
    }
  }
}

// A reference without a definition is its source, as markdown.
function revert(context: RenderContext, node: RemarkImageReference | RemarkLinkReference): HastNode | HastNode[] {
  let suffix = ']';

  if (node.referenceType === 'collapsed') {
    suffix += '[]';
  } else if (node.referenceType === 'full') {
    suffix += `[${node.label || node.identifier}]`;
  }

  if (node.type === 'imageReference') {
    return { type: 'text', value: `![${String(node.alt)}${suffix}` };
  }

  const contents = all(context, node);
  const [head] = contents;

  if (head?.type === 'text') {
    head.value = `[${head.value}`;
  } else {
    contents.unshift({ type: 'text', value: '[' });
  }

  const tail = contents.at(-1);

  if (tail?.type === 'text') {
    tail.value += suffix;
  } else {
    contents.push({ type: 'text', value: suffix });
  }

  return contents;
}

function serialize(node: HastNode): string {
  switch (node.type) {
    case 'element': {
      const attributes = Object.entries(node.attributes)
        .filter(([, value]) => value !== undefined && value !== false)
        .map(([name, value]) => (value === true ? ` ${name}=""` : ` ${name}="${escapeAttribute(String(value))}"`))
        .join('');
      const open = `<${node.tagName}${attributes}>`;
      return VOID_ELEMENTS.has(node.tagName) ? open : `${open}${serializeAll(node.children)}</${node.tagName}>`;
    }
    case 'raw': {
      return node.value;
    }
    case 'text': {
      return escapeText(node.value);
    }
    default: {
      throw new Error('Unknown node type');
    }
  }
}

function serializeAll(nodes: readonly HastNode[]): string {
  return nodes.map((node) => serialize(node)).join('');
}

function table(context: RenderContext, node: RemarkTable): HastElement {
  const rows: HastElement[] = node.children.map((row, rowIndex) => {
    const cells = row.type === 'tableRow' ? row.children : [];
    const name = rowIndex === 0 ? 'th' : 'td';
    const count = node.align.length || cells.length;
    const out: HastNode[] = [];
    for (let position = 0; position < count; position++) {
      const cell = cells[position];
      out.push(element(name, { align: node.align[position] ?? undefined }, cell && 'children' in cell ? all(context, cell) : []));
    }
    return element('tr', {}, wrap(out, true));
  });
  const [head, ...body] = rows;
  const sections: HastNode[] = [element('thead', {}, wrap(head ? [head] : [], true))];
  if (body.length > 0) {
    sections.push(element('tbody', {}, wrap(body, true)));
  }
  return element('table', {}, wrap(sections, true));
}

// Line feeds between the nodes, and around them when `isSpread`.
function wrap(nodes: readonly HastNode[], isSpread = false): HastNode[] {
  const result: HastNode[] = [];

  if (isSpread) {
    result.push({ type: 'text', value: '\n' });
  }

  for (const [index, node] of nodes.entries()) {
    if (index) {
      result.push({ type: 'text', value: '\n' });
    }

    result.push(node);
  }

  if (isSpread && nodes.length > 0) {
    result.push({ type: 'text', value: '\n' });
  }

  return result;
}

/* eslint-enable no-magic-numbers, unicorn/prefer-code-point -- The port ends here. */
