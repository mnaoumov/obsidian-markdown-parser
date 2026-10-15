/**
 * @file
 *
 * The `CachedMetadata` the metadata worker posts for a document, with the names and shapes Obsidian's API gives it.
 * Every object's keys are in the order the worker writes them, so the metadata compares with the worker's as JSON.
 */

/**
 * A block with a block id.
 */
export interface BlockCache extends CacheItem {
  /**
   * The block id, as written.
   */
  readonly id: string;
}

/**
 * The metadata of a document.
 */
export interface CachedMetadata {
  /**
   * The block ids, by lowercased id.
   */
  readonly blocks?: Readonly<Record<string, BlockCache>>;

  /**
   * The embeds: `![[target]]`, and images whose destination is no URL.
   */
  readonly embeds?: readonly EmbedCache[];

  /**
   * The footnote references to a definition, and inline footnotes with no content.
   */
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own name.
  readonly footnoteRefs?: readonly FootnoteReferenceCache[];

  /**
   * The footnote definitions, and the content of inline footnotes.
   */
  readonly footnotes?: readonly FootnoteCache[];

  /**
   * The front matter, parsed as YAML, when it parses to an object.
   */
  readonly frontmatter?: FrontMatterCache;

  /**
   * The internal links in the front matter's string values.
   */
  readonly frontmatterLinks?: readonly FrontmatterLinkCache[];

  /**
   * Where the front matter is, when it parses to an object.
   */
  readonly frontmatterPosition?: Pos;

  /**
   * The headings of the document, outside quotes, lists and footnotes.
   */
  readonly headings?: readonly HeadingCache[];

  /**
   * The internal links: `[[target]]`, and links whose destination is no URL.
   */
  readonly links?: readonly LinkCache[];

  /**
   * The list items.
   */
  readonly listItems?: readonly ListItemCache[];

  /**
   * The link reference definitions.
   */
  readonly referenceLinks?: readonly ReferenceLinkCache[];

  /**
   * The blocks of the document, and the footnotes section after them when it holds a footnote.
   */
  readonly sections?: readonly SectionCache[];

  /**
   * The tags.
   */
  readonly tags?: readonly TagCache[];
}

/**
 * The fields every listed item has.
 */
export interface CacheItem {
  /**
   * Where it is.
   */
  readonly position: Pos;
}

/**
 * An embed.
 */
export type EmbedCache = ReferenceCache;

/**
 * A footnote definition, or the content of an inline footnote.
 */
export interface FootnoteCache extends CacheItem {
  /**
   * The label, lowercased, or `[inline<n>` for the inline footnote numbered `n` from 0.
   */
  readonly id: string;
}

/**
 * A footnote reference.
 */
export interface FootnoteReferenceCache extends CacheItem {
  /**
   * The label, lowercased, or `''` for an inline footnote.
   */
  readonly id: string;
}

/**
 * The front matter, as the YAML parser gives it: an object, or another value of `typeof` `object` that is no array.
 */
export type FrontMatterCache = Readonly<Record<string, unknown>>;

/**
 * An internal link in a string value of the front matter.
 */
export interface FrontmatterLinkCache {
  /**
   * The text it shows.
   */
  readonly displayText: string;

  /**
   * The path of the value, its keys and array indexes joined with `.`.
   */
  readonly key: string;

  /**
   * The link.
   */
  readonly link: string;

  /**
   * The value.
   */
  readonly original: string;
}

/**
 * A heading.
 */
export interface HeadingCache extends CacheItem {
  /**
   * The heading's source, from the start of its content to its end, trimmed.
   */
  readonly heading: string;

  /**
   * The level, 1 to 6.
   */
  readonly level: number;
}

/**
 * An internal link.
 */
export type LinkCache = ReferenceCache;

/**
 * A list item.
 */
export interface ListItemCache extends CacheItem {
  /**
   * The block id of its own content.
   */
  readonly id?: string;

  /**
   * The line of the item its list is nested in, or, for a list of the document, minus the list's first line (`-1` for
   * a list on line 0).
   */
  readonly parent: number;

  /**
   * For a task, the character between its brackets.
   */
  readonly task?: string;
}

/**
 * A point in the document.
 */
export interface Loc {
  /**
   * The column, from 0.
   */
  readonly col: number;

  /**
   * The line, from 0.
   */
  readonly line: number;

  /**
   * The offset, from 0.
   */
  readonly offset: number;
}

/**
 * Where an item is.
 */
export interface Pos {
  /**
   * Its end.
   */
  readonly end: Loc;

  /**
   * Its start.
   */
  readonly start: Loc;
}

/**
 * An internal link or an embed.
 */
export interface ReferenceCache extends CacheItem {
  /**
   * The text it shows.
   */
  readonly displayText: string;

  /**
   * The link: the path with its subpath.
   */
  readonly link: string;

  /**
   * Its source.
   */
  readonly original: string;
}

/**
 * A link reference definition.
 */
export interface ReferenceLinkCache extends CacheItem {
  /**
   * The label as written, or else its normalized form.
   */
  readonly id: string;

  /**
   * The destination.
   */
  readonly link: string;
}

/**
 * A block of the document.
 */
export interface SectionCache extends CacheItem {
  /**
   * The block id attached to it.
   */
  readonly id?: string;

  /**
   * Its type: the mdast type of the block, `callout`, `comment`, or `text` and `element` for the footnotes section.
   */
  readonly type: string;
}

/**
 * A tag.
 */
export interface TagCache extends CacheItem {
  /**
   * The tag, with its `#`.
   */
  readonly tag: string;
}
