/**
 * @file
 *
 * The live surface oracle, read from a live Obsidian by `scripts/live-surfaces-oracle.ts` into
 * `oracle/live-surfaces-obsidian-<version>.json`: for a sample of grammar notes (`note-grammar.ts`) in one vault, the
 * surfaces that exist only in the app. They are the metadata cache as the app holds it, `resolvedLinks` and
 * `unresolvedLinks`, the Outline view, the Backlinks view and `getBacklinksForFile` of every file the notes link to, the
 * text after a real `fileManager.renameFile` of those files and after renaming them back, and the text after a
 * `processFrontMatter`.
 */

import type {
  CachedMetadata,
  Pos
} from '../../metadata/types.ts';
import type { RemarkNode } from '../../remark/types.ts';
import type { SpecOracleMeta } from '../spec/spec-oracle-file.ts';

import { parseMetadata } from '../../metadata/metadata.ts';
import { parseRemark } from '../../remark/parse.ts';
import { compareCodeUnits } from '../classes/score.ts';
import { generateNotes } from './note-grammar.ts';
import { shownText } from './self-check.ts';

/**
 * How many grammar notes the oracle reads: the first ones of the grammar's default seed, the notes `npm run self-check`
 * starts from.
 */
export const LIVE_SURFACE_NOTE_COUNT = 400;

/**
 * The vault folder the oracle writes to.
 */
export const LIVE_SURFACE_FOLDER = 'live-surfaces';

/**
 * The vault folder the notes go to.
 */
export const LIVE_SURFACE_NOTE_FOLDER = `${LIVE_SURFACE_FOLDER}/notes`;

/**
 * The key `processFrontMatter` adds to every note.
 */
export const PROCESSED_KEY = 'livecheck';

/**
 * A file the grammar's notes link to.
 */
export interface LiveSurfaceTarget {
  /**
   * Its content: markdown, or `null` for an empty binary file.
   */
  readonly content: null | string;

  /**
   * Its vault path.
   */
  readonly path: string;

  /**
   * The vault path the rename moves it to.
   */
  readonly renamedPath: string;
}

/**
 * Every file the grammar's notes link to, at the paths the oracle gives them: the names the grammar writes, in
 * {@link LIVE_SURFACE_FOLDER}.
 */
export const LIVE_SURFACE_TARGETS: readonly LiveSurfaceTarget[] = [
  { content: '# Heading\n\nA paragraph ^blockid\n', path: `${LIVE_SURFACE_FOLDER}/target.md`, renamedPath: `${LIVE_SURFACE_FOLDER}/retitled-target.md` },
  { content: '# Page\n', path: `${LIVE_SURFACE_FOLDER}/page.md`, renamedPath: `${LIVE_SURFACE_FOLDER}/retitled-page.md` },
  { content: null, path: `${LIVE_SURFACE_FOLDER}/image.png`, renamedPath: `${LIVE_SURFACE_FOLDER}/retitled-image.png` },
  { content: null, path: `${LIVE_SURFACE_FOLDER}/pic.png`, renamedPath: `${LIVE_SURFACE_FOLDER}/retitled-pic.png` }
];

/**
 * One file's Backlinks of one note.
 */
export interface LiveSurfaceBacklinks {
  /**
   * `metadataCache.getBacklinksForFile(<target>).data` of the note: its link caches, with a position in the body or a
   * key in the front matter.
   */
  readonly api: readonly unknown[];

  /**
   * The Backlinks view's result for the note: the `[from, to]` offsets of its matches in the body, and its matches in
   * the front matter; `null` where the view does not list it.
   */
  readonly pane: LiveSurfacePaneResult | null;
}

/**
 * A note the oracle reads.
 */
export interface LiveSurfaceDocument {
  /**
   * The grammar note's id.
   */
  readonly id: string;

  /**
   * The note.
   */
  readonly markdown: string;
}

/**
 * The live surface oracle file.
 */
export interface LiveSurfaceFile {
  /**
   * Where the notes were read.
   */
  readonly meta: SpecOracleMeta;

  /**
   * The count the Backlinks view shows for each target, by its path.
   */
  readonly paneCounts: Readonly<Record<string, number>>;

  /**
   * Every note of {@link liveSurfaceDocuments}, as the app read it.
   */
  readonly reads: readonly LiveSurfaceRead[];
}

/**
 * A live surface judge.
 */
