/**
 * @file
 *
 * Judges that find where Obsidian is wrong but consistent with itself, which no comparison of Obsidian against itself
 * or of its editor against its reading view can see. Each judge checks one relation a correct parser keeps, needing no
 * reference output:
 *
 * - `offset`: every position the metadata cache reports slices out its own construct.
 * - `shift`: prepending a paragraph moves every position by its length and changes nothing else.
 * - `padding`: stretching a plain word across a scan window's length changes no structure.
 * - `rename`: rewriting a link where the cache says it is, as a rename does, leaves every other link alone.
 * - `escape`: a backslash before a construct's opening or closing delimiter removes the construct.
 * - `independence`: a block after a blank line reads the same alone and after the blocks before it.
 * - `render`: the cache and the reading view find the same headings, links, embeds, tags and footnote references.
 * - `fidelity`: the reading view's text is its source, escapes and container marks aside.
 * - `conservation`: every word of the source is shown, or hidden by a construct that hides it by design.
 *
 * The cache is `parseMetadata`, equal to the metadata worker's output on every oracle document, and the reading view is
 * the `remark-parse` 8 engine, equal to the reading view's HTML; so each judge runs offline, at fuzzing speed, and what
 * it flags is Obsidian's behaviour.
 */

import type {
  CachedMetadata,
  Loc,
  Pos
} from '../metadata/types.ts';
import type {
  RemarkNode,
  RemarkRoot
} from '../remark/types.ts';

import { parseMetadata } from '../metadata/metadata.ts';
import { renderRemarkHtml } from '../remark/html.ts';
import { parseRemark } from '../remark/parse.ts';
import { minimizeNote } from './ddmin.ts';
import { FILLER_WORD } from './note-grammar.ts';
import { compareCodeUnits } from './score.ts';

/**
 * One relation a note breaks.
 */
export interface SelfCheckFinding {
  /**
   * What was seen, for a person.
   */
  readonly detail: string;

  /**
   * The judge that found it.
   */
  readonly judge: SelfCheckJudge;

  /**
   * The key the finding is grouped and reduced by: `<judge>:<what>`.
   */
  readonly key: string;
}

/**
 * A self-check judge.
 */
export type SelfCheckJudge = 'conservation' | 'escape' | 'fidelity' | 'independence' | 'offset' | 'padding' | 'rename' | 'render' | 'shift';

/**
 * Every judge, in the order {@link judgeNote} runs them.
 */
export const SELF_CHECK_JUDGES: readonly SelfCheckJudge[] = ['offset', 'shift', 'padding', 'rename', 'escape', 'independence', 'render', 'fidelity', 'conservation'];

/**
 * What the shift relation prepends.
 */
export const SHIFT_PREFIX = `${FILLER_WORD} ipsum\n\n`;

/**
 * How far the padding relation stretches a filler word: past the 1,024 and the 4,096 character marks.
 */
// eslint-disable-next-line no-magic-numbers -- The lengths are the data: each passes one scan window's end.
export const PADDING_LENGTHS: readonly number[] = [1100, 4200];

/**
 * The link a simulated rename writes.
 */
export const RENAMED_LINK = '[[renamed]]';

interface Delimiters {
  readonly closer: string;
  readonly opener: string;
}

type ItemField = 'blocks' | 'embeds' | 'footnoteRefs' | 'footnotes' | 'headings' | 'links' | 'listItems' | 'referenceLinks' | 'tags';

interface Range {
  readonly from: number;
  readonly to: number;
}

interface TreeItem {
  readonly from: number;
  readonly isInComment: boolean;
}

