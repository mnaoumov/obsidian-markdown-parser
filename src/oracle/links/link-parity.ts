/**
 * @file
 *
 * The link parity oracle, read from a live Obsidian by `scripts/links/link-parity-oracle.ts` into
 * `oracle/link-parity-obsidian-<version>.json`: which links a wikilink can express and a markdown link cannot, and the
 * other way round, and whether the links Obsidian writes itself reach what they were written for.
 *
 * Every target is a file written on disk directly, never through Obsidian, since a note can reach the vault from a file
 * manager, sync or git with a name Obsidian would refuse. Each case is one link in a note of its own. A case works when
 * the cached link and the Reading view's link both resolve, through Obsidian's own `parseLinktext`,
 * `getFirstLinkpathDest` and `resolveSubpath`, to the expected file, heading or block, and Reading view shows the
 * expected text. The rule the gaps are measured against is in `docs/link-parity.md`.
 */

import type { SpecOracleMeta } from '../spec/spec-oracle-file.ts';

/**
 * The vault folder every file of the oracle is written to.
 */
export const LINK_PARITY_FOLDER = 'link-parity';

/**
 * Two headings in one note, the second a variant of the first.
 */
export interface HeadingCollision {
  /**
   * The first heading.
   */
  readonly first: string;

  /**
   * The second heading.
   */
  readonly second: string;
}

/**
 * Where links to the second heading of a {@link HeadingCollision} led.
 */
export interface HeadingCollisionRead extends HeadingCollision {
  /**
   * The heading index the autocomplete's link reached: 0 the first, 1 the second, -1 none, `null` with no link.
   */
  readonly autocompleteReach: null | number;

  /**
   * The link the autocomplete wrote for the second heading, or `null` where it offered none.
   */
  readonly autocompleteWrote: null | string;

  /**
   * The headings the cache holds.
   */
  readonly headings: readonly string[];

  /**
   * The heading index the second heading's own text, as a subpath, reached.
   */
  readonly rawReach: number;
}

/**
 * The two link formats.
 */
export type LinkFormat = 'markdown' | 'wikilink';

/**
 * One link the oracle reads, under the id of the note that holds it.
 */
export interface LinkParityCase extends LinkParityLink {
  /**
   * The note holding the link, a file name in {@link LINK_PARITY_FOLDER} without `.md`.
   */
  readonly id: string;
}

/**
 * Where a case's link should lead, and what it should show.
 */
export interface LinkParityExpectation {
  /**
   * The block id it reaches, for a block link.
   */
  readonly block?: string;

  /**
   * The text Reading view shows, when the case checks it.
   */
  readonly display?: string;

  /**
   * The vault path of the file it reaches.
   */
  readonly file: string;

  /**
   * The heading it reaches, for a heading link.
   */
  readonly heading?: string;
}

/**
 * The link parity oracle file.
 */
export interface LinkParityFile {
  /**
   * The heading collisions.
   */
  readonly collisions: readonly HeadingCollisionRead[];

  /**
   * The vault paths of every file in {@link LINK_PARITY_FOLDER} the app indexed, the case notes left out.
   */
  readonly indexed: readonly string[];

  /**
   * Where the oracle was read.
   */
  readonly meta: SpecOracleMeta;

  /**
   * Each case's read, by its id.
   */
  readonly reads: Readonly<Record<string, LinkParityRead>>;
}

/**
 * What a case links to.
 */
export type LinkParityKind = 'block' | 'display' | 'heading' | 'target';

/**
 * One link the oracle reads.
 */
export interface LinkParityLink {
  /**
   * Where the link should lead.
   */
  readonly expect: LinkParityExpectation;

  /**
   * How a hand-written link is spelled (`plain`, `escaped`, `angle`, ...), or the writer's name.
   */
  readonly form: string;

  /**
   * The link's format.
   */
  readonly format: LinkFormat;

  /**
   * What the link leads to.
   */
  readonly kind: LinkParityKind;

  /**
   * The note's text, or `null` where Obsidian writes it.
   */
  readonly markdown: null | string;

  /**
   * What Obsidian is asked to write a link for, where it writes it.
   */
  readonly request?: LinkParityRequest;