export type LiveSurfaceJudge = 'backlinks' | 'openFile' | 'outline' | 'processFrontMatter' | 'renameFile' | 'resolvedLinks';

/**
 * One item of the Outline view.
 */
export interface LiveSurfaceOutlineItem {
  /**
   * How deep the view nests it: 0 for a top-level item.
   */
  readonly depth: number;

  /**
   * The text it shows.
   */
  readonly text: string;
}

/**
 * The Backlinks view's result for one note.
 */
export interface LiveSurfacePaneResult {
  /**
   * The `[from, to]` offsets of its matches in the body.
   */
  readonly content: readonly (readonly [number, number])[];

  /**
   * Its matches in the front matter, as the view holds them.
   */
  readonly properties: readonly unknown[];
}

/**
 * A note as the app read it.
 */
export interface LiveSurfaceRead extends LiveSurfaceDocument {
  /**
   * The Backlinks of each target the note links to, by the target's path.
   */
  readonly backlinks: Readonly<Record<string, LiveSurfaceBacklinks>>;

  /**
   * `metadataCache.getFileCache` of the note, or `null`, read before the note is opened.
   */
  readonly cache: unknown;

  /**
   * `metadataCache.getFileCache` of the note once it is open in the editor, or `null` where opening it changed nothing.
   */
  readonly cacheAfterOpen: unknown;

  /**
   * The Outline view's items, in order.
   */
  readonly outline: readonly LiveSurfaceOutlineItem[];

  /**
   * The note after `processFrontMatter` set {@link PROCESSED_KEY} to 1, or `null` where it threw.
   */
  readonly processedText: null | string;

  /**
   * The error `processFrontMatter` threw, or `null`.
   */
  readonly processError: null | string;

  /**
   * The note after every target was renamed to its {@link LiveSurfaceTarget.renamedPath}.
   */
  readonly renamedText: string;

  /**
   * `metadataCache.resolvedLinks` of the note.
   */
  readonly resolvedLinks: Readonly<Record<string, number>>;

  /**
   * The note after every target was renamed back.
   */
  readonly roundTripText: string;

  /**
   * `metadataCache.unresolvedLinks` of the note.
   */
  readonly unresolvedLinks: Readonly<Record<string, number>>;
}

/**
 * Every note the oracle reads: the first {@link LIVE_SURFACE_NOTE_COUNT} grammar notes.
 *
 * @returns The notes.
 */
export function liveSurfaceDocuments(): LiveSurfaceDocument[] {
  return generateNotes({ count: LIVE_SURFACE_NOTE_COUNT }).map((note) => ({ id: note.id, markdown: note.text }));
}

/**
 * The vault path of a note.
 *
 * @param id - The note's id.
 * @returns The path.
 */
export function liveSurfaceNotePath(id: string): string {
  return `${LIVE_SURFACE_NOTE_FOLDER}/${id}.md`;
}

/**
 * Every live surface judge, in the order {@link judgeLiveSurfaces} runs them.
 */
export const LIVE_SURFACE_JUDGES: readonly LiveSurfaceJudge[] = ['openFile', 'resolvedLinks', 'backlinks', 'outline', 'renameFile', 'processFrontMatter'];

/**
 * One relation a live surface breaks on a note.
 */
export interface LiveSurfaceFinding {
  /**
   * What was seen, for a person.
   */
  readonly detail: string;

  /**
   * The lines of the note the difference lies on, which its family is matched against: the oracle notes cannot be
   * reduced offline, since only the live app reads them.
   */
  readonly excerpt: string;

  /**
   * The judge that found it.
   */
  readonly judge: LiveSurfaceJudge;

  /**
   * The key the finding is grouped by: `<judge>:<what>`.
   */
  readonly key: string;
}

interface LinkItem {
  readonly key: null | string;
  readonly link: string;
  readonly original: string;
  readonly position: null | Pos;
}

const SUBPATH_PATTERN = /#.*$/su;

interface LinkItemSource {
  readonly key?: string;
  readonly link: string;
  readonly original: string;
  readonly position?: Pos;
}

interface PaneProperty {
  readonly key?: unknown;
}

/**
 * The count relation of the Backlinks view: the count it shows for a target is the number of matches it lists.
 *
 * @param file - The oracle file.
 * @returns The findings, keyed `backlinks:count`.
 */
