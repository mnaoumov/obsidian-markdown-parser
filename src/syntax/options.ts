/**
 * @file
 *
 * Which syntax a parser reads, shared by every adapter: a preset, with any of its flags overridden.
 *
 * Each flag turns on one construct. The GFM flags add the syntax of the GFM spec's extensions, and the Obsidian flags
 * add the Obsidian syntax. Every flag adds syntax that CommonMark reads as text or as something else, so a document
 * that uses it parses differently, but none of them changes how a document without it parses. So the `commonmark`
 * preset, with every flag off, passes the CommonMark spec suite, and `gfm` passes the GFM spec's extension examples as
 * well.
 *
 * A quirk is different: it changes how valid CommonMark parses. Each quirk Obsidian has, measured against its reading
 * view and its metadata worker (`docs/spec-suites.md`), is a flag of {@link ObsidianQuirkFlags} named after the
 * behaviour. Every preset leaves every quirk at its CommonMark behaviour, so a quirk only applies when it is asked for.
 */

/**
 * The quirks: where Obsidian reads valid CommonMark differently. Each flag takes two values, the CommonMark behaviour
 * ({@link COMMONMARK_QUIRKS}), which every preset keeps, and Obsidian's ({@link OBSIDIAN_QUIRKS}).
 */
export interface ObsidianQuirkFlags {
  /**
   * Which autolinks there are. CommonMark: a scheme of 2 to 32 letters, digits, `+`, `.` and `-`, then a `:`, or an email
   * address of the characters HTML allows. Obsidian: a `<`, then a scheme of any characters but whitespace and `@` with
   * `://` and more after it, or any non-whitespace with an `@` in it, then a `>`. A `mailto:` address shows without its
   * scheme.
   */
  readonly autolink: 'commonmark' | 'obsidian';

  /**
   * Which character references inline content holds. CommonMark: a `;` ends each, a name must be one HTML defines, and
   * a numeric reference takes up to seven decimal or six hexadecimal digits. Obsidian: a numeric reference takes any
   * number of digits and needs no `;`, and a named one without its `;` takes the longest of HTML's legacy names it
   * starts with (`&copy`, `&nbsp`). A numeric reference past the last code point is U+FFFD.
   */
  readonly characterReference: 'commonmark' | 'obsidian';

  /**
   * Whether an empty list item can interrupt a paragraph. CommonMark: it cannot, so `foo\n*` is one paragraph.
   * Obsidian: `*`, `+`, `-` and `1.` with nothing after them end the paragraph and open a list, wherever the line is not
   * a setext heading's underline.
   */
  readonly emptyListItem: 'cannot-interrupt' | 'interrupts-paragraph';

  /**
   * How a GFM table is read. GFM: its header and delimiter rows have as many cells, it can interrupt a paragraph, and it
   * runs to a blank line or another block. `\|` is a pipe in any cell content. Obsidian: its rows agree with the header
   * on whether they start with a pipe, and the delimiter row gives the columns, to which every row is cut or padded. It
   * interrupts no paragraph, and runs to a line that holds no pipe after its first character or disagrees on the leading
   * pipe. Its cells are read as written, so `\|` in a code span keeps its backslash.
   */
  readonly gfmTable: 'commonmark' | 'obsidian';

  /**
   * Which lines open an HTML block, and what ends it. CommonMark 0.31.2: its seven kinds. Obsidian: the first kind is
   * `<script>`, `<pre>` and `<style>`, with no `<textarea>`; the sixth kind's tags have no `search` and add `hgroup`,
   * `meta`, `pre` and `source`, so `</pre>` interrupts a paragraph; and the sixth and seventh kinds end at an empty line,
   * not at a line of whitespace.
   */
  readonly htmlBlock: 'commonmark' | 'obsidian';

  /**
   * Which raw inline HTML comments there are. CommonMark 0.31.2: `<!-->`, `<!--->`, and any text between `<!--` and the
   * first `-->`. Obsidian, as CommonMark 0.30: the text does not start with `>` or `->`, does not end with `-`, and holds
   * no `--`. Any other `<!--` is text.
   */
  readonly htmlComment: 'commonmark' | 'obsidian';

  /**
   * How a link reference definition is read. CommonMark: a title that does not end its line leaves the definition
   * without one, and a setext underline below a definition is text. Obsidian: such a title spoils the definition, so it
   * is a paragraph; a title holds no escaped quote and starts no line with its closing quote; `<>` is no destination,
   * and a label may hold brackets; and a definition of one line with a setext underline below it is a heading. A
   * definition runs over no blank line, though Obsidian's may.
   */
  readonly linkDefinition: 'commonmark' | 'obsidian';