const MAX_PADDED_WORDS = 3;
const MAX_FINDINGS_PER_KEY = 1;
const WORD_PATTERN = /[\p{L}\p{N}]{3,}/gu;
const ESCAPABLE_PATTERN = /\\(?<character>[!-/:-@[-`{-~])/gu;
const CONTAINER_MARK_PATTERN = /^[ \t]*(?:>[ \t]?)*[ \t]*/u;
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;
const CALLOUT_MARK_PATTERN = /^(?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t]|\[.\][ \t])*\[![^\]]*\][+-]?/gmu;
const BLANK_LINE_PATTERN = /\n[ \t]*\n/u;
const SHIFT_LINES = 2;
const SHIFT_PREFIX_SECTIONS = 2;

const ITEM_FIELDS: readonly ItemField[] = ['blocks', 'embeds', 'footnoteRefs', 'footnotes', 'headings', 'links', 'listItems', 'referenceLinks', 'tags'];

const ESCAPABLE: Readonly<Partial<Record<RemarkNode['type'], Delimiters>>> = {
  delete: { closer: '~~', opener: '~~' },
  embed: { closer: ']]', opener: '![[' },
  highlight: { closer: '==', opener: '==' },
  inlineMath: { closer: '$', opener: '$' },
  internalLink: { closer: ']]', opener: '[[' },
  obsidianComment: { closer: '%%', opener: '%%' }
};

// Nodes whose whole source is accounted for: shown as they are, or hidden by design.
const COVERING_TYPES: ReadonlySet<RemarkNode['type']> = new Set<RemarkNode['type']>([
  'blockId',
  'code',
  'embed',
  'footnoteReference',
  'html',
  'image',
  'imageReference',
  'inlineCode',
  'inlineMath',
  'internalLink',
  'link',
  'linkReference',
  'math',
  'obsidianComment',
  'obsidianCommentBlock',
  'tag',
  'text',
  'yaml'
]);

const COMMENT_TYPES: ReadonlySet<RemarkNode['type']> = new Set<RemarkNode['type']>(['obsidianComment', 'obsidianCommentBlock']);

/**
 * The conservation judge: every word of the source lies in a node that shows it, or in one that hides it by design
 * (comments, front matter, a link's destination, a definition's lines up to a blank line, a callout's type).
 *
 * @param text - The note.
 * @param tree - Its reading view tree.
 * @returns The findings, keyed by the innermost node over a word nothing shows.
 */
export function judgeConservation(text: string, tree: RemarkRoot = parseRemark(text)): SelfCheckFinding[] {
  const covered: Range[] = [];
  walk(tree, (node) => {
    const range = rangeOf(node);
    if (range === null) {
      return;
    }
    if (COVERING_TYPES.has(node.type)) {
      covered.push(range);
    } else if (node.type === 'definition') {
      // A definition may take its destination and title from the lines after its label, but never across a blank line.
      const blankLine = text.slice(range.from, range.to).search(BLANK_LINE_PATTERN);
      covered.push({ from: range.from, to: blankLine < 0 ? range.to : range.from + blankLine });
    } else if (node.type === 'footnoteDefinition') {
      const labelEnd = text.indexOf(']:', range.from);
      covered.push({ from: range.from, to: labelEnd === -1 ? range.from : labelEnd + ']:'.length });
    }
  });
  for (const match of text.matchAll(CALLOUT_MARK_PATTERN)) {
    covered.push({ from: match.index, to: match.index + match[0].length });
  }
  const findings: SelfCheckFinding[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const from = match.index;
    const to = from + match[0].length;
    if (covered.some((range) => range.from <= from && to <= range.to)) {
      continue;
    }
    const holder = innermostAt(tree, from)?.type ?? 'root';
    findings.push({ detail: `the word ${JSON.stringify(match[0])} at ${String(from)} is not shown`, judge: 'conservation', key: `conservation:${holder}` });
  }
  return findings;
}

/**
 * The escape judge: a backslash before the opening or the closing delimiter of an Obsidian construct, or of a
 * strikethrough, makes the delimiter literal, so the construct goes.
 *
 * @param text - The note.
 * @param tree - Its reading view tree.
 * @returns The findings, keyed by the node type and the delimiter escaped.
 */
export function judgeEscapes(text: string, tree: RemarkRoot = parseRemark(text)): SelfCheckFinding[] {
  const findings: SelfCheckFinding[] = [];
  walk(tree, (node) => {
    const delimiters = ESCAPABLE[node.type];
    const range = rangeOf(node);
    if (delimiters === undefined || range === null) {
      return;
    }
    const source = text.slice(range.from, range.to);
    if (!source.startsWith(delimiters.opener) || !source.endsWith(delimiters.closer) || source.length < delimiters.opener.length + delimiters.closer.length) {
      return;
    }
    // The construct survives when one of its type still opens on the escaped opener, or still spans from its opener to the escaped closer.
    const survivors = {
      closer: (candidate: Range): boolean => candidate.from === range.from && candidate.to === range.to + 1,
      opener: (candidate: Range): boolean => candidate.from === range.from + 1
    };
    const sides = [['opener', range.from], ['closer', range.to - delimiters.closer.length]] as const;
    for (const [side, at] of sides) {
      const escaped = `${text.slice(0, at)}\\${text.slice(at)}`;
      const isKept = hasNode(parseRemark(escaped), (candidate) => {
        const candidateRange = rangeOf(candidate);
        return candidate.type === node.type && candidateRange !== null && survivors[side](candidateRange);
      });
      if (isKept) {
        findings.push({ detail: `a backslash before the ${side} of ${JSON.stringify(source)} keeps the ${node.type}`, judge: 'escape', key: `escape:${node.type}-${side}` });
      }
    }
  });
  return findings;
}

/**
 * The fidelity judge: a text node of the reading view holds its own source, once backslash escapes are taken out, the
 * marks of the containers it continues in are dropped and whitespace is collapsed.
 *
 * @param text - The note.
 * @param tree - Its reading view tree.
 * @returns The findings, keyed by the text node's parent type.
 */
export function judgeFidelity(text: string, tree: RemarkRoot = parseRemark(text)): SelfCheckFinding[] {
  const findings: SelfCheckFinding[] = [];
  walkWithParent(tree, null, (node, parent) => {
    const range = rangeOf(node);
    // The reading view shows nothing of a comment.
    if (range === null || node.type !== 'text' || isInsideComment(tree, range.from)) {
      return;
    }
    const source = text.slice(range.from, range.to);
    // A character reference is decoded into its character, which no slice can show.
    if (source.includes('&')) {
      return;
    }
    const expected = collapse(source.split('\n').map((line, index) => (index === 0 ? line : line.replace(CONTAINER_MARK_PATTERN, ''))).join('\n').replaceAll(ESCAPABLE_PATTERN, '$<character>'));
    const actual = collapse(node.value.replaceAll(ESCAPABLE_PATTERN, '$<character>'));
    if (actual !== expected) {
      findings.push({ detail: `text ${JSON.stringify(node.value)} stands for ${JSON.stringify(source)}`, judge: 'fidelity', key: `fidelity:${parent?.type ?? 'root'}` });
    }
  });
  return findings;
}

/**
 * The independence judge: a block after a blank line gives the same headings, links, embeds, tags, footnotes, block
 * ids, definitions and sections read alone as it does after the blocks before it. A link by reference, a footnote
 * reference and a list, which may lean on or merge with an earlier block by design, are left out.
 *
 * @param text - The note.
 * @returns The findings, keyed by the field that differs.
 */
export function judgeIndependence(text: string): SelfCheckFinding[] {
  const whole = parseMetadata(text);
  if (whole === null) {
    return [];
  }
  const findings: SelfCheckFinding[] = [];
  const chunks = text.split('\n\n');
  let from = 0;
  for (const [index, chunk] of chunks.entries()) {
    const start = from;
    from += chunk.length + '\n\n'.length;
    if (index === 0 || chunk.trim() === '') {
      continue;
    }
    const alone = parseMetadata(chunk);
    if (alone === null) {
      continue;
    }
    const inContext = independenceFacts(whole, start, start + chunk.length);
    const byItself = independenceFacts(alone, 0, chunk.length);
    for (const [field, facts] of byItself) {
      const contextFacts = inContext.get(field) ?? [];
      if (facts.join('\n') !== contextFacts.join('\n')) {
        findings.push({
          detail: `block ${String(index)} alone gives ${field} ${JSON.stringify(facts)}, after the blocks before it ${JSON.stringify(contextFacts)}`,
          judge: 'independence',
          key: `independence:${field}`
        });
      }
    }
  }
  return findings;
}

/**
 * Judges a note with every judge but `independence`'s generated-block form: the findings, at most one per key.
 *
 * @param text - The note.
 * @returns The findings.
 */
export function judgeNote(text: string): SelfCheckFinding[] {
  const metadata = parseMetadata(text);
  if (metadata === null) {
    return [];
  }
  const tree = parseRemark(text);
  return firstPerKey([
    ...judgeOffsets(text, metadata),
    ...judgeShift(text, metadata),
    ...judgePadding(text, metadata),
    ...judgeRename(text, metadata),
    ...judgeEscapes(text, tree),
    ...judgeIndependence(text),
    ...judgeRender(text, metadata, tree),
    ...judgeFidelity(text, tree),
    ...judgeConservation(text, tree)
  ]);
}

/**
 * The offset judge: every position of an internal link, embed, tag, footnote reference, footnote, heading, block id,
 * definition or list item slices out that construct from the note.
 *
 * @param text - The note.
 * @param metadata - Its metadata.
 * @returns The findings, keyed by the field.
 */
export function judgeOffsets(text: string, metadata: CachedMetadata | null = parseMetadata(text)): SelfCheckFinding[] {
  if (metadata === null) {
    return [];
  }
  const findings: SelfCheckFinding[] = [];
  function check(field: ItemField, position: Pos, isRight: (slice: string) => boolean, what: string): void {
    const slice = text.slice(position.start.offset, position.end.offset);
    if (!isLocConsistent(text, position.start) || !isLocConsistent(text, position.end) || !isRight(slice)) {
      findings.push({ detail: `${field} ${what} is at ${JSON.stringify(slice)}`, judge: 'offset', key: `offset:${field}` });
    }
  }
  const { embeds = [], footnoteRefs: footnoteReferences = [], footnotes = [], headings = [], links = [], tags = [] } = metadata;
  for (const [field, items] of [['links', links], ['embeds', embeds]] as const) {
    for (const item of items) {
      check(field, item.position, (slice) => slice === item.original && isReferenceSource(slice, field === 'embeds'), JSON.stringify(item.original));
    }
  }
  for (const item of tags) {
    check('tags', item.position, (slice) => slice === item.tag, item.tag);
  }
  for (const item of footnoteReferences) {
    check('footnoteRefs', item.position, (slice) => (item.id === '' ? slice.startsWith('^[') : slice.toLowerCase() === `[^${item.id}]`), JSON.stringify(item.id));
  }
  for (const item of footnotes) {
    check('footnotes', item.position, (slice) => (item.id.startsWith('[inline') ? slice.length > 0 : slice.toLowerCase().startsWith(`[^${item.id}]:`)), JSON.stringify(item.id));
  }
  for (const item of headings) {
    check('headings', item.position, (slice) => slice.includes(item.heading) && /^#|\n[ \t]*[=-]+[ \t]*$/u.test(slice.trimStart()), JSON.stringify(item.heading));
  }
  visitBlockOffsets(text, metadata, check);
  return findings;
}

/**
 * The padding relation: stretching a filler word ({@link FILLER_WORD}) by each of {@link PADDING_LENGTHS} changes
 * no structure: no count of any item, no heading level, no section type, no link, tag or footnote.
 *
 * @param text - The note.
 * @param metadata - Its metadata.
 * @returns The findings, keyed by the field that changed.
 */
export function judgePadding(text: string, metadata: CachedMetadata | null = parseMetadata(text)): SelfCheckFinding[] {
  if (metadata === null) {
    return [];
  }
  const findings: SelfCheckFinding[] = [];
  const before = structureOf(metadata);
  const offsets = Array.from(text.matchAll(new RegExp(FILLER_WORD, 'gu')), (match) => match.index + FILLER_WORD.length).slice(0, MAX_PADDED_WORDS);
  for (const at of offsets) {
    for (const length of PADDING_LENGTHS) {
      const padded = parseMetadata(`${text.slice(0, at)}${'x'.repeat(length)}${text.slice(at)}`);
      if (padded === null) {
        findings.push({ detail: `padding by ${String(length)} at ${String(at)} makes the worker throw`, judge: 'padding', key: 'padding:throws' });
        continue;
      }
      const after = structureOf(padded);
      for (const [field, value] of before) {
        const paddedValue = after.get(field) ?? '';
        if (value !== paddedValue) {
          findings.push({ detail: `padding by ${String(length)} at ${String(at)} changes ${field} from ${value} to ${paddedValue}`, judge: 'padding', key: `padding:${field}` });
        }
      }
    }
  }
  return findings;
}

/**
 * The rename relation: writing {@link RENAMED_LINK} over each internal link or embed where the cache says it is, as a
 * rename rewrites a link, gives a link to `renamed` there and leaves every other link and embed as it was.
 *
 * @param text - The note.
 * @param metadata - Its metadata.
 * @returns The findings, keyed by the field of the link renamed.
 */
export function judgeRename(text: string, metadata: CachedMetadata | null = parseMetadata(text)): SelfCheckFinding[] {
  if (metadata === null) {
    return [];
  }
  const findings: SelfCheckFinding[] = [];
  const all = [...(metadata.links ?? []).map((item) => ({ field: 'links', item })), ...(metadata.embeds ?? []).map((item) => ({ field: 'embeds', item }))];
  for (const [index, { field, item }] of all.entries()) {
    const replacement = field === 'embeds' ? `!${RENAMED_LINK}` : RENAMED_LINK;
    const { end, start } = item.position;
    const renamedText = text.slice(0, start.offset) + replacement + text.slice(end.offset);
    const renamed = parseMetadata(renamedText);
    const after = [...(renamed?.links ?? []), ...(renamed?.embeds ?? [])];
    const others = all.filter((_entry, otherIndex) => otherIndex !== index).map((entry) => entry.item.original).toSorted(compareCodeUnits);
    const isLinked = after.some((link) => link.position.start.offset === start.offset && link.original === replacement);
    const afterOthers = after.filter((link) => link.position.start.offset !== start.offset).map((link) => link.original).toSorted(compareCodeUnits);
    if (isLinked && afterOthers.join('\n') === others.join('\n')) {
      continue;
    }
    const line = renamedText.split('\n')[start.line] ?? '';
    findings.push({ detail: `renaming ${JSON.stringify(item.original)} gives the line ${JSON.stringify(line)}`, judge: 'rename', key: `rename:${field}` });
  }
  return findings;
}

/**
 * The render judge: the cache and the reading view find the same headings, links, embeds, tags and footnote
 * references, and a heading has the same text in both. An item found only in the cache inside a comment, which the
 * reading view hides, gets its own key. A colored highlight shows nothing of its color marker.
 *
 * @param text - The note.
 * @param metadata - Its metadata.
 * @param tree - Its reading view tree.
 * @returns The findings, keyed by the field and the side that has it.
 */
export function judgeRender(text: string, metadata: CachedMetadata | null = parseMetadata(text), tree: RemarkRoot = parseRemark(text)): SelfCheckFinding[] {
  if (metadata === null) {
    return [];
  }
  const fromTree = treeItems(tree);
  const findings: SelfCheckFinding[] = [];
  for (const field of ['embeds', 'footnoteRefs', 'headings', 'links', 'tags'] as const) {
    // A heading is matched by its line, since the two place an indented one's start differently.
    function startOf(offset: number): number {
      return field === 'headings' ? lineOf(text, offset) : offset;
    }
    const cacheList = cacheOffsets(metadata, field);
    const treeList = (fromTree.get(field) ?? []).filter((item) => !item.isInComment);
    const cacheStarts = new Set(cacheList.map((offset) => startOf(offset)));
    const treeStarts = new Set(treeList.map((item) => startOf(item.from)));
    for (const offset of cacheList) {
      if (treeStarts.has(startOf(offset))) {
        continue;
      }
      const isInComment = isInsideComment(tree, offset);
      findings.push({ detail: `${field} at ${String(offset)} is only in the cache`, judge: 'render', key: `render:${field}-only-in-cache${isInComment ? '-in-comment' : ''}` });
    }
    for (const item of treeList) {
      if (cacheStarts.has(startOf(item.from))) {
        continue;
      }
      findings.push({ detail: `${field} at ${String(item.from)} is only in the reading view`, judge: 'render', key: `render:${field}-only-in-render` });
    }
  }
  walk(tree, (node) => {
    const range = rangeOf(node);
    // A highlight's color marker goes, and nothing it leaves shows: no space after it, no variation selector or joiner of the emoji.
    if (node.type === 'highlight' && node.color !== null && /^(?:\s|\u{200D}|\u{FE0F})/u.test(shownText(node))) {
      findings.push({ detail: `the colored highlight ${JSON.stringify(text.slice(range?.from ?? 0, range?.to ?? 0))} shows as ${JSON.stringify(shownText(node))}`, judge: 'render', key: 'render:highlight-color-residue' });
    }
    if (range === null || node.type !== 'heading') {
      return;
    }
    const cached = metadata.headings?.find((heading) => heading.position.start.offset === range.from);
    const shown = shownText(node).trim();
    if (cached !== undefined && cached.heading !== shown) {
      findings.push({ detail: `the cache's heading ${JSON.stringify(cached.heading)} shows as ${JSON.stringify(shown)}`, judge: 'render', key: 'render:heading-text' });
    }
  });
  return findings;
}