  /**
   * The note name, heading, display text or block id the case is about.
   */
  readonly subject: string;

  /**
   * Who wrote the link.
   */
  readonly writer: LinkParityWriter;
}

/**
 * What the app made of one case's note.
 */
export interface LinkParityRead {
  /**
   * How many internal links Reading view rendered.
   */
  readonly anchorCount: number;

  /**
   * The cached link's display text.
   */
  readonly cacheDisplay: null | string;

  /**
   * The cached link's link.
   */
  readonly cacheLink: null | string;

  /**
   * Where the cached link led.
   */
  readonly cacheResolve: LinkResolutionRead | null;

  /**
   * How many links and embeds the cache holds.
   */
  readonly linkCount: number;

  /**
   * The first link Reading view rendered, or `null`.
   */
  readonly rendered: null | RenderedLinkRead;

  /**
   * Where that link's `data-href` led.
   */
  readonly renderedResolve: LinkResolutionRead | null;

  /**
   * The note's text, as written by hand or by Obsidian.
   */
  readonly text: string;
}

/**
 * What Obsidian is asked to write a link for.
 */
export interface LinkParityRequest {
  /**
   * The display text passed to `generateMarkdownLink`.
   */
  readonly alias?: string;

  /**
   * The heading to pick among the autocomplete's suggestions.
   */
  readonly heading?: string;

  /**
   * The subpath passed to `generateMarkdownLink`.
   */
  readonly subpath?: string;

  /**
   * The vault path of the file linked to.
   */
  readonly target: string;

  /**
   * What is typed before the autocomplete is asked for its suggestions.
   */
  readonly typed?: string;
}

/**
 * Who wrote a case's link: a hand-written form, the editor's link autocomplete, or `fileManager.generateMarkdownLink`.
 */
export type LinkParityWriter = 'api' | 'autocomplete' | 'hand';

/**
 * Where a link led, by Obsidian's own resolution.
 */
export interface LinkResolutionRead {
  /**
   * The file `getFirstLinkpathDest` found, or `null`.
   */
  readonly destination: null | string;

  /**
   * The link path `parseLinktext` gave.
   */
  readonly path: string;

  /**
   * Where the subpath led in that file, or `null` without a file or a subpath.
   */
  readonly sub: LinkSubpathRead | null;

  /**
   * The subpath `parseLinktext` gave.
   */
  readonly subpath: string;
}

/**
 * Where a subpath led, by `resolveSubpath`.
 */
export type LinkSubpathRead = 'unresolved' | SubpathBlockRead | SubpathHeadingRead;

/**
 * The first internal link Reading view rendered.
 */
export interface RenderedLinkRead {
  /**
   * Its `data-href`.
   */
  readonly href: null | string;

  /**
   * Its text.
   */
  readonly text: null | string;
}

/**
 * A subpath that led to a block.
 */
export interface SubpathBlockRead {
  /**
   * The block's id.
   */
  readonly block: null | string;
}

/**
 * A subpath that led to a heading.
 */
export interface SubpathHeadingRead {
  /**
   * The heading's text.
   */
  readonly heading: string;
}

/**
 * Note names, each a file in {@link LINK_PARITY_FOLDER}. Only names Windows can store: `| : * ? " < > \ /` and a
 * trailing space or dot are left out.
 */
export const LINK_PARITY_NAMES: readonly string[] = [
  'x[y',
  'x]y',
  'x[[y',
  'x]]y',
  'x[y]z',
  'x#y',
  '#x',
  'x^y',
  '^x',
  'x#^y',
  'x%y',
  'x%%y',
  'x%%y%%z',
  'x{y',
  'x}y',
  'x(y',
  'x)y',
  'x(y)z',
  'x!y',
  '!x',
  'x$y',
  'x&y',
  'x\'y',
  'x+y',
  'x,y',
  'x;y',
  'x=y',
  'x==y==z',
  'x@y',
  'x`y',
  'x~y',
  'x~~y~~z',
  'x_y',
  'x y',
  ' x',
  'x  y',
  'x.md',
  'x&amp;y',
  'x&#35;y',
  'x%23y',
  'é',
  'x y'
];

