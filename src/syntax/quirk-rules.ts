/**
 * @file
 *
 * The rules of Obsidian's quirks that every adapter shares, on plain text: each adapter reads the text its own way and
 * asks these rules what Obsidian makes of it.
 */

/**
 * A kind of HTML block Obsidian reads: what its first line starts with, what ends it, and whether it can interrupt a
 * paragraph.
 */
export interface ObsidianHtmlBlockKind {
  /**
   * Whether it can interrupt a paragraph.
   */
  readonly canInterrupt: boolean;

  /**
   * What ends it: a line that holds this, which is the block's last line, or `null` for an empty line, which is not.
   */
  readonly end: null | RegExp;

  /**
   * Whether it is a comment, a processing instruction or another kind of HTML.
   */
  readonly type: 'comment' | 'html' | 'processingInstruction';
}

/**
 * What opens an HTML comment.
 */
export const COMMENT_OPEN = '<!--';

// The tags of the sixth kind of HTML block, as Obsidian reads them: CommonMark 0.31.2's, without `search`, and with `hgroup`,
// `meta`, `pre` and `source`.
const OBSIDIAN_BLOCK_TAGS = [
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'meta',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'pre',
  'section',
  'source',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul'
];
const ATTRIBUTE = String.raw`(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^"'<=>\x60\0- ]+|'[^']*'|"[^"]*"))?)`;
const OPEN_OR_CLOSE_TAG_LINE_RE = new RegExp(String.raw`^(?:<[A-Za-z][\dA-Za-z-]*${ATTRIBUTE}*\s*\/?>|<\/[A-Za-z][\dA-Za-z-]*\s*>)\s*$`, 'u');
const HTML_BLOCK_KINDS: readonly (readonly [RegExp, ObsidianHtmlBlockKind])[] = [
  [/^<(?:script|pre|style)(?=\s|>|$)/iu, { canInterrupt: true, end: /<\/(?:script|pre|style)>/iu, type: 'html' }],
  [/^<!--/u, { canInterrupt: true, end: /-->/u, type: 'comment' }],
  [/^<\?/u, { canInterrupt: true, end: /\?>/u, type: 'processingInstruction' }],
  [/^<![A-Za-z]/u, { canInterrupt: true, end: />/u, type: 'html' }],
  [/^<!\[CDATA\[/u, { canInterrupt: true, end: /\]\]>/u, type: 'html' }],
  [new RegExp(String.raw`^<\/?(?:${OBSIDIAN_BLOCK_TAGS.join('|')})(?=\s|\/?>|$)`, 'iu'), { canInterrupt: true, end: null, type: 'html' }],
  [OPEN_OR_CLOSE_TAG_LINE_RE, { canInterrupt: false, end: null, type: 'html' }]
];

// CommonMark 0.30's comment: text that does not start with `>` or `->`, does not end with `-` and holds no `--`.
const OBSIDIAN_COMMENT_RE = /^<!--(?:-?[^>-])(?:-?[^-])*-->|^<!---->/u;

/**
 * Whether text that starts with `<!--` starts with an HTML comment Obsidian reads.
 *
 * @param text - The text, from its `<`.
 * @returns Whether it opens with a comment.
 */
export function isObsidianHtmlComment(text: string): boolean {
  return OBSIDIAN_COMMENT_RE.test(text);
}

/**
 * The kind of HTML block a line opens, as Obsidian reads it. Its first kind is `<script>`, `<pre>` and `<style>`, with
 * no `<textarea>`; its sixth kind takes Obsidian's own tags; and the sixth and seventh end at an empty line, not at a
 * line of whitespace.
 *
 * @param line - The line, from its first non-whitespace character.
 * @returns The kind, or `null` for a line that opens no HTML block.
 */
export function obsidianHtmlBlockKind(line: string): null | ObsidianHtmlBlockKind {
  return HTML_BLOCK_KINDS.find(([start]) => start.test(line))?.[1] ?? null;
}