/**
 * The shift relation: prepending {@link SHIFT_PREFIX} moves every position by its length and two lines and changes
 * nothing else, measured between the note with the prefix once and twice. A note that opens on front matter is left out, since the prefix would make it none.
 *
 * @param text - The note.
 * @param metadata - Its metadata.
 * @returns The findings, keyed by the field that differs.
 */
export function judgeShift(text: string, metadata: CachedMetadata | null = parseMetadata(text)): SelfCheckFinding[] {
  if (metadata === null || text.startsWith('---')) {
    return [];
  }
  // The prefix once and twice, so no list starts on line 0 or 1, whose parent the cache gives as -1 alike.
  const base = parseMetadata(SHIFT_PREFIX + text);
  const shifted = parseMetadata(SHIFT_PREFIX + SHIFT_PREFIX + text);
  if (base === null || shifted === null) {
    return [{ detail: 'the prefix makes the worker throw', judge: 'shift', key: 'shift:throws' }];
  }
  const findings: SelfCheckFinding[] = [];
  for (const field of [...ITEM_FIELDS, 'sections'] as const) {
    const baseValue = field === 'sections' ? (base.sections ?? []).slice(1) : base[field] ?? null;
    const expected = String(JSON.stringify(shiftValue(baseValue, SHIFT_PREFIX.length, field)));
    const actual = JSON.stringify(field === 'sections' ? (shifted.sections ?? []).slice(SHIFT_PREFIX_SECTIONS) : shifted[field] ?? null);
    if (expected !== actual) {
      findings.push({ detail: `${field} after the prefix is ${actual}, not ${expected}`, judge: 'shift', key: `shift:${field}` });
    }
  }
  return findings;
}

