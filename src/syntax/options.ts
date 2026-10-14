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
 * Behaviour that changes how valid CommonMark parses (an Obsidian quirk, such as a list item child that is indented
 * less than CommonMark requires) is not here yet: each one is to be measured against Obsidian first, and added as a flag
 * that is off in every preset.
 */

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
 * The syntax a parser reads: a preset, `obsidian` by default, with any of its flags overridden.
 */
export interface ObsidianSyntaxOptions extends Partial<ObsidianSyntaxFlags> {
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