/**
 * Heading texts, each the one heading of a note of its own, so no two can collide.
 */
export const LINK_PARITY_HEADINGS: readonly string[] = [
  'a[b]c',
  'a[[b]]c',
  'a]]b',
  'a]b',
  'a[b',
  'a|b',
  'a#b',
  'a^b',
  'a%b',
  'a%%b%%c',
  'a:b',
  String.raw`a\b`,
  'a`b`c',
  'a*b*c',
  'a  b',
  'a.b',
  'a/b',
  'a #t b',
  'a&amp;b',
  'a (b) c',
  'a<b>c',
  'a==b==c',
  'a~~b~~c',
  '[[t]] x',
  '[l](t.md) x',
  'a $x$ b'
];

/**
 * Display texts of a link to {@link LINK_PARITY_DISPLAY_TARGET}.
 */
export const LINK_PARITY_DISPLAYS: readonly string[] = [
  'a]b',
  'a]]b',
  'a[b',
  'a[[b',
  'a[b]c',
  'a|b',
  String.raw`a\b`,
  'a#b',
  'a^b',
  'a%%b%%c',
  'a*b*',
  'a`b`',
  '  a',
  'a  ',
  'a&amp;b',
  '[[t]]',
  String.raw`a\|b`
];

/**
 * The file the display text cases link to.
 */
export const LINK_PARITY_DISPLAY_TARGET = `${LINK_PARITY_FOLDER}/t.md`;

/**
 * The file the block cases link to, and its block id.
 */
export const LINK_PARITY_BLOCK_TARGET = `${LINK_PARITY_FOLDER}/B.md`;

const BLOCK_ID = 'blk-1';
const FIRST_PRINTABLE = 0x21;
const PAST_PRINTABLE = 0x7F;
const ASCII_PUNCTUATION = Array.from({ length: PAST_PRINTABLE - FIRST_PRINTABLE }, (_value, index) => String.fromCodePoint(FIRST_PRINTABLE + index)).filter((character) => !/[\p{L}\p{N}]/u.test(character));

/**
 * The heading pairs: `a b` and `a<c>b` for every ASCII punctuation character `<c>`, then case, inner whitespace, a
 * no-break space, a trailing space and an exact duplicate.
 */
export const HEADING_COLLISIONS: readonly HeadingCollision[] = [
  ...ASCII_PUNCTUATION.map((character) => ({ first: 'a b', second: `a${character}b` })),
  { first: 'ab', second: 'AB' },
  { first: 'a b', second: 'a  b' },
  { first: 'a b', second: 'a b' },
  { first: 'ab', second: 'ab ' },
  { first: 'a b', second: 'a b' }
];

