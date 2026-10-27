/**
 * @file
 *
 * The special note name oracle, read from a live Obsidian by `scripts/links/special-names-oracle.ts` into
 * `oracle/special-names-obsidian-<version>.json`: what each vault surface does with a note whose name holds a character
 * Obsidian warns about, a character link syntax reserves, or a character the vault normalizes.
 *
 * Every note is a file written on disk directly, never through Obsidian, since a note can reach the vault from a file
 * manager, sync or git with a name Obsidian would warn about or refuse. Each name gets a linker note holding the
 * wikilink Obsidian writes for it, the same link as an embed and as a properties link, and the oracle reads the
 * indexing, the file explorer, opening the note, the quick switcher, search, the link graph, `obsidian://open` and
 * renames and moves with their link updates. The links a user can write by hand are `link-parity.ts`'s. The rules a
 * verdict is measured against are in `docs/special-names.md`.
 */

import type { SpecOracleMeta } from '../spec/spec-oracle-file.ts';

/**
 * The vault folder every file of the oracle is written to.
 */
export const SPECIAL_NAMES_FOLDER = 'special-names';

/**
 * The folder the oracle renames each note into and back from.
 */
export const SPECIAL_NAMES_RENAMED_FOLDER = `${SPECIAL_NAMES_FOLDER}/renamed`;

/**
 * The folder the oracle moves each note into and back from, keeping its name.
 */
export const SPECIAL_NAMES_MOVED_FOLDER = `${SPECIAL_NAMES_FOLDER}/moved`;

/**
 * The folder holding the linker notes.
 */
export const SPECIAL_NAMES_LINKER_FOLDER = `${SPECIAL_NAMES_FOLDER}/linkers`;

/**
 * The folder where a plainly named note is renamed onto each special name, with its linker beside it.
 */
export const SPECIAL_NAMES_ONTO_FOLDER = `${SPECIAL_NAMES_FOLDER}/onto`;

/**
 * One note name of the sweep.
 */
export interface SpecialName {
  /**
   * Why it is in the sweep.
   */
  readonly group: SpecialNameGroup;

  /**
   * The note's base name, the file name without `.md`.
   */
  readonly name: string;

  /**
   * The name of another file of the sweep the vault indexes under the same path, where there is one.
   */
  readonly shadows?: string;

  /**
   * Spellings of the name, beyond its own, its NFC and its NFD, that the normalization sweep types links in.
   */
  readonly typed?: readonly string[];
}

/**
 * Why a name is in the sweep.
 */
export type SpecialNameGroup =
  | 'bare-mark'
  | 'compatibility'
  | 'control'
  | 'device'
  | 'dot'
  | 'link-syntax'
  | 'mixed'
  | 'order'
  | 'percent'
  | 'space'
  | 'unicode'
  | 'warned';

/**
 * The note names of the sweep, each a file in {@link SPECIAL_NAMES_FOLDER}. Only names Windows can store: the names it
 * cannot are {@link DEVICE_SPECIAL_NAMES}.
 */
export const SPECIAL_NAMES: readonly SpecialName[] = [
  { group: 'control', name: 'plain' },
  { group: 'warned', name: 'x#y' },
  { group: 'warned', name: '#x' },
  { group: 'warned', name: 'x^y' },
  { group: 'warned', name: '^x' },
  { group: 'warned', name: 'x[y' },
  { group: 'warned', name: 'x]y' },
  { group: 'warned', name: 'x[y]z' },
  { group: 'warned', name: 'x[[y' },
  { group: 'warned', name: 'x]]y' },
  { group: 'warned', name: 'x#^y' },
  // A name that is also a link to the heading `n` of the note `m`, which the sweep writes too.
  { group: 'link-syntax', name: 'm#n' },
  { group: 'link-syntax', name: 'x%%y' },
  { group: 'percent', name: 'x%y' },
  { group: 'percent', name: 'x%20y' },
  { group: 'percent', name: 'x%23y' },
  { group: 'percent', name: 'x%2Fy' },
  { group: 'dot', name: '.x' },
  { group: 'dot', name: 'x.y' },
  { group: 'space', name: ' x' },
  { group: 'space', name: 'x  y' },
  { group: 'unicode', name: 'x y' },
  { group: 'unicode', name: 'x\u{A0}y', shadows: 'x y' },
  { group: 'unicode', name: 'p\u{A0}q' },
  { group: 'unicode', name: 'caf\u{E9}' },
  { group: 'unicode', name: 'cafe\u{301}', shadows: 'caf\u{E9}' },
  { group: 'unicode', name: 'nai\u{308}ve' }
];