  /**
   * How list items are structured. CommonMark: an ordered marker has at most nine digits, an item whose first line is
   * empty has its content a column after its marker and ends at a blank line, a line indented less than an item's
   * content ends it, and a marker indented four or more columns opens no item. Obsidian: an ordered marker has any
   * number of digits; an item whose first line is empty has its content right after its marker, and a blank line does
   * not end it; a line indented more than four columns, though less than the item's content, continues the item; and a
   * marker of the same list indented less than the item's content opens the next item, however far it is indented.
   */
  readonly listItem: 'commonmark' | 'obsidian';

  /**
   * When a list is loose, its items' paragraphs rendered in `<p>`. CommonMark: when a blank line separates two of its
   * items, or two blocks directly inside one item. Obsidian: when a blank line anywhere inside it is followed by more of
   * it, in a nested list or in fenced code as well.
   */
  readonly looseList: 'between-blocks' | 'blank-line-anywhere';

  /**
   * How a setext heading is written. CommonMark: its text may run over several lines, and its underline may be indented
   * up to three spaces and followed by whitespace. Obsidian: its text is one line, and its underline starts its line
   * and has nothing after it. A paragraph of more lines keeps a `===` line as text, and a `---` line after it is a
   * thematic break.
   */
  readonly setextHeading: 'multi-line' | 'single-line';

  /**
   * What a line ending inside a paragraph is. CommonMark: a soft line break, rendered as a line ending. Obsidian, with
   * its default `strictLineBreaks: false`: a hard line break.
   */
  readonly softLineBreak: 'hard-break' | 'line-ending';
}

/**
 * The constructs a parser can read, each turned on or off.
 */
export interface ObsidianSyntaxFlags {
  /**
   * GFM bare URLs: `www.example.com`, `https://example.com` and email addresses become links.
   */
  readonly autolinkLiteral: boolean;

  /**
   * Block ids: `^id` at the end of a line.
   */
  readonly blockId: boolean;

  /**
   * Callouts: a quote whose first line opens with `[!type]`.
   */
  readonly callout: boolean;

  /**
   * Comments: `%%` inline, and comment blocks.
   */
  readonly comment: boolean;

  /**
   * Footnote references `[^label]` and footnote definitions `[^label]:`.
   */
  readonly footnote: boolean;

  /**
   * Front matter: a first line of `---`, up to the next line of `---`.
   */
  readonly frontMatter: boolean;

  /**
   * Highlights: `==text==`.
   */
  readonly highlight: boolean;

  /**
   * Inline footnotes: `^[text]`.
   */
  readonly inlineFootnote: boolean;

  /**
   * Internal links and embeds: `[[target]]` and `![[target]]`.
   */
  readonly internalLink: boolean;

  /**
   * Math: `$` inline, `$$` display, and math blocks.
   */
  readonly math: boolean;

  /**
   * GFM strikethrough, with two tildes only: `~~text~~`.
   */
  readonly strikethrough: boolean;

  /**
   * GFM tables.
   */
  readonly table: boolean;

  /**
   * Tags: `#tag`.
   */
  readonly tag: boolean;

  /**
   * Obsidian's task markers: a list item opening with `[c]` for any one character `c`. They replace GFM's task list
   * items, which take only a space, `x` or `X`.
   */
  readonly task: boolean;
}

/**
 * The syntax a parser reads: a preset, `obsidian` by default, with any of its flags overridden, and any of the quirks.
 */
export interface ObsidianSyntaxOptions extends Partial<ObsidianQuirkFlags>, Partial<ObsidianSyntaxFlags> {
  /**
   * The preset the flags start from.
   */
  readonly preset?: ObsidianSyntaxPreset;
}

/**
 * A named set of flags: `commonmark` has every flag off, `gfm` the GFM spec's extensions, and `obsidian` everything
 * Obsidian reads.
 */
export type ObsidianSyntaxPreset = 'commonmark' | 'gfm' | 'obsidian';

/**
 * The options of {@link resolveObsidianQuirks}.
 */
export type ResolveObsidianQuirksOptions = ObsidianSyntaxOptions;

/**
 * The options of {@link resolveObsidianSyntax}.
 */
export type ResolveObsidianSyntaxOptions = ObsidianSyntaxOptions;

// The flags while a preset's overrides are applied to them.
type MutableObsidianSyntaxFlags = { -readonly [Name in keyof ObsidianSyntaxFlags]: boolean };

