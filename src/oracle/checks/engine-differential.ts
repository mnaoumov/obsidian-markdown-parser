/**
 * @file
 *
 * The engine differential: a judge that finds where Obsidian is wrong only by the spec, which no relation of Obsidian
 * with itself can see. A note of CommonMark and GFM alone (`note-grammar.ts` with `syntax: 'gfm'`) is rendered by the
 * `remark-parse` 8 engine, which is Obsidian's reading view, and by three reference engines that pass their spec
 * suites: `micromark` with its GFM extensions, `markdown-it` and `commonmark.js`. Each engine's HTML is read into one
 * normalized token sequence: element names, the attributes that carry meaning, and text with its white space collapsed.
 *
 * - When the references agree and the `remark-parse` 8 engine does not, the note is a likely Obsidian bug.
 * - When the references disagree among themselves, the note is a spec question, and Obsidian is not judged on it.
 *
 * Three things are made equal before the comparison, since they are not what the differential looks for:
 *
 * - A list's looseness: a paragraph directly in a list item is read as its content. `remark-parse` 8 decides looseness
 *   by its own rule, which the spec suites already measure as the `looseList` quirk.
 * - GFM task items: none of the references runs a task extension, so the GFM rule is applied to their output (a list
 *   item whose first block is a paragraph opening on `[ ]`, `[x]` or `[X]` and white space is a task), and the
 *   `remark-parse` 8 engine's checkbox is read as the same mark.
 * - `commonmark.js` knows no GFM extension, so it is a reference only for a note the GFM extensions of `micromark`
 *   change nothing in.
 */

import type { MarkdownIt } from 'markdown-it';
import type { DefaultTreeAdapterTypes } from 'parse5';

import {
  HtmlRenderer,
  Parser
} from 'commonmark';
import MarkdownItCallable from 'markdown-it';
import { micromark } from 'micromark';
import {
  gfmAutolinkLiteral,
  gfmAutolinkLiteralHtml
} from 'micromark-extension-gfm-autolink-literal';
import {
  gfmStrikethrough,
  gfmStrikethroughHtml
} from 'micromark-extension-gfm-strikethrough';
import {
  gfmTable,
  gfmTableHtml
} from 'micromark-extension-gfm-table';
import { parseFragment } from 'parse5';

import type { SelfCheckFinding } from './self-check.ts';

import { renderRemarkHtml } from '../../remark/html.ts';
import { parseRemark } from '../../remark/parse.ts';

/**
 * An engine of the differential.
 */
export type DifferentialEngine = 'commonmark.js' | 'markdown-it' | 'micromark' | 'remark-parse-8';

/**
 * The reference engines, in the order a disagreement among them is named.
 */
export const REFERENCE_ENGINES: readonly DifferentialEngine[] = ['micromark', 'markdown-it', 'commonmark.js'];

/**
 * The engine judged: Obsidian's reading view.
 */
export const JUDGED_ENGINE: DifferentialEngine = 'remark-parse-8';

// The attributes that carry meaning, by element: a link's destination and title, an image's source, text and title, an ordered list's start.
const KEPT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['href', 'title'],
  img: ['alt', 'src', 'title'],
  ol: ['start']
};

// Elements engines name differently for the same construct: `markdown-it` renders strikethrough as `<s>`.
const ELEMENT_SYNONYMS: Readonly<Record<string, string>> = { s: 'del' };

// A task mark the GFM rule reads at the start of a list item's first paragraph.
const TASK_MARK_PATTERN = /^\[(?<status>[ xX])\](?=[ \t\n])/u;
const WHITE_SPACE_PATTERN = /\s+/gu;
const DESCRIBED_TOKENS = 3;
// How many references it takes for one of them to be alone against the others.
const REFERENCES_FOR_A_MAJORITY = 3;

const markdownIt = createMarkdownIt();

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
interface ReferenceTokens {
  readonly engine: DifferentialEngine;
  readonly tokens: readonly string[];
}

type TextNode = DefaultTreeAdapterTypes.TextNode;

/**
 * An engine's normalized token sequence for a note: `<name attribute="value">` and `</name>` for elements, with a list
 * item's task mark as `<li [x]>` or `<li [ ]>`, and `"text` for text, its white space collapsed.
 *
 * @param engine - The engine.
 * @param text - The note.
 * @returns The tokens.
 */