/**
 * Reduces a note to a minimal one that keeps a finding's key, judged with {@link judgeNote}.
 *
 * @param text - The note.
 * @param key - The key to keep.
 * @returns The reduced note, `text` itself when it lacks the key.
 */
export function reduceFinding(text: string, key: string): string {
  const judge = key.split(':', 1)[0] as SelfCheckJudge;
  function hasKey(candidate: string): boolean {
    return judgeOne(judge, candidate).some((finding) => finding.key === key);
  }
  return hasKey(text) ? minimizeNote(text, hasKey) : text;
}

/**
 * The text a node shows in the reading view: its HTML with the tags taken out and the five escapes HTML uses decoded.
 *
 * @param node - The node.
 * @returns The text.
 */
export function shownText(node: RemarkNode): string {
  const html = renderRemarkHtml({ children: [node], type: 'root' });
  return html.replaceAll(/<[^>]*>/gu, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#x27;', '\'').replaceAll('&amp;', '&');
}

// The start offsets of a field's items in the cache; an inline footnote with content, which the cache lists among the footnotes from its content on, counts as a reference at its `^[`.
function cacheOffsets(metadata: CachedMetadata, field: 'embeds' | 'footnoteRefs' | 'headings' | 'links' | 'tags'): number[] {
  const offsets = (metadata[field] ?? []).map((item) => item.position.start.offset);
  if (field === 'footnoteRefs') {
    offsets.push(...(metadata.footnotes ?? []).filter((item) => item.id.startsWith('[inline')).map((item) => item.position.start.offset - '^['.length));
  }
  return offsets;
}

function collapse(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
}

function firstPerKey(findings: readonly SelfCheckFinding[]): SelfCheckFinding[] {
  const seen = new Map<string, number>();
  return findings.filter((finding) => {
    const count = seen.get(finding.key) ?? 0;
    seen.set(finding.key, count + 1);
    return count < MAX_FINDINGS_PER_KEY;
  });
}

function hasNode(node: RemarkNode, isMatch: (node: RemarkNode) => boolean): boolean {
  return isMatch(node) || ('children' in node && node.children.some((child) => hasNode(child, isMatch)));
}

function independenceFacts(metadata: CachedMetadata, from: number, to: number): Map<string, string[]> {
  const facts = new Map<string, string[]>();
  function add(field: string, position: Pos, payload: string): void {
    if (position.start.offset < from || position.start.offset >= to) {
      return;
    }
    const list = facts.get(field) ?? [];
    list.push(`${String(position.start.offset - from)} ${payload}`);
    facts.set(field, list);
  }
  const { blocks = {}, embeds = [], footnotes = [], headings = [], links = [], referenceLinks = [], sections = [], tags = [] } = metadata;
  const lists: readonly (readonly [string, readonly (readonly [Pos, null | string])[]])[] = [
    // A link by reference leans on a definition anywhere in the note.
    ['links', links.map((item) => [item.position, isByReference(item.original) ? null : item.original])],
    ['embeds', embeds.map((item) => [item.position, isByReference(item.original) ? null : item.original])],
    ['headings', headings.map((item) => [item.position, `${String(item.level)} ${item.heading}`])],
    ['tags', tags.map((item) => [item.position, item.tag])],
    // Inline footnotes are numbered through the whole note.
    ['footnotes', footnotes.map((item) => [item.position, item.id.startsWith('[inline') ? '[inline' : item.id])],
    ['referenceLinks', referenceLinks.map((item) => [item.position, item.id])],
    ['blocks', Object.values(blocks).map((item) => [item.position, item.id])],
    // A list merges with a list before it, and the footnotes section sits at the end of the whole note.
    ['sections', sections.map((item) => [item.position, ['element', 'list', 'text'].includes(item.type) ? null : item.type])]
  ];
  for (const [field, items] of lists) {
    facts.set(field, []);
    for (const [position, payload] of items) {
      if (payload !== null) {
        add(field, position, payload);
      }
    }
  }
  return facts;
}

function innermostAt(tree: RemarkRoot, offset: number): null | RemarkNode {
  let found: null | RemarkNode = null;
  walk(tree, (node) => {
    const range = rangeOf(node);
    if (range !== null && node.type !== 'root' && range.from <= offset && offset < range.to) {
      found = node;
    }
  });
  return found;
}

function isByReference(original: string): boolean {
  return !original.endsWith(']]') && !original.endsWith(')');
}

function isInsideComment(tree: RemarkRoot, offset: number): boolean {
  let isInside = false;
  walk(tree, (node) => {
    const range = rangeOf(node);
    if (range !== null && COMMENT_TYPES.has(node.type) && range.from <= offset && offset < range.to) {
      isInside = true;
    }
  });
  return isInside;
}

function isLocConsistent(text: string, loc: Loc): boolean {
  const before = text.slice(0, loc.offset);
  const line = before.split('\n').length - 1;
  const col = loc.offset - (before.lastIndexOf('\n') + 1);
  return line === loc.line && col === loc.col;
}

function isReferenceSource(slice: string, isEmbed: boolean): boolean {
  const isWiki = isEmbed ? slice.startsWith('![[') : slice.startsWith('[[');
  const isMarkdown = isEmbed ? slice.startsWith('![') : slice.startsWith('[');
  return (isWiki && slice.endsWith(']]')) || (isMarkdown && (slice.endsWith(')') || slice.endsWith(']')));
}

function judgeOne(judge: SelfCheckJudge, text: string): SelfCheckFinding[] {
  switch (judge) {
    case 'conservation': {
      return judgeConservation(text);
    }
    case 'escape': {
      return judgeEscapes(text);
    }
    case 'fidelity': {
      return judgeFidelity(text);
    }
    case 'independence': {
      return judgeIndependence(text);
    }
    case 'offset': {
      return judgeOffsets(text);
    }
    case 'padding': {
      return judgePadding(text);
    }
    case 'rename': {
      return judgeRename(text);
    }
    case 'render': {
      return judgeRender(text);
    }
    case 'shift': {
      return judgeShift(text);
    }
    default: {
      return [];
    }
  }
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length - 1;
}

function rangeOf(node: RemarkNode): null | Range {
  const { position } = node;
  return position === undefined ? null : { from: position.start.offset, to: position.end.offset };
}
function shiftValue(value: unknown, by: number, field: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => shiftValue(item, by, field));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['offset'] === 'number' && typeof record['line'] === 'number') {
    return { ...record, line: record['line'] + SHIFT_LINES, offset: record['offset'] + by };
  }
  const shifted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (field === 'listItems' && key === 'parent' && typeof item === 'number') {
      shifted[key] = item < 0 ? item - SHIFT_LINES : item + SHIFT_LINES;
      continue;
    }
    shifted[key] = shiftValue(item, by, field);
  }
  return shifted;
}