/**
 * The note names Windows cannot store, swept on Android: the characters its file names refuse, and a name or a folder
 * ending in a dot or a space. A name holding `/` is a note in a folder of that name.
 */
export const DEVICE_SPECIAL_NAMES: readonly SpecialName[] = [
  { group: 'device', name: 'x|y' },
  { group: 'device', name: 'x:y' },
  { group: 'device', name: 'x*y' },
  { group: 'device', name: 'x?y' },
  { group: 'device', name: 'x"y' },
  { group: 'device', name: 'x<y' },
  { group: 'device', name: 'x>y' },
  { group: 'device', name: String.raw`x\y` },
  { group: 'device', name: 'x.' },
  { group: 'device', name: 'x ' },
  { group: 'device', name: 'x./y' },
  { group: 'device', name: 'x /y' }
];

/**
 * The note names of the Android sweep: the desktop's, at the same indices, then {@link DEVICE_SPECIAL_NAMES}.
 */
export const ANDROID_SPECIAL_NAMES: readonly SpecialName[] = [...SPECIAL_NAMES, ...DEVICE_SPECIAL_NAMES];

/**
 * The note names of the normalization sweep: names in neither NFC nor NFD, three spellings of one name at once, combining
 * marks with no base, and compatibility characters NFKC would change but NFC keeps. A shadowed name is written before
 * the name it shadows, so the last one written is the one the vault keeps.
 */
export const NORMALIZATION_NAMES: readonly SpecialName[] = [
  { group: 'control', name: 'plain' },
  // A composed é next to a decomposed й, and the other way round: neither is NFC nor NFD.
  { group: 'mixed', name: 'm\u{E9}\u{438}\u{306}' },
  { group: 'mixed', name: 'ke\u{301}\u{439}' },
  // Two marks below and above, in the order NFD does not use: canonical reordering makes it ệ's NFD.
  { group: 'order', name: 'e\u{302}\u{323}' },
  // Both orders of the same two marks at once, the non-canonical one written last.
  { group: 'order', name: 'o\u{323}\u{302}', shadows: 'o\u{302}\u{323}' },
  { group: 'order', name: 'o\u{302}\u{323}' },
  // Three spellings of one name at once, the mixed one written last.
  { group: 'mixed', name: 'n\u{E9}\u{439}', shadows: 'n\u{E9}\u{438}\u{306}' },
  { group: 'mixed', name: 'ne\u{301}\u{438}\u{306}', shadows: 'n\u{E9}\u{438}\u{306}' },
  { group: 'mixed', name: 'n\u{E9}\u{438}\u{306}' },
  // The same three, the NFC one written last.
  { group: 'mixed', name: 'pe\u{301}\u{438}\u{306}', shadows: 'p\u{E9}\u{439}' },
  { group: 'mixed', name: 'p\u{E9}\u{438}\u{306}', shadows: 'p\u{E9}\u{439}' },
  { group: 'mixed', name: 'p\u{E9}\u{439}' },
  // An NFC name that links are also typed to in a mixed spelling.
  { group: 'mixed', name: 'q\u{E9}\u{439}', typed: ['q\u{E9}\u{438}\u{306}', 'qe\u{301}\u{439}'] },
  { group: 'bare-mark', name: '\u{301}x' },
  { group: 'bare-mark', name: 'x \u{301}y' },
  // Each beside the name NFKC would make of it.
  { group: 'compatibility', name: '\u{FB01}x' },
  { group: 'compatibility', name: 'fix' },
  { group: 'compatibility', name: '\u{FF21}x' },
  { group: 'compatibility', name: 'Ax' },
  { group: 'compatibility', name: 'x\u{B2}' },
  { group: 'compatibility', name: 'x2' }
];

/**
 * The folder the normalization sweep writes a second file of each name into, to rename it between its spellings.
 */
export const SPECIAL_NAMES_FORMS_FOLDER = `${SPECIAL_NAMES_FOLDER}/forms`;

/**
 * The folder holding the normalization sweep's linkers with hand-typed links, one link each.
 */
export const SPECIAL_NAMES_TYPED_FOLDER = `${SPECIAL_NAMES_FOLDER}/typed`;