export function engineTokens(engine: DifferentialEngine, text: string): string[] {
  const html = renderHtml(engine, text);
  const tokens: string[] = [];
  pushTokens(parseFragment(html).childNodes, engine !== JUDGED_ENGINE, tokens);
  return tokens;
}

/**
 * The engine judge: the `remark-parse` 8 engine against the references, on a note of CommonMark and GFM alone.
 *
 * @param text - The note.
 * @returns At most one finding: `engines:obsidian:<its>-vs-<the references'>` when the references agree and the engine
 *   does not; when they disagree, `engines:references:<engine>-alone:<its>-vs-<the others'>` for one against the other
 *   two, else `engines:references:<engine>-vs-<engine>:<one's>-vs-<other's>`. Each names the first token that differs.
 */
export function judgeEngines(text: string): SelfCheckFinding[] {
  const references = referenceTokens(text);
  const [first] = references;
  if (first === undefined) {
    return [];
  }
  const dissenters = references.filter((reference) => firstDifference(reference.tokens, first.tokens) !== null);
  if (dissenters.length > 0) {
    return [splitFinding(references, dissenters)];
  }
  const judged = engineTokens(JUDGED_ENGINE, text);
  const index = firstDifference(judged, first.tokens);
  if (index === null) {
    return [];
  }
  return [{
    detail: `${JUDGED_ENGINE} gives ${describe(judged, index)}, the references ${describe(first.tokens, index)}`,
    judge: 'engines',
    key: `engines:obsidian:${labelAt(judged, index)}-vs-${labelAt(first.tokens, index)}`
  }];
}

/**
 * An engine's HTML for a note, with its spec suite's options: raw HTML on, and GFM autolinks where it has them.
 *
 * @param engine - The engine.
 * @param text - The note.
 * @returns The HTML.
 */
export function renderHtml(engine: 'micromark-commonmark' | DifferentialEngine, text: string): string {
  switch (engine) {
    case 'commonmark.js': {
      return new HtmlRenderer().render(new Parser().parse(text));
    }
    case 'markdown-it': {
      return markdownIt.render(text);
    }
    case 'micromark': {
      return micromark(text, {
        allowDangerousHtml: true,
        extensions: [gfmTable(), gfmStrikethrough(), gfmAutolinkLiteral()],
        htmlExtensions: [gfmTableHtml(), gfmStrikethroughHtml(), gfmAutolinkLiteralHtml()]
      });
    }
    case 'micromark-commonmark': {
      return micromark(text, { allowDangerousHtml: true });
    }
    case 'remark-parse-8': {
      return renderRemarkHtml(parseRemark(text));
    }
    default: {
      throw new Error('Unknown engine');
    }
  }
}

function attributesOf(element: Element): string {
  const kept = KEPT_ATTRIBUTES[element.tagName] ?? [];
  return element.attrs
    .filter((attribute) => kept.includes(attribute.name))
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => ` ${attribute.name}="${decodeTarget(attribute.value)}"`)
    .join('');
}

// `markdown-it` with GFM's autolink literals, which need a scheme or `www.`, not a bare domain.
function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownItCallable({ html: true, linkify: true });
  md.linkify.set({ fuzzyLink: false });
  return md;
}

function decodeTarget(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    // A target that is not valid percent-encoding is compared as it is.
    return value;
  }
}

function describe(tokens: readonly string[], index: number): string {
  return JSON.stringify(tokens.slice(index, index + DESCRIBED_TOKENS));
}

// The child that opens an element's content: white space skipped.
function firstContent(nodes: readonly ChildNode[]): ChildNode | undefined {
  return nodes.find((node) => !isText(node) || node.value.trim() !== '');
}

function firstDifference(left: readonly string[], right: readonly string[]): null | number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) {
      return index;
    }
  }
  return null;
}

function isElement(node: ChildNode | undefined): node is Element {
  return node !== undefined && 'tagName' in node;
}

function isText(node: ChildNode): node is TextNode {
  return node.nodeName === '#text';
}

// A token's kind, as a key names it: the element's name with its task mark, `text`, or `end` past the last token.
function labelAt(tokens: readonly string[], index: number): string {
  const token = tokens[index];
  if (token === undefined) {
    return 'end';
  }
  return token.startsWith('"') ? 'text' : /^<\/?[a-z\d]+(?: \[.\])?/u.exec(token)?.[0].replace('<', '') ?? token;
}

