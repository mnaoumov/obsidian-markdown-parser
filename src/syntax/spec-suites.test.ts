/* eslint-disable import-x/no-nodejs-modules -- The suite runs in Node and reads the vendored spec suites from disk. */
import type { Token } from 'markdown-it';
import type { Extension } from 'micromark-util-types';

import {
  micromark,
  parse,
  postprocess,
  preprocess
} from 'micromark';
import { gfmAutolinkLiteralHtml } from 'micromark-extension-gfm-autolink-literal';
import { gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { gfmTableHtml } from 'micromark-extension-gfm-table';
import { gfmTagfilterHtml } from 'micromark-extension-gfm-tagfilter';
import { readFileSync } from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules -- Only the fixture imports above need Node. */
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  ObsidianQuirkFlags,
  ObsidianSyntaxFlags,
  ObsidianSyntaxOptions,
  ObsidianSyntaxPreset
} from './options.ts';

import { parseWithLinkReferences } from './lezer-commonmark.ts';
import { renderLezerHtml } from './lezer-html.ts';
import { createObsidianParser } from './lezer.ts';
import { createObsidianMarkdownIt } from './markdown-it.ts';
import { micromarkQuirksHtml } from './micromark-quirks.ts';
import { createMicromarkObsidianMarkdown } from './micromark.ts';
import {
  COMMONMARK_QUIRKS,
  OBSIDIAN_QUIRK_FLAGS,
  OBSIDIAN_QUIRKS,
  OBSIDIAN_SYNTAX_FLAGS,
  OBSIDIAN_SYNTAX_PRESETS,
  resolveObsidianQuirks
} from './options.ts';

type Adapter = 'lezer' | 'markdown-it' | 'micromark';

interface SpecExample {
  readonly example: number;
  readonly extensions?: readonly string[];
  readonly html: string;
  readonly markdown: string;
}

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'spec');
const COMMONMARK = readExamples('commonmark-0.31.2.json');
// The GFM spec's own examples: the rest of its file is CommonMark 0.29, which the CommonMark suite covers in 0.31.2.
const GFM_EXTENSIONS = readExamples('gfm-0.29.0.gfm.13.json').filter((example) => example.extensions !== undefined);
const ADAPTERS: readonly Adapter[] = ['lezer', 'markdown-it', 'micromark'];
const PRESETS = Object.keys(OBSIDIAN_SYNTAX_PRESETS) as ObsidianSyntaxPreset[];

/*
 * The examples each adapter fails with the strict preset, and why. `docs/spec-suites.md` lists them too.
 * - lezer 280: `@lezer/markdown` keeps a list item open after its first line and a blank line, where CommonMark closes
 *   an item that starts with two blank lines.
 */
const COMMONMARK_FAILURES: Readonly<Record<Adapter, readonly number[]>> = {
  'lezer': [280],
  'markdown-it': [],
  'micromark': []
};

/*
 * - 628: the GFM 0.29 spec links `ftp://` URLs, which `@lezer/markdown` and micromark no longer do, as github.com
 *   no longer does.
 * - markdown-it 621-627, 630: markdown-it finds bare URLs with linkify-it, which links no `www.` address without a
 *   scheme and takes the GFM spec's invalid email address.
 * - markdown-it 652: markdown-it has no tag filter.
 */
const GFM_FAILURES: Readonly<Record<Adapter, readonly number[]>> = {
  'lezer': [628],
  'markdown-it': [621, 622, 623, 624, 625, 626, 627, 630, 652],
  'micromark': [628]
};

/*
 * The CommonMark examples whose parse changes when a flag is turned on or off, whatever the preset and the adapter.
 * Each one uses the flag's syntax: a bare URL, a `---` first line, a `[[` or a `#` tag.
 */
const FLAG_CHANGES: Readonly<Record<keyof ObsidianSyntaxFlags, readonly number[]>> = {
  autolinkLiteral: [602, 608, 611, 612],
  blockId: [],
  callout: [],
  comment: [],
  footnote: [],
  frontMatter: [96, 98],
  highlight: [],
  inlineFootnote: [],
  internalLink: [548, 559, 590],
  math: [],
  strikethrough: [],
  table: [],
  tag: [64],
  task: []
};

/*
 * The CommonMark examples whose rendering changes when a quirk is turned on, whatever the preset. Each example shows the
 * quirk's behaviour, and Obsidian's reading view differs from the spec on it (`src/oracle/spec-quirks.ts`), except where
 * Obsidian's other quirks hide it: `softLineBreak` shows on every soft line break, including in examples Obsidian
 * parses differently. `linkDefinition` reads the definitions of 546 and 552, whose labels hold a bracket or only
 * whitespace; Obsidian differs from the spec there in its links too. `@lezer/markdown` keeps the paragraph of example
 * 280 in its list item (`COMMONMARK_FAILURES`), where a blank line before it makes the list loose.
 */