/**
 * The ways the normalization sweep types a link to a note: a wikilink, a markdown link with its destination
 * percent-encoded, and one with its destination in angle brackets, unencoded.
 */
export const TYPED_LINK_KINDS = ['wikilink', 'markdown-encoded', 'markdown-raw'] as const;

/**
 * What one `fileManager.renameFile` of the note's second file to another spelling of its name did.
 */
export interface FormRenameRead extends Spelling {
  /**
   * The vault path of the note afterwards, or `null` where the vault lost it.
   */
  readonly path: null | string;

  /**
   * The file on disk the note reads afterwards, or `null`.
   */
  readonly realpath: null | string;

  /**
   * The refusal, or `null`.
   */
  readonly refusal: null | string;
}

/**
 * What `getAbstractFileByPath` found for one spelling of the note's path.
 */
export interface LookupRead extends Spelling {
  /**
   * The path of the file it found, or `null`.
   */
  readonly found: null | string;
}

/**
 * Which normal forms a string is in.
 */
export type NormalForm = 'both' | 'neither' | 'nfc' | 'nfd';

/**
 * What the normalization sweep read of one name beyond the surfaces.
 */
export interface NormalizationRead {
  /**
   * The renames of the name's second file to each other spelling and back, in order, or `null` for a shadowed name.
   */
  readonly formRenames: null | readonly FormRenameRead[];

  /**
   * What `getAbstractFileByPath` found for each spelling of the name's path.
   */
  readonly lookups: readonly LookupRead[];

  /**
   * The file on disk the vault note reads, after the plainly named note was renamed onto this name.
   */
  readonly ontoRealpath: null | string;

  /**
   * The file on disk the vault note reads, as the sweep found it, or `null` with no note.
   */
  readonly realpath: null | string;

  /**
   * The file on disk the vault note reads after its rename and move round trips.
   */
  readonly realpathAfterRenames: null | string;

  /**
   * Where each hand-typed link to the note led.
   */
  readonly typedLinks: readonly TypedLinkRead[];
}

/**
 * A spelling of a name, and which normal forms it is in.
 */
export interface Spelling {
  /**
   * Its forms.
   */
  readonly form: NormalForm;

  /**
   * The spelling.
   */
  readonly text: string;
}

/**
 * One way of typing a link.
 */
export type TypedLinkKind = typeof TYPED_LINK_KINDS[number];

/**
 * Where one hand-typed link from a linker of its own led.
 */
export interface TypedLinkRead extends Spelling {
  /**
   * The link path the metadata cache holds for it, which a click follows, or `null`.
   */
  readonly cached: null | string;

  /**
   * The notes following it created, which the oracle deletes again.
   */
  readonly created: readonly string[];

  /**
   * The note the editor's "Follow link under cursor" opened from the linker's own text, or `null` where none opened.
   */
  readonly followed: null | string;

  /**
   * The `data-href` of its anchor in Reading view, which a click follows, or `null` with no anchor.
   */
  readonly href: null | string;

  /**
   * How it was typed.
   */
  readonly kind: TypedLinkKind;

  /**
   * The link as typed.
   */
  readonly link: string;

  /**
   * The note a click on its anchor in Reading view opened, or `null` where none opened.
   */
  readonly opened: null | string;

  /**
   * The note `resolvedLinks` maps the linker to, or `null`.
   */
  readonly resolved: null | string;

  /**
   * The link text `unresolvedLinks` holds for the linker, or `null`.
   */
  readonly unresolved: null | string;
}

/**
 * The note `m` with the heading `n`, which a link to the note `m#n` meets.
 */
export const SPECIAL_NAMES_HEADING_NOTE = `${SPECIAL_NAMES_FOLDER}/m.md`;

/**
 * The surfaces the oracle reads, in table order.
 */
export const SPECIAL_NAME_SURFACES = [
  'indexed',
  'explorer',
  'open',
  'switcher',
  'search',
  'link',
  'backlinks',
  'graph',
  'embed',
  'property',
  'uri',
  'rename',
  'move',
  'rename-onto'
] as const;

/**
 * Whether the graph view showed a note.
 */
export interface GraphRead {
  /**
   * Whether the linker's link is an edge to the note.
   */
  readonly edge: boolean;

  /**
   * Whether the note is a node.
   */
  readonly node: boolean;
}

/**
 * What opening a note in a leaf showed.
 */
