/**
 * @file
 *
 * Hosts the editor-class tokenizer in CodeMirror 6 as a {@link Language}, the way Obsidian's editor hosts its mode.
 *
 * CodeMirror 6's `StreamLanguage` cannot run the tokenizer: it gives a mode no way to read the lines after the current
 * one, and setext headings and tables need them. This host reads the document through the parser's `Input`, so the
 * mode's `lookAhead` reads the real next lines.
 *
 * The tree has the shape of the editor's: a line with line classes is a node named by them, holding its tokens, and
 * every token is a node named by its classes, sorted and joined by `_`. Lines are grouped into chunks, anonymous nodes
 * a tree cursor steps through, and each chunk records the state after its last line and how far its lines read,
 * lookahead included. A new parse after an edit resumes from the last chunk whose reads all lie before the edit, and
 * once a line after the edit ends in the state the earlier parse had there, it reuses the earlier parse's chunks. In an
 * editor, the parse and the reuse stop at the end of the viewport.
 *
 * Obsidian's editor renders classes from two node props its copy of `@codemirror/language` adds, `lineClassNodeProp`
 * and `tokenClassNodeProp`, which the public package does not have; a host inside Obsidian passes them as options.
 */

import type {
  Input,
  PartialParse,
  TreeFragment
} from '@lezer/common';

import {
  defineLanguageFacet,
  Language,
  languageDataProp,
  ParseContext
} from '@codemirror/language';
import {
  NodeProp,
  NodeSet,
  NodeType,
  Parser,
  Tree
} from '@lezer/common';

import type {
  EditorClassOptions,
  LineState
} from './highlight.ts';

import { compareCodeUnits } from '../oracle/score.ts';
import {
  areLineStatesEqual,
  copyLineState,
  isLineStateResumable,
  startLineState,
  tokenizeLine
} from './highlight.ts';

/**
 * Options of {@link createEditorClassLanguage}. A host inside Obsidian passes the app's `apiVersion` as
 * `obsidianVersion`.
 */
export interface CreateEditorClassLanguageOptions extends EditorClassOptions {
  /**
   * How many characters a chunk spans before it is closed, at a line end. A chunk is the unit of reuse after an edit and
   * of work per `advance` call.
   *
   * @default 512
   */
  readonly chunkSize?: number;

  /**
   * A further node prop that carries a line node's classes, joined by spaces. Obsidian's editor renders a line's
   * classes from the `lineClassNodeProp` its copy of `@codemirror/language` adds, so a host there passes that prop.
   */
  readonly lineClassNodeProperty?: NodeProp<string>;

  /**
   * A further node prop that carries a token node's classes, joined by spaces. Obsidian's editor renders a token's
   * classes from the `tokenClassNodeProp` its copy of `@codemirror/language` adds, so a host there passes that prop.
   */
  readonly tokenClassNodeProperty?: NodeProp<string>;
}

interface ChunkInfo {
  // The index of the line after the chunk.
  readonly lineIndex: number;
  // How far past the chunk's start its lines read: their own newlines and any line read ahead.
  readonly readLength: number;
  readonly state: LineState;
}

interface FoundState {
  readonly info: ChunkInfo;
  readonly pos: number;
}

// A chunk of an earlier tree, in document coordinates.
interface FragmentChunk {
  readonly from: number;
  readonly info: ChunkInfo;
  // The state and line index after the chunk before it, or `null` when no chunk ends where this one starts.
  readonly previous: ChunkInfo | null;
  readonly tree: Tree;
}

interface ParseRange {
  readonly from: number;
  readonly to: number;
}

interface ParseStart {
  readonly lineIndex: number;
  readonly state: LineState;
  readonly tree: Tree;
}

// A fragment of an earlier tree that a parse may reuse chunks from, with the range it may read in.
interface ReusableFragment {
  chunks: null | readonly FragmentChunk[];
  readonly fragment: TreeFragment;
  readonly from: number;
  readonly to: number;
}

interface TakeChunksParams {
  readonly firstIndex: number;
  readonly lineShift: number;
  readonly parseEnd: number;
  readonly reusable: ReusableFragment;
}

/**
 * The classes of a token node's type.
 */
export const tokenClassesProperty = new NodeProp<readonly string[]>();

/**
 * The classes of a line node's type, rendered on `.cm-line`.
 */
export const lineClassesProperty = new NodeProp<readonly string[]>();

