/**
 * @file
 *
 * Turns the repository's `docs/*.md` pages into the documentation site's guides.
 *
 * The pages stay where they are, so the links to them from `AGENTS.md`, the README and the code keep working, and the
 * site gets a generated copy of each in `docs/src/content/docs/guides/`, which is not committed: its first heading
 * becomes the `title`, its first sentence the `description`, a link to another page becomes a link to that page on the
 * site, and a link to any other file of the repository becomes a link to that file on GitHub.
 */

import type {
  Definition,
  Link,
  Nodes,
  Root
} from 'mdast';

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import {
  join,
  normalize
} from 'node:path/posix';

import { DOCS_SITE_CONFIG } from './docs-site-config.ts';

/**
 * The pages in their sidebar order. Every `docs/*.md` page must be listed, so a new page is placed on purpose.
 */
const GUIDE_ORDER = [
  'write-up',
  'api',
  'architecture',
  'development',
  'syntax',
  'spec-suites',
  'remark',
  'metadata',
  'cm6-host',
  'demo-plugin',
  'phase-0',
  'phase-1',
  'oracles',
  'mode-judge',
  'self-check',
  'link-parity',
  'link-cases',
  'special-names',
  'remark-obsidian',
  'provenance'
] as const;

const GITHUB_URL = `https://github.com/mnaoumov/${DOCS_SITE_CONFIG.repo}`;
const GUIDES_BASE_PATH = `/${DOCS_SITE_CONFIG.repo}/guides/`;
const MAX_DESCRIPTION_LENGTH = 300;
const SOURCE_FOLDER = 'docs';
const LINK_DESTINATION_OPENER = '](';
const DEFINITION_SEPARATOR = ']:';

interface ConvertPageParams {
  readonly fileName: string;
  readonly index: number;
  readonly pageNames: readonly string[];
  readonly root: string;
  readonly source: string;
}

interface Replacement {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

interface RewriteDestinationParams {
  readonly fileName: string;
  readonly node: Definition | Link;
  readonly pageNames: readonly string[];
  readonly root: string;
  readonly source: string;
}

interface SourceRange {
  readonly end: number;
  readonly start: number;
}

/**
 * Writes every `docs/*.md` page as a guide into `docs/src/content/docs/guides/`, replacing what was there.
 *
 * @param root - The repository root.
 * @throws If a page is not in {@link GUIDE_ORDER}, has no first-level heading, or links a file that does not exist.
 */
export function generateGuides(root: string): void {
  const sourceFolder = join(root, SOURCE_FOLDER);
  const pageNames = readdirSync(sourceFolder)
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => fileName.slice(0, -'.md'.length));
  const order: readonly string[] = GUIDE_ORDER;
  const unordered = pageNames.filter((name) => !order.includes(name));
  if (unordered.length > 0) {
    throw new Error(`Add these docs pages to GUIDE_ORDER in scripts/docs/docs-guides.ts: ${unordered.join(', ')}`);
  }
  const missing = order.filter((name) => !pageNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`GUIDE_ORDER names pages docs/ does not have: ${missing.join(', ')}`);
  }

  const outputFolder = join(sourceFolder, 'src', 'content', 'docs', 'guides');
  rmSync(outputFolder, { force: true, recursive: true });
  mkdirSync(outputFolder, { recursive: true });

  for (const [index, name] of GUIDE_ORDER.entries()) {
    const fileName = `${name}.md`;
    const source = readFileSync(join(sourceFolder, fileName), 'utf-8').replaceAll('\r\n', '\n');
    const guide = convertPage({ fileName, index, pageNames, root, source });
    writeFileSync(join(outputFolder, fileName), guide);
  }
}

function applyReplacements(source: string, replacements: readonly Replacement[]): string {
  let result = source;
  const lastFirst = replacements.toSorted((a, b) => b.start - a.start);
  for (const replacement of lastFirst) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}

function collectNodes(node: Nodes, found: (Definition | Link)[]): void {
  if (node.type === 'link' || node.type === 'definition') {
    found.push(node);
  }
  if (node.type === 'image' && !isExternal(node.url)) {
    throw new Error(`A docs page embeds the local image ${node.url}, which the guide generator does not copy`);
  }
  if ('children' in node) {
    for (const child of node.children) {
      collectNodes(child, found);
    }
  }
}

