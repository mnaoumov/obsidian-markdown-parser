/**
 * @file
 *
 * The families the self-check judges' findings fall into, each with its verdict.
 */

/**
 * A family of self-check findings.
 */
export interface SelfCheckFamily {
  /**
   * The forum topic that reports or explains it, or `null`.
   */
  readonly forumUrl: null | string;

  /**
   * A stable identifier.
   */
  readonly id: string;

  /**
   * The verdict.
   */
  readonly kind: SelfCheckFamilyKind;

  /**
   * Whether a finding, by its key and reduced note, belongs here.
   */
  readonly matches: (key: string, markdown: string) => boolean;

  /**
   * What the family is, and why its verdict.
   */
  readonly note: string;
}

/**
 * A family's verdict: `bug` for one reported or to report, `known` for one an open forum topic or the team already
 * has, `expected` for behaviour by design or documented, `minor` for one only notes nobody writes show, `quirk` for a
 * deviation of `remark-parse` 8 from the spec that the spec suites already measure (`docs/spec-suites.md`), and `judge`
 * for a limit of the judge itself, where Obsidian is right or is not judged.
 */
export type SelfCheckFamilyKind = 'bug' | 'expected' | 'judge' | 'known' | 'minor' | 'quirk';

const FORUM = 'https://forum.obsidian.md/t/';

// A line that opens a `%%` block comment: the mark first on the line, after any quote, list and task marks or a footnote label.
const COMMENT_LINE_PATTERN = /^(?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t]|\[.\][ \t]|\[\^[^\]]+\]:[ \t]*)*%%/mu;
// A callout with a lazy line after its title: one opened in a list item and continued with no list indentation, or one
// continued with no `>`.
const LAZY_CALLOUT_PATTERN = /^(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?>[ \t]*\[!.*\n(?![ \t])|^(?:>[ \t]*)+\[!.*\n(?![ \t>])/mu;
const UNCLOSED_FENCE_PATTERN = /^(?:```|~~~|\$\$)/u;
const TABLE_ROW_PATTERN = /^\|.*\|[ \t]*$/mu;
// A task item whose text opens on what would open a block: a heading, quote, list item, fence, thematic break, table row or definition.
const TASK_BLOCK_BODY_PATTERN = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[.\][ \t]+(?:#{1,6}(?:[ \t]|$)|>|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|```|\*\*\*|\||\[[^\]]*\]:)/mu;
// A task mark of a character the GFM spec does not read as a status, or a task mark with no text after it.
const TASK_STATUS_PATTERN = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[^ xX]\]/mu;
const EMPTY_TASK_PATTERN = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[.\][ \t]*$/mu;
const SETEXT_UNDERLINE_PATTERN = /^[ \t>]*(?:=+|-+)[ \t]*$/mu;
const TABLE_DELIMITER_PATTERN = /^[ \t>]*[|:-][ \t|:-]*$/mu;
const LINK_DEFINITION_PATTERN = /\[[^\]]*\]:/u;
// A key where the references close a container, a code block or a paragraph that the engine goes on with.
const CONTINUATION_KEY_PATTERN = /-vs-\/(?:blockquote|code|li|p|pre)$|^engines:obsidian:text-vs-\/\w+$/u;
const OBSIDIAN_ENGINE_KEY = 'engines:obsidian:';
// A key where the engine and the references part on text, emphasis or strong emphasis alone.
const EMPHASIS_KEY_PATTERN = /^engines:obsidian:(?:em|strong|text)-vs-(?:em|strong|text)$/u;
// A `[` after a closing bracket, with no `]` after it.
const DROPPED_BRACKET_PATTERN = /\]\[[^\]]*$/u;
const AUTOLINK_AFTER_TEXT_PATTERN = /[^\s*_~(]https?:\/\//u;
// A quote line, and a line after it with no `>`; or a quote opened on a list item's line, and a `>` line after it with
// no list indentation.
const LAZY_AFTER_QUOTE_PATTERN = /^>.*\n(?!>)|^(?:[-*+]|\d{1,9}[.)])[ \t]+>.*\n>/mu;