const DEFAULT_CHUNK_SIZE = 512;
// Like `StreamLanguage`, keep this far from a fragment's open end, where the edit was.
const OPEN_EDGE_MARGIN = 25;
// Like `StreamLanguage`, parse a viewport this far past the parsed text from a fresh state instead.
const MAX_DISTANCE_BEFORE_VIEWPORT = 100_000;
const NODE_SIZE = 4;
// A node in the buffer is its type, start, end and size.
const NODE_END_OFFSET = 2;
const HALVES = 2;

const chunkProperty = new NodeProp<ChunkInfo>({ perNode: true });
// As in `StreamLanguage`, node types are added as new class sets appear, so the set's array grows after it is made.
const typeArray: NodeType[] = [NodeType.none];
const nodeSet = new NodeSet(typeArray);
const typeIds = new Map<string, number>();

class EditorClassHost {
  public readonly chunkSize: number;
  public readonly classOptions: EditorClassOptions;
  public readonly lineClassNodeProperty: NodeProp<string> | undefined;
  public readonly tokenClassNodeProperty: NodeProp<string> | undefined;
  public readonly topNode: NodeType;
  // Node types are shared by every host that adds no prop; a host that adds one gets types of its own.
  public readonly typeKeyPrefix: string;

  public constructor(options: CreateEditorClassLanguageOptions, data: ReturnType<typeof defineLanguageFacet>) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.lineClassNodeProperty = options.lineClassNodeProperty;
    this.classOptions = options;
    this.tokenClassNodeProperty = options.tokenClassNodeProperty;
    // eslint-disable-next-line unicorn/name-replacements -- Lezer's option name.
    this.topNode = NodeType.define({ id: typeArray.length, name: 'Document', props: [[languageDataProp, data]], top: true });
    this.typeKeyPrefix = this.lineClassNodeProperty || this.tokenClassNodeProperty ? `${String(this.topNode.id)}:` : '';
    typeArray.push(this.topNode);
  }
}

/* eslint-disable unicorn/consistent-class-member-order -- perfectionist/sort-classes orders public members first, and the two rules disagree. */
class EditorClassParse implements PartialParse {
  public parsedPos: number;
  public stoppedAt: null | number = null;
  private buffer: number[] = [];
  private readonly chunkPositions: number[] = [];
  private chunkReadTo: number;
  private readonly chunks: Tree[] = [];
  private chunkStart: number;
  private readonly from: number;
  private lineIndex: number;
  private readonly lineTexts = new Map<number, string>();
  private readonly reusableFragments: ReusableFragment[] = [];
  private state: LineState;
  private readonly to: number;

  public constructor(
    private readonly host: EditorClassHost,
    private readonly input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly ParseRange[]
  ) {
    const [first, ...rest] = ranges;
    if (!first || rest.length > 0) {
      throw new Error('The editor-class language parses exactly one range');
    }
    this.from = first.from;
    this.to = first.to;
    const start = this.findStartInFragments(fragments);
    this.state = start.state;
    this.lineIndex = start.lineIndex;
    this.parsedPos = this.from + start.tree.length;
    for (const [index, child] of start.tree.children.entries()) {
      this.chunks.push(child as Tree);
      this.chunkPositions.push(start.tree.positions[index] ?? 0);
    }
    const context = ParseContext.get();
    if (context && this.parsedPos < context.viewport.from - MAX_DISTANCE_BEFORE_VIEWPORT && this.to >= context.viewport.from) {
      const line = context.state.doc.lineAt(context.viewport.from);
      context.skipUntilInView(this.parsedPos, line.from);
      this.state = startLineState(this.host.classOptions);
      this.lineIndex = line.number - 1;
      this.parsedPos = line.from;
    }
    this.chunkStart = this.parsedPos;
    this.chunkReadTo = this.parsedPos;
    for (const fragment of fragments) {
      const from = fragment.from + (fragment.openStart ? OPEN_EDGE_MARGIN : 0);
      const to = fragment.to - (fragment.openEnd ? OPEN_EDGE_MARGIN : 0);
      if (from < to && to > this.parsedPos) {
        this.reusableFragments.push({ chunks: null, fragment, from, to });
      }
    }
  }

  public advance(): null | Tree {
    const context = ParseContext.get();
    const parseEnd = this.stoppedAt === null ? this.to : Math.min(this.to, this.stoppedAt);
    /*
     * In an editor, a parse stops at the end of the viewport, as `StreamLanguage`'s does, and so do the chunks reused
     * after an edit: live preview walks the whole tree on every change, so a tree past the viewport costs every keystroke.
     */
    const viewEnd = context ? Math.min(parseEnd, context.viewport.to) : parseEnd;
    const end = Math.min(viewEnd, this.chunkStart + this.host.chunkSize);
    while (this.parsedPos < end) {
      this.parseLine();
      this.reuseChunks(viewEnd);
    }
    if (this.chunkStart < this.parsedPos) {
      this.finishChunk();
    }
    if (this.parsedPos >= parseEnd) {
      return this.finish();
    }
    if (context && this.parsedPos >= context.viewport.to) {
      context.skipUntilInView(this.parsedPos, parseEnd);
      return this.finish();
    }
    return null;
  }

