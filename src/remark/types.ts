/**
 * @file
 *
 * The tree the `remark-parse` 8 engine gives: mdast as `remark-parse` 8.0.3 builds it, with the fields Obsidian's
 * edits to its `blockquote`, `list` and `table` tokenizers add, and the nodes of the Obsidian syntax. Those take the
 * names `src/syntax/unified/mdast.ts` gives them where the shapes agree.
 */

/**
 * A block id, `^id`. One that ends a block is attached to it as its {@link RemarkNodeBase.id}.
 */
export interface RemarkBlockId extends RemarkNodeBase<'blockId'> {
  /**
   * The id, without its `^`.
   */
  readonly value: string;
}

/**
 * A blockquote, with the callout Obsidian reads off its first line.
 */
export interface RemarkBlockquote extends RemarkParentBase<'blockquote'> {
  /**
   * The callout its first line opens, or `null`.
   */
  readonly callout: null | RemarkCallout;
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
  readonly lang: null | string;

  /**
   * The rest of the info string, or `null`.
   */
  readonly meta: null | string;

  /**
   * The code.
   */
  readonly value: string;
}

/**
 * A link reference definition.
 */
export interface RemarkDefinition extends RemarkNodeBase<'definition'> {
  /**
   * The label, normalized: whitespace collapsed and lowercased.
   */
  readonly identifier: string;

  /**
   * The label as written.
   */
  readonly label: string;

  /**
   * The title, or `null`.
   */
  readonly title: null | string;

  /**
   * The destination.
   */
  readonly url: string;
}

/**
 * Strikethrough.
 */
export type RemarkDelete = RemarkParentBase<'delete'>;

/**
 * An embed, `![[target|alias]]`.
 */
export type RemarkEmbed = RemarkInternalLinkBase<'embed'>;

/**
 * Emphasis.
 */
export type RemarkEmphasis = RemarkParentBase<'emphasis'>;

/**
 * A footnote definition, `[^label]: content`.
 */
export interface RemarkFootnoteDefinition extends RemarkParentBase<'footnoteDefinition'> {
  /**
   * The label, lowercased.
   */
  readonly identifier: string;

  /**
   * The label as written.
   */
  readonly label: string;
}

/**
 * A footnote reference, `[^label]`, to a definition the document holds.
 */
export interface RemarkFootnoteReference extends RemarkNodeBase<'footnoteReference'> {
  /**
   * The label, lowercased.
   */
  readonly identifier: string;

  /**
   * The label as written.
   */
  readonly label: string;
}

/**
 * A heading.
 */
export interface RemarkHeading extends RemarkParentBase<'heading'> {
  /**
   * The level, 1 to 6.
   */
  readonly depth: number;
}

/**
 * A highlight, `==text==`.
 */
export interface RemarkHighlight extends RemarkParentBase<'highlight'> {
  /**
   * The color a colored square or circle emoji opening the text names, which is no part of the content, or `null`.
   */
  readonly color: null | string;
}

/**
 * Raw HTML, a block or inline.
 */
export interface RemarkHtml extends RemarkNodeBase<'html'> {
  /**
   * The HTML.
   */
  readonly value: string;
}

/**
 * An image.
 */
export interface RemarkImage extends RemarkNodeBase<'image'> {
  /**
   * The description as source text, or `null` when empty.
   */
  readonly alt: null | string;

  /**
   * The title, or `null`.
   */
  readonly title: null | string;

  /**
   * The destination.
   */
  readonly url: string;
}

/**
 * An image reference.
 */
export interface RemarkImageReference extends RemarkNodeBase<'imageReference'> {
  /**
   * The description as source text, or `null` when empty.
   */
  readonly alt: null | string;

  /**
   * The label, normalized.
   */
  readonly identifier: string;

  /**
   * The label as written.
   */
  readonly label: string;

  /**
   * The kind of reference.
   */
  readonly referenceType: RemarkReferenceType;
}

/**
 * Inline code.
 */
export interface RemarkInlineCode extends RemarkNodeBase<'inlineCode'> {
  /**
   * The code.
   */
  readonly value: string;
}

/**
 * An inline footnote, `^[text]`.
 */
export type RemarkInlineFootnote = RemarkParentBase<'inlineFootnote'>;

/**
 * Inline math, `$tex$`, or `$$tex$$` inside a paragraph.
 */
export interface RemarkInlineMath extends RemarkNodeBase<'inlineMath'> {
  /**
   * Whether it is written `$$tex$$`, which shows as a block.
   */
  readonly display: boolean;

  /**
   * The TeX.
   */
  readonly value: string;
}

/**
 * An internal link, `[[target|alias]]`.
 */
export type RemarkInternalLink = RemarkInternalLinkBase<'internalLink'>;

/**
 * The fields of an internal link and an embed.
 */
export interface RemarkInternalLinkBase<Type extends string> extends RemarkNodeBase<Type> {
  /**
   * The text after the first `|`, trimmed, or `null` without one.
   */
  readonly alias: null | string;

  /**
   * The text it shows: the alias, or else the target with each run of `#` made ` > `.
   */
  readonly displayText: string;

  /**
   * The link text before the first `|`, trimmed, with a final backslash taken off, no-break spaces made spaces, and in
   * Unicode normal form C: the path with its subpath.
   */
  readonly target: string;
}

/**
 * A link.
 */