const WIKILINK_SPECIAL = /[[\]#^|\\%]/g;
const ASCII_PUNCTUATION_PATTERN = /[!-/:-@[-`{-~]/g;
const HEADING_STRIPPED = /[|#^\\:%[\]]/g;
const SPACES = /\s+/g;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]/gu;

/**
 * One subject, judged.
 */
export interface LinkParitySubject {
  /**
   * Whether the help's "Invalid characters" note covers it: a note name or heading holding one of `# | ^ : %% [[ ]]`.
   */
  readonly isDocumented: boolean;

  /**
   * What the subject is.
   */
  readonly kind: LinkParityKind;

  /**
   * The hand-written markdown link forms that work.
   */
  readonly markdownForms: readonly string[];

  /**
   * The note name, heading, display text or block id.
   */
  readonly subject: string;

  /**
   * Which format can express it.
   */
  readonly verdict: LinkParityVerdict;

  /**
   * The hand-written wikilink forms that work.
   */
  readonly wikilinkForms: readonly string[];

  /**
   * The links Obsidian wrote for it.
   */
  readonly written: readonly WrittenLinkVerdict[];
}

/**
 * Which format can express a subject by hand.
 *
 * - `parity`: both can.
 * - `wikilink-gap`: only a markdown link can.
 * - `markdown-gap`: only a wikilink can.
 * - `neither`: no form of either can.
 * - `not-indexed`: the vault shows no file at the subject's path.
 */
export type LinkParityVerdict = 'markdown-gap' | 'neither' | 'not-indexed' | 'parity' | 'wikilink-gap';

/**
 * How a link Obsidian wrote fared.
 */
export type WrittenLinkOutcome = 'not-offered' | 'ok' | 'wrong-target' | 'wrong-text';

/**
 * A link Obsidian wrote, judged.
 */
export interface WrittenLinkVerdict {
  /**
   * The link's format.
   */
  readonly format: LinkFormat;

  /**
   * What Obsidian wrote.
   */
  readonly markdown: string;

  /**
   * How it fared.
   */
  readonly outcome: WrittenLinkOutcome;

  /**
   * What Reading view shows for it, or `null` where it rendered no link.
   */
  readonly shown: null | string;

  /**
   * Who wrote it.
   */
  readonly writer: Exclude<LinkParityWriter, 'hand'>;
}

/**
 * The vault path of a case's note.
 *
 * @param id - The case id.
 * @returns The path.
 */
export function linkParityCasePath(id: string): string {
  return `${LINK_PARITY_FOLDER}/${id}.md`;
}

/**
 * Every case, in a fixed order, each id `case-<n>`.
 *
 * @returns The cases.
 */
export function linkParityCases(): LinkParityCase[] {
  const cases: LinkParityCase[] = [];
  function add(linkCase: LinkParityLink): void {
    cases.push({ ...linkCase, id: `case-${String(cases.length + 1)}` });
  }
  function hand(kind: LinkParityKind, subject: string, expect: LinkParityExpectation, forms: Record<string, string>): void {
    for (const [form, markdown] of Object.entries(forms)) {
      const format = form.startsWith('md-') ? 'markdown' : 'wikilink';
      add({ expect, form: form.replace(/^(?:md|wiki)-/, ''), format, kind, markdown, subject, writer: 'hand' });
    }
  }
  function written(kind: LinkParityKind, subject: string, expect: LinkParityExpectation, writers: readonly LinkParityWriter[], request: LinkParityRequest): void {
    for (const writer of writers) {
      for (const format of ['wikilink', 'markdown'] as const) {
        add({ expect, form: writer, format, kind, markdown: null, request, subject, writer });
      }
    }
  }

  for (const name of LINK_PARITY_NAMES) {
    const file = linkParityNamePath(name);
    hand('target', name, { file }, {
      'md-angle': `[d](<${name}.md>)`,
      'md-entity': `[d](<${name.replaceAll('&', '&amp;')}.md>)`,
      'md-escaped': `[d](${escapeMarkdownDestination(name)}.md)`,
      'md-percent-encoded': `[d](${percentEncode(name)}.md)`,
      'md-plain': `[d](${name}.md)`,
      'wiki-escaped': `[[${escapeWikilink(name)}]]`,
      'wiki-folder-path': `[[${LINK_PARITY_FOLDER}/${name}]]`,
      'wiki-percent-encoded': `[[${percentEncode(name)}]]`,
      'wiki-plain': `[[${name}]]`,
      'wiki-with-extension': `[[${name}.md]]`
    });
    written('target', name, { display: name, file }, ['autocomplete', 'api'], { target: file, typed: `[[${name.replaceAll(NOT_LETTER_OR_DIGIT, '')}` });
  }
  for (const [index, heading] of LINK_PARITY_HEADINGS.entries()) {
    const file = linkParityHeadingPath(index);
    const base = `H${String(index)}`;
    hand('heading', heading, { file, heading }, {
      'md-angle': `[d](<${base}.md#${heading}>)`,
      'md-entity': `[d](<${base}.md#${heading.replaceAll('&', '&amp;')}>)`,
      'md-percent-encoded': `[d](${base}.md#${percentEncode(heading)})`,
      'md-stripped': `[d](${base}.md#${percentEncode(stripHeading(heading))})`,
      'wiki-escaped': `[[${base}#${escapeWikilink(heading)}]]`,
      'wiki-plain': `[[${base}#${heading}]]`,
      'wiki-stripped': `[[${base}#${stripHeading(heading)}]]`
    });
    written('heading', heading, { file, heading }, ['autocomplete', 'api'], { heading, subpath: `#${heading}`, target: file, typed: `[[${base}#` });
  }
  for (const display of LINK_PARITY_DISPLAYS) {
    const expect = { display, file: LINK_PARITY_DISPLAY_TARGET };
    hand('display', display, expect, {
      'md-escaped': `[${escapeMarkdownText(display)}](t.md)`,
      'md-escaped-in-table': `| h |\n| - |\n| [${escapeMarkdownText(display).replaceAll('|', String.raw`\|`)}](t.md) |`,
      'wiki-escaped': `[[t|${escapeWikilink(display)}]]`,
      'wiki-in-table': `| h |\n| - |\n| [[t\\|${display.replaceAll('|', String.raw`\|`)}]] |`,
      'wiki-plain': `[[t|${display}]]`
    });
    written('display', display, expect, ['api'], { alias: display, target: LINK_PARITY_DISPLAY_TARGET });
  }
  const blockExpect = { block: BLOCK_ID, file: LINK_PARITY_BLOCK_TARGET };
  hand('block', BLOCK_ID, blockExpect, {
    'md-percent-encoded': `[d](B.md#%5E${BLOCK_ID})`,
    'md-plain': `[d](B.md#^${BLOCK_ID})`,
    'wiki-plain': `[[B#^${BLOCK_ID}]]`
  });
  written('block', BLOCK_ID, blockExpect, ['api'], { subpath: `#^${BLOCK_ID}`, target: LINK_PARITY_BLOCK_TARGET });
  return cases;
}

/**
 * The vault path of the note holding one heading collision.
 *
 * @param index - The collision's index in {@link HEADING_COLLISIONS}.
 * @returns The path.
 */
export function linkParityCollisionPath(index: number): string {
  return `${LINK_PARITY_FOLDER}/C${String(index)}.md`;
}

/**
 * The vault path of the note holding one heading.
 *
 * @param index - The heading's index in {@link LINK_PARITY_HEADINGS}.
 * @returns The path.
 */
export function linkParityHeadingPath(index: number): string {
  return `${LINK_PARITY_FOLDER}/H${String(index)}.md`;
}

/**
 * The vault path of a note name's file.
 *
 * @param name - The note name.
 * @returns The path.
 */
export function linkParityNamePath(name: string): string {
  return `${LINK_PARITY_FOLDER}/${name}.md`;
}

/**
 * Every file the oracle writes before the cases, by its vault path: the named notes, the heading notes, the collision
 * notes, the display and block targets.
 *
 * @returns The files.
 */
export function linkParityTargetFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of LINK_PARITY_NAMES) {
    files.set(linkParityNamePath(name), 'first line\n');
  }
  for (const [index, heading] of LINK_PARITY_HEADINGS.entries()) {
    files.set(linkParityHeadingPath(index), `first line\n\n# ${heading}\n\ntext\n`);
  }
  for (const [index, collision] of HEADING_COLLISIONS.entries()) {
    files.set(linkParityCollisionPath(index), `first line\n\n# ${collision.first}\n\ntext\n\n# ${collision.second}\n\ntext\n`);
  }
  files.set(LINK_PARITY_DISPLAY_TARGET, 'first line\n');
  files.set(LINK_PARITY_BLOCK_TARGET, `first line\n\ntext ^${BLOCK_ID}\n`);
  return files;
}