  public stopAt(pos: number): void {
    this.stoppedAt = pos;
  }

  private cutTree(tree: Tree, from: number, to: number, isInside: boolean): null | Tree {
    if (isInside && from <= 0 && to >= tree.length) {
      return tree;
    }
    const isInsideHere = isInside || (from === 0 && tree.type === this.host.topNode);
    for (let index = tree.children.length - 1; index >= 0; index--) {
      const pos = tree.positions[index] ?? 0;
      const child = tree.children[index];
      if (pos < to && child instanceof Tree) {
        const inner = this.cutTree(child, from - pos, to - pos, isInsideHere);
        if (!inner) {
          break;
        }
        return isInsideHere
          ? new Tree(tree.type, [...tree.children.slice(0, index), inner], tree.positions.slice(0, index + 1), pos + inner.length)
          : inner;
      }
    }
    return null;
  }

  private findStartInFragments(fragments: readonly TreeFragment[]): ParseStart {
    for (const fragment of fragments) {
      const fragmentFrom = fragment.from + (fragment.openStart ? OPEN_EDGE_MARGIN : 0);
      const fragmentTo = fragment.to - (fragment.openEnd ? OPEN_EDGE_MARGIN : 0);
      if (fragmentFrom > this.from || fragmentTo <= this.from) {
        continue;
      }
      const found = findState(fragment.tree, -fragment.offset, this.from, fragmentTo);
      if (!found || found.pos > this.to) {
        continue;
      }
      const tree = this.cutTree(fragment.tree, this.from + fragment.offset, found.pos + fragment.offset, false);
      if (tree) {
        return { lineIndex: found.info.lineIndex, state: copyLineState(found.info.state), tree };
      }
    }
    return { lineIndex: 0, state: startLineState(this.host.classOptions), tree: Tree.empty };
  }

  private finish(): Tree {
    return new Tree(this.host.topNode, this.chunks, this.chunkPositions, this.parsedPos - this.from).balance();
  }

  private finishChunk(): void {
    const built = Tree.build({
      buffer: this.buffer,
      length: this.parsedPos - this.chunkStart,
      nodeSet,
      start: this.chunkStart,
      topID: 0
    });
    const info: ChunkInfo = { lineIndex: this.lineIndex, readLength: this.chunkReadTo - this.chunkStart, state: copyLineState(this.state) };
    this.chunks.push(new Tree(built.type, built.children, built.positions, built.length, [[chunkProperty, info]]));
    this.chunkPositions.push(this.chunkStart - this.from);
    this.buffer = [];
    this.chunkStart = this.parsedPos;
    this.chunkReadTo = this.parsedPos;
  }

  private parseLine(): void {
    const lineFrom = this.parsedPos;
    const line = this.readLineAt(lineFrom);
    this.lineTexts.delete(lineFrom);
    const lineEnd = lineFrom + line.length;
    // A line depends on its own newline: without one it is the last line, and an empty last line is never parsed.
    let readTo = lineEnd + 1;
    const readLine = (n: number): string | undefined => {
      let pos = lineEnd;
      let text: string | undefined = line;
      for (let step = 0; step < n; step++) {
        if (pos >= this.to) {
          readTo = Math.max(readTo, this.to + 1);
          return undefined;
        }
        text = this.readLineAt(pos + 1);
        this.lineTexts.set(pos + 1, text);
        pos += 1 + text.length;
      }
      readTo = Math.max(readTo, pos + 1);
      return text;
    };
    const { classes, spans } = tokenizeLine({ line, lineIndex: this.lineIndex, readLine, state: this.state });
    let childCount = 0;
    for (const span of spans) {
      const id = typeId(this.host, tokenClassesProperty, span.classes);
      const last = this.buffer.length - NODE_SIZE;
      // As in `StreamLanguage`, a token right after one of the same type extends it.
      if (childCount > 0 && this.buffer[last] === id && this.buffer[last + NODE_END_OFFSET] === lineFrom + span.from) {
        this.buffer[last + NODE_END_OFFSET] = lineFrom + span.to;
        continue;
      }
      this.buffer.push(id, lineFrom + span.from, lineFrom + span.to, NODE_SIZE);
      childCount++;
    }
    if (classes.length > 0) {
      this.buffer.push(typeId(this.host, lineClassesProperty, classes), lineFrom, lineEnd, NODE_SIZE * (childCount + 1));
    }
    this.chunkReadTo = Math.max(this.chunkReadTo, readTo);
    this.lineIndex++;
    this.parsedPos = lineEnd < this.to ? lineEnd + 1 : lineEnd;
  }