const SOFT_LINE_BREAK_CHANGES = [
  14,
  25,
  28,
  37,
  46,
  49,
  70,
  81,
  82,
  87,
  88,
  93,
  95,
  104,
  105,
  106,
  113,
  138,
  145,
  148,
  187,
  213,
  216,
  217,
  220,
  222,
  223,
  224,
  228,
  229,
  230,
  232,
  233,
  238,
  243,
  247,
  250,
  251,
  253,
  254,
  285,
  286,
  287,
  288,
  290,
  291,
  292,
  293,
  304,
  312,
  334,
  367,
  384,
  394,
  405,
  423,
  432,
  490,
  494,
  505,
  543,
  552,
  556,
  587,
  621,
  648,
  649
];
const QUIRK_CHANGES: Readonly<Record<Adapter, Readonly<Record<keyof ObsidianQuirkFlags, readonly number[]>>>> = {
  'lezer': {
    autolink: [597, 598, 601, 606],
    characterReference: [28, 29],
    emptyListItem: [285, 367],
    gfmTable: [],
    htmlBlock: [148, 171],
    htmlComment: [625, 626],
    linkDefinition: [196, 200, 202, 210, 216, 546, 552],
    looseList: [280, 307, 318, 319],
    setextHeading: [81, 82, 84, 86, 95],
    softLineBreak: SOFT_LINE_BREAK_CHANGES
  },
  'markdown-it': {
    autolink: [597, 598, 601, 606],
    characterReference: [28, 29],
    emptyListItem: [285, 367],
    gfmTable: [],
    htmlBlock: [148, 171],
    htmlComment: [625, 626],
    linkDefinition: [196, 200, 202, 210, 216, 546, 552],
    looseList: [307, 318, 319],
    setextHeading: [81, 82, 84, 86, 95],
    softLineBreak: SOFT_LINE_BREAK_CHANGES
  },
  'micromark': {
    autolink: [597, 598, 601, 606],
    characterReference: [28, 29],
    emptyListItem: [285, 367],
    gfmTable: [],
    htmlBlock: [148, 171],
    htmlComment: [625, 626],
    linkDefinition: [196, 200, 202, 210, 216, 546, 552],
    looseList: [307, 318, 319],
    setextHeading: [81, 82, 84, 86, 95],
    softLineBreak: SOFT_LINE_BREAK_CHANGES
  }
};

/*
 * The GFM extension examples whose rendering changes when a quirk is turned on from the gfm preset, in the same way:
 * `gfmTable` changes the four table examples Obsidian reads differently, and `softLineBreak` the one that GFM reads as a
 * paragraph of three lines, which Obsidian reads as a table.
 */
const GFM_QUIRK_CHANGES: Readonly<Partial<Record<keyof ObsidianQuirkFlags, readonly number[]>>> = {
  gfmTable: [199, 200, 202, 203],
  softLineBreak: [203]
};

function failingExamples(examples: readonly SpecExample[], render: (markdown: string) => string): number[] {
  return examples.filter((example) => render(example.markdown) !== example.html).map((example) => example.example);
}

function micromarkEvents(extensions: Extension[]): (markdown: string) => string {
  return (markdown) =>
    postprocess(parse({ extensions }).document().write(preprocess()(markdown, undefined, true)))
      .map(([kind, token]) => `${kind}${token.type}@${String(token.start.offset)}-${String(token.end.offset)}`)
      .join(' ');
}

function readExamples(fileName: string): SpecExample[] {
  return JSON.parse(readFileSync(join(SPEC_DIR, fileName), 'utf-8')) as SpecExample[];
}

// The GFM spec's tag filter is a step of rendering, so it is on for the GFM suite only.
function renderer(adapter: Adapter, options: ObsidianSyntaxOptions, hasTagFilter: boolean): (markdown: string) => string {
  const renderers: Record<Adapter, () => (markdown: string) => string> = {
    'lezer': () => {
      const parser = createObsidianParser(options);
      return (markdown) => renderLezerHtml(markdown, parseWithLinkReferences(parser, markdown), { ...resolveObsidianQuirks(options), tagFilter: hasTagFilter });
    },
    'markdown-it': () => {
      const md = createObsidianMarkdownIt(options);
      return (markdown) => md.render(markdown);
    },
    'micromark': () => {
      const extensions = createMicromarkObsidianMarkdown(options);
      const htmlExtensions = [gfmTableHtml(), gfmStrikethroughHtml(), gfmAutolinkLiteralHtml(), micromarkQuirksHtml, ...hasTagFilter ? [gfmTagfilterHtml()] : []];
      return (markdown) => micromark(markdown, { allowDangerousHtml: true, allowDangerousProtocol: true, extensions, htmlExtensions });
    }
  };
  return renderers[adapter]();
}