function structureOf(metadata: CachedMetadata): Map<string, string> {
  const structure = new Map<string, string>();
  for (const field of ITEM_FIELDS) {
    structure.set(field, String(Object.values(metadata[field] ?? {}).length));
  }
  structure.set('headingLevels', (metadata.headings ?? []).map((heading) => heading.level).join(','));
  structure.set('sectionTypes', (metadata.sections ?? []).map((section) => section.type).join(','));
  structure.set('linkSources', [...(metadata.links ?? []), ...(metadata.embeds ?? [])].map((link) => link.original).join(','));
  structure.set('tagNames', (metadata.tags ?? []).map((tag) => tag.tag).join(','));
  structure.set('footnoteIds', (metadata.footnotes ?? []).map((footnote) => footnote.id).join(','));
  return structure;
}

function treeItems(tree: RemarkRoot): Map<string, TreeItem[]> {
  const items = new Map<string, TreeItem[]>([['embeds', []], ['footnoteRefs', []], ['headings', []], ['links', []], ['tags', []]]);
  function walkItems(node: RemarkNode, isInComment: boolean): void {
    const range = rangeOf(node);
    const isComment = isInComment || COMMENT_TYPES.has(node.type);
    let field: null | string = null;
    switch (node.type) {
      case 'embed': {
        field = 'embeds';
        break;
      }
      case 'footnoteReference':
      case 'inlineFootnote': {
        field = 'footnoteRefs';
        break;
      }
      case 'heading': {
        field = 'headings';
        break;
      }
      case 'image': {
        field = node.url === '' || URL_SCHEME_PATTERN.test(node.url) ? null : 'embeds';
        break;
      }
      case 'internalLink': {
        field = 'links';
        break;
      }
      case 'link': {
        field = node.url === '' || URL_SCHEME_PATTERN.test(node.url) ? null : 'links';
        break;
      }
      case 'tag': {
        field = 'tags';
        break;
      }
      default: {
        break;
      }
    }
    if (field !== null && range !== null) {
      items.get(field)?.push({ from: range.from, isInComment: isComment });
    }
    if ('children' in node) {
      for (const child of node.children) {
        walkItems(child, isComment);
      }
    }
  }
  walkItems(tree, false);
  return items;
}