export interface OpenRead {
  /**
   * Whether the editor held the note's text.
   */
  readonly hasText: boolean;

  /**
   * The note the leaf showed.
   */
  readonly path: null | string;
}

/**
 * What the current build does when a name is typed into a rename: saved with a warning, saved, or refused.
 */
export interface RenameCheckRead {
  /**
   * The error or warning shown, or `null`.
   */
  readonly message: null | string;

  /**
   * The typed name.
   */
  readonly name: string;

  /**
   * Whether the rename was saved.
   */
  readonly saved: boolean;
}

/**
 * What renaming a plainly named, linked note onto the special name did to its link.
 */
export interface RenameOntoRead {
  /**
   * The linker's link after the rename.
   */
  readonly link: null | string;

  /**
   * Whether that link resolves to the renamed note.
   */
  readonly resolved: boolean;
}

/**
 * What a rename or move, and its undoing, did to the linker note.
 */
export interface RenameRead {
  /**
   * The linker's link after the note was renamed back.
   */
  readonly backLink: null | string;

  /**
   * Whether the linker's link resolved to the note at its original path after it was renamed back.
   */
  readonly backResolved: boolean;

  /**
   * The linker's link after the note was renamed.
   */
  readonly link: null | string;

  /**
   * Whether the linker's link resolved to the note at its new path.
   */
  readonly resolved: boolean;
}

/**
 * What an edit of the one note two shadowing files share wrote on disk.
 */
export interface ShadowWriteRead {
  /**
   * The shadowed name, whose file the vault does not index.
   */
  readonly name: string;

  /**
   * The text the shadowed name's file held after the edit.
   */
  readonly nameText: string;

  /**
   * The name the vault indexes in its place.
   */
  readonly partner: string;

  /**
   * The text the partner's file held after the edit.
   */
  readonly partnerText: string;
}

/**
 * What the app made of one name.
 */
export interface SpecialNameRead {
  /**
   * Whether the linker's embed rendered the note's text.
   */
  readonly embed: boolean;

  /**
   * The title the file explorer shows for the note, or `null` with no item.
   */
  readonly explorer: null | string;

  /**
   * Whether the note's file is in the graph view, and the linker's link is an edge to it.
   */
  readonly graph: GraphRead;

  /**
   * Whether `getBacklinksForFile` lists the linker.
   */
  readonly hasBacklink: boolean;

  /**
   * The vault path of the note whose file is this name's, or `null` where the vault has none.
   */
  readonly indexed: null | string;

  /**
   * The link Obsidian wrote in the linker, by `generateMarkdownLink`, or the hand-written `[[name]]` with no note.
   */
  readonly link: string;

  /**
   * Whether the linker's body link, its first cached link, resolves to the note.
   */
  readonly linkResolved: boolean;

  /**
   * What the move into another folder, and back, did to the linker, or `null` with no note.
   */
  readonly move: null | RenameRead;

  /**
   * The note an opened leaf showed and whether its editor held the note's text, or `null` with no note.
   */
  readonly open: null | OpenRead;

  /**
   * Whether the linker's properties link resolves to the note.
   */
  readonly property: boolean;

  /**
   * What the rename to a plain name, and back, did to the linker, or `null` with no note.
   */
  readonly rename: null | RenameRead;

  /**
   * What renaming a plainly named note onto this name did to its link.
   */
  readonly renameOnto: RenameOntoRead;

  /**
   * The vault paths a search for the note's text found, of the sweep's notes.
   */
  readonly search: readonly string[];

  /**
   * The files the quick switcher offered for the name, typed composed, up to 50.
   */
  readonly switcher: readonly string[];

  /**
   * The text the note's file holds, as the vault read it, or `null` with no note.
   */
  readonly text: null | string;

  /**
   * What `obsidian://open` did, or `null` with no note.
   */
  readonly uri: null | UriRead;
}

/**
 * The special note name oracle file.
 */
export interface SpecialNamesFile {
  /**
   * Where the oracle was read.
   */
  readonly meta: SpecialNamesMeta;

  /**
   * What the normalization sweep read of each name beyond the surfaces, by its name; only in its file.
   */
  readonly normalization?: Readonly<Record<string, NormalizationRead>>;

  /**
   * Each name's read, by its name.
   */
  readonly reads: Readonly<Record<string, SpecialNameRead>>;

  /**
   * What typing each checked name into the file explorer's rename did.
   */
  readonly renameChecks: readonly RenameCheckRead[];