export function judgeBacklinkCounts(file: LiveSurfaceFile): LiveSurfaceFinding[] {
  const findings: LiveSurfaceFinding[] = [];
  for (const target of LIVE_SURFACE_TARGETS) {
    let listed = 0;
    for (const read of file.reads) {
      const pane = read.backlinks[target.path]?.pane;
      listed += (pane?.content.length ?? 0) + (pane?.properties.length ?? 0);
    }
    const shown = file.paneCounts[target.path] ?? 0;
    if (shown !== listed) {
      findings.push({ detail: `the Backlinks view of ${target.path} shows ${String(shown)} but lists ${String(listed)} matches`, excerpt: '', judge: 'backlinks', key: 'backlinks:count' });
    }
  }
  return findings;
}

/**
 * The Backlinks relation: `getBacklinksForFile` of each target, and the Backlinks view of it, hold exactly the note's
 * cached links, embeds and front matter links that resolve to it, at the cache's positions and keys.
 *
 * @param read - The note as the app read it.
 * @returns The findings, keyed by the surface and the side that has the extra link.
 */
export function judgeBacklinks(read: LiveSurfaceRead): LiveSurfaceFinding[] {
  const cache = read.cache as CachedMetadata | null;
  const items = cache === null ? [] : linkItems(cache);
  const findings: LiveSurfaceFinding[] = [];
  for (const target of LIVE_SURFACE_TARGETS) {
    const expected = items.filter((item) => resolveLinkpath(item.link) === target.path);
    const backlinks = read.backlinks[target.path];
    const api = (backlinks?.api ?? []) as LinkItemSource[];
    compareSignatures(expected.map((item) => signatureOf(item)), api.map((item) => signatureOf(linkItemOf(item))), 'api');
    const pane = backlinks?.pane ?? null;
    const paneSignatures = [
      ...(pane?.content ?? []).map(([from, to]) => `${String(from)}-${String(to)}`),
      ...(pane?.properties ?? []).map((property) => `key ${String((property as PaneProperty).key)}`)
    ];
    const expectedPane = expected.map((item) => item.position === null ? `key ${String(item.key)}` : `${String(item.position.start.offset)}-${String(item.position.end.offset)}`);
    compareSignatures(expectedPane, paneSignatures, 'pane');
  }
  return findings;

  function compareSignatures(expected: readonly string[], actual: readonly string[], surface: string): void {
    const left = expected.toSorted(compareCodeUnits);
    const right = actual.toSorted(compareCodeUnits);
    if (left.join('\n') === right.join('\n')) {
      return;
    }
    const missing = left.filter((signature) => !right.includes(signature));
    const extra = right.filter((signature) => !left.includes(signature));
    const side = missing.length > 0 ? 'missing' : 'extra';
    findings.push({
      detail: `${surface} misses ${JSON.stringify(missing)} and adds ${JSON.stringify(extra)}`,
      excerpt: read.markdown,
      judge: 'backlinks',
      key: `backlinks:${surface}-${side}`
    });
  }
}

/**
 * Judges every note of an oracle file, and the file's Backlinks counts.
 *
 * @param file - The oracle file.
 * @returns The findings of each note, by its id, and the file's own under `''`.
 */
export function judgeLiveSurfaceFile(file: LiveSurfaceFile): Map<string, LiveSurfaceFinding[]> {
  const findings = new Map<string, LiveSurfaceFinding[]>();
  for (const read of file.reads) {
    findings.set(read.id, judgeLiveSurfaces(read));
  }
  findings.set('', judgeBacklinkCounts(file));
  return findings;
}

/**
 * Runs every live surface judge on a note.
 *
 * @param read - The note as the app read it.
 * @returns The findings.
 */
export function judgeLiveSurfaces(read: LiveSurfaceRead): LiveSurfaceFinding[] {
  return [...judgeOpenFile(read), ...judgeResolvedLinks(read), ...judgeBacklinks(read), ...judgeOutline(read), ...judgeRenameFile(read), ...judgeProcessFrontMatter(read)];
}

/**
 * The open relation: opening a note in the editor leaves its cache as the worker gave it, since its text is the same.
 *
 * @param read - The note as the app read it.
 * @returns The findings, keyed `openFile:cache`.
 */
