/**
 * @file
 *
 * The Obsidian syntax as the metadata worker reports it: the fields of its `CachedMetadata` the syntax makes, with each
 * position as its offsets. {@link workerSyntaxOf} reads them off the worker's metadata, and {@link engineSyntaxOf}
 * derives them from the `remark-parse` 8 engine's tree, walking it in the order the worker walks its own, so the two
 * compare exactly.
 *
 * The worker moves the content of inline footnotes out of the tree into a footnotes section it adds after the
 * document's blocks, before it walks it. So what an inline footnote holds is listed after the rest, a section of type
 * `element` (and one of type `text` before it) ends the sections, and that section takes the last block id the
 * footnotes hold. Markdown links and images whose target is no URL are internal links and embeds to the worker too;
 * the syntax's lists keep only the `[[` and `![[` ones. Front matter is compared as its section, as `frontmatterPosition`
 * waits for its YAML to parse.
 */

import type {
  RemarkFootnoteDefinition,
  RemarkList,
  RemarkListItem,
  RemarkNode,
  RemarkPosition,
  RemarkRoot
} from '../remark/types.ts';

/**
 * A block id the worker lists: its key, the id, and the start and end of its block.
 */
export type SyntaxBlock = readonly [key: string, id: string, start: number, end: number];

/**
 * A footnote or a footnote reference: its id, start and end.
 */
export type SyntaxFootnote = readonly [id: string, start: number, end: number];

/**
 * An internal link or an embed: its link, the text it shows, its start and end.
 */
export type SyntaxLink = readonly [link: string, displayText: string, start: number, end: number];

/**
 * A list item: its start and end, its parent as the worker gives it, its task character and its block id.
 */
export type SyntaxListItem = readonly [start: number, end: number, parent: number, task: null | string, id: null | string];

/**
 * A link reference definition: its label, destination, start and end.
 */
export type SyntaxReferenceLink = readonly [id: string, link: string, start: number, end: number];

/**
 * A block of the document: its type, start, end and block id.
 */
export type SyntaxSection = readonly [type: string, start: number, end: number, id: null | string];

/**
 * A tag: the tag with its `#`, its start and end.
 */
export type SyntaxTag = readonly [tag: string, start: number, end: number];

/**
 * The parts of the worker's `CachedMetadata` {@link workerSyntaxOf} reads.
 */
export interface WorkerMetadata {
  /**
   * The block ids, by lowercased id.
   */
  readonly blocks?: Readonly<Record<string, WorkerBlock>>;

  /**
   * The embeds.
   */
  readonly embeds?: readonly WorkerLink[];

  /**
   * The footnote references.
   */
  // eslint-disable-next-line unicorn/name-replacements -- The worker's own name.
  readonly footnoteRefs?: readonly WorkerFootnote[];

  /**
   * The footnote definitions and inline footnotes.
   */
  readonly footnotes?: readonly WorkerFootnote[];

  /**
   * The internal links.
   */
  readonly links?: readonly WorkerLink[];

  /**
   * The list items.
   */
  readonly listItems?: readonly WorkerListItem[];

  /**
   * The link reference definitions.
   */
  readonly referenceLinks?: readonly WorkerReferenceLink[];

  /**
   * The blocks of the document.
   */
  readonly sections?: readonly WorkerSection[];

  /**
   * The tags.
   */
  readonly tags?: readonly WorkerTag[];
}

/**
 * The fields of the worker's metadata the Obsidian syntax makes.
 */
export interface WorkerSyntax {
  /**
   * The block ids, in the order of the worker's `blocks` object.
   */
  readonly blocks: readonly SyntaxBlock[];

  /**
   * The `![[` embeds.
   */
  readonly embeds: readonly SyntaxLink[];

  /**
   * The footnote references.
   */
  readonly footnoteReferences: readonly SyntaxFootnote[];

  /**
   * The footnote definitions and inline footnotes.
   */
  readonly footnotes: readonly SyntaxFootnote[];