function convertPage(params: ConvertPageParams): string {
  const { fileName, index, pageNames, root, source } = params;
  const tree: Root = fromMarkdown(source, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()]
  });

  const headingIndex = tree.children.findIndex((node) => node.type === 'heading' && node.depth === 1);
  const heading = tree.children[headingIndex];
  if (heading?.type !== 'heading' || heading.position === undefined) {
    throw new Error(`docs/${fileName} has no first-level heading to take its title from`);
  }
  const title = toPlainText(heading);
  const paragraph = tree.children.slice(headingIndex + 1).find((node) => node.type === 'paragraph');
  const description = paragraph === undefined ? undefined : firstSentence(toPlainText(paragraph));

  const links: (Definition | Link)[] = [];
  collectNodes(tree, links);
  const replacements: Replacement[] = [];
  for (const node of links) {
    const replacement = rewriteDestination({ fileName, node, pageNames, root, source });
    if (replacement !== null) {
      replacements.push(replacement);
    }
  }
  const headingStart = heading.position.start.offset ?? 0;
  const headingEnd = heading.position.end.offset ?? 0;
  replacements.push({ end: source.startsWith('\n', headingEnd) ? headingEnd + 1 : headingEnd, start: headingStart, text: '' });

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    ...(description === undefined ? [] : [`description: ${JSON.stringify(description)}`]),
    `editUrl: ${JSON.stringify(`${GITHUB_URL}/edit/main/${SOURCE_FOLDER}/${fileName}`)}`,
    'sidebar:',
    `  order: ${String(index + 1)}`,
    '---',
    '',
    `<!-- Generated from ${SOURCE_FOLDER}/${fileName} by scripts/docs/docs-guides.ts. Edit that file, not this one. -->`,
    '',
    ''
  ].join('\n');

  return frontmatter + applyReplacements(source, replacements).trimStart();
}

function findDestination(source: string, node: Definition | Link): null | SourceRange {
  const nodeStart = node.position?.start.offset;
  const nodeEnd = node.position?.end.offset;
  if (nodeStart === undefined || nodeEnd === undefined) {
    return null;
  }

  let position: number;
  if (node.type === 'link') {
    const lastChild = node.children.at(-1);
    const textEnd = lastChild?.position?.end.offset ?? nodeStart + 1;
    const closing = source.indexOf(LINK_DESTINATION_OPENER, textEnd);
    if (closing === -1 || closing >= nodeEnd) {
      // An autolink or a link written `<url>`: it has no destination to rewrite.
      return null;
    }
    position = closing + LINK_DESTINATION_OPENER.length;
  } else {
    const colon = source.indexOf(DEFINITION_SEPARATOR, nodeStart);
    position = colon + DEFINITION_SEPARATOR.length;
  }

  while (position < nodeEnd && /\s/.test(source.charAt(position))) {
    position++;
  }
  const start = position;
  if (source.charAt(position) === '<') {
    return { end: source.indexOf('>', position) + 1, start };
  }
  let depth = 0;
  while (position < nodeEnd) {
    const character = source.charAt(position);
    if (character === '\\') {
      // Skip the backslash and the character it escapes.
      position += String.raw`\x`.length;
      continue;
    }
    if (/\s/.test(character)) {
      break;
    }
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      if (depth === 0) {
        break;
      }
      depth--;
    }
    position++;
  }
  return { end: position, start };
}

function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/s.exec(text);
  const sentence = (match?.[0] ?? text).replaceAll(/\s+/g, ' ').trim();
  return sentence.length <= MAX_DESCRIPTION_LENGTH ? sentence : `${sentence.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

function isExternal(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//');
}

function rewriteDestination(params: RewriteDestinationParams): null | Replacement {
  const { fileName, node, pageNames, root, source } = params;
  if (isExternal(node.url) || node.url === '') {
    return null;
  }
  const destination = findDestination(source, node);
  if (destination === null) {
    return null;
  }

  const hashIndex = node.url.indexOf('#');
  const path = hashIndex === -1 ? node.url : node.url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : node.url.slice(hashIndex);

  const pageMatch = /^(?:\.\/)?(?<name>[^/]+)\.md$/.exec(path);
  const pageName = pageMatch?.groups?.['name'];
  if (pageName !== undefined && pageNames.includes(pageName)) {
    return { ...destination, text: `${GUIDES_BASE_PATH}${pageName.toLowerCase()}/${hash}` };
  }

  const repoPath = normalize(join(SOURCE_FOLDER, path));
  if (repoPath.startsWith('..')) {
    throw new Error(`docs/${fileName} links ${node.url}, which is outside the repository`);
  }
  const fullPath = join(root, repoPath);
  if (!existsSync(fullPath)) {
    throw new Error(`docs/${fileName} links ${node.url}, which does not exist`);
  }
  const kind = statSync(fullPath).isDirectory() ? 'tree' : 'blob';
  const urlPath = repoPath.replace(/\/$/, '').split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return { ...destination, text: `${GITHUB_URL}/${kind}/main/${urlPath}${hash}` };
}

function toPlainText(node: Nodes): string {
  if ('value' in node && (node.type === 'text' || node.type === 'inlineCode')) {
    return node.value;
  }
  if ('children' in node) {
    return node.children.map((child) => toPlainText(child)).join('');
  }
  return node.type === 'break' ? ' ' : '';
}
