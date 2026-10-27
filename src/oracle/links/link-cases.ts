/**
 * @file
 *
 * The link case oracle, read from a live Obsidian by `scripts/links/link-cases-oracle.ts` into
 * `oracle/link-cases-obsidian-<version>.json`: where a link leads in the vault shapes the owner's forum reports name and
 * no other oracle builds. A note name shared by a root note and a note in a folder, a renamed note whose name has spaces
 * and which an angle-bracket destination links, a file with no extension, the links `generateMarkdownLink` writes to
 * those and to an attachment, and a note composer merge of a note with relative links into a note in another folder.
 *
 * Each case writes its files into an empty vault, optionally renames a file, merges a note or writes the links
 * `generateMarkdownLink` gives into its note, and reads every link the note's cache then holds and where the app's own
 * `getFirstLinkpathDest` sends it. The rules a verdict is measured against are in `docs/link-cases.md`.
 */

import type { SpecOracleMeta } from '../spec/spec-oracle-file.ts';

/**
 * The vault folder every file of the oracle but the root note of {@link ROOT_COLLISION_NOTE} is written to.
 */
export const LINK_CASES_FOLDER = 'link-cases';

/**
 * The root note whose name a note in a folder shares.
 */
export const ROOT_COLLISION_NOTE = 'A.md';

/**
 * The text of a file the oracle writes as a 1x1 PNG image.
 */
export const IMAGE_FILE = null;

/**
 * The link formats `generateMarkdownLink` is asked for, by the `useMarkdownLinks` setting.
 */
export const LINK_FORMATS = ['wikilink', 'markdown'] as const;

/**
 * One case of the oracle.
 */
export interface LinkCase {
  /**
   * What the case does before its note is read.
   */
  readonly action: LinkCaseAction;

  /**
   * What each link of the note should lead to, in source order.
   */
  readonly expected: readonly LinkExpectation[];

  /**
   * The files the case writes, by vault path: a note's text, or {@link IMAGE_FILE} for an image.
   */
  readonly files: Readonly<Record<string, null | string>>;

  /**
   * The case's id.
   */
  readonly id: string;

  /**
   * The note whose links are read.
   */
  readonly note: string;

  /**
   * The rule a failure breaks, in a few words.
   */
  readonly rule: string;

  /**
   * The forum topic that reported it.
   */
  readonly topic: string;
}

/**
 * What a case does between writing its files and reading its note.
 */
export type LinkCaseAction =
  | LinkCaseGenerate
  | LinkCaseMerge
  | LinkCaseNone
  | LinkCaseRename;

/**
 * A case that writes the links `generateMarkdownLink` gives for a file, one per format, into its note.
 */
export interface LinkCaseGenerate {
  readonly kind: 'generate';

  /**
   * The file linked.
   */
  readonly target: string;
}

/**
 * A case that merges a note into its note with note composer's merge.
 */
export interface LinkCaseMerge {
  /**
   * The note merged away.
   */
  readonly from: string;

  readonly kind: 'merge';
}

/**
 * A case that only reads its note.
 */
export interface LinkCaseNone {
  readonly kind: 'none';
}

/**
 * What the app made of one case.
 */
export interface LinkCaseRead {
  /**
   * The links `generateMarkdownLink` gave, one per {@link LINK_FORMATS} entry, or none.
   */
  readonly generated: readonly string[];

  /**
   * The note's cached links and embeds, in source order.
   */
  readonly links: readonly LinkRead[];

  /**
   * The note's text once the case acted.
   */
  readonly text: string;
}

/**
 * A case that renames a file through `fileManager.renameFile`, with link updates on.
 */
export interface LinkCaseRename {
  /**
   * The file renamed.
   */
  readonly from: string;

  readonly kind: 'rename';

  /**
   * Its new path.
   */
  readonly to: string;
}

/**
 * The link case oracle file.
 */
export interface LinkCasesFile {
  /**
   * Where the oracle was read.
   */
  readonly meta: LinkCasesMeta;

  /**
   * Each case's read, by its id.
   */
  readonly reads: Readonly<Record<string, LinkCaseRead>>;
}

/**
 * Where the oracle was read.
 */
export interface LinkCasesMeta extends SpecOracleMeta {
  /**
   * The name of the vault.
   */
  readonly vault: string;
}

/**
 * How one link fared: it reaches its target, it reaches what Obsidian says it should by design, or it fails.
 */
export type LinkCaseStatus = 'expected' | 'fails' | 'ok';

/**
 * The verdict on one link of a case.
 */