export function judgeOpenFile(read: LiveSurfaceRead): LiveSurfaceFinding[] {
  if (read.cacheAfterOpen === null) {
    return [];
  }
  const before = String(JSON.stringify(read.cache));
  const after = String(JSON.stringify(read.cacheAfterOpen));
  let prefix = 0;
  while (before[prefix] === after[prefix]) {
    prefix++;
  }
  const context = 80;
  return [{
    detail: `opening the note changes its cache from ${before.slice(Math.max(0, prefix - context), prefix + context)} to ${after.slice(Math.max(0, prefix - context), prefix + context)}`,
    excerpt: read.markdown,
    judge: 'openFile',
    key: 'openFile:cache'
  }];
}

/**
 * The Outline relation: the view lists the cache's headings, nested by their levels, each showing the text Reading view
 * shows for it.
 *
 * @param read - The note as the app read it.
 * @returns The findings, keyed `outline:count`, `outline:depth` or `outline:text`.
 */
export function judgeOutline(read: LiveSurfaceRead): LiveSurfaceFinding[] {
  const cache = read.cache as CachedMetadata | null;
  const headings = cache?.headings ?? [];
  const lines = read.markdown.split('\n');
  if (headings.length !== read.outline.length) {
    return [{ detail: `the Outline view lists ${String(read.outline.length)} of ${String(headings.length)} headings`, excerpt: read.markdown, judge: 'outline', key: 'outline:count' }];
  }
  const tree = parseRemark(read.markdown);
  // A heading is rendered with the note's definitions, so a reference link in it resolves as it does in the note.
  const definitions: RemarkNode[] = [];
  walk(tree, (node) => {
    if (node.type === 'definition') {
      definitions.push(node);
    }
  });
  const shown = new Map<number, string>();
  walk(tree, (node) => {
    if (node.type === 'heading' && node.position !== undefined) {
      shown.set(node.position.start.offset, collapse(shownText({ children: [...definitions, node], type: 'root' })));
    }
  });
  const findings: LiveSurfaceFinding[] = [];
  const levels: number[] = [];
  for (const [index, heading] of headings.entries()) {
    while ((levels.at(-1) ?? 0) >= heading.level) {
      levels.pop();
    }
    const depth = levels.length;
    levels.push(heading.level);
    const item = read.outline[index];
    const excerpt = lines[heading.position.start.line] ?? '';
    if (item?.depth !== depth) {
      findings.push({ detail: `the heading ${JSON.stringify(heading.heading)} is nested at ${String(item?.depth)}, not ${String(depth)}`, excerpt, judge: 'outline', key: 'outline:depth' });
    }
    const expected = shown.get(heading.position.start.offset) ?? collapse(heading.heading);
    if (collapse(item?.text ?? '') !== expected) {
      findings.push({ detail: `the Outline view shows ${String(JSON.stringify(item?.text))} where Reading view shows ${JSON.stringify(expected)}`, excerpt, judge: 'outline', key: 'outline:text' });
    }
  }
  return findings;
}

/**
 * The `processFrontMatter` relation: setting one key leaves the body byte for byte, keeps every other value, and
 * changes the front matter's text only by the added line.
 *
 * @param read - The note as the app read it.
 * @returns The findings, keyed `processFrontMatter:throws`, `:body`, `:values` or `:restyled`.
 */
export function judgeProcessFrontMatter(read: LiveSurfaceRead): LiveSurfaceFinding[] {
  if (read.processedText === null) {
    return [{ detail: `processFrontMatter threw ${String(read.processError)}`, excerpt: read.markdown, judge: 'processFrontMatter', key: 'processFrontMatter:throws' }];
  }
  const cache = read.cache as CachedMetadata | null;
  const processed = parseMetadata(read.processedText);
  const end = processed?.frontmatterPosition?.end.offset;
  if (processed === null || end === undefined) {
    return [{ detail: 'the processed note has no front matter', excerpt: read.processedText, judge: 'processFrontMatter', key: 'processFrontMatter:no-front-matter' }];
  }
  const originalEnd = cache?.frontmatterPosition?.end.offset;
  const originalBody = originalEnd === undefined ? `\n${read.markdown}` : read.markdown.slice(originalEnd);
  const findings: LiveSurfaceFinding[] = [];
  if (read.processedText.slice(end) !== originalBody) {
    findings.push({ detail: `the body ${JSON.stringify(originalBody)} became ${JSON.stringify(read.processedText.slice(end))}`, excerpt: read.markdown, judge: 'processFrontMatter', key: 'processFrontMatter:body' });
  }
  const values = JSON.stringify({ ...cache?.frontmatter, [PROCESSED_KEY]: 1 });
  if (JSON.stringify(processed.frontmatter) !== values) {
    findings.push({ detail: `the front matter ${values} became ${String(JSON.stringify(processed.frontmatter))}`, excerpt: read.markdown, judge: 'processFrontMatter', key: 'processFrontMatter:values' });
  }
  const originalYaml = originalEnd === undefined ? '---\n' : read.markdown.slice(0, originalEnd - '---'.length);
  const processedYaml = read.processedText.slice(0, end);
  if (processedYaml !== `${originalYaml}${PROCESSED_KEY}: 1\n---`) {
    const excerpt = read.markdown.slice(0, originalEnd ?? 0);
    findings.push({ detail: `the front matter ${JSON.stringify(excerpt)} was written back as ${JSON.stringify(processedYaml)}`, excerpt, judge: 'processFrontMatter', key: 'processFrontMatter:restyled' });
  }
  return findings;
}