const COMMONMARK: ObsidianSyntaxFlags = {
  autolinkLiteral: false,
  blockId: false,
  callout: false,
  comment: false,
  footnote: false,
  frontMatter: false,
  highlight: false,
  inlineFootnote: false,
  internalLink: false,
  math: false,
  strikethrough: false,
  table: false,
  tag: false,
  task: false
};

const GFM: ObsidianSyntaxFlags = {
  ...COMMONMARK,
  autolinkLiteral: true,
  strikethrough: true,
  table: true
};

/**
 * The flags of each preset.
 */
export const OBSIDIAN_SYNTAX_PRESETS: Readonly<Record<ObsidianSyntaxPreset, ObsidianSyntaxFlags>> = {
  commonmark: COMMONMARK,
  gfm: GFM,
  obsidian: {
    autolinkLiteral: true,
    blockId: true,
    callout: true,
    comment: true,
    footnote: true,
    frontMatter: true,
    highlight: true,
    inlineFootnote: true,
    internalLink: true,
    math: true,
    strikethrough: true,
    table: true,
    tag: true,
    task: true
  }
};

/**
 * The names of the flags, in a fixed order.
 */
export const OBSIDIAN_SYNTAX_FLAGS = Object.keys(COMMONMARK) as readonly (keyof ObsidianSyntaxFlags)[];

/**
 * The CommonMark behaviour of every quirk, which every preset keeps.
 */
export const COMMONMARK_QUIRKS: ObsidianQuirkFlags = {
  autolink: 'commonmark',
  characterReference: 'commonmark',
  emptyListItem: 'cannot-interrupt',
  gfmTable: 'commonmark',
  htmlBlock: 'commonmark',
  htmlComment: 'commonmark',
  linkDefinition: 'commonmark',
  listItem: 'commonmark',
  looseList: 'between-blocks',
  setextHeading: 'multi-line',
  softLineBreak: 'line-ending'
};

/**
 * Obsidian's behaviour for every quirk, as its reading view and its metadata worker show it.
 */
export const OBSIDIAN_QUIRKS: ObsidianQuirkFlags = {
  autolink: 'obsidian',
  characterReference: 'obsidian',
  emptyListItem: 'interrupts-paragraph',
  gfmTable: 'obsidian',
  htmlBlock: 'obsidian',
  htmlComment: 'obsidian',
  linkDefinition: 'obsidian',
  listItem: 'obsidian',
  looseList: 'blank-line-anywhere',
  setextHeading: 'single-line',
  softLineBreak: 'hard-break'
};

/**
 * The names of the quirks, in a fixed order.
 */
export const OBSIDIAN_QUIRK_FLAGS = Object.keys(COMMONMARK_QUIRKS) as readonly (keyof ObsidianQuirkFlags)[];

/**
 * Resolves options to the quirks they ask for: the CommonMark behaviour, with the overrides applied.
 *
 * @param options - The options.
 * @returns The quirks.
 */
export function resolveObsidianQuirks(options: ResolveObsidianQuirksOptions = {}): ObsidianQuirkFlags {
  return {
    autolink: options.autolink ?? COMMONMARK_QUIRKS.autolink,
    characterReference: options.characterReference ?? COMMONMARK_QUIRKS.characterReference,
    emptyListItem: options.emptyListItem ?? COMMONMARK_QUIRKS.emptyListItem,
    gfmTable: options.gfmTable ?? COMMONMARK_QUIRKS.gfmTable,
    htmlBlock: options.htmlBlock ?? COMMONMARK_QUIRKS.htmlBlock,
    htmlComment: options.htmlComment ?? COMMONMARK_QUIRKS.htmlComment,
    linkDefinition: options.linkDefinition ?? COMMONMARK_QUIRKS.linkDefinition,
    listItem: options.listItem ?? COMMONMARK_QUIRKS.listItem,
    looseList: options.looseList ?? COMMONMARK_QUIRKS.looseList,
    setextHeading: options.setextHeading ?? COMMONMARK_QUIRKS.setextHeading,
    softLineBreak: options.softLineBreak ?? COMMONMARK_QUIRKS.softLineBreak
  };
}

/**
 * Resolves options to the flags they turn on: the preset's flags, with the overrides applied.
 *
 * @param options - The options.
 * @returns The flags.
 */
export function resolveObsidianSyntax(options: ResolveObsidianSyntaxOptions = {}): ObsidianSyntaxFlags {
  const { preset = 'obsidian', ...overrides } = options;
  const flags: MutableObsidianSyntaxFlags = { ...OBSIDIAN_SYNTAX_PRESETS[preset] };
  for (const name of OBSIDIAN_SYNTAX_FLAGS) {
    const value = overrides[name];
    if (value !== undefined) {
      flags[name] = value;
    }
  }
  return flags;
}
