/**
 * @file
 *
 * The tree the `remark-parse` 8 engine gives: mdast as `remark-parse` 8.0.3 builds it, with the fields Obsidian's
 * edits to its `blockquote`, `list` and `table` tokenizers add.
 */

/**
 * A blockquote, with the callout Obsidian reads off its first line.
 */
export interface RemarkBlockquote extends RemarkParentBase<'blockquote'> {
  /**
   * The callout its first line opens, or `null`.
   */
  callout: null | RemarkCallout;
}

/**
 * A hard line break.
 */
export type RemarkBreak = RemarkNodeBase<'break'>;

/**
 * The callout header `[!type|data]+` Obsidian reads off a blockquote's first line.
 */
export interface RemarkCallout {
  /**
   * The text after the first `|` inside the brackets, or `''`.
   */
  readonly data: string;

  /**
   * The fold sign, `+`, `-` or `''`.
   */
  readonly fold: string;

  /**
   * The type, trimmed, lowercased and with each run of whitespace made a `-`.
   */
  readonly type: string;
}

/**
 * Fenced or indented code.
 */
export interface RemarkCode extends RemarkNodeBase<'code'> {
  /**
   * The first word of the info string, or `null`.
   */
  lang: null | string;

  /**
   * The rest of the info string, or `null`.
   */
  meta: null | string;

  /**
   * The code.
   */
  value: string;
}

/**
 * A link reference definition.
 */
export interface RemarkDefinition extends RemarkNodeBase<'definition'> {
  /**
   * The label, normalized: whitespace collapsed and lowercased.
   */
  identifier: string;

  /**
   * The label as written.
   */
  label: string;

  /**
   * The title, or `null`.
   */
  title: null | string;

  /**
   * The destination.
   */
  url: string;
}

/**
 * Strikethrough.
 */
export type RemarkDelete = RemarkParentBase<'delete'>;

/**
 * Emphasis.
 */
export type RemarkEmphasis = RemarkParentBase<'emphasis'>;

/**
 * A heading.
 */
export interface RemarkHeading extends RemarkParentBase<'heading'> {
  /**
   * The level, 1 to 6.
   */
  depth: number;
}

/**
 * Raw HTML, a block or inline.
 */
export interface RemarkHtml extends RemarkNodeBase<'html'> {
  /**
   * The HTML.
   */
  value: string;
}

/**
 * An image.
 */
export interface RemarkImage extends RemarkNodeBase<'image'> {
  /**
   * The description as source text, or `null` when empty.
   */
  alt: null | string;

  /**
   * The title, or `null`.
   */
  title: null | string;

  /**
   * The destination.
   */
  url: string;
}

/**
 * An image reference.
 */
export interface RemarkImageReference extends RemarkNodeBase<'imageReference'> {
  /**
   * The description as source text, or `null` when empty.
   */
  alt: null | string;

  /**
   * The label, normalized.
   */
  identifier: string;

  /**
   * The label as written.
   */
  label: string;

  /**
   * The kind of reference.
   */
  referenceType: RemarkReferenceType;
}

/**
 * Inline code.
 */
export interface RemarkInlineCode extends RemarkNodeBase<'inlineCode'> {
  /**
   * The code.
   */
  value: string;
}

/**
 * A link.
 */
export interface RemarkLink extends RemarkParentBase<'link'> {
  /**
   * The title, or `null`.
   */
  title: null | string;

  /**
   * The destination.
   */
  url: string;
}

/**
 * A link reference.
 */
export interface RemarkLinkReference extends RemarkParentBase<'linkReference'> {
  /**
   * The label, normalized.
   */
  identifier: string;

  /**
   * The label as written.
   */
  label: string;

  /**
   * The kind of reference.
   */
  referenceType: RemarkReferenceType;
}

/**
 * A list.
 */
export interface RemarkList extends RemarkParentBase<'list'> {
  /**
   * Whether it is ordered.
   */
  ordered: boolean;

  /**
   * Whether a blank line separates two of its items.
   */
  spread: boolean;

