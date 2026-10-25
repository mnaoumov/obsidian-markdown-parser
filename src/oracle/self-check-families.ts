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
 * has, `expected` for behaviour by design or documented, `minor` for one only notes nobody writes show, and `judge`
 * for a limit of the judge itself, where Obsidian is right.
 */
export type SelfCheckFamilyKind = 'bug' | 'expected' | 'judge' | 'known' | 'minor';

const FORUM = 'https://forum.obsidian.md/t/';

// A line that opens a `%%` block comment: the mark first on the line, after any quote, list and task marks or a footnote label.
const COMMENT_LINE_PATTERN = /^(?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t]|\[.\][ \t]|\[\^[^\]]+\]:[ \t]*)*%%/mu;
// A callout with a lazy line after its title: one opened in a list item and continued with no list indentation, or one
// continued with no `>`.
const LAZY_CALLOUT_PATTERN = /^(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?>[ \t]*\[!.*\n(?![ \t])|^(?:>[ \t]*)+\[!.*\n(?![ \t>])/mu;
const UNCLOSED_FENCE_PATTERN = /^(?:```|~~~|\$\$)/u;
const TABLE_ROW_PATTERN = /^\|.*\|[ \t]*$/mu;

function judgeOf(key: string): string {
  return key.split(':', 1)[0] ?? '';
}

/**
 * The families, the first that matches winning.
 */
export const SELF_CHECK_FAMILIES: readonly SelfCheckFamily[] = [
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
    forumUrl: null,
    id: 'first-open-offset',
    kind: 'bug',
    matches: (key, markdown) => (key === 'openFile:cache' || judgeOf(key) === 'backlinks') && TABLE_ROW_PATTERN.test(markdown),
    note: 'Opening a note with a table in the editor can rewrite its cache with a link offset that disagrees with its line and column, by the note\'s length plus 1; the Backlinks view then marks the wrong span. Seen on the first note opened in a session, and in the Backlinks view of the second.'
  },
  {
    forumUrl: null,
    id: 'rename-reformats-table',
    kind: 'bug',
    matches: (key, markdown) => key === 'renameFile:body' && TABLE_ROW_PATTERN.test(markdown),
    note: 'Renaming a file a link in a table points at rewrites the whole table, padding every cell to its column\'s width, and a `[[target|alias]]` in a cell is split at its `|` into a column of its own: the rename changes text it does not own.'
  },
  {
    forumUrl: null,
    id: 'front-matter-restyled',
    kind: 'expected',
    matches: (key) => ['processFrontMatter:restyled', 'renameFile:front-matter'].includes(key),
    note: 'A `processFrontMatter`, and a rename that updates a link in the front matter, write the whole front matter back in the YAML library\'s style, so `tags: [a]` becomes a block list: the API hands the values over as an object, so their spelling is not kept. Undocumented in `obsidian.d.ts`.'
  },
  {
    forumUrl: null,
    id: 'outline-inline-footnote',
    kind: 'bug',
    matches: (key, markdown) => key === 'outline:text' && markdown.includes('^['),
    note: 'An inline footnote in a heading shows in the Outline view as a numbered list of its text after the heading, with no reference mark where it stands.'
  },
  {
    forumUrl: null,
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
