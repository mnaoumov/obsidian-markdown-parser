/**
 * @file
 *
 * The remark entry point (`obsidian-markdown-parser/remark`, and `./remark` of the metadata package): the engine
 * Obsidian's reading view and metadata worker parse with.
 *
 * - {@link parseRemark} parses as they do: `remark-parse` 8 with Obsidian's edits and the Obsidian syntax as the worker
 *   reads it, giving its mdast tree, and {@link renderRemarkHtml} renders that tree as `remark-html` does.
 */

export { renderRemarkHtml } from '../remark/html.ts';

export type { ParseRemarkOptions } from '../remark/parse.ts';

export { parseRemark } from '../remark/parse.ts';

export type {
  RemarkBlockId,
  RemarkBlockquote,
  RemarkBreak,
  RemarkCallout,
  RemarkCode,
  RemarkDefinition,
  RemarkDelete,
  RemarkEmbed,
  RemarkEmphasis,
  RemarkFootnoteDefinition,
  RemarkFootnoteReference,
  RemarkHeading,
  RemarkHighlight,
  RemarkHtml,
  RemarkImage,
  RemarkImageReference,
  RemarkInlineCode,
  RemarkInlineFootnote,
  RemarkInlineMath,
  RemarkInternalLink,
  RemarkInternalLinkBase,
  RemarkLink,
  RemarkLinkReference,
  RemarkList,
  RemarkListItem,
  RemarkMath,
  RemarkNode,
  RemarkNodeBase,
  RemarkObsidianComment,
  RemarkObsidianCommentBlock,
  RemarkParagraph,
  RemarkParent,
  RemarkParentBase,
  RemarkPoint,
  RemarkPosition,
  RemarkReferenceType,
  RemarkRoot,
  RemarkStrong,
  RemarkTable,
  RemarkTableAlignment,
  RemarkTableCell,
  RemarkTableCellPadding,
  RemarkTableRow,
  RemarkTag,
  RemarkText,
  RemarkThematicBreak,
  RemarkYaml
} from '../remark/types.ts';