// A list item, its paragraphs read as their content, and its task mark read off the checkbox or, for a reference, by the GFM rule.
function pushListItem(item: Element, isReference: boolean, tokens: string[]): void {
  const children = item.childNodes.flatMap((child) => (isElement(child) && child.tagName === 'p' ? child.childNodes : [child]));
  let mark = '';
  const head = firstContent(children);
  if (isReference) {
    // The item's first block is a paragraph, or the text of a tight item; its text opens on the mark.
    const first = firstContent(item.childNodes);
    const opening = isElement(first) ? (first.tagName === 'p' ? first.childNodes.at(0) : undefined) : first;
    if (opening !== undefined && isText(opening)) {
      const status = TASK_MARK_PATTERN.exec(opening.value.trimStart())?.groups?.['status'];
      if (status !== undefined) {
        mark = status === ' ' ? ' [ ]' : ' [x]';
        opening.value = opening.value.trimStart().slice('[ ]'.length);
      }
    }
  } else if (isElement(head) && head.tagName === 'input') {
    mark = head.attrs.some((attribute) => attribute.name === 'checked') ? ' [x]' : ' [ ]';
    children.splice(children.indexOf(head), 1);
  }
  tokens.push(`<li${mark}>`);
  pushTokens(children, isReference, tokens);
  tokens.push('</li>');
}

function pushTokens(nodes: readonly ChildNode[], isReference: boolean, tokens: string[]): void {
  for (const node of nodes) {
    if (isText(node)) {
      const value = node.value.replaceAll(WHITE_SPACE_PATTERN, ' ').trim();
      if (value !== '') {
        tokens.push(`"${value}`);
      }
      continue;
    }
    if ('data' in node) {
      tokens.push(`<!--${node.data}-->`);
      continue;
    }
    if (!isElement(node)) {
      continue;
    }
    if (node.tagName === 'li') {
      pushListItem(node, isReference, tokens);
      continue;
    }
    const name = ELEMENT_SYNONYMS[node.tagName] ?? node.tagName;
    tokens.push(`<${name}${attributesOf(node)}>`);
    pushTokens(node.childNodes, isReference, tokens);
    tokens.push(`</${name}>`);
  }
}

// The references' tokens, `commonmark.js` only for a note the GFM extensions change nothing in.
function referenceTokens(text: string): ReferenceTokens[] {
  const references: ReferenceTokens[] = REFERENCE_ENGINES.filter((engine) => engine !== 'commonmark.js').map((engine) => ({ engine, tokens: engineTokens(engine, text) }));
  if (renderHtml('micromark', text) === renderHtml('micromark-commonmark', text)) {
    references.push({ engine: 'commonmark.js', tokens: engineTokens('commonmark.js', text) });
  }
  return references;
}

// The finding of references that disagree, `dissenters` being those that differ from the first: the one alone against
// the other two when there is one, else the first and the first dissenter.
function splitFinding(references: readonly ReferenceTokens[], dissenters: readonly ReferenceTokens[]): SelfCheckFinding {
  const [first] = references;
  const [dissenter, otherDissenter] = dissenters;
  if (first === undefined || dissenter === undefined) {
    throw new Error('A split needs two references');
  }
  let alone: ReferenceTokens | undefined;
  if (references.length >= REFERENCES_FOR_A_MAJORITY && dissenters.length === 1) {
    alone = dissenter;
  } else if (otherDissenter !== undefined && firstDifference(dissenter.tokens, otherDissenter.tokens) === null) {
    alone = first;
  }
  const [one, other] = alone === dissenter ? [dissenter, first] : [first, dissenter];
  const index = firstDifference(one.tokens, other.tokens) ?? 0;
  const name = alone === undefined ? `${one.engine}-vs-${other.engine}` : `${one.engine}-alone`;
  return {
    detail: `${one.engine} gives ${describe(one.tokens, index)}, ${alone === undefined ? other.engine : 'the other references'} ${describe(other.tokens, index)}`,
    judge: 'engines',
    key: `engines:references:${name}:${labelAt(one.tokens, index)}-vs-${labelAt(other.tokens, index)}`
  };
}