export interface LinkCaseVerdict {
  /**
   * The link as the note holds it.
   */
  readonly original: string;

  /**
   * What it does, in a few words.
   */
  readonly shown: string;

  /**
   * How it fared.
   */
  readonly status: LinkCaseStatus;
}

/**
 * What a link of a case should lead to.
 */
export interface LinkExpectation {
  /**
   * Where Obsidian sends it by its stated design, where that differs from {@link want}.
   */
  readonly designed?: string;

  /**
   * The file the link names, read by its format's own rules.
   */
  readonly want: string;
}

/**
 * One cached link of a note, and where it leads.
 */
export interface LinkRead {
  /**
   * The file `getFirstLinkpathDest` gives for its path, or `null`.
   */
  readonly destination: null | string;

  /**
   * The cached link.
   */
  readonly link: string;

  /**
   * The link as the note holds it.
   */
  readonly original: string;
}

const COLLISION_FOLDER = `${LINK_CASES_FOLDER}/F`;
const COLLISION_NOTE = `${COLLISION_FOLDER}/A.md`;
const SPACED_FOLDER = `${LINK_CASES_FOLDER}/spaced`;
const SPACED_NOTE = `${SPACED_FOLDER}/a b.md`;
const SPACED_RENAMED = `${SPACED_FOLDER}/c d.md`;
const EXTENSIONLESS_FOLDER = `${LINK_CASES_FOLDER}/extensionless`;
const EXTENSIONLESS_FILE = `${EXTENSIONLESS_FOLDER}/file`;
const ATTACHMENT_FOLDER = `${LINK_CASES_FOLDER}/attachment`;
const ATTACHMENT = `${ATTACHMENT_FOLDER}/pic.png`;
const MERGE_FOLDER = `${LINK_CASES_FOLDER}/merge`;
const MERGE_ASSET = `${MERGE_FOLDER}/assets/i.png`;
const MERGE_SIBLING = `${MERGE_FOLDER}/src/j.png`;
const MERGE_SOURCE = `${MERGE_FOLDER}/src/S.md`;
const MERGE_DESTINATION = `${MERGE_FOLDER}/dst/deep/D.md`;
const URL_RULE = 'CommonMark: a link destination is a URL, resolved against the note (RFC 3986 section 5)';

/**
 * The cases, each from one of the owner's forum reports.
 */