export interface RemarkLink extends RemarkParentBase<'link'> {
  /**
   * The title, or `null`.
   */
  readonly title: null | string;

  /**
   * The destination.
   */
  readonly url: string;
}

/**
 * A link reference.
 */
export interface RemarkLinkReference extends RemarkParentBase<'linkReference'> {
  /**
   * The label, normalized.
   */
  readonly identifier: string;

  /**
   * The label as written.
   */
  readonly label: string;

  /**
   * The kind of reference.
   */
  readonly referenceType: RemarkReferenceType;
}

/**
 * A list.
 */
export interface RemarkList extends RemarkParentBase<'list'> {
  /**
   * Whether it is ordered.
   */
  readonly ordered: boolean;

  /**
   * Whether a blank line separates two of its items.
   */
  readonly spread: boolean;

  /**
   * The number of an ordered list's first item, or `null`.
   */
  readonly start: null | number;
}

/**
 * A list item.
 */
export interface RemarkListItem extends RemarkParentBase<'listItem'> {
  /**
   * For a task, whether its character is not a space; `null` for an item that is no task.
   */
  readonly checked: boolean | null;

  /**
   * For a task, the character between its brackets; `null` for an item that is no task. Obsidian keeps any character.
   */
  readonly checklist: null | string;

  /**
   * Whether a blank line separates two of its blocks.
   */
  readonly spread: boolean;
}

/**
 * A math block, `$$` lines.
 */
export interface RemarkMath extends RemarkNodeBase<'math'> {
  /**
   * The TeX.
   */
  readonly value: string;
}

/**
 * Any node of the tree.
 */
export type RemarkNode =
  | RemarkBlockId
  | RemarkBlockquote
  | RemarkBreak
  | RemarkCode
  | RemarkDefinition
  | RemarkDelete
  | RemarkEmbed
  | RemarkEmphasis
  | RemarkFootnoteDefinition
  | RemarkFootnoteReference
  | RemarkHeading
  | RemarkHighlight
  | RemarkHtml
  | RemarkImage
  | RemarkImageReference
  | RemarkInlineCode
  | RemarkInlineFootnote
  | RemarkInlineMath
  | RemarkInternalLink
  | RemarkLink
  | RemarkLinkReference
  | RemarkList
  | RemarkListItem
  | RemarkMath
  | RemarkObsidianComment
  | RemarkObsidianCommentBlock
  | RemarkParagraph
  | RemarkRoot
  | RemarkStrong
  | RemarkTable
  | RemarkTableCell
  | RemarkTableRow
  | RemarkTag
  | RemarkText
  | RemarkThematicBreak
  | RemarkYaml;

/**
 * The fields every node has.
 */
export interface RemarkNodeBase<Type extends string> {
  /**
   * The block id attached to it: on a block of the document and a list item, the id of a {@link RemarkBlockId} in it.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Parser transforms attach or correct this node field after construction.
  id?: string;

  /**
   * Where it is in the document.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Parser transforms attach or correct this node field after construction.
  position?: RemarkPosition;

  /**
   * The node type.
   */
  readonly type: Type;
}

/**
 * An inline comment, `%%text%%`. The text is tokenized as inline content too, as Obsidian reads it.
 */
export interface RemarkObsidianComment extends RemarkParentBase<'obsidianComment'> {
  /**
   * The text between the delimiters.
   */
  readonly value: string;
}

/**
 * A comment block, from a line opening with `%%` to the next `%%`. The text is tokenized as inline content too, from
 * the block's start, as Obsidian reads it.
 */
export interface RemarkObsidianCommentBlock extends RemarkParentBase<'obsidianCommentBlock'> {
  /**
   * The text between the delimiters.
   */
  readonly value: string;
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
  readonly children: RemarkNode[];
}

/**
 * A point in the document.
 */
export interface RemarkPoint {
  /**
   * The column, from 1.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Position tracking advances this coordinate as source text is consumed.
  column: number;

  /**
   * The line, from 1.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Position tracking advances this coordinate as source text is consumed.
  line: number;

  /**
   * The offset, from 0.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Position tracking advances this coordinate as source text is consumed.
  offset: number;
}

/**
 * Where a node is: its start, its end, and the column each of its later lines starts at.
 */
export interface RemarkPosition {
  /**
   * The end.
   */
  readonly end: RemarkPoint;

  /**
   * The column each line after the first starts at. The root has none.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Position correction replaces indentation after container prefixes are removed.
  indent?: number[];

  /**
   * The start.
   */
  readonly start: RemarkPoint;
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
  readonly align: RemarkTableAlignment[];
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
  readonly padding: RemarkTableCellPadding;
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
 * A tag, `#name`.
 */
export interface RemarkTag extends RemarkNodeBase<'tag'> {
  /**
   * The name, without its `#`.
   */
  readonly name: string;
}

/**
 * Text.
 */
export interface RemarkText extends RemarkNodeBase<'text'> {
  /**
   * The text, character references decoded.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Inline transforms merge text and strip delimiters on existing nodes.
  value: string;
}

/**
 * A thematic break.
 */
export type RemarkThematicBreak = RemarkNodeBase<'thematicBreak'>;

/**
 * Front matter, from a first line `---` to the next line opening with `---`.
 */
export interface RemarkYaml extends RemarkNodeBase<'yaml'> {
  /**
   * The lines between the delimiters.
   */
  readonly value: string;
}