function judgeOf(key: string): string {
  return key.split(':', 1)[0] ?? '';
}

// The engine differential's families: the two from the spec alone first, then what `remark-parse` 8 is known to read otherwise.
const ENGINE_FAMILIES: readonly SelfCheckFamily[] = [
  {
    forumUrl: null,
    id: 'task-body-blocks',
    kind: 'known',
    matches: (key, markdown) => key.startsWith(OBSIDIAN_ENGINE_KEY) && TASK_BLOCK_BODY_PATTERN.test(markdown),
    note: 'A task item\'s text after its mark is read again as blocks, where the GFM spec reads it as the start of a paragraph: `- [ ] # H` holds a heading, `- [ ] > q` a quote, `- [ ] [r]: u` a definition. The team has it already.'
  },
  {
    forumUrl: null,
    id: 'task-status-any-character',
    kind: 'expected',
    matches: (key, markdown) => key.startsWith(`${OBSIDIAN_ENGINE_KEY}li [`) && TASK_STATUS_PATTERN.test(markdown),
    note: 'Any character between a task\'s brackets makes a task, checked unless it is a space: `- [?] a` is a checked task, where the GFM spec reads only a space, `x` or `X` as a status. By design: themes and plugins give the other characters their own looks.'
  },
  {
    forumUrl: null,
    id: 'task-without-text',
    kind: 'minor',
    matches: (key, markdown) => key.startsWith(`${OBSIDIAN_ENGINE_KEY}li [`) && EMPTY_TASK_PATTERN.test(markdown),
    note: 'A task mark with no text after it, `- [ ]`, makes a task; the references read the mark as text, the GFM rule needing white space after it, and the spec has no example of either reading.'
  },
  {
    forumUrl: null,
    id: 'engine-table',
    kind: 'quirk',
    matches: (key, markdown) => key.startsWith(OBSIDIAN_ENGINE_KEY) && markdown.includes('|') && TABLE_DELIMITER_PATTERN.test(markdown),
    note: 'A table where GFM reads none, or one that ends where GFM goes on: a delimiter row with a space in a cell or on a lazy line, a table interrupting a list item\'s text, and a row with no pipe after a table, which GFM reads as a row. `remark-parse` 8 with Obsidian\'s table edits, the `gfmTable` quirk.'
  },
  {
    forumUrl: null,
    id: 'engine-setext-heading',
    kind: 'quirk',
    matches: (key, markdown) => key.startsWith(OBSIDIAN_ENGINE_KEY) && SETEXT_UNDERLINE_PATTERN.test(markdown) && /h[12]|\/p|text-vs-text/u.test(key),
    note: 'A setext heading where CommonMark reads a paragraph, or the other way: `remark-parse` 8 underlines only a one-line paragraph, and takes a lazy `=` or `-` line in a quote or list item as the underline. The `setextHeading` quirk.'
  },
  {
    forumUrl: null,
    id: 'engine-link-definition',
    kind: 'quirk',
    matches: (key, markdown) => key.startsWith(OBSIDIAN_ENGINE_KEY) && LINK_DEFINITION_PATTERN.test(markdown),
    note: 'A link reference definition CommonMark rejects, or one whose title it reads otherwise: a blank label, an unescaped `[` in it, no destination, an unbalanced `)`, or a title opened and never closed. The `linkDefinition` quirk.'
  },
  {
    forumUrl: `${FORUM}119764`,
    id: 'open-reference-bracket-dropped',
    kind: 'bug',
    matches: (key, markdown) => key === `${OBSIDIAN_ENGINE_KEY}text-vs-text` && DROPPED_BRACKET_PATTERN.test(markdown),
    note: 'A `[` straight after a bracketed text, never closed, is not shown: `[x][` reads `[x]`, `a [][` reads `a []`, `[x][z` reads `[x]z`. Every reference shows it, and the source keeps it. Reading view on 1.14.5 and 1.15.0 drops it too: `remark-parse` 8\'s `reference` tokenizer eats the `[` with the shortcut reference when no `]` closes it. The `[foo][ref[]` sample of the topic is the same loss.'
  },
  {
    forumUrl: null,
    id: 'engine-autolink-literal',
    kind: 'quirk',
    matches: (key, markdown) => key.startsWith(OBSIDIAN_ENGINE_KEY) && AUTOLINK_AFTER_TEXT_PATTERN.test(markdown),
    note: 'A bare URL straight after a character that is no space: GFM\'s autolink literal links `]http://m` and leaves `shttp://x.c`, `remark-parse` 8 the other way round. The `autolink` quirk.'
  },
  {
    forumUrl: null,
    id: 'engine-container-continuation',
    kind: 'quirk',
    matches: (key, markdown) => CONTINUATION_KEY_PATTERN.test(key) || /^engines:obsidian:(?:(?:blockquote|h\d|ol|ul)-vs-\/|\/(?:blockquote|li|p)-vs-(?:a|text)$)/u.test(key) || (key === `${OBSIDIAN_ENGINE_KEY}text-vs-text` && LAZY_AFTER_QUOTE_PATTERN.test(markdown)),
    note: 'A list item or quote goes on where CommonMark ends it: a line with no indentation after an empty list item or a closed fence, a lazy line after a quote whose last block is no paragraph, a `>` line that goes on with a quote opened in a list item, an indented line after a quoted list item read as code, and an unclosed fence that takes the lazy lines after it. The `listItem` and `emptyListItem` quirks, and `remark-parse` 8\'s lazy lines.'
  },
  {
    forumUrl: `${FORUM}26871`,
    id: 'engine-emphasis-pairing',
    kind: 'known',
    matches: (key, markdown) => EMPHASIS_KEY_PATTERN.test(key) && /[*_]/u.test(markdown),
    note: 'A `*` or `_` run paired otherwise than CommonMark pairs it: `*italic **bold***` is no emphasis around strong emphasis but a `*` and strong emphasis ending on a `*`, CommonMark example 414. Reading view does the same, `remark-parse` 8\'s inline rules; the open topic has it, tagged upstream-bug, and t/82094, this very note, was closed as its duplicate.'
  },
  {
    forumUrl: null,
    id: 'references-disagree',
    kind: 'judge',
    matches: (key) => key.startsWith('engines:references:'),
    note: 'The reference engines read the note differently, so it is a spec question and the engine is not judged on it. `micromark` and `markdown-it` part on an ordered list not numbered 1 that opens a quote straight after a paragraph, and on a definition in a quote or list item followed by a lazy line.'
  }
];

