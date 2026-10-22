/**
 * @file
 *
 * The metadata entry point (`obsidian-markdown-parser/metadata`, and the root of the metadata package): the
 * `CachedMetadata` Obsidian's metadata worker posts for a document.
 *
 * - {@link parseMetadata} gives that `CachedMetadata`, built from the remark engine's tree, equal to the worker's as
 *   JSON.
 *
 * Its import closure is the remark engine plus `yaml` and three entity tables, with no editor or CodeMirror
 * dependency, which `metadata-package.test.ts` pins.
 */

export { parseMetadata } from '../metadata/metadata.ts';

export type {
  BlockCache,
  CachedMetadata,
  CacheItem,
  EmbedCache,
  FootnoteCache,
  FootnoteReferenceCache,
  FrontMatterCache,
  FrontmatterLinkCache,
  HeadingCache,
  LinkCache,
  ListItemCache,
  Loc,
  Pos,
  ReferenceCache,
  ReferenceLinkCache,
  SectionCache,
  TagCache
} from '../metadata/types.ts';