export const LINK_CASES: readonly LinkCase[] = [
  {
    action: { kind: 'none' },
    expected: [
      { designed: ROOT_COLLISION_NOTE, want: COLLISION_NOTE },
      // The staff reply on t/69542 names the wikilink only; a markdown link's destination is a URL.
      { want: COLLISION_NOTE },
      { want: COLLISION_NOTE },
      { want: ROOT_COLLISION_NOTE }
    ],
    files: {
      [`${COLLISION_FOLDER}/B.md`]: '[[A]]\n\n[x](A.md)\n\n[x](./A.md)\n\n[x](/A.md)\n',
      [COLLISION_NOTE]: 'folder A\n',
      [ROOT_COLLISION_NOTE]: 'root A\n'
    },
    id: 'folder-root-collision',
    note: `${COLLISION_FOLDER}/B.md`,
    rule: `wikilink: vault-absolute first by design (t/69542); markdown link: ${URL_RULE}`,
    topic: 'https://forum.obsidian.md/t/69542'
  },
  {
    action: { kind: 'generate', target: COLLISION_NOTE },
    expected: [{ want: COLLISION_NOTE }, { want: COLLISION_NOTE }],
    files: {},
    id: 'folder-root-collision-generated',
    note: `${COLLISION_FOLDER}/G.md`,
    rule: 'round trip: a link Obsidian writes reaches the file it was written for',
    topic: 'https://forum.obsidian.md/t/69542'
  },
  {
    action: { from: SPACED_NOTE, kind: 'rename', to: SPACED_RENAMED },
    expected: [{ want: SPACED_RENAMED }, { want: SPACED_RENAMED }, { want: SPACED_RENAMED }, { want: SPACED_RENAMED }],
    files: {
      [`${SPACED_FOLDER}/L.md`]: '[x](<./a b.md>)\n\n[y](<a b.md>)\n\n[z](a%20b.md)\n\n[[a b]]\n',
      [SPACED_NOTE]: 'spaced\n'
    },
    id: 'spaced-name-rename',
    note: `${SPACED_FOLDER}/L.md`,
    rule: 'round trip: a link a rename rewrites reaches the renamed file',
    topic: 'https://forum.obsidian.md/t/85598'
  },
  {
    action: { kind: 'none' },
    expected: [{ want: EXTENSIONLESS_FILE }, { want: EXTENSIONLESS_FILE }, { want: EXTENSIONLESS_FILE }, { want: EXTENSIONLESS_FILE }],
    files: {
      [`${EXTENSIONLESS_FOLDER}/L.md`]: `[[file]]\n\n[x](file)\n\n![[file]]\n\n[[${EXTENSIONLESS_FILE}]]\n`,
      [EXTENSIONLESS_FILE]: 'no extension\n'
    },
    id: 'extensionless',
    note: `${EXTENSIONLESS_FOLDER}/L.md`,
    rule: 'a file the vault shows is reachable by a link to its name',
    topic: 'https://forum.obsidian.md/t/90389'
  },
  {
    action: { kind: 'generate', target: EXTENSIONLESS_FILE },
    expected: [{ want: EXTENSIONLESS_FILE }, { want: EXTENSIONLESS_FILE }],
    files: {},
    id: 'extensionless-generated',
    note: `${EXTENSIONLESS_FOLDER}/G.md`,
    rule: 'round trip: a link Obsidian writes reaches the file it was written for',
    topic: 'https://forum.obsidian.md/t/90389'
  },
  {
    action: { kind: 'generate', target: ATTACHMENT },
    expected: [{ want: ATTACHMENT }, { want: ATTACHMENT }],
    files: { [ATTACHMENT]: IMAGE_FILE },
    id: 'attachment-generated',
    note: `${ATTACHMENT_FOLDER}/G.md`,
    rule: 'round trip, and no leading ! (1.10.0 changelog, t/106790) and no undefined alias (t/86606)',
    topic: 'https://forum.obsidian.md/t/106790'
  },
  {
    action: { from: MERGE_SOURCE, kind: 'merge' },
    expected: [{ want: MERGE_ASSET }, { want: MERGE_SIBLING }, { want: MERGE_ASSET }, { want: MERGE_ASSET }],
    files: {
      [MERGE_ASSET]: IMAGE_FILE,
      [MERGE_DESTINATION]: 'destination\n',
      [MERGE_SIBLING]: IMAGE_FILE,
      [MERGE_SOURCE]: 'source\n\n![](../assets/i.png)\n\n![](./j.png)\n\n![[i.png]]\n\n[[../assets/i.png]]\n'
    },
    id: 'merge-relative-links',
    note: MERGE_DESTINATION,
    rule: 'round trip: a link a merge moves still reaches its file, as a rename keeps it',
    topic: 'https://forum.obsidian.md/t/64899'
  }
];

/**
 * Whether a link `generateMarkdownLink` wrote is free of the two defects reported against it: a leading `!` with no
 * embed asked for, and an `undefined` display text.
 *
 * @param link - The link.
 * @returns Whether it is clean.
 */
export function isGeneratedLinkClean(link: string): boolean {
  return !link.startsWith('!') && !link.includes('undefined');
}

/**
 * Judges every link of every case.
 *
 * @param file - The oracle file.
 * @returns The verdicts, by case id, one per expected link, then one per generated link.
 */
export function judgeLinkCases(file: LinkCasesFile): Map<string, LinkCaseVerdict[]> {
  const verdicts = new Map<string, LinkCaseVerdict[]>();
  for (const linkCase of LINK_CASES) {
    const read = file.reads[linkCase.id];
    if (read === undefined) {
      throw new Error(`No read for ${linkCase.id}`);
    }
    verdicts.set(linkCase.id, judgeCase(linkCase, read));
  }
  return verdicts;
}

function judgeCase(linkCase: LinkCase, read: LinkCaseRead): LinkCaseVerdict[] {
  const result = linkCase.expected.map((expectation, index): LinkCaseVerdict => {
    const link = read.links[index];
    if (link === undefined) {
      return { original: '-', shown: 'no link cached', status: 'fails' };
    }
    let status: LinkCaseStatus = 'fails';
    if (link.destination === expectation.want) {
      status = 'ok';
    } else if (link.destination === expectation.designed) {
      status = 'expected';
    }
    return { original: link.original, shown: link.destination === null ? 'leads nowhere' : `leads to ${link.destination}`, status };
  });
  for (const [index, generated] of read.generated.entries()) {
    result.push({
      original: generated,
      shown: `generateMarkdownLink, ${LINK_FORMATS[index] ?? 'unknown'}`,
      status: isGeneratedLinkClean(generated) ? 'ok' : 'fails'
    });
  }
  return result;
}