  /**
   * For each shadowed name, what its two files on disk held after the one note the vault shows was edited.
   */
  readonly shadowWrites: readonly ShadowWriteRead[];
}

/**
 * Where the oracle was read, with the URL parse it assumed.
 */
export interface SpecialNamesMeta extends SpecOracleMeta {
  /**
   * The name of the vault.
   */
  readonly vault: string;
}

/**
 * How one surface fared with one name: it works, it fails, or it fails where the help already says it may.
 */
export type SpecialNameStatus = 'documented' | 'fails' | 'ok';

/**
 * One surface the oracle reads.
 */
export type SpecialNameSurface = typeof SPECIAL_NAME_SURFACES[number];

/**
 * The verdict on one surface for one name.
 */
export interface SpecialNameVerdict {
  /**
   * What the surface did, in a few words.
   */
  readonly shown: string;

  /**
   * How it fared.
   */
  readonly status: SpecialNameStatus;
}

/**
 * What `obsidian://open` did with the URL "Copy Obsidian URL" writes for the note.
 */
export interface UriRead {
  /**
   * The note it opened, or `null`.
   */
  readonly opened: null | string;

  /**
   * The URL.
   */
  readonly url: string;
}

/**
 * The names the oracle types into the file explorer's rename, each a plain name with one character added.
 */
export const RENAME_CHECK_NAMES: readonly string[] = ['r#s', 'r^s', 'r[s', 'r]s', 'r|s', 'r%s', 'r:s', 'r*s', '.rs'];

/**
 * The names the Android oracle types into the rename: the desktop's, and the rest of what Windows cannot store.
 */
export const ANDROID_RENAME_CHECK_NAMES: readonly string[] = [...RENAME_CHECK_NAMES, 'r?s', 'r"s', 'r<s', 'r>s', String.raw`r\s`, 'rs.', 'rs '];

// The help's *Invalid characters* note: "A string which contains the following characters may not work as a link:
// `# | ^ : %% [[ ]]`". It covers every surface that goes through a link, `obsidian://open` among them, whose `file` is a
// link where `%23` opens a heading (*Obsidian URI*, *Open a heading or block*).
const HELP_INVALID_IN_LINKS = ['#', '|', '^', ':', '%%', '[[', ']]'];
// What the app says when it refuses a rename to a name its platform does not allow.
const REFUSED_NAME_MESSAGE = '<<refused: File name cannot contain';
const LINK_SURFACES = new Set<SpecialNameSurface>(['backlinks', 'embed', 'graph', 'link', 'move', 'property', 'rename', 'rename-onto', 'uri']);

/**
 * The text the oracle writes into the note two shadowing files share.
 */
export const SHADOW_EDIT_TEXT = 'edited through the vault\n';

// What a surface's judge knows about the name beyond its read.
interface JudgeContext {
  // Whether the vault indexed the name's own file.
  readonly isIndexed: boolean;
  // The name.
  readonly name: string;
  // The vault path of the name's note.
  readonly notePath: string;
}

// A surface's judge: whether it worked, and what it did, in a few words.
type SurfaceJudge = (read: SpecialNameRead, context: JudgeContext) => readonly [boolean, string];

/**
 * Whether the help's *Invalid characters* note covers a name.
 *
 * @param name - The name.
 * @returns Whether it holds one of the strings the note names.
 */
export function isDocumentedInvalid(name: string): boolean {
  return HELP_INVALID_IN_LINKS.some((text) => name.includes(text));
}

/**
 * Judges every surface for every name.
 *
 * @param file - The oracle file.
 * @param names - The names it swept.
 * @returns The verdicts, by name and surface.
 */
export function judgeSpecialNames(file: SpecialNamesFile, names = SPECIAL_NAMES): Map<string, Map<SpecialNameSurface, SpecialNameVerdict>> {
  const verdicts = new Map<string, Map<SpecialNameSurface, SpecialNameVerdict>>();
  for (const [index, specialName] of names.entries()) {
    const read = file.reads[specialName.name];
    if (read === undefined) {
      throw new Error(`No read for ${specialName.name}`);
    }
    verdicts.set(specialName.name, judgeName(specialName, index, read));
  }
  return verdicts;
}

/**
 * Which normal forms a string is in.
 *
 * @param text - The string.
 * @returns Its forms.
 */
