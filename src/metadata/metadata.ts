/**
 * @file
 *
 * The `CachedMetadata` projection: the metadata Obsidian's metadata worker posts for a document, built from the
 * `remark-parse` 8 engine's tree by walking it as the worker walks its own.
 *
 * The worker reads the document with Obsidian's `breaks` option, which makes every line break in inline content a hard
 * one. Before it walks the tree it runs transforms that move things: a markdown link or an image whose destination is
 * no URL becomes an internal link or an embed, and the content of each inline footnote moves into a footnotes section
 * it adds after the document's blocks. So what an inline footnote holds is listed after the rest, the sections end
 * with one of type `text` and one of type `element` on the line after the last block, and that `element` section takes
 * the last block id the footnotes hold. It also puts a task's checkbox first in a list item that no paragraph opens,
 * which moves the item's end. The projection reproduces each of these, and the keys of every object are in the
 * worker's order, so the two compare as JSON.
 */

/* eslint-disable perfectionist/sort-objects -- Each item is built in the worker's key order, which a JSON comparison of the metadata sees. */

import type {
  RemarkFootnoteDefinition,
  RemarkHeading,
  RemarkImage,
  RemarkList,
  RemarkListItem,
  RemarkNode,
  RemarkPoint,
  RemarkPosition,
  RemarkRoot
} from '../remark/types.ts';
import type {
  BlockCache,
  CachedMetadata,
  EmbedCache,
  FootnoteCache,
  FootnoteReferenceCache,
  FrontMatterCache,
  FrontmatterLinkCache,
  HeadingCache,
  LinkCache,
  ListItemCache,
  Loc,
  Pos,
  ReferenceLinkCache,
  SectionCache,
  TagCache
} from './types.ts';

import { normalizeLinkPath } from '../remark/obsidian.ts';
import { parseRemarkTree } from '../remark/parse.ts';
import {
  frontmatterLinksOf,
  parseFrontmatter
} from './frontmatter.ts';
import {
  isLinkPath,
  WorkerFailure
} from './link-path.ts';

interface FootnoteNote {
  readonly children: readonly RemarkNode[];
  readonly isInline: boolean;
}

interface FootnoteNumbering {
  readonly inlineIndexes: ReadonlyMap<RemarkNode, number>;
  readonly notes: readonly FootnoteNote[];
}

interface MutableListItemCache {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The metadata walk attaches this field after creating the list item cache.
  id?: string;
  readonly parent: number;
  readonly position: Pos;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The metadata walk attaches this field after creating the list item cache.
  task?: string;
}

interface MutableMetadata {
  readonly blocks: Record<string, BlockCache>;
  readonly embeds: EmbedCache[];
  // eslint-disable-next-line unicorn/name-replacements -- The worker's own name, which the JSON comparison sees.
  readonly footnoteRefs: FootnoteReferenceCache[];
  readonly footnotes: FootnoteCache[];
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The metadata walk fills front matter fields after parsing the YAML node.
  frontmatter?: FrontMatterCache;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The metadata walk fills front matter fields after parsing the YAML node.
  frontmatterLinks?: FrontmatterLinkCache[];
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The metadata walk fills front matter fields after parsing the YAML node.
  frontmatterPosition?: Pos;
  readonly headings: HeadingCache[];
  readonly links: LinkCache[];
  readonly listItems: ListItemCache[];
  readonly referenceLinks: ReferenceLinkCache[];
  readonly sections: SectionCache[];
  readonly tags: TagCache[];
}

interface Walk {
  readonly inlineIndexes: ReadonlyMap<RemarkNode, number>;
  readonly listParents: Map<RemarkList, RemarkListItem>;
  readonly metadata: MutableMetadata;
  readonly text: string;
}

// A block id the engine has taken out of the tree, after the last block of the document.
const TRAILING_BLOCK_ID_RE = /^\s*\^[a-zA-Z0-9-]+/u;
const LINE_BREAKS_RE = /\r\n|\r/gu;
const IMAGE_SIZE_RE = /^\s*\d+\s*(?:x\s*\d+\s*)?$/u;
const DEFAULT_HEADING_LEVEL = 1;
const DELETED_WHEN_EMPTY = new Set(['embeds', 'footnoteRefs', 'footnotes', 'headings', 'links', 'listItems', 'referenceLinks', 'sections', 'tags']);