/**
 * The families, the first that matches winning.
 */
export const SELF_CHECK_FAMILIES: readonly SelfCheckFamily[] = [
  ...ENGINE_FAMILIES,
  {
    forumUrl: `${FORUM}119821`,
    id: 'comment-line-offset',
    kind: 'bug',
    matches: (key, markdown) => ['offset', 'padding', 'rename', 'renameFile'].includes(judgeOf(key)) && key !== 'offset:listItems' && COMMENT_LINE_PATTERN.test(markdown),
    note: 'On a line that opens a `%%` block comment, every position the cache gives is 2 characters early, as if the `%%` were not there: a link\'s `original` is cut, and renaming its target rewrites the wrong characters.'
  },
  {
    forumUrl: null,
    id: 'lazy-callout-negative-end',
    kind: 'bug',
    matches: (key, markdown) => (judgeOf(key) === 'shift' || ['offset:listItems', 'offset:referenceLinks'].includes(key)) && LAZY_CALLOUT_PATTERN.test(markdown),
    note: 'A list item or definition on a callout\'s line that continues a list item with no indentation ends at offset -1: its start is placed, its end offset is not.'
  },
  {
    forumUrl: `${FORUM}119821`,
    id: 'lazy-callout-offset',
    kind: 'bug',
    matches: (key, markdown) => ['fidelity', 'offset', 'rename'].includes(judgeOf(key)) && LAZY_CALLOUT_PATTERN.test(markdown),
    note: 'On a callout\'s lazy line, a `>` line that continues a list item with no indentation or a line with no `>`, every position is 1 character late; renaming a link there corrupts the line.'
  },
  {
    forumUrl: `${FORUM}119822`,
    id: 'footnote-scan-window',
    kind: 'bug',
    matches: (key, markdown) => judgeOf(key) === 'padding' && markdown.includes('[^'),
    note: 'A line ends a footnote definition only when its whole marker lies in the first 1,024 characters of the definition, so a long definition swallows the heading, list or definition after it.'
  },
  {
    forumUrl: null,
    id: 'bracket-run-link',
    kind: 'minor',
    matches: (key, markdown) => judgeOf(key) === 'rename' && /\[\[\[|\[\[\]\(/u.test(markdown),
    note: 'A link right after a stray `[` takes the bracket into its target, so a rename that writes `[[renamed]]` there reads back as a link to `[renamed`: a link to a note named `[` nobody writes.'
  },
  {
    forumUrl: `${FORUM}119823`,
    id: 'definition-title-across-blank-line',
    kind: 'bug',
    matches: (key, markdown) => ['conservation', 'independence'].includes(judgeOf(key)) && /^ {0,3}\[[^\]]+\]:.*\n[ \t]*\n/mu.test(markdown),
    note: 'A link reference definition takes its title or destination from after a blank line, so a quoted or parenthesized paragraph after it vanishes from the reading view.'
  },
  {
    forumUrl: `${FORUM}119824`,
    id: 'undefined-footnote-brackets',
    kind: 'bug',
    matches: (key, markdown) => (judgeOf(key) === 'fidelity' || key === 'render:heading-text') && /\[\^[^\]]*\]/u.test(markdown) && !markdown.includes(']:'),
    note: 'A footnote reference with no definition shows its label without its `[^` and `]` in the reading view, where every other tool shows it as typed.'
  },
  {
    forumUrl: `${FORUM}119825`,
    id: 'comment-footnote-backlink',
    kind: 'bug',
    matches: (key) => key === 'render:footnoteRefs-only-in-cache-in-comment',
    note: 'A footnote reference inside a `%%` comment counts as a reference: the footnote gets a second back link to a reference nobody can see.'
  },
  {
    forumUrl: `${FORUM}119826`,
    id: 'escaped-closer',
    kind: 'bug',
    matches: (key) => ['escape:embed-closer', 'escape:highlight-closer', 'escape:internalLink-closer'].includes(key),
    note: 'A backslash before a closing `==` or `]]` does not escape it, though it escapes an opening `==` and a closing `$`.'
  },
  {
    forumUrl: null,
    id: 'escaped-closer-other',
    kind: 'minor',
    matches: (key) => judgeOf(key) === 'escape',
    note: 'The same as the escaped closer, on the closing `%%` of a comment and the closing `~~` of a strikethrough, which the topic does not name.'
  },
  {
    forumUrl: `${FORUM}59897`,
    id: 'container-heading-uncached',
    kind: 'known',
    matches: (key) => key === 'render:headings-only-in-render',
    note: 'A heading in a quote, a callout or a list item is shown as a heading and left out of the cache, so the outline and links to it miss it (also t/35788).'
  },
  {
    forumUrl: null,
    id: 'heading-raw-source',
    kind: 'known',
    matches: (key) => key === 'render:heading-text',
    note: 'The cache\'s heading text is its source, markup included, where the reading view shows the rendered text: the raw-headings question the team has not decided.'
  },
  {
    forumUrl: null,
    id: 'colored-highlight-residue',
    kind: 'minor',
    matches: (key) => key === 'render:highlight-color-residue',
    note: 'A colored highlight strips its emoji marker and keeps the space after it, or a variation selector, at the start of the shown text: invisible in most themes.'
  },
  {
    forumUrl: `${FORUM}119752`,
    id: 'unclosed-comment-swallows',
    kind: 'expected',
    matches: (key, markdown) => judgeOf(key) === 'independence' && COMMENT_LINE_PATTERN.test(markdown),
    note: 'A line that starts with `%%` opens a block comment, and one never closed hides the rest of the note: documented behaviour.'
  },
  {
    forumUrl: null,
    id: 'unclosed-fence-swallows',
    kind: 'expected',
    matches: (key, markdown) => judgeOf(key) === 'independence' && UNCLOSED_FENCE_PATTERN.test(markdown),
    note: 'A code fence or a `$$` math block never closed runs to the end of the note, as CommonMark has it for fences.'
  },
  {
    forumUrl: null,
    id: 'comment-indexed',
    kind: 'expected',
    matches: (key) => judgeOf(key) === 'render' && key.endsWith('-only-in-cache-in-comment'),
    note: 'Links, embeds and tags inside a `%%` comment are indexed though the reading view hides them, by design.'
  },
  {
    forumUrl: `${FORUM}119754`,
    id: 'footnote-block-id-empty-position',
    kind: 'bug',
    matches: (key, markdown) => ['independence:blocks', 'offset:blocks'].includes(key) && markdown.includes('^['),
    note: 'A block id in a footnote is placed at an empty spot past the note\'s content, so a link to it lands nowhere.'
  },
  {
    forumUrl: null,
    id: 'footnote-in-inline-footnote',
    kind: 'minor',
    matches: (key) => key === 'render:footnoteRefs-only-in-render',
    note: 'A footnote reference inside an inline footnote shows as nothing in the reading view, and the cache leaves it out.'
  },
  {
    forumUrl: null,
    id: 'undecodable-destination',
    kind: 'minor',
    matches: (key, markdown) => key === 'render:links-only-in-render' && /\]\([^)]*%/u.test(markdown),
    note: 'A markdown link whose destination `decodeURI` refuses, such as a lone `%`, is shown as a link and left out of the cache, so its backlink is lost.'
  },
  {
    forumUrl: null,
    id: 'open-bracket-hides-definition',
    kind: 'bug',
    matches: (key, markdown) => key === 'independence:referenceLinks' && /^\[[^\]\n]*\n\n/u.test(markdown),
    note: 'A link reference definition\'s label runs back across a blank line to a `[` never closed, so `[draft`, a blank line and `[f]: page.md` define the label `draft\n\n[f`: the paragraph vanishes and every `[x][f]` stops being a link. The label\'s half of the definition crossing a blank line, beside the title\'s.'
  },
  {
    forumUrl: null,
    id: 'list-continuation',
    kind: 'expected',
    matches: (key, markdown) => judgeOf(key) === 'independence' && /^(?:[-*+]|\d{1,9}[.)])(?:[ \t].*)?\n\n(?:\t| {2})/u.test(markdown),
    note: 'A blank line does not end a list item: a line indented to its content after it continues the item, as CommonMark has it.'
  },
  {
    forumUrl: null,
    id: 'duplicate-block-id',
    kind: 'expected',
    matches: (key, markdown) => key === 'independence:blocks' && /\^(?<id>[\w-]+)[\s\S]*\^\k<id>(?![\w-])/u.test(markdown),
    note: 'A block id used twice names the first block that carries it, so a later block with the same id has no id when read after the first: the cache keeps one block per id.'
  },
  {
    forumUrl: null,
    id: 'indented-block-start',
    kind: 'minor',
    matches: (key, markdown) => ['offset:footnotes', 'offset:listItems'].includes(key) || (judgeOf(key) === 'independence' && markdown.includes('\n\n ')),
    note: 'A list item or footnote definition indented by up to 3 spaces starts at its line\'s start rather than at its marker, so its position depends on what comes before it.'
  },
  {
    forumUrl: 'https://forum.obsidian.md/t/120800',
    id: 'editor-reformats-table',
    kind: 'bug',
    matches: (key, markdown) => (key === 'openFile:cache' || key === 'renameFile:body' || judgeOf(key) === 'backlinks') && TABLE_ROW_PATTERN.test(markdown),
    note: 'Live Preview writes every table of a note back to the file padded to its column widths, with no edit: when the note is left for another one, or already on opening when a math span or a fenced code block with a language follows the table. A cell with more `|` than the header gets a header column of its own, so an unescaped `[[target|alias]]` is split into two cells. The cache, the Backlinks view and a later rename then read the padded text, which is what shifts their offsets; a rename of a note never opened leaves its table as it is.'
  },
  {
    forumUrl: null,
    id: 'front-matter-restyled',
    kind: 'expected',
    matches: (key) => ['processFrontMatter:restyled', 'renameFile:front-matter'].includes(key),
    note: 'A `processFrontMatter`, and a rename that updates a link in the front matter, write the whole front matter back in the YAML library\'s style, so `tags: [a]` becomes a block list: the API hands the values over as an object, so their spelling is not kept. Undocumented in `obsidian.d.ts`.'
  },
  {
    forumUrl: 'https://forum.obsidian.md/t/81585/9',
    id: 'outline-inline-footnote',
    kind: 'bug',
    matches: (key, markdown) => key === 'outline:text' && markdown.includes('^['),
    note: 'An inline footnote in a heading shows in the Outline view as a numbered list of its text after the heading, with no reference mark where it stands.'
  },
  {
    forumUrl: 'https://forum.obsidian.md/t/120799',
    id: 'outline-escaped-bracket',
    kind: 'bug',
    matches: (key, markdown) => key === 'outline:text' && markdown.includes(String.raw`\[[`),
    note: 'A heading holding `\\[[escaped]]` shows `[escaped]` in the Outline view, one bracket on each side lost, where Reading view shows `[[escaped]]`.'
  },
  {
    forumUrl: null,
    id: 'outline-undefined-reference',
    kind: 'minor',
    matches: (key, markdown) => key === 'outline:text' && /\]\[[^\]]*\]/u.test(markdown),
    note: 'A reference link with no definition in a heading shows as its text alone in the Outline view, where Reading view shows it as typed, brackets included.'
  },
  {
    forumUrl: null,
    id: 'outline-embed-source',
    kind: 'minor',
    matches: (key, markdown) => key === 'outline:text' && markdown.includes('!['),
    note: 'An embed or an image in a heading shows in the Outline view as its link path, `target#Heading` or `pic.png`, where Reading view shows the embed, the image or its alias.'
  },
  {
    forumUrl: null,
    id: 'blocks-record',
    kind: 'expected',
    matches: (key) => key === 'shape:blocks-record',
    note: '`blocks` is a record keyed by block id, where every other item field of `CachedMetadata` is a list: API design, as `obsidian.d.ts` declares it, so a consumer walks it with `Object.values`.'
  },
  {
    forumUrl: null,
    id: 'utf16-columns',
    kind: 'expected',
    matches: (key) => key.startsWith('shape:columns-'),
    note: 'A column counts UTF-16 code units, not graphemes: an emoji before a link moves it 2 columns, a letter with a combining mark 2 where a reader sees 1. API design, the same unit as `offset` and as CodeMirror\'s positions.'
  },
  {
    forumUrl: null,
    id: 'tree-position',
    kind: 'judge',
    matches: (key) => ['conservation', 'fidelity'].includes(judgeOf(key)),
    note: 'The reading view tree places a text node off its source, which shows only through the positions the cache gives; the rendered text itself is right.'
  }
];

/**
 * The family of a finding.
 *
 * @param key - The finding's key.
 * @param markdown - Its reduced note.
 * @returns The family, or `null`.
 */
export function selfCheckFamilyOf(key: string, markdown: string): null | SelfCheckFamily {
  return SELF_CHECK_FAMILIES.find((family) => family.matches(key, markdown)) ?? null;
}