  private readLineAt(from: number): string {
    const cached = this.lineTexts.get(from);
    if (cached !== undefined) {
      return cached;
    }
    let text = '';
    let pos = from;
    while (pos < this.to) {
      const chunk = this.input.chunk(pos);
      if (chunk.length === 0 || (chunk === '\n' && this.input.lineChunks)) {
        break;
      }
      const eol = chunk.indexOf('\n');
      if (eol !== -1) {
        text += chunk.slice(0, eol);
        break;
      }
      text += chunk;
      pos += chunk.length;
    }
    return text.slice(0, this.to - from);
  }

  /*
   * Once a line ends in the state an earlier parse had at the same text, the lines after it give what they gave then. So
   * when an earlier tree has a chunk starting here, after a chunk that ended in an equal state, its chunks are reused
   * for as long as their reads stay in the text the edit left unchanged.
   */
  private reuseChunks(parseEnd: number): void {
    for (const reusable of this.reusableFragments) {
      if (this.parsedPos < reusable.from || this.parsedPos >= reusable.to) {
        continue;
      }
      reusable.chunks ??= fragmentChunks(reusable.fragment);
      const firstIndex = findChunkIndex(reusable.chunks, this.parsedPos);
      const first = reusable.chunks[firstIndex];
      if (
        first?.from === this.parsedPos
        && first.previous
        && isChunkReusable(first, reusable, parseEnd)
        // The stored state is a copy, and a copy drops what the mode carries only within a line, so compare a copy.
        && areLineStatesEqual(copyLineState(this.state), first.previous.state)
      ) {
        this.takeChunks({ firstIndex, lineShift: this.lineIndex - first.previous.lineIndex, parseEnd, reusable });
        return;
      }
    }
  }

  // Takes a fragment's chunks from `firstIndex` on, while they are contiguous and reusable, and parses on after them.
  private takeChunks(params: TakeChunksParams): void {
    const { firstIndex, lineShift, parseEnd, reusable } = params;
    const chunks = reusable.chunks ?? [];
    let lastIndex = firstIndex;
    while (lastIndex + 1 < chunks.length && isNextChunkReusable(chunks[lastIndex + 1], reusable, parseEnd)) {
      lastIndex++;
    }
    // The parse goes on from the last chunk's state, so that chunk must end at a resume point, or where the parse ends.
    while (lastIndex >= firstIndex && !isChunkEndResumable(chunks[lastIndex], parseEnd)) {
      lastIndex--;
    }
    const last = chunks[lastIndex];
    if (!last || lastIndex < firstIndex) {
      return;
    }
    if (this.chunkStart < this.parsedPos) {
      this.finishChunk();
    }
    const taken = chunks.slice(firstIndex, lastIndex + 1);
    for (const chunk of taken) {
      this.chunks.push(lineShift === 0 ? chunk.tree : shiftChunkLines(chunk, lineShift));
      this.chunkPositions.push(chunk.from - this.from);
    }
    this.parsedPos = last.from + last.tree.length;
    this.state = copyLineState(last.info.state);
    this.lineIndex = last.info.lineIndex + lineShift;
    this.chunkStart = this.parsedPos;
    this.chunkReadTo = this.parsedPos;
    this.lineTexts.clear();
  }
}
/* eslint-enable unicorn/consistent-class-member-order -- The rule is off for EditorClassParse only. */

class EditorClassParser extends Parser {
  public constructor(private readonly host: EditorClassHost) {
    super();
  }

  public override createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly ParseRange[]): PartialParse {
    return new EditorClassParse(this.host, input, fragments, ranges);
  }
}

/**
 * Creates the editor-class tokenizer as a CodeMirror 6 language.
 *
 * @param options - The options.
 * @returns The language.
 */
export function createEditorClassLanguage(options: CreateEditorClassLanguageOptions = {}): Language {
  const data = defineLanguageFacet();
  const host = new EditorClassHost(options, data);
  return new Language(data, new EditorClassParser(host), [], 'obsidian-markdown');
}