// The block-level half of `judgeOffsets`: block ids, link reference definitions and list items.
function visitBlockOffsets(
  text: string,
  metadata: CachedMetadata,
  check: (field: ItemField, position: Pos, isRight: (slice: string) => boolean, what: string) => void
): void {
  const { blocks = {}, listItems = [], referenceLinks = [] } = metadata;
  for (const item of Object.values(blocks)) {
    // An id on a line of its own after a block names that block, so it follows the block's position.
    const ownLine = new RegExp(String.raw`^\s*\^${escapeRegExp(item.id)}[ \t]*(?:\n|$)`, 'u');
    check('blocks', item.position, (slice) => slice.includes(`^${item.id}`) || ownLine.test(text.slice(item.position.end.offset)), JSON.stringify(item.id));
  }
  for (const item of referenceLinks) {
    check('referenceLinks', item.position, (slice) => slice.trimStart().startsWith('[') && slice.includes(']:'), JSON.stringify(item.id));
  }
  for (const item of listItems) {
    check('listItems', item.position, (slice) => /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u.test(slice), `on line ${String(item.position.start.line)}`);
  }
}

function walk(node: RemarkNode, visit: (node: RemarkNode) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) {
      walk(child, visit);
    }
  }
}

function walkWithParent(node: RemarkNode, parent: null | RemarkNode, visit: (node: RemarkNode, parent: null | RemarkNode) => void): void {
  visit(node, parent);
  if ('children' in node) {
    for (const child of node.children) {
      walkWithParent(child, node, visit);
    }
  }
}