function serializeTokens(tokens: readonly Token[]): string {
  return tokens.map((token) => `${token.type}|${token.content}|${serializeTokens(token.children ?? [])}`).join(';');
}

// What a parse gives, as a string, so two configurations can be compared on a document.
function structure(adapter: Adapter, options: ObsidianSyntaxOptions): (markdown: string) => string {
  const structures: Record<Adapter, () => (markdown: string) => string> = {
    'lezer': () => {
      const parser = createObsidianParser(options);
      return (markdown) => {
        const nodes: string[] = [];
        parser.parse(markdown).iterate({
          enter: (node) => {
            nodes.push(`${node.name}@${String(node.from)}-${String(node.to)}`);
          }
        });
        return nodes.join(' ');
      };
    },
    'markdown-it': () => {
      const md = createObsidianMarkdownIt(options);
      return (markdown) => serializeTokens(md.parse(markdown, {}));
    },
    'micromark': () => micromarkEvents(createMicromarkObsidianMarkdown(options))
  };
  return structures[adapter]();
}
describe('the vendored spec suites', () => {
  it('hold every example of their spec', () => {
    expect(COMMONMARK).toHaveLength(652);
    expect(GFM_EXTENSIONS.map((example) => example.extensions?.[0])).toEqual([
      ...Array.from({ length: 8 }, () => 'table'),
      ...Array.from({ length: 2 }, () => 'strikethrough'),
      ...Array.from({ length: 11 }, () => 'autolink'),
      'tagfilter'
    ]);
  });
});

describe.each(ADAPTERS)('%s', (adapter) => {
  it('passes the CommonMark 0.31.2 spec suite with the commonmark preset', () => {
    expect(failingExamples(COMMONMARK, renderer(adapter, { preset: 'commonmark' }, false))).toEqual(COMMONMARK_FAILURES[adapter]);
  });

  it('passes the GFM spec\'s extension examples with the gfm preset', () => {
    expect(failingExamples(GFM_EXTENSIONS, renderer(adapter, { preset: 'gfm' }, true))).toEqual(GFM_FAILURES[adapter]);
  });

  it.each(PRESETS)('changes only the examples using a flag\'s syntax when the flag is toggled from the %s preset', (preset) => {
    const base = structure(adapter, { preset });
    const baseStructures = COMMONMARK.map((example) => base(example.markdown));
    const changes: Partial<Record<keyof ObsidianSyntaxFlags, number[]>> = {};
    for (const flag of OBSIDIAN_SYNTAX_FLAGS) {
      const toggled = structure(adapter, { [flag]: !OBSIDIAN_SYNTAX_PRESETS[preset][flag], preset });
      changes[flag] = COMMONMARK.filter((example, index) => toggled(example.markdown) !== baseStructures[index]).map((example) => example.example);
    }
    expect(changes).toEqual(FLAG_CHANGES);
  });

  it.each(PRESETS)('changes only the examples showing a quirk when the quirk is turned on from the %s preset', (preset) => {
    const base = renderer(adapter, { preset }, false);
    const baseHtml = COMMONMARK.map((example) => base(example.markdown));
    const changes: Partial<Record<keyof ObsidianQuirkFlags, number[]>> = {};
    for (const quirk of OBSIDIAN_QUIRK_FLAGS) {
      const quirked = renderer(adapter, { preset, [quirk]: OBSIDIAN_QUIRKS[quirk] }, false);
      changes[quirk] = COMMONMARK.filter((example, index) => quirked(example.markdown) !== baseHtml[index]).map((example) => example.example);
    }
    expect(changes).toEqual(QUIRK_CHANGES[adapter]);
  });

  it('changes only the GFM extension examples showing a quirk when the quirk is turned on from the gfm preset', () => {
    const base = renderer(adapter, { preset: 'gfm' }, true);
    const baseHtml = GFM_EXTENSIONS.map((example) => base(example.markdown));
    const changes: Partial<Record<keyof ObsidianQuirkFlags, number[]>> = {};
    for (const quirk of OBSIDIAN_QUIRK_FLAGS) {
      const quirked = renderer(adapter, { preset: 'gfm', [quirk]: OBSIDIAN_QUIRKS[quirk] }, true);
      const changed = GFM_EXTENSIONS.filter((example, index) => quirked(example.markdown) !== baseHtml[index]).map((example) => example.example);
      if (changed.length > 0) {
        changes[quirk] = changed;
      }
    }
    expect(changes).toEqual(GFM_QUIRK_CHANGES);
  });

  it('passes the CommonMark spec suite with every quirk at its CommonMark behaviour', () => {
    expect(failingExamples(COMMONMARK, renderer(adapter, { ...COMMONMARK_QUIRKS, preset: 'commonmark' }, false))).toEqual(COMMONMARK_FAILURES[adapter]);
  });
});