  /**
   * The number of an ordered list's first item, or `null`.
   */
  start: null | number;
}

/**
 * A list item.
 */
export interface RemarkListItem extends RemarkParentBase<'listItem'> {
  /**
   * For a task, whether its character is not a space; `null` for an item that is no task.
   */
  checked: boolean | null;

  /**
   * For a task, the character between its brackets; `null` for an item that is no task. Obsidian keeps any character.
   */
  checklist: null | string;

  /**
   * Whether a blank line separates two of its blocks.
   */
  spread: boolean;
}

/**
 * Any node of the tree.
 */
export type RemarkNode =
  | RemarkBlockquote
  | RemarkBreak
  | RemarkCode
  | RemarkDefinition
  | RemarkDelete
  | RemarkEmphasis
  | RemarkHeading
  | RemarkHtml
  | RemarkImage
  | RemarkImageReference
  | RemarkInlineCode
  | RemarkLink
  | RemarkLinkReference
  | RemarkList
  | RemarkListItem
  | RemarkParagraph
  | RemarkRoot
  | RemarkStrong
  | RemarkTable
  | RemarkTableCell
  | RemarkTableRow
  | RemarkText
  | RemarkThematicBreak;

/**
 * The fields every node has.
 */
export interface RemarkNodeBase<Type extends string> {
  /**
   * Where it is in the document.
   */
  position?: RemarkPosition;

  /**
   * The node type.
   */
  type: Type;
}

/**
 * A paragraph.
 */
export type RemarkParagraph = RemarkParentBase<'paragraph'>;

/**
 * Any node with children.
 */
export type RemarkParent = Extract<RemarkNode, RemarkParentBase<string>>;

/**
 * The fields every node with children has.
 */
export interface RemarkParentBase<Type extends string> extends RemarkNodeBase<Type> {
  /**
   * The children.
   */
  children: RemarkNode[];
}

/**
 * A point in the document.
 */
export interface RemarkPoint {
  /**
   * The column, from 1.
   */
  column: number;

  /**
   * The line, from 1.
   */
  line: number;

  /**
   * The offset, from 0.
   */
  offset: number;
}

/**
 * Where a node is: its start, its end, and the column each of its later lines starts at.
 */
export interface RemarkPosition {
  /**
   * The end.
   */
  end: RemarkPoint;

  /**
   * The column each line after the first starts at. The root has none.
   */
  indent?: number[];

  /**
   * The start.
   */
  start: RemarkPoint;
}

/**
 * How a reference names its definition: `[a][b]`, `[a][]` or `[a]`.
 */
export type RemarkReferenceType = 'collapsed' | 'full' | 'shortcut';

/**
 * The document.
 */
export type RemarkRoot = RemarkParentBase<'root'>;

/**
 * Strong emphasis.
 */
export type RemarkStrong = RemarkParentBase<'strong'>;

/**
 * A table.
 */
export interface RemarkTable extends RemarkParentBase<'table'> {
  /**
   * The alignment of each column.
   */
  align: RemarkTableAlignment[];
}

/**
 * A table column's alignment.
 */
export type RemarkTableAlignment = 'center' | 'left' | 'right' | null;

/**
 * A table cell, with the whitespace Obsidian's table tokenizer measures around its content.
 */
export interface RemarkTableCell extends RemarkParentBase<'tableCell'> {
  /**
   * The spaces and tabs before and after its content.
   */
  padding: RemarkTableCellPadding;
}

/**
 * The spaces and tabs around a table cell's content.
 */
export interface RemarkTableCellPadding {
  /**
   * After the content.
   */
  readonly end: number;

  /**
   * Before the content.
   */
  readonly start: number;
}

/**
 * A table row.
 */
export type RemarkTableRow = RemarkParentBase<'tableRow'>;

/**
 * Text.
 */
export interface RemarkText extends RemarkNodeBase<'text'> {
  /**
   * The text, character references decoded.
   */
  value: string;
}

/**
 * A thematic break.
 */
export type RemarkThematicBreak = RemarkNodeBase<'thematicBreak'>;