const ORIGIN: RemarkPoint = { column: 1, line: 1, offset: 0 };

/**
 * Builds the metadata Obsidian's metadata worker posts for a document.
 *
 * The worker reads the file's bytes as UTF-8, so the document is too: a byte order mark at its start is dropped, and
 * every position counts from after it.
 *
 * @param markdown - The document.
 * @returns The metadata, with the fields the document has; `null` where the worker throws and posts `null`, which a
 * front matter string `[text]()` makes it do.
 */
export function parseMetadata(markdown: string): CachedMetadata | null {
  try {
    return metadataOrFailure(markdown);
  } catch (error) {
    if (error instanceof WorkerFailure) {
      return null;
    }
    throw error;
  }
}

/**
 * Why Obsidian's metadata worker throws on a document, where {@link parseMetadata} gives `null`.
 *
 * @param markdown - The document.
 * @returns The failure, naming what makes the worker throw; `null` where the worker posts metadata.
 */
export function workerFailureOf(markdown: string): null | WorkerFailure {
  try {
    metadataOrFailure(markdown);
    return null;
  } catch (error) {
    if (error instanceof WorkerFailure) {
      return error;
    }
    throw error;
  }
}

function addFootnoteSection(metadata: MutableMetadata, text: string, root: RemarkRoot, notes: readonly FootnoteNote[]): void {
  const position = footnoteSectionPosition(text, root);
  let id: string | undefined;
  for (const note of notes) {
    for (const child of note.children) {
      id = lastBlockId(child, !note.isInline) ?? id;
    }
  }

  metadata.sections.push({ type: 'text', position });
  const section: SectionCache = id ? { type: 'element', position, id } : { type: 'element', position };
  metadata.sections.push(section);
  if (id) {
    metadata.blocks[id.toLowerCase()] = { position, id };
  }
}

function childrenText(walk: Walk, children: readonly RemarkNode[]): string {
  return children.map((child) => displayTextOf(walk, child)).join('');
}

// A markdown link's destination decoded, or `undefined` where `decodeURI` refuses it.
function decodeLinkPath(destination: string): string | undefined {
  try {
    return normalizeLinkPath(decodeURI(destination));
  } catch {
    return undefined;
  }
}