  /**
   * The `[[` internal links.
   */
  readonly links: readonly SyntaxLink[];

  /**
   * The list items.
   */
  readonly listItems: readonly SyntaxListItem[];

  /**
   * The link reference definitions.
   */
  readonly referenceLinks: readonly SyntaxReferenceLink[];

  /**
   * The blocks of the document.
   */
  readonly sections: readonly SyntaxSection[];

  /**
   * The tags.
   */
  readonly tags: readonly SyntaxTag[];
}

/**
 * One document of the worker oracle, with the syntax the worker read in it.
 */
export interface WorkerSyntaxDocument {
  /**
   * The piece set, or `conformance` for a document of the conformance corpus.
   */
  readonly set: string;

  /**
   * The syntax the worker read.
   */
  readonly syntax: WorkerSyntax;

  /**
   * The document.
   */
  readonly text: string;
}

/**
 * The worker oracle file `scripts/worker-oracle.ts` writes.
 */
export interface WorkerSyntaxOracleFile {
  /**
   * The documents.
   */
  readonly docs: readonly WorkerSyntaxDocument[];

  /**
   * How the oracle was read.
   */
  readonly meta: WorkerSyntaxOracleMeta;
}

/**
 * How the worker oracle was read.
 */
export interface WorkerSyntaxOracleMeta {
  /**
   * The Obsidian version whose worker was run.
   */
  readonly appVersion: string;

  /**
   * How many documents were built from each piece set.
   */
  readonly perSet: number;

  /**
   * The corpus seed.
   */
  readonly seed: number;
}

interface FootnoteNote {
  readonly children: readonly RemarkNode[];
  readonly isInline: boolean;
}

interface FootnoteNumbering {
  readonly inlineIndexes: ReadonlyMap<RemarkNode, number>;
  readonly notes: readonly FootnoteNote[];
}

interface Walk {
  readonly embeds: SyntaxLink[];
  readonly footnoteReferences: SyntaxFootnote[];
  readonly footnotes: SyntaxFootnote[];
  readonly inlineIndexes: ReadonlyMap<RemarkNode, number>;
  readonly links: SyntaxLink[];
  readonly listItems: SyntaxListItem[];
  readonly listParents: Map<RemarkList, RemarkListItem>;
  readonly referenceLinks: SyntaxReferenceLink[];
  readonly tags: SyntaxTag[];
}

interface WorkerBlock {
  readonly id: string;
  readonly position: WorkerPosition;
}

interface WorkerFootnote {
  readonly id: string;
  readonly position: WorkerPosition;
}

interface WorkerLink {
  readonly displayText?: string;
  readonly link: string;
  readonly original: string;
  readonly position: WorkerPosition;
}

interface WorkerListItem {
  readonly id?: string;
  readonly parent: number;
  readonly position: WorkerPosition;
  readonly task?: string;
}

interface WorkerPoint {
  readonly offset: number;
}

interface WorkerPosition {
  readonly end: WorkerPoint;
  readonly start: WorkerPoint;
}

interface WorkerReferenceLink {
  readonly id: string;
  readonly link: string;
  readonly position: WorkerPosition;
}

interface WorkerSection {
  readonly id?: string;
  readonly position: WorkerPosition;
  readonly type: string;
}

interface WorkerTag {
  readonly position: WorkerPosition;
  readonly tag: string;
}

// A block id the engine has taken out of the tree, after the last block of the document.
const TRAILING_BLOCK_ID_RE = /^\s*\^[a-zA-Z0-9-]+/u;

/**
 * The syntax fields of the engine's tree, as the worker would report them for the same document.
 *
 * @param markdown - The document.
 * @param root - The engine's tree of it.
 * @returns The fields.
 */
