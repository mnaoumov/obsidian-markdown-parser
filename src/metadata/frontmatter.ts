/**
 * @file
 *
 * The front matter as the metadata worker reads it: its YAML parsed by `yaml` 2 with the options the worker passes,
 * and the internal links in its string values.
 *
 * The worker bundles `yaml`'s browser build, which reads a `!!binary` value with `atob` into a `Uint8Array`, where the
 * Node build makes a `Buffer`; {@link parseFrontmatter} puts the browser's reading in its place. Every 2.x release from
 * 2.6.0, the first with the options the worker's copy has, gives the worker's result on the fuzzed front matter it was
 * measured on.
 */

/* eslint-disable perfectionist/sort-objects -- Each item is built in the worker's key order, which a JSON comparison of the metadata sees. */

import type {
  ScalarTag,
  Tags
} from 'yaml';

import { parse } from 'yaml';

import type {
  FrontMatterCache,
  FrontmatterLinkCache
} from './types.ts';

import { parseInternalLink } from '../remark/obsidian.ts';
import {
  isLinkPath,
  WorkerFailure
} from './link-path.ts';

interface OwnKeyCheck {
  readonly hasOwnProperty?: unknown;
}

const BINARY_TAG = 'tag:yaml.org,2002:binary';
const INTERNAL_LINK_DELIMITER_LENGTH = 2;
const LINE_BREAKS_RE = /[\n\r]/gu;

/*
 * A markdown link or image as a whole string: its text, and a destination that is a `<...>` run or no space or `"`,
 * with an optional title. The destination may be missing, as in `[text]()`.
 */
const MARKDOWN_LINK_RE = /^(?<opening>!?\[)(?<text>.*?)(?<middle>\]\(\s*)(?<target>(?<destination><[^>]*?>|[^ "]+?)(?<title>\s+(?:[^ ]+|"[^"]+"|'[^']+'|\([^']+\)))?)?(?<closing>\s*\))$/u;

const BROWSER_BINARY: ScalarTag = {
  default: false,
  identify: (value) => value instanceof Uint8Array,
  resolve(source) {
    const binary = atob(source.replaceAll(LINE_BREAKS_RE, ''));
    return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
  },
  tag: BINARY_TAG
};

/**
 * The internal links in the string values of the front matter, at any depth: a value that is a whole `[[link]]`, and
 * one that is a whole markdown link whose destination is no URL.
 *
 * @param frontmatter - The front matter.
 * @returns The links, in the order of the keys.
 * @throws {@link WorkerFailure} where the worker throws: a markdown link with no destination, or an object whose
 * `hasOwnProperty` is a value of its own.
 */
export function frontmatterLinksOf(frontmatter: FrontMatterCache): FrontmatterLinkCache[] {
  const links: FrontmatterLinkCache[] = [];
  addLinksOfObject(links, '', frontmatter);
  return links;
}

/**
 * Parses the front matter's YAML as the worker does.
 *
 * @param yaml - The lines between the front matter's delimiters.
 * @returns The value, when it is an object and no array; `undefined` when it is anything else or does not parse.
 */
export function parseFrontmatter(yaml: string): FrontMatterCache | undefined {
  let value: unknown;
  try {
    value = parse(yaml, { customTags: withBrowserBinary, logLevel: 'error' });
  } catch {
    return undefined;
  }
  return value === null || typeof value !== 'object' || Array.isArray(value) ? undefined : (value as FrontMatterCache);
}

function addLinksOf(links: FrontmatterLinkCache[], parentKey: string, key: string, value: unknown): void {
  const path = parentKey ? `${parentKey}.${key}` : key;

  if (typeof value !== 'string') {
    addLinksOfObject(links, path, value);
    return;
  }

  if (value.startsWith('[[') && value.endsWith(']]')) {
    const { displayText, target } = parseInternalLink(value.slice(INTERNAL_LINK_DELIMITER_LENGTH, -INTERNAL_LINK_DELIMITER_LENGTH));
    links.push({ key: path, link: target, original: value, displayText });
  }

  if (!value.startsWith('[') || !value.endsWith(')')) {
    return;
  }

  const groups = MARKDOWN_LINK_RE.exec(value)?.groups;
  if (!groups) {
    return;
  }

  let destination = groups['destination'];
  if (destination === undefined) {
    throw new WorkerFailure(`A markdown link with no destination in the front matter: ${value}`);
  }
  if (destination.startsWith('<') && destination.endsWith('>')) {
    destination = destination.slice(1, -1).trim();
  }
  if (!isLinkPath(destination)) {
    return;
  }

  let link = destination;
  try {
    link = decodeURI(destination);
  } catch {
    // The worker keeps a destination `decodeURI` refuses as it is.
  }
  links.push({ key: path, link, original: value, displayText: groups['text'] ?? '' });
}

function addLinksOfObject(links: FrontmatterLinkCache[], path: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      addLinksOf(links, path, String(index), item);
    }
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const key in value) {
    if (isOwnKey(value, key)) {
      addLinksOf(links, path, key, (value as Record<string, unknown>)[key]);
    }
  }
}

// The worker calls the object's own `hasOwnProperty` for each key, which throws when a key of that name hides it.
function isOwnKey(value: object, key: string): boolean {
  if (typeof (value as OwnKeyCheck).hasOwnProperty !== 'function') {
    throw new WorkerFailure('A front matter object whose hasOwnProperty is one of its keys.');
  }
  return Object.hasOwn(value, key);
}

function withBrowserBinary(tags: Tags): Tags {
  return [...tags.filter((tag) => typeof tag === 'string' || tag.tag !== BINARY_TAG), BROWSER_BINARY];
}

/* eslint-enable perfectionist/sort-objects -- The worker's key order ends here. */