// The text the worker gives an item it shows: the alternative text, title or value of a node, or its children's.
// eslint-disable-next-line complexity -- One case per node the text is read from.
function displayTextOf(walk: Walk, node: RemarkNode): string {
  let value: string;

  switch (node.type) {
    case 'blockId':
    case 'footnoteReference':
    case 'html':
    case 'obsidianComment':
    case 'obsidianCommentBlock': {
      return '';
    }
    case 'embed': {
      return node.target;
    }
    case 'image': {
      const link = imageLinkOf(node);
      if (link !== undefined) {
        return link;
      }
      value = imageAltOf(node) || (node.title ?? '');
      break;
    }
    case 'imageReference': {
      value = node.alt ?? '';
      break;
    }
    case 'inlineCode':
    case 'inlineMath':
    case 'text': {
      value = node.value;
      break;
    }
    case 'inlineFootnote': {
      // A numbered inline footnote has given its content to the footnotes section, and holds only its number.
      value = walk.inlineIndexes.has(node) ? '' : childrenText(walk, node.children);
      break;
    }
    case 'internalLink': {
      value = node.displayText;
      break;
    }
    case 'link': {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- An empty title falls through to the children, as in the worker.
      value = node.title || childrenText(walk, node.children);
      break;
    }
    case 'tag': {
      return `#${node.name}`;
    }
    default: {
      value = 'children' in node ? childrenText(walk, node.children) : '';
      break;
    }
  }

  if (node.type === 'break') {
    return `${value}\n`;
  }
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

/*
 * The worker puts its footnotes section at the start of the line after the last block of the document, a block id it
 * later takes out of the tree included, at that block's end offset.
 */
function footnoteSectionPosition(text: string, root: RemarkRoot): Pos {
  const last = root.children.at(-1)?.position?.end;
  if (!last) {
    return positionOf({ end: ORIGIN, start: ORIGIN });
  }

  const normalized = text.replaceAll(LINE_BREAKS_RE, '\n');
  let { line, offset } = last;
  for (let match = TRAILING_BLOCK_ID_RE.exec(normalized.slice(offset)); match; match = TRAILING_BLOCK_ID_RE.exec(normalized.slice(offset))) {
    offset += match[0].length;
    line += match[0].split('\n').length - 1;
  }

  const point: RemarkPoint = { column: 1, line: line + 1, offset };
  return positionOf({ end: point, start: point });
}

// The source of a heading's content, trimmed: from its first child's start to its last child's end.
function headingTextOf(text: string, heading: RemarkHeading): string {
  const first = heading.children.at(0)?.position?.start ?? heading.position?.end;
  const last = heading.children.at(-1)?.position?.end ?? heading.position?.end;
  return text.slice(first?.offset ?? 0, last?.offset ?? 0).trim();
}

/*
 * An image's alternative text with a size after its last `|` taken off, as the worker's image transform leaves it. It
 * runs after images whose destination is no URL became embeds, which keep theirs whole.
 */
function imageAltOf(image: RemarkImage): string {
  const alt = image.alt ?? '';
  const pipe = alt.lastIndexOf('|');
  return pipe !== -1 && IMAGE_SIZE_RE.test(alt.slice(pipe + 1)) ? alt.slice(0, pipe) : alt;
}

// An image's destination as an embed's link, when it is no URL; `decodeURI` refusing it leaves it as it is.
function imageLinkOf(image: RemarkImage): string | undefined {
  return !image.url || !isLinkPath(image.url) ? undefined : decodeLinkPath(image.url) ?? normalizeLinkPath(image.url);
}

function lastBlockId(node: RemarkNode, isInlineFootnoteHidden: boolean): string | undefined {
  if (node.type === 'blockId') {
    return node.value;
  }
  if (!('children' in node) || (isInlineFootnoteHidden && node.type === 'inlineFootnote')) {
    return undefined;
  }
  let id: string | undefined;
  for (const child of node.children) {
    id = lastBlockId(child, isInlineFootnoteHidden) ?? id;
  }
  return id;
}

function listItemOf(walk: Walk, item: RemarkListItem, parent: RemarkNode): ListItemCache {
  const position = positionOf(item.position);
  let end = position.end;
  /*
   * The worker puts a task's checkbox, a node at the item's position, first in the item when no paragraph opens it, so
   * it counts as a child here, and as the last one that is no list it ends where the item ends.
   */
  const hasCheckbox = typeof item.checked === 'boolean' && item.children.at(0)?.type !== 'paragraph';

  if (item.children.length + (hasCheckbox ? 1 : 0) > 1) {
    for (const child of item.children.toReversed()) {
      if (child.type !== 'list') {
        end = locOf(child.position?.end ?? ORIGIN);
        break;
      }
      walk.listParents.set(child, item);
    }
  }

  let parentLine = 0;
  if (parent.type === 'list') {
    const parentItem = walk.listParents.get(parent);
    parentLine = parentItem ? (parentItem.position?.start.line ?? 1) - 1 : -((parent.position?.start.line ?? 1) - 1) || -1;
  }

  const listItem: MutableListItemCache = { position: { start: position.start, end }, parent: parentLine };
  if (typeof item.checklist === 'string') {
    listItem.task = item.checklist;
  }
  if (item.id) {
    listItem.id = item.id;
  }
  return listItem;
}

function locOf(point: RemarkPoint): Loc {
  return { line: point.line - 1, col: point.column - 1, offset: point.offset };
}

function metadataOf(text: string, root: RemarkRoot, hasFootnoteOrBlockId: boolean): CachedMetadata {
  const metadata: MutableMetadata = {
    links: [],
    embeds: [],
    tags: [],
    headings: [],
    footnotes: [],
    // eslint-disable-next-line unicorn/name-replacements -- The worker's own name, which the JSON comparison sees.
    footnoteRefs: [],
    referenceLinks: [],
    sections: [],
    listItems: [],
    blocks: {}
  };

  const first = root.children.at(0);
  if (first?.type === 'yaml') {
    const frontmatter = parseFrontmatter(first.value);
    if (frontmatter) {
      metadata.frontmatter = frontmatter;
      metadata.frontmatterPosition = positionOf(first.position);
      metadata.frontmatterLinks = frontmatterLinksOf(frontmatter);
    }
  }

  for (const child of root.children) {
    const position = positionOf(child.position);
    metadata.sections.push(child.id ? { type: sectionType(child), position, id: child.id } : { type: sectionType(child), position });
    if (child.id) {
      metadata.blocks[child.id.toLowerCase()] = { position, id: child.id };
    }
  }

  // A tree with no footnote has no note to number, so it is not walked for them.
  const { inlineIndexes, notes } = hasFootnoteOrBlockId ? numberFootnotes(root) : { inlineIndexes: new Map<RemarkNode, number>(), notes: [] };
  if (notes.length > 0) {
    addFootnoteSection(metadata, text, root, notes);
  }

  const walk: Walk = { inlineIndexes, listParents: new Map(), metadata, text };
  walkNode(walk, root, root, false);
  for (const note of notes) {
    if (note.isInline) {
      for (const child of note.children) {
        walkNode(walk, child, root, true);
      }
    }
  }

  return withoutEmptyFields(metadata);
}

// Throws `WorkerFailure` where the worker throws.
function metadataOrFailure(markdown: string): CachedMetadata {
  const text = new TextDecoder().decode(new TextEncoder().encode(markdown));
  const { hasFootnoteOrBlockId, root } = parseRemarkTree(text, { shouldReadSoftLineBreaksAsHard: true });
  return metadataOf(text, root, hasFootnoteOrBlockId);
}

/*
 * The inline footnotes and the definitions the document refers to, numbered in the order the worker numbers them: by
 * first reference, outside the inline footnotes' content.
 */
function numberFootnotes(root: RemarkRoot): FootnoteNumbering {
  const definitions = new Map<string, RemarkFootnoteDefinition>();
  const inlineIndexes = new Map<RemarkNode, number>();
  const numbered = new Set<string>();
  const notes: FootnoteNote[] = [];
  // The notes in order, from one walk: a reference's definition can come after it, so it is looked up once the walk ends.
  const sites: RemarkNode[] = [];

  visitOutsideInlineFootnotes(root, (node) => {
    switch (node.type) {
      case 'footnoteDefinition': {
        definitions.set(node.identifier, node);
        break;
      }
      case 'footnoteReference':
      case 'inlineFootnote': {
        sites.push(node);
        break;
      }
      default: {
        break;
      }
    }
  });

  for (const node of sites) {
    if (node.type === 'inlineFootnote') {
      inlineIndexes.set(node, notes.length);
      notes.push({ children: node.children, isInline: true });
    } else if (node.type === 'footnoteReference' && !numbered.has(node.identifier)) {
      numbered.add(node.identifier);
      notes.push({ children: definitions.get(node.identifier)?.children ?? [], isInline: false });
    }
  }

  return { inlineIndexes, notes };
}

function positionOf(position: RemarkPosition | undefined): Pos {
  return { start: locOf(position?.start ?? ORIGIN), end: locOf(position?.end ?? ORIGIN) };
}

function sectionType(node: RemarkNode): string {
  if (node.type === 'blockquote' && node.callout) {
    return 'callout';
  }
  return node.type === 'obsidianCommentBlock' ? 'comment' : node.type;
}

function visitOutsideInlineFootnotes(node: RemarkNode, visitor: (node: RemarkNode) => void): void {
  visitor(node);
  if ('children' in node && node.type !== 'inlineFootnote') {
    for (const child of node.children) {
      visitOutsideInlineFootnotes(child, visitor);
    }
  }
}

/*
 * Walks a node as the worker walks its tree. `isInNote` is whether it is in an inline footnote's content, which the
 * worker never numbered: a reference there is not listed, and an inline footnote there is walked as its content.
 */
// eslint-disable-next-line complexity -- One case per node the worker lists.
function walkNode(walk: Walk, node: RemarkNode, parent: RemarkNode, isInNote: boolean): void {
  const { metadata, text } = walk;

  switch (node.type) {
    case 'definition': {
      if (node.url) {
        metadata.referenceLinks.push({ position: positionOf(node.position), id: node.label || node.identifier, link: node.url });
      }
      break;
    }
    case 'embed': {
      const position = positionOf(node.position);
      metadata.embeds.push({ position, link: node.target, original: text.slice(position.start.offset, position.end.offset), displayText: node.displayText });
      break;
    }
    case 'footnoteDefinition': {
      metadata.footnotes.push({ position: positionOf(node.position), id: node.identifier });
      break;
    }
    case 'footnoteReference': {
      if (!isInNote) {
        metadata.footnoteRefs.push({ position: positionOf(node.position), id: node.identifier });
      }
      break;
    }
    case 'heading': {
      if (parent.type === 'root') {
        metadata.headings.push({ position: positionOf(node.position), heading: headingTextOf(text, node), level: node.depth || DEFAULT_HEADING_LEVEL });
      }
      break;
    }
    case 'image': {
      const link = imageLinkOf(node);
      if (link !== undefined) {
        const position = positionOf(node.position);
        metadata.embeds.push({ position, link, original: text.slice(position.start.offset, position.end.offset), displayText: node.alt ?? '' });
      }
      break;
    }
    case 'inlineFootnote': {
      const index = walk.inlineIndexes.get(node);
      if (index !== undefined) {
        const firstChild = node.children.at(0)?.position;
        const lastChild = node.children.at(-1)?.position;
        if (firstChild && lastChild) {
          metadata.footnotes.push({ position: positionOf({ end: lastChild.end, start: firstChild.start }), id: `[inline${String(index)}` });
        } else {
          metadata.footnoteRefs.push({ position: positionOf(node.position), id: '' });
        }
        // Its content is walked in the footnotes section.
        return;
      }
      break;
    }
    case 'internalLink': {
      const position = positionOf(node.position);
      metadata.links.push({ position, link: node.target, original: text.slice(position.start.offset, position.end.offset), displayText: node.displayText });
      break;
    }
    case 'link': {
      const link = node.url && isLinkPath(node.url) ? decodeLinkPath(node.url) : undefined;
      if (link !== undefined) {
        const position = positionOf(node.position);
        const displayText = childrenText(walk, node.children);
        metadata.links.push({ position, link, original: text.slice(position.start.offset, position.end.offset), displayText: displayText.endsWith('\n') ? displayText.slice(0, -1) : displayText });
      }
      break;
    }
    case 'listItem': {
      const item = listItemOf(walk, node, parent);
      metadata.listItems.push(item);
      if (item.id) {
        metadata.blocks[item.id.toLowerCase()] = { position: item.position, id: item.id };
      }
      break;
    }
    case 'tag': {
      metadata.tags.push({ position: positionOf(node.position), tag: `#${node.name}` });
      break;
    }
    default: {
      break;
    }
  }

  if ('children' in node) {
    for (const child of node.children) {
      walkNode(walk, child, node, isInNote);
    }
  }
}

// The worker deletes each list it found nothing for, and the block ids when there are none; never `frontmatterLinks`.
function withoutEmptyFields(metadata: MutableMetadata): CachedMetadata {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const isEmpty = key === 'blocks' ? Object.keys(metadata.blocks).length === 0 : DELETED_WHEN_EMPTY.has(key) && Array.isArray(value) && value.length === 0;
    if (!isEmpty) {
      result[key] = value;
    }
  }
  return result;
}

/* eslint-enable perfectionist/sort-objects -- The worker's key order ends here. */