export function engineSyntaxOf(markdown: string, root: RemarkRoot): WorkerSyntax {
  const { inlineIndexes, notes } = numberFootnotes(root);
  const blocks: Record<string, SyntaxBlock> = {};
  const sections: SyntaxSection[] = [];

  for (const child of root.children) {
    const [start, end] = offsets(child.position);
    sections.push([sectionType(child), start, end, child.id ?? null]);
    if (child.id) {
      blocks[child.id.toLowerCase()] = [child.id.toLowerCase(), child.id, start, end];
    }
  }

  if (notes.length > 0) {
    const sectionOffset = footnoteSectionOffset(markdown, root);
    let id: string | undefined;
    for (const note of notes) {
      for (const child of note.children) {
        id = lastBlockId(child, !note.isInline) ?? id;
      }
    }
    sections.push(['text', sectionOffset, sectionOffset, null], ['element', sectionOffset, sectionOffset, id ?? null]);
    if (id) {
      blocks[id.toLowerCase()] = [id.toLowerCase(), id, sectionOffset, sectionOffset];
    }
  }

  const walk: Walk = {
    embeds: [],
    footnoteReferences: [],
    footnotes: [],
    inlineIndexes,
    links: [],
    listItems: [],
    listParents: new Map(),
    referenceLinks: [],
    tags: []
  };

  walkNode(walk, root, root, blocks, false);
  for (const note of notes) {
    if (note.isInline) {
      for (const child of note.children) {
        walkNode(walk, child, root, blocks, true);
      }
    }
  }

  return {
    blocks: Object.values(blocks),
    embeds: walk.embeds,
    footnoteReferences: walk.footnoteReferences,
    footnotes: walk.footnotes,
    links: walk.links,
    listItems: walk.listItems,
    referenceLinks: walk.referenceLinks,
    sections,
    tags: walk.tags
  };
}

/**
 * The syntax fields of the worker's metadata.
 *
 * @param metadata - The worker's metadata.
 * @returns The fields.
 */
export function workerSyntaxOf(metadata: WorkerMetadata): WorkerSyntax {
  return {
    blocks: Object.entries(metadata.blocks ?? {}).map(([key, block]) => [key, block.id, block.position.start.offset, block.position.end.offset]),
    embeds: (metadata.embeds ?? []).filter((item) => isWikilink(item, '![[')).map((item) => syntaxLinkOf(item)),
    footnoteReferences: (metadata.footnoteRefs ?? []).map((item) => syntaxFootnoteOf(item)),
    footnotes: (metadata.footnotes ?? []).map((item) => syntaxFootnoteOf(item)),
    links: (metadata.links ?? []).filter((item) => isWikilink(item, '[[')).map((item) => syntaxLinkOf(item)),
    listItems: (metadata.listItems ?? []).map((item) => [item.position.start.offset, item.position.end.offset, item.parent, item.task ?? null, item.id ?? null]),
    referenceLinks: (metadata.referenceLinks ?? []).map((item) => [item.id, item.link, item.position.start.offset, item.position.end.offset]),
    sections: (metadata.sections ?? []).map((item) => [item.type, item.position.start.offset, item.position.end.offset, item.id ?? null]),
    tags: (metadata.tags ?? []).map((item) => [item.tag, item.position.start.offset, item.position.end.offset])
  };
}

// The worker puts its footnotes section where the last block of the document ends, a removed block id included.
function footnoteSectionOffset(markdown: string, root: RemarkRoot): number {
  let end = root.children.at(-1)?.position?.end.offset ?? 0;
  for (let match = TRAILING_BLOCK_ID_RE.exec(markdown.slice(end)); match; match = TRAILING_BLOCK_ID_RE.exec(markdown.slice(end))) {
    end += match[0].length;
  }
  return end;
}