/**
 * The rename relation: a real `fileManager.renameFile` of every target changes the note only inside the cached links,
 * embeds and front matter links to it, each getting the new name, as the self-check `rename` judge simulates from the
 * cache's positions; and renaming every target back gives the note back.
 *
 * @param read - The note as the app read it.
 * @returns The findings, keyed `renameFile:front-matter`, `renameFile:body` or `renameFile:round-trip`.
 */
export function judgeRenameFile(read: LiveSurfaceRead): LiveSurfaceFinding[] {
  const cache = read.cache as CachedMetadata | null;
  const simulated = cache === null ? read.markdown : simulateRename(read.markdown, cache);
  if (read.renamedText !== simulated) {
    const end = parseMetadata(simulated)?.frontmatterPosition?.end.offset;
    const renamedEnd = parseMetadata(read.renamedText)?.frontmatterPosition?.end.offset;
    const isFrontMatterOnly = end !== undefined && renamedEnd !== undefined && read.renamedText.slice(renamedEnd) === simulated.slice(end);
    const excerpt = diffLines(simulated, read.renamedText);
    return [{
      detail: `the rename gives ${JSON.stringify(diffLines(read.renamedText, simulated))} where the cache's positions give ${JSON.stringify(excerpt)}`,
      excerpt,
      judge: 'renameFile',
      key: isFrontMatterOnly ? 'renameFile:front-matter' : 'renameFile:body'
    }];
  }
  if (read.roundTripText !== read.markdown) {
    const excerpt = diffLines(read.markdown, read.roundTripText);
    return [{ detail: `renaming back gives ${JSON.stringify(diffLines(read.roundTripText, read.markdown))} for ${JSON.stringify(excerpt)}`, excerpt, judge: 'renameFile', key: 'renameFile:round-trip' }];
  }
  return [];
}

/**
 * The `resolvedLinks` relation: every cached link, embed and front matter link is counted once, under the file it
 * resolves to in `resolvedLinks`, or under its link path in `unresolvedLinks`.
 *
 * @param read - The note as the app read it.
 * @returns The findings, keyed `resolvedLinks:resolved` or `resolvedLinks:unresolved`.
 */
export function judgeResolvedLinks(read: LiveSurfaceRead): LiveSurfaceFinding[] {
  const cache = read.cache as CachedMetadata | null;
  const resolved: Record<string, number> = {};
  const unresolved: Record<string, number> = {};
  const itemsByKey = new Map<string, LinkItem[]>();
  const items = cache === null ? [] : linkItems(cache);
  for (const item of items) {
    const target = resolveLinkpath(item.link);
    const linkpath = item.link.replace(SUBPATH_PATTERN, '');
    const key = target ?? linkpath;
    const counts = target === null ? unresolved : resolved;
    counts[key] = (counts[key] ?? 0) + 1;
    itemsByKey.set(key, [...itemsByKey.get(key) ?? [], item]);
  }
  const findings: LiveSurfaceFinding[] = [];
  const sides = [['resolved', resolved, read.resolvedLinks], ['unresolved', unresolved, read.unresolvedLinks]] as const;
  for (const [side, expected, actual] of sides) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (expected[key] === actual[key]) {
        continue;
      }
      const lines = read.markdown.split('\n');
      const excerpt = (itemsByKey.get(key) ?? []).map((item) => item.position === null ? item.original : lines[item.position.start.line] ?? '').join('\n') || read.markdown;
      findings.push({
        detail: `${side}Links counts ${JSON.stringify(key)} ${String(actual[key] ?? 0)} times, the cache ${String(expected[key] ?? 0)}`,
        excerpt,
        judge: 'resolvedLinks',
        key: `resolvedLinks:${side}`
      });
    }
  }
  return findings;
}