// The index of the first chunk starting at or after `pos`.
function findChunkIndex(chunks: readonly FragmentChunk[], pos: number): number {
  let low = 0;
  let high = chunks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / HALVES);
    if ((chunks[middle]?.from ?? Infinity) < pos) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

// Finds the last chunk whose reads end before `before`, starting at or after `startPos`, and ending at a resume point.
function findState(tree: Tree, offset: number, startPos: number, before: number): FoundState | null {
  const info = tree.prop(chunkProperty);
  if (info && offset >= startPos && offset + info.readLength <= before && isLineStateResumable(info.state)) {
    return { info, pos: offset + tree.length };
  }
  for (let index = tree.children.length - 1; index >= 0; index--) {
    const child = tree.children[index];
    const pos = offset + (tree.positions[index] ?? 0);
    if (!(child instanceof Tree) || pos >= before) {
      continue;
    }
    const found = findState(child, pos, startPos, before);
    if (found) {
      return found;
    }
  }
  return null;
}

// The chunks of a fragment's tree in document order, each with the chunk that ends where it starts.
function fragmentChunks(fragment: TreeFragment): FragmentChunk[] {
  const chunks: FragmentChunk[] = [];
  let previous: FragmentChunk | null = null;
  function visit(tree: Tree, from: number): void {
    const info = tree.prop(chunkProperty);
    if (info) {
      const chunk: FragmentChunk = { from, info, previous: previous && previous.from + previous.tree.length === from ? previous.info : null, tree };
      chunks.push(chunk);
      previous = chunk;
      return;
    }
    for (const [index, child] of tree.children.entries()) {
      if (child instanceof Tree) {
        visit(child, from + (tree.positions[index] ?? 0));
      }
    }
  }
  visit(fragment.tree, -fragment.offset);
  return chunks;
}

/*
 * The same text as an internalized string. Live preview splits a token's classes on every node of the tree on every
 * change, and V8 caches a split only for an internalized string, which one made by `join` is not: it took twice as long
 * on the parser's tree as on the stock one. An object's key is internalized.
 */
function internalize(text: string): string {
  return Object.keys({ [text]: 0 })[0] ?? text;
}

// A parse may go on from a chunk's state when the state is a resume point, and has nothing to go on with past its end.
function isChunkEndResumable(chunk: FragmentChunk | undefined, parseEnd: number): boolean {
  return !!chunk && (chunk.from + chunk.tree.length >= parseEnd || isLineStateResumable(chunk.info.state));
}

// A chunk is reused only when the text it read is unchanged and it ends where the parse may.
function isChunkReusable(chunk: FragmentChunk, reusable: ReusableFragment, parseEnd: number): boolean {
  return chunk.from >= reusable.from && chunk.from + chunk.info.readLength <= reusable.to && chunk.from + chunk.tree.length <= parseEnd;
}

// A chunk after a reused one is reused too when it starts where that one ends and is reusable itself.
function isNextChunkReusable(chunk: FragmentChunk | undefined, reusable: ReusableFragment, parseEnd: number): chunk is FragmentChunk {
  return !!chunk?.previous && isChunkReusable(chunk, reusable, parseEnd);
}

function shiftChunkLines(chunk: FragmentChunk, lineShift: number): Tree {
  const info: ChunkInfo = { ...chunk.info, lineIndex: chunk.info.lineIndex + lineShift };
  return new Tree(chunk.tree.type, chunk.tree.children, chunk.tree.positions, chunk.tree.length, [[chunkProperty, info]]);
}

function typeId(host: EditorClassHost, property: NodeProp<readonly string[]>, classes: readonly string[]): number {
  const sorted = classes.toSorted(compareCodeUnits);
  const isLine = property === lineClassesProperty;
  const key = `${host.typeKeyPrefix}${isLine ? 'line' : 'token'}:${JSON.stringify(sorted)}`;
  let id = typeIds.get(key);
  if (id === undefined) {
    id = typeArray.length;
    const properties: [NodeProp<readonly string[]> | NodeProp<string>, readonly string[] | string][] = [[property, sorted]];
    const classProperty = isLine ? host.lineClassNodeProperty : host.tokenClassNodeProperty;
    if (classProperty) {
      properties.push([classProperty, internalize(sorted.join(' '))]);
    }
    // eslint-disable-next-line unicorn/name-replacements -- Lezer's option name.
    typeArray.push(NodeType.define({ id, name: sorted.join('_'), props: properties }));
    typeIds.set(key, id);
  }
  return id;
}

/**
 * The editor-class tokenizer as a CodeMirror 6 language.
 */
export const editorClassLanguage = createEditorClassLanguage();