export function normalFormOf(text: string): NormalForm {
  const isNfc = text === text.normalize('NFC');
  const isNfd = text === text.normalize('NFD');
  if (isNfc) {
    return isNfd ? 'both' : 'nfc';
  }
  return isNfd ? 'nfd' : 'neither';
}

/**
 * Every file the oracle writes before the linkers: the sweep's names and the note `m` with the heading `n`.
 *
 * @param names - The names of the sweep.
 * @returns The files, by vault path.
 */
export function specialNameFiles(names = SPECIAL_NAMES): Map<string, string> {
  const files = new Map<string, string>();
  for (const [index, { name }] of names.entries()) {
    files.set(specialNamePath(name), specialNameText(index));
  }
  files.set(SPECIAL_NAMES_HEADING_NOTE, 'first line\n\n# n\n\ntext\n');
  return files;
}

/**
 * The vault path of a name's linker note.
 *
 * @param index - The name's index in {@link SPECIAL_NAMES}.
 * @returns The path.
 */
export function specialNameLinkerPath(index: number): string {
  return `${SPECIAL_NAMES_LINKER_FOLDER}/L${String(index)}.md`;
}

/**
 * The text of a linker note: the link, its embed, and the same link as a properties link.
 *
 * @param link - The wikilink.
 * @returns The text.
 */
export function specialNameLinkerText(link: string): string {
  return `---\nrelated: "${link.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"\n---\n${link}\n\n!${link}\n`;
}

/**
 * The vault path of a name's file.
 *
 * @param name - The name.
 * @returns The path.
 */
export function specialNamePath(name: string): string {
  return `${SPECIAL_NAMES_FOLDER}/${name}.md`;
}

/**
 * The text a note of the sweep holds: a word unique to it, which a search finds.
 *
 * @param index - The name's index in {@link SPECIAL_NAMES}.
 * @returns The text.
 */
export function specialNameText(index: number): string {
  return `sntok${String(index)}q\n`;
}

/**
 * The spellings of a name the normalization sweep looks its note up by and types links in: the name, its NFC, its NFD
 * and its `typed` spellings, each once.
 *
 * @param specialName - The name.
 * @returns The spellings.
 */
export function spellingsOf(specialName: SpecialName): Spelling[] {
  const { name } = specialName;
  const texts = new Set([name, name.normalize('NFC'), name.normalize('NFD'), ...specialName.typed ?? []]);
  return Array.from(texts, (text) => ({ form: normalFormOf(text), text }));
}

/**
 * A hand-typed link to the note of a spelling of a name, from a linker in {@link SPECIAL_NAMES_TYPED_FOLDER}.
 *
 * @param kind - How it is typed.
 * @param spelling - The spelling.
 * @returns The link.
 */
export function typedLink(kind: TypedLinkKind, spelling: string): string {
  const path = `${SPECIAL_NAMES_FOLDER}/${spelling}`;
  switch (kind) {
    case 'markdown-encoded': {
      return `[t](${encodeURI(`${path}.md`)})`;
    }
    case 'markdown-raw': {
      return `[t](<${path}.md>)`;
    }
    case 'wikilink': {
      return `[[${path}]]`;
    }
    default: {
      throw new Error(`Unknown link kind ${String(kind satisfies never)}`);
    }
  }
}

/**
 * The vault path of the linker holding one hand-typed link.
 *
 * @param index - The name's index in {@link NORMALIZATION_NAMES}.
 * @param spellingIndex - The spelling's index in {@link spellingsOf}.
 * @param kind - How the link is typed.
 * @returns The path.
 */
export function typedLinkerPath(index: number, spellingIndex: number, kind: TypedLinkKind): string {
  return `${SPECIAL_NAMES_TYPED_FOLDER}/T${String(index)}-${String(spellingIndex)}-${kind}.md`;
}

const NO_BREAK_SPACE_PATTERN = /\u{A0}/gu;