/**
 * The note a rename of every target gives by the cache's positions: each cached link, embed and front matter link to a
 * target gets the target's new name in place of the name it wrote, and nothing else changes.
 *
 * @param text - The note.
 * @param cache - Its cache.
 * @returns The renamed note.
 */
export function simulateRename(text: string, cache: CachedMetadata): string {
  const items = linkItems(cache).filter((item) => resolveLinkpath(item.link) !== null);
  let renamed = text;
  const positioned = items.filter((item) => item.position !== null).toSorted((left, right) => (right.position?.start.offset ?? 0) - (left.position?.start.offset ?? 0));
  for (const item of positioned) {
    const { end, start } = item.position ?? { end: { offset: 0 }, start: { offset: 0 } };
    renamed = renamed.slice(0, start.offset) + renamedOriginal(item) + renamed.slice(end.offset);
  }
  const frontMatterEnd = cache.frontmatterPosition?.end.offset ?? 0;
  let frontMatter = renamed.slice(0, frontMatterEnd);
  let from = 0;
  for (const item of items) {
    if (item.position !== null) {
      continue;
    }
    const at = frontMatter.indexOf(item.original, from);
    if (at === -1) {
      continue;
    }
    const replacement = renamedOriginal(item);
    frontMatter = frontMatter.slice(0, at) + replacement + frontMatter.slice(at + item.original.length);
    from = at + replacement.length;
  }
  return frontMatter + renamed.slice(frontMatterEnd);
}

function collapse(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

// The lines of `text` around where it first and last differs from `other`.
function diffLines(text: string, other: string): string {
  let prefix = 0;
  while (prefix < text.length && text[prefix] === other[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < text.length - prefix && suffix < other.length - prefix && text.at(-1 - suffix) === other.at(-1 - suffix)) {
    suffix++;
  }
  const from = text.lastIndexOf('\n', prefix - 1) + 1;
  const toBreak = text.indexOf('\n', text.length - suffix);
  return text.slice(from, toBreak === -1 ? text.length : toBreak);
}

function linkItemOf(source: LinkItemSource): LinkItem {
  return { key: source.key ?? null, link: source.link, original: source.original, position: source.position ?? null };
}

function linkItems(cache: CachedMetadata): LinkItem[] {
  return [...cache.links ?? [], ...cache.embeds ?? [], ...cache.frontmatterLinks ?? []].map((item) => linkItemOf(item as LinkItemSource));
}

// The new text of a link to a target: the name it wrote, with or without its extension, swapped for the new name.
function renamedOriginal(item: LinkItem): string {
  const target = LIVE_SURFACE_TARGETS.find((entry) => entry.path === resolveLinkpath(item.link));
  if (target === undefined) {
    return item.original;
  }
  const linkpath = item.link.replace(SUBPATH_PATTERN, '');
  const name = target.renamedPath.slice(LIVE_SURFACE_FOLDER.length + 1);
  const newName = linkpath.endsWith('.md') || !name.endsWith('.md') ? name : name.slice(0, -'.md'.length);
  const at = item.original.indexOf(linkpath);
  return at === -1 ? item.original : item.original.slice(0, at) + newName + item.original.slice(at + linkpath.length);
}

// The target a link resolves to, by its path without the subpath, as the app resolves the names the grammar writes.
function resolveLinkpath(link: string): null | string {
  const linkpath = link.replace(SUBPATH_PATTERN, '').toLowerCase();
  for (const target of LIVE_SURFACE_TARGETS) {
    const name = target.path.slice(LIVE_SURFACE_FOLDER.length + 1);
    const names = [name, target.path, ...name.endsWith('.md') ? [name.slice(0, -'.md'.length), target.path.slice(0, -'.md'.length)] : []];
    if (names.includes(linkpath)) {
      return target.path;
    }
  }
  return null;
}

function signatureOf(item: LinkItem): string {
  const where = item.position === null ? `key ${String(item.key)}` : `${String(item.position.start.offset)}-${String(item.position.end.offset)}`;
  return `${where} ${item.original}`;
}

function walk(node: RemarkNode, visit: (node: RemarkNode) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) {
      walk(child, visit);
    }
  }
}