function escapeMarkdownDestination(text: string): string {
  return text.replaceAll(ASCII_PUNCTUATION_PATTERN, (character) => (character === '.' ? character : `\\${character}`));
}

function escapeMarkdownText(text: string): string {
  return text.replaceAll(ASCII_PUNCTUATION_PATTERN, (character) => `\\${character}`);
}

function escapeWikilink(text: string): string {
  return text.replaceAll(WIKILINK_SPECIAL, (character) => `\\${character}`);
}

function percentEncode(text: string): string {
  return text.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

// A heading as the autocomplete writes it: the characters it drops made spaces, runs of spaces made one.
function stripHeading(heading: string): string {
  return heading.replaceAll(HEADING_STRIPPED, ' ').replaceAll(SPACES, ' ').trim();
}

const DOCUMENTED_INVALID = ['#', '|', '^', ':', '%%', '[[', ']]'];

/**
 * Judges every subject of the oracle.
 *
 * @param file - The oracle file.
 * @returns The subjects, in the order of {@link linkParityCases}.
 */
export function judgeLinkParity(file: LinkParityFile): LinkParitySubject[] {
  const cases = linkParityCases();
  const indexed = new Set(file.indexed);
  const subjects = new Map<string, LinkParityCase[]>();
  for (const linkCase of cases) {
    const key = `${linkCase.kind}\u{0}${linkCase.subject}`;
    subjects.set(key, [...subjects.get(key) ?? [], linkCase]);
  }
  return Array.from(subjects.values(), (group) => {
    const [first] = group;
    if (first === undefined) {
      throw new Error('An empty subject');
    }
    function working(format: LinkFormat): string[] {
      return group.filter((linkCase) => linkCase.writer === 'hand' && linkCase.format === format && judgeLinkParityRead(linkCase, readOf(file, linkCase)) === 'ok')
        .map((linkCase) => linkCase.form);
    }
    const wikilinkForms = working('wikilink');
    const markdownForms = working('markdown');
    const written: WrittenLinkVerdict[] = group.filter((linkCase) => linkCase.writer !== 'hand').map((linkCase) => {
      const read = readOf(file, linkCase);
      const markdown = read.text.replace(/\n$/, '');
      const isOffered = !markdown.startsWith('<<');
      return {
        format: linkCase.format,
        markdown,
        outcome: isOffered ? judgeLinkParityRead(linkCase, read) : 'not-offered',
        shown: read.rendered?.text ?? null,
        writer: linkCase.writer as Exclude<LinkParityWriter, 'hand'>
      };
    });
    let verdict: LinkParityVerdict;
    if (!indexed.has(first.expect.file)) {
      verdict = 'not-indexed';
    } else if (wikilinkForms.length > 0) {
      verdict = markdownForms.length > 0 ? 'parity' : 'markdown-gap';
    } else {
      verdict = markdownForms.length > 0 ? 'wikilink-gap' : 'neither';
    }
    const isDocumented = (first.kind === 'target' || first.kind === 'heading') && DOCUMENTED_INVALID.some((part) => first.subject.includes(part));
    return { isDocumented, kind: first.kind, markdownForms, subject: first.subject, verdict, wikilinkForms, written };
  });
}

/**
 * Whether a case's link reaches its target from the cache and from Reading view, and shows the expected text.
 *
 * @param linkCase - The case.
 * @param read - Its read.
 * @returns How it fared.
 */
export function judgeLinkParityRead(linkCase: LinkParityCase, read: LinkParityRead): Exclude<WrittenLinkOutcome, 'not-offered'> {
  const isReached = read.linkCount === 1 && read.anchorCount === 1 && isExpectedReached(read.cacheResolve, linkCase.expect)
    && isExpectedReached(read.renderedResolve, linkCase.expect);
  if (!isReached) {
    return 'wrong-target';
  }
  return linkCase.expect.display === undefined || read.rendered?.text === linkCase.expect.display ? 'ok' : 'wrong-text';
}

function isExpectedReached(resolution: LinkResolutionRead | null, expect: LinkParityExpectation): boolean {
  if (resolution?.destination !== expect.file) {
    return false;
  }
  const { sub } = resolution;
  const isHeadingReached = expect.heading === undefined || (typeof sub === 'object' && sub !== null && 'heading' in sub && sub.heading === expect.heading);
  const isBlockReached = expect.block === undefined || (typeof sub === 'object' && sub !== null && 'block' in sub && sub.block === expect.block);
  return isHeadingReached && isBlockReached;
}

function readOf(file: LinkParityFile, linkCase: LinkParityCase): LinkParityRead {
  const read = file.reads[linkCase.id];
  if (read === undefined) {
    throw new Error(`No read of ${linkCase.id}`);
  }
  return read;
}