// A markdown link or image ends with its `)`, so one whose text opens with `[[` is told from an internal link.
function isWikilink(item: WorkerLink, opening: string): boolean {
  return item.original.startsWith(opening) && item.original.endsWith(']]');
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

function listItemOf(walk: Walk, item: RemarkListItem, parent: RemarkNode): SyntaxListItem {
  const [start] = offsets(item.position);
  let [, end] = offsets(item.position);
  /*
   * The worker puts a task's checkbox, a node at the item's position, first in the item when no paragraph opens it, so
   * it counts as a child here, and as the last one that is no list it ends where the item ends.
   */
  const hasCheckbox = typeof item.checked === 'boolean' && item.children.at(0)?.type !== 'paragraph';

  if (item.children.length + (hasCheckbox ? 1 : 0) > 1) {
    for (const child of item.children.toReversed()) {
      if (child.type !== 'list') {
        [, end] = offsets(child.position);
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

  return [start, end, parentLine, item.checklist, item.id ?? null];
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

  visitOutsideInlineFootnotes(root, (node) => {
    if (node.type === 'footnoteDefinition') {
      definitions.set(node.identifier, node);
    }
  });

  visitOutsideInlineFootnotes(root, (node) => {
    if (node.type === 'inlineFootnote') {
      inlineIndexes.set(node, notes.length);
      notes.push({ children: node.children, isInline: true });
    } else if (node.type === 'footnoteReference' && !numbered.has(node.identifier)) {
      numbered.add(node.identifier);
      notes.push({ children: definitions.get(node.identifier)?.children ?? [], isInline: false });
    }
  });

  return { inlineIndexes, notes };
}

function offsets(position: RemarkPosition | undefined): [start: number, end: number] {
  return [position?.start.offset ?? 0, position?.end.offset ?? 0];
}

function sectionType(node: RemarkNode): string {
  if (node.type === 'blockquote' && node.callout) {
    return 'callout';
  }
  return node.type === 'obsidianCommentBlock' ? 'comment' : node.type;
}

function syntaxFootnoteOf(item: WorkerFootnote): SyntaxFootnote {
  return [item.id, item.position.start.offset, item.position.end.offset];
}

function syntaxLinkOf(item: WorkerLink): SyntaxLink {
  return [item.link, item.displayText ?? '', item.position.start.offset, item.position.end.offset];
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
function walkNode(walk: Walk, node: RemarkNode, parent: RemarkNode, blocks: Record<string, SyntaxBlock>, isInNote: boolean): void {
  const [start, end] = offsets(node.position);

  switch (node.type) {
    case 'definition': {
      if (node.url) {
        walk.referenceLinks.push([node.label || node.identifier, node.url, start, end]);
      }
      break;
    }
    case 'embed': {
      walk.embeds.push([node.target, node.displayText, start, end]);
      break;
    }
    case 'footnoteDefinition': {
      walk.footnotes.push([node.identifier, start, end]);
      break;
    }
    case 'footnoteReference': {
      if (!isInNote) {
        walk.footnoteReferences.push([node.identifier, start, end]);
      }
      break;
    }
    case 'inlineFootnote': {
      const index = walk.inlineIndexes.get(node);
      if (index !== undefined) {
        const first = node.children.at(0)?.position?.start.offset;
        const last = node.children.at(-1)?.position?.end.offset;
        if (first === undefined || last === undefined) {
          walk.footnoteReferences.push(['', start, end]);
        } else {
          walk.footnotes.push([`[inline${String(index)}`, first, last]);
        }
        // Its content is walked in the footnotes section.
        return;
      }
      break;
    }
    case 'internalLink': {
      walk.links.push([node.target, node.displayText, start, end]);
      break;
    }
    case 'listItem': {
      const item = listItemOf(walk, node, parent);
      walk.listItems.push(item);
      if (node.id) {
        blocks[node.id.toLowerCase()] = [node.id.toLowerCase(), node.id, item[0], item[1]];
      }
      break;
    }
    case 'tag': {
      walk.tags.push([`#${node.name}`, start, end]);
      break;
    }
    default: {
      break;
    }
  }

  if ('children' in node) {
    for (const child of node.children) {
      walkNode(walk, child, node, blocks, isInNote);
    }
  }
}