const JUDGES: Readonly<Record<SpecialNameSurface, SurfaceJudge>> = {
  'backlinks': (read, { isIndexed }) => [isIndexed && read.hasBacklink, read.hasBacklink ? 'lists the linker' : 'no backlink'],
  'embed': (read, { isIndexed }) => [isIndexed && read.embed, read.embed ? 'shows the note' : 'does not show the note'],
  // The explorer shows the name as the vault indexed it: composed, a no-break space made a space. A note in a folder
  // shows its own name only.
  'explorer': (read, { isIndexed, name }) => [
    isIndexed && [name, name.normalize('NFC').replaceAll(NO_BREAK_SPACE_PATTERN, ' ')].some((shown) => read.explorer === shown.slice(shown.lastIndexOf('/') + 1)),
    read.explorer === null ? 'no item' : `shows ${read.explorer}`
  ],
  'graph': (read, { isIndexed }) => [isIndexed && read.graph.node && read.graph.edge, `${read.graph.node ? 'node' : 'no node'}, ${read.graph.edge ? 'edge' : 'no edge'}`],
  'indexed': (read, { isIndexed }) => [isIndexed, describeIndexed(read, isIndexed)],
  'link': (read, { isIndexed }) => [isIndexed && read.linkResolved, `${read.link} ${describeResolved(read.linkResolved)}`],
  'move': (read, { isIndexed }) => [isIndexed && isRenameResolved(read.move), describeRename(read.move)],
  'open': (read, { isIndexed, notePath }) => [isIndexed && read.open?.path === notePath && read.open.hasText, describeOpen(read.open)],
  'property': (read, { isIndexed }) => [isIndexed && read.property, describeResolved(read.property)],
  'rename': (read, { isIndexed }) => [isIndexed && isRenameResolved(read.rename), describeRename(read.rename)],
  'rename-onto': (read) => [read.renameOnto.resolved, `${read.renameOnto.link ?? 'no link'} ${describeResolved(read.renameOnto.resolved)}`],
  'search': (read, { isIndexed, notePath }) => [isIndexed && read.search.includes(notePath), read.search.length === 0 ? 'finds nothing' : `finds ${read.search.join(', ')}`],
  'switcher': (read, { isIndexed, notePath }) => [isIndexed && read.switcher.includes(notePath), describeRank(read.switcher, notePath)],
  'uri': (read, { isIndexed, notePath }) => [isIndexed && read.uri?.opened === notePath, read.uri === null ? 'no URL' : `opens ${read.uri.opened ?? 'nothing'}`]
};

function describeIndexed(read: SpecialNameRead, isIndexed: boolean): string {
  if (read.indexed === null) {
    return 'not indexed';
  }
  return isIndexed ? `as ${read.indexed}` : `as ${read.indexed}, reading another file`;
}

function describeOpen(open: null | OpenRead): string {
  if (open === null) {
    return 'nothing to open';
  }
  return `opens ${open.path ?? 'nothing'}${open.hasText ? '' : ', without its text'}`;
}

function describeRank(offered: readonly string[], notePath: string): string {
  const rank = offered.indexOf(notePath);
  if (rank === -1) {
    return `not offered among ${String(offered.length)}`;
  }
  return rank === 0 ? 'offered first' : `offered at ${String(rank + 1)}`;
}

function describeRename(read: null | RenameRead): string {
  return read === null ? 'nothing to rename' : `${read.link ?? 'no link'} ${describeResolved(read.resolved)}; back, ${read.backLink ?? 'no link'} ${describeResolved(read.backResolved)}`;
}

function describeResolved(isResolved: boolean): string {
  return isResolved ? 'resolves' : 'does not resolve';
}

function isRenameResolved(read: null | RenameRead): boolean {
  return read !== null && read.resolved && read.backResolved;
}

function judgeName(specialName: SpecialName, index: number, read: SpecialNameRead): Map<SpecialNameSurface, SpecialNameVerdict> {
  const isDocumented = isDocumentedInvalid(specialName.name);
  const isDot = specialName.name.startsWith('.');
  // The vault indexes a name under its normalized path, so a note whose own text the vault reads is this name's note.
  const context: JudgeContext = {
    isIndexed: read.indexed !== null && read.text === specialNameText(index),
    name: specialName.name,
    notePath: read.indexed ?? specialNamePath(specialName.name)
  };
  const result = new Map<SpecialNameSurface, SpecialNameVerdict>();
  for (const surface of SPECIAL_NAME_SURFACES) {
    const [isOk, shown] = JUDGES[surface](read, context);
    let status: SpecialNameStatus = 'ok';
    if (!isOk) {
      // A rename the app refuses with its own message about the name is documented by that message.
      const isRefused = shown.includes(REFUSED_NAME_MESSAGE);
      status = isDot || isRefused || (isDocumented && LINK_SURFACES.has(surface)) ? 'documented' : 'fails';
    }
    result.set(surface, { shown, status });
  }
  return result;
}
