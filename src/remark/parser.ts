/**
 * @file
 *
 * The core of the `remark-parse` 8 engine: a TypeScript port of `remark-parse` 8.0.3's parser, tokenizer factory,
 * position tracking and unescaping (MIT, Titus Wormer), with `vfile-location` 3 and `state-toggle` folded in.
 *
 * It is configured as Obsidian runs it, `commonmark: true` and `gfm: true`, so the branches of the other modes are
 * gone. The tokenizers are in `block.ts` and `inline.ts`.
 */

/* eslint-disable no-magic-numbers, no-useless-assignment, unicorn/consistent-boolean-name, unicorn/consistent-class-member-order, unicorn/no-break-in-nested-loop, unicorn/prefer-ternary -- A line-for-line port: its control flow and names stay as upstream wrote them, and perfectionist/sort-classes orders public members first. */

import type {
  RemarkNode,
  RemarkParent,
  RemarkPoint,
  RemarkPosition,
  RemarkRoot
} from './types.ts';

import { decodeEntities } from './entities.ts';

/**
 * Whether a block tokenizer can start at a place, from the code of its first character and of its first character after
 * spaces and tabs. Either is `NaN` at the end of the value.
 */
export type BlockStart = (firstCode: number, afterIndentCode: number) => boolean;

/**
 * A block tokenizer: eats a block at the start of `value`, or, with `silent`, says whether it would.
 */
export type BlockTokenizer = (parser: RemarkParser, eat: Eat, value: string, isSilent: boolean) => TokenizerResult;

/**
 * The name of a block tokenizer, in the order they are tried.
 */
export type BlockTokenizerName =
  | 'atxHeading'
  | 'blankLine'
  | 'blockId'
  | 'blockquote'
  | 'comment'
  | 'definition'
  | 'fencedCode'
  | 'footnoteDefinition'
  | 'frontmatter'
  | 'html'
  | 'indentedCode'
  | 'list'
  | 'math'
  | 'paragraph'
  | 'setextHeading'
  | 'table'
  | 'thematicBreak';

/**
 * Eats `subvalue` off the start of the value being tokenized.
 */
export interface Eat {
  /**
   * Eats `subvalue`.
   *
   * @param subvalue - The text to eat. It must start the value.
   * @returns A function that adds a node at the eaten range.
   */
  (subvalue: string): EatApply;

  /**
   * The current point.
   *
   * @returns The point.
   */
  readonly now: () => RemarkPoint;

  /**
   * Eats `subvalue`, adds a node as {@link EatApply} does, then puts the text back: for a node whose children eat it
   * again. Upstream's `eat(subvalue).reset(node)`: its arguments are read before the eat here, so none may eat.
   *
   * @param subvalue - The text to eat. It must start the value.
   * @param node - The node.
   * @param parent - The parent, if not the tokens being made.
   * @returns The node.
   */
  readonly reset: <Node extends RemarkNode>(subvalue: string, node: Node, parent?: RemarkParent) => Node;

  /**
   * The range `subvalue` covers; the text is put back. Upstream's `eat(subvalue).test()`.
   *
   * @param subvalue - The text to eat. It must start the value.
   * @returns The range.
   */
  readonly test: (subvalue: string) => RemarkPosition;
}

/**
 * Adds a node to `parent`, or to the tokens being made, and gives it the position of the eaten range.
 *
 * @param node - The node.
 * @param parent - The parent, if not the tokens being made.
 * @returns The node, or the text node it merged into.
 */
export type EatApply = <Node extends RemarkNode>(node: Node, parent?: RemarkParent) => Node;

/**
 * An inline tokenizer, with the locator that finds where it could start.
 */
export interface InlineTokenizer {
  /**
   * The first index from `fromIndex` where the tokenizer could start, or `-1`.
   */
  readonly locator: (parser: RemarkParser, value: string, fromIndex: number) => number;

  /**
   * Whether it is skipped inside a link.
   */
  readonly notInLink?: boolean;

  /**
   * The characters a value it eats from can start with, when it eats from no other: a value starting with none of them
   * is not handed to it. Without them, it is tried at every position.
   */
  readonly startCharacters?: string;

  /**
   * Eats inline content at the start of `value`.
   */
  readonly tokenize: (parser: RemarkParser, eat: Eat, value: string, isSilent: boolean) => TokenizerResult;
}

/**
 * The name of an inline tokenizer, in the order they are tried.
 */
export type InlineTokenizerName =
  | 'autoLink'
  | 'blockId'
  | 'break'
  | 'code'
  | 'comment'
  | 'deletion'
  | 'email'
  | 'emphasis'
  | 'escape'
  | 'footnoteReference'
  | 'highlight'
  | 'html'
  | 'inlineFootnote'
  | 'inlineMath'
  | 'internalLink'
  | 'link'
  | 'reference'
  | 'strong'
  | 'tag'
  | 'text'
  | 'url';

/**
 * The tokenizers of a parser, the order they are tried in, and the blocks that interrupt others.
 */
export interface RemarkTokenizers {
  /**
   * The block tokenizers.
   */
  readonly block: Readonly<Partial<Record<BlockTokenizerName, BlockTokenizer>>>;

  /**
   * The block tokenizers, in the order they are tried.
   */
  readonly blockMethods: readonly BlockTokenizerName[];

  /**
   * Where a block tokenizer can start, by name: a block whose start says no is not tried there. A tokenizer with none is
   * tried everywhere. Each must say yes wherever its tokenizer could eat or answer yes in silent mode.
   */
  readonly blockStarts?: Readonly<Partial<Record<BlockTokenizerName, BlockStart>>>;

  /**
   * The inline tokenizers.
   */
  readonly inline: Readonly<Partial<Record<InlineTokenizerName, InlineTokenizer>>>;

  /**
   * The inline tokenizers, in the order they are tried.
   */
  readonly inlineMethods: readonly InlineTokenizerName[];

  /**
   * The blocks that interrupt a blockquote.
   */
  readonly interruptBlockquote: readonly BlockTokenizerName[];

  /**
   * The blocks that interrupt a list.
   */
  readonly interruptList: readonly BlockTokenizerName[];

  /**
   * The blocks that interrupt a paragraph.
   */
  readonly interruptParagraph: readonly BlockTokenizerName[];
}

/**
 * What a tokenizer gives: the node it added, or in silent mode whether it would, and `undefined` when it does not match.
 * The `undefined` is `remark-parse` 8's tokenizer contract, which the port keeps, so a tokenizer is typed by this alias
 * rather than spelling the union.
 */
export type TokenizerResult = boolean | RemarkNode | undefined;

// The tokenizer list built from one set of block tokenizers, and its dispatch.
interface BlockTokenizeBuilt {
  readonly dispatch: TokenizeDispatch;
  readonly methods: TokenizeMethod[];
}

// The tokenizer list built from one set of inline tokenizers, and its dispatch.
interface InlineTokenizeBuilt {
  readonly dispatch: TokenizeDispatch;
  readonly methods: InlineTokenizer[];
}

/*
 * The lists and dispatches are built once per set of tokenizers and shared by every parser, since the sets are module
 * constants: built per parser, the inline dispatch alone, 128 lists, cost half a millisecond of every parse.
 */
const blockTokenizeBuilt = new WeakMap<RemarkTokenizers, BlockTokenizeBuilt>();
const inlineTokenizeBuilt = new WeakMap<Partial<Record<InlineTokenizerName, InlineTokenizer>>, InlineTokenizeBuilt>();

type Interruptors = readonly BlockTokenizerName[];

interface PositionCarrier {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The parser attaches source positions after the node has been constructed.
  position?: RemarkPosition;
}

interface TokenizeDispatch {
  // Indexed by the code of an ASCII first character; a table read is cheaper than hashing a one-character string.
  readonly byCode: readonly (readonly TokenizeMethod[])[];
  readonly ungated: readonly TokenizeMethod[];
}

interface TokenizeMethod {
  readonly blockStart?: BlockStart;
  readonly notInLink?: boolean;
  readonly startCharacters?: string;
  readonly tokenize: BlockTokenizer;
}

const ASCII_CODE_COUNT = 128;
const SPACE_CODE = 32;
const TAB_CODE = 9;

/**
 * The block tokenizers of `remark-parse` 8, in the order they are tried.
 */
export const BLOCK_METHODS: readonly BlockTokenizerName[] = [
  'blankLine',
  'indentedCode',
  'fencedCode',
  'blockquote',
  'atxHeading',
  'thematicBreak',
  'list',
  'setextHeading',
  'html',
  'definition',
  'table',
  'paragraph'
];

/**
 * The inline tokenizers of `remark-parse` 8, in the order they are tried.
 */
export const INLINE_METHODS: readonly InlineTokenizerName[] = [
  'escape',
  'autoLink',
  'url',
  'email',
  'html',
  'link',
  'reference',
  'strong',
  'emphasis',
  'deletion',
  'code',
  'break',
  'text'
];

/**
 * The blocks that interrupt a paragraph in `remark-parse` 8's `commonmark` mode.
 */
export const INTERRUPT_PARAGRAPH: Interruptors = ['thematicBreak', 'list', 'atxHeading', 'fencedCode', 'blockquote', 'html'];

/**
 * The blocks that interrupt a list in `remark-parse` 8's `commonmark` mode.
 */
export const INTERRUPT_LIST: Interruptors = ['atxHeading', 'fencedCode', 'thematicBreak'];

/**
 * The blocks that interrupt a blockquote in `remark-parse` 8's `commonmark` mode.
 */
export const INTERRUPT_BLOCKQUOTE: Interruptors = ['indentedCode', 'fencedCode', 'atxHeading', 'setextHeading', 'thematicBreak', 'html', 'list'];

// The characters a backslash escapes in `commonmark` mode (`markdown-escapes`).
const ESCAPES = '\\`*{}[]()#+-.!_>~|\n"$%&\',/:;<=?@^';
const LINE_BREAKS_RE = /\r\n|\r/gu;
const LINE_ENDING_RE = /\r?\n|\r/gu;
const BYTE_ORDER_MARK = 0xFE_FF;

/**
 * Whether the scans keep {@link TokenizeScope} memos, and whether a tokenizer is skipped at a character it cannot start
 * at. Only the differential test turns them off, to check that a parse with them gives the tree a parse without them does.
 */
export const scanMemoSettings = {
  isEnabled: true,
  isStartCharacterGateEnabled: true,
  /**
   * The shortest text whose locators are remembered. Every text is: on 10,000 lines of vault notes, remembering only
   * texts of 1,024 characters or more left the locators reading 9.6 million characters, and remembering all of them
   * 5.5 million, since most paragraphs are short and each is still searched once per locator and text run.
   */
  minLocatorMemoLength: 0
};

/**
 * Where a locator last found its construct in a {@link TokenizeScope}'s text, as indices into that text.
 */
export interface LocatedIndex {
  /**
   * For a locator that finds the first of several markers, where each marker was last found, in the markers' order:
   * made on the first search.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Made on the entry's first search.
  alternatives?: LocatedIndex[];

  /**
   * The index it found, or `-1` for none.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The entry is updated in place at every search, so a text run allocates nothing.
  at: number;

  /**
   * The index it searched from, or `Infinity` before it has searched.
   */
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The entry is updated in place at every search, so a text run allocates nothing.
  from: number;
}

/**
 * What a scan has learned about one text, kept by index into the text.
 */
export interface ScanMemo {
  /**
   * The index of the value the scan was given, in the {@link TokenizeScope}'s text.
   */
  readonly base: number;

  /**
   * The memo, keyed and valued as the scan chooses, by index into the text.
   */
  readonly map: Map<number, number>;
}

/*
 * The state of one `tokenize` call: what is left of its text, where that starts, the nodes it made and its memos. One
 * object, read by the parser's methods, where upstream made a closure over each for every call; the 1.15.1 metadata
 * worker keeps it the same way.
 */
class TokenizeFrame {
  public column: number;

  public line: number;

  public constructor(public value: string, location: RemarkPoint, public readonly tokens: RemarkNode[], public readonly scope: TokenizeScope) {
    this.column = location.column;
    this.line = location.line;
  }
}

/**
 * The column offset of each line's content, by line number from 1: a `Map`'s `get`, `has` and `set`, kept in a typed
 * array over the document's lines, since every point and every eaten line reads it. A line past the document, which
 * no parse should reach, falls back to a `Map`.
 */
export class LineOffsets {
  private readonly beyond = new Map<number, number>();

  // `NaN` marks a line with no offset set, as a `Map` without the key.
  private readonly byLine: Float64Array;

  /**
   * Creates the offsets of a document.
   *
   * @param lineCount - Its number of lines.
   */
  public constructor(lineCount: number) {
    this.byLine = new Float64Array(lineCount + 2).fill(NaN);
  }

  /**
   * The offset of a line.
   *
   * @param line - The line.
   * @returns Its offset, or `null` when none is set.
   */
  public get(line: number): null | number {
    if (Number.isSafeInteger(line) && line >= 0 && line < this.byLine.length) {
      const value = this.byLine[line] ?? NaN;
      return Number.isNaN(value) ? null : value;
    }
    return this.beyond.get(line) ?? null;
  }

  /**
   * Whether a line has an offset.
   *
   * @param line - The line.
   * @returns Whether it has.
   */
  public has(line: number): boolean {
    return this.get(line) !== null;
  }

  /**
   * Sets the offset of a line.
   *
   * @param line - The line.
   * @param value - Its offset.
   */
  public set(line: number, value: number): void {
    if (Number.isSafeInteger(line) && line >= 0 && line < this.byLine.length) {
      this.byLine[line] = value;
    } else {
      this.beyond.set(line, value);
    }
  }
}

/**
 * A `remark-parse` 8 parser over one document.
 */
export class RemarkParser {
  /**
   * Whether nothing has been eaten yet. Front matter is read only here.
   */
  public atStart = true;

  /**
   * The point the last tokenizer run ended at.
   */
  public eof: RemarkPoint | undefined;

  /**
   * Whether a tokenizer made a footnote definition or reference, an inline footnote or a block id: the nodes the tree
   * transforms after the parse act on, which a parse without them can skip.
   */
  public hasFootnoteOrBlockId = false;

  /**
   * Whether the tokenizer is inside a container block.
   */
  public inBlock = false;

  /**
   * The inline tokenizers in use. Autolinks and links in text swap them for `text` alone while they read their
   * content.
   */
  public inlineTokenizers: Partial<Record<InlineTokenizerName, InlineTokenizer>>;

  /**
   * Whether the tokenizer is inside a link.
   */
  public inLink = false;

  /**
   * Whether the tokenizer is inside a list.
   */
  public inList = false;

  /**
   * The column offset each line's content starts at, set by the containers that strip their markers.
   */
  public readonly offset: LineOffsets;

  /**
   * The memos of the innermost `tokenize` call running.
   */
  public scope: TokenizeScope | undefined;

  private blockTokenizeBuilt: BlockTokenizeBuilt | undefined;

  /*
   * The one eat every tokenizer is given, acting on the frame of the `tokenize` call running. A tokenizer eats only while
   * its own call runs: the calls it makes for nested content have returned before it eats again.
   */
  private readonly eat: Eat;

  private frame: TokenizeFrame | undefined;

  private inlineTokenizeDispatch: TokenizeDispatch | undefined;

  private inlineTokenizeMethods: InlineTokenizer[] = [];

  private inlineTokenizeMethodsFor: Partial<Record<InlineTokenizerName, InlineTokenizer>> | undefined;

  private readonly lineStarts: number[];

  /**
   * Creates a parser over a document.
   *
   * @param text - The document.
   * @param tokenizers - The tokenizers.
   */
  public constructor(private readonly text: string, public readonly tokenizers: RemarkTokenizers) {
    // The set itself, never changed: a copy would be a new key, and build its list and dispatch again for every parser.
    this.inlineTokenizers = tokenizers.inline;
    this.lineStarts = [];
    for (const match of text.matchAll(LINE_ENDING_RE)) {
      this.lineStarts.push(match.index + match[0].length);
    }
    this.lineStarts.push(text.length + 1);
    this.offset = new LineOffsets(this.lineStarts.length);
    const eatSubvalue = (subvalue: string): EatApply => this.eatSubvalue(this.currentFrame(), subvalue);
    this.eat = Object.assign(eatSubvalue, {
      now: (): RemarkPoint => this.pointOf(this.currentFrame()),
      reset: <Node extends RemarkNode>(subvalue: string, node: Node, parent?: RemarkParent): Node => this.eatAndReset(this.currentFrame(), subvalue, node, parent),
      test: (subvalue: string): RemarkPosition => this.eatAndTest(this.currentFrame(), subvalue)
    });
  }

  /**
   * Decodes the character references in `value` into the nodes `handler` makes.
   *
   * @param value - The value.
   * @param position - Where it starts.
   * @param handler - Called with each run of text and each reference, and the reference's source.
   */
  public decode(value: string, position: RemarkPoint, handler: (content: string, source?: string) => void): void {
    // Without an ampersand there is no reference, and the whole value is one run of text.
    if (!value.includes('&')) {
      if (value) {
        handler(value);
      }
      return;
    }

    decodeEntities(value, {
      indent: this.indentFrom(position),
      onReference: (content, _range, source) => {
        handler(content, source);
      },
      onText: (content) => {
        handler(content);
      },
      start: position
    });
  }

  /**
   * Decodes the character references in `value`.
   *
   * @param value - The value.
   * @param position - Where it starts.
   * @param canOmitSemicolon - Whether a reference without its `;` is decoded.
   * @returns The decoded value.
   */
  public decodeRaw(value: string, position: RemarkPoint, canOmitSemicolon = true): string {
    if (!value.includes('&')) {
      return value;
    }

    return decodeEntities(value, { indent: this.indentFrom(position), nonTerminated: canOmitSemicolon, start: position });
  }

  /**
   * Enters a container block.
   *
   * @returns A function that leaves it.
   */
  public enterBlock(): () => void {
    const wasInBlock = this.inBlock;
    this.inBlock = true;
    return () => {
      this.inBlock = wasInBlock;
    };
  }

  /**
   * Enters a link.
   *
   * @returns A function that leaves it.
   */
  public enterLink(): () => void {
    const wasInLink = this.inLink;
    this.inLink = true;
    return () => {
      this.inLink = wasInLink;
    };
  }

  /**
   * Enters a list.
   *
   * @returns A function that leaves it.
   */
  public enterList(): () => void {
    const wasInList = this.inList;
    this.inList = true;
    return () => {
      this.inList = wasInList;
    };
  }

  /**
   * Whether one of the named blocks starts `value`.
   *
   * @param interruptors - The blocks.
   * @param eat - The eat function.
   * @param value - The text.
   * @returns Whether one does.
   */
  public interrupts(interruptors: Interruptors, eat: Eat, value: string): boolean {
    const tokenizers = this.tokenizers.block;
    const starts = scanMemoSettings.isStartCharacterGateEnabled ? this.tokenizers.blockStarts : undefined;
    const firstCode = value.codePointAt(0) ?? NaN;
    const afterIndentCode = starts ? codeAfterIndent(value) : NaN;

    // Asked at every line of every paragraph: a block that cannot start there is not asked.
    for (const name of interruptors) {
      const start = starts?.[name];
      if (start && !start(firstCode, afterIndentCode)) {
        continue;
      }
      if (tokenizers[name]?.(this, eat, value, true)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether a block that would interrupt a blockquote starts `value`.
   *
   * @param eat - The eat function.
   * @param value - The rest of the document.
   * @returns Whether one does.
   */
  public interruptsBlockquote(eat: Eat, value: string): boolean {
    return this.interrupts(this.tokenizers.interruptBlockquote, eat, value);
  }

  /**
   * Whether a block that would interrupt a list starts `value`.
   *
   * @param eat - The eat function.
   * @param value - The line.
   * @returns Whether one does.
   */
  public interruptsList(eat: Eat, value: string): boolean {
    return this.interrupts(this.tokenizers.interruptList, eat, value);
  }

  /**
   * Whether a block that would interrupt a paragraph starts `value`.
   *
   * @param eat - The eat function.
   * @param value - The rest of the document.
   * @returns Whether one does.
   */
  public interruptsParagraph(eat: Eat, value: string): boolean {
    return this.interrupts(this.tokenizers.interruptParagraph, eat, value);
  }

  /**
   * Parses the document.
   *
   * @returns The tree.
   */
  public parse(): RemarkRoot {
    const start: RemarkPoint = { column: 1, line: 1, offset: 0 };
    const content = { ...start };
    let value = this.text.replaceAll(LINE_BREAKS_RE, '\n');

    if (value.codePointAt(0) === BYTE_ORDER_MARK) {
      value = value.slice(1);
      content.column++;
      content.offset++;
    }

    const children = this.tokenizeBlock(value, content);
    return { children, position: { end: this.eof ?? { ...start }, start }, type: 'root' };
  }

  /**
   * The memo a scan keeps under `name` over the text of the innermost `tokenize` call, with where `value` starts in it.
   *
   * @param name - The scan's name.
   * @param value - The value the scan was given: a suffix of that text.
   * @returns The memo, or `null` when there is no text to key it by.
   */
  public scanMemo(name: string, value: string): null | ScanMemo {
    const scope = this.scopeOf(value);
    return scope && { base: scope.length - value.length, map: scope.memo(name) };
  }

  /**
   * The memos of the innermost `tokenize` call running, when `value` can be keyed by them.
   *
   * @param value - A value a tokenizer of that call was given: a suffix of its text.
   * @returns The memos, or `null` when there is no text to key them by.
   */
  public scopeOf(value: string): null | TokenizeScope {
    const scope = this.scope;
    return scope?.isValid && value.length <= scope.length ? scope : null;
  }

  /**
   * Tokenizes blocks.
   *
   * @param value - The text.
   * @param location - Where it starts.
   * @returns The blocks.
   */
  public tokenizeBlock(value: string, location: RemarkPoint): RemarkNode[] {
    // Built once: every container and list item tokenizes its content again, each call building the same list.
    let built = this.blockTokenizeBuilt;
    if (!built) {
      built = blockTokenizeBuilt.get(this.tokenizers);
      if (!built) {
        const tokenizers = this.tokenizers.block;
        const starts = this.tokenizers.blockStarts;
        const methods: TokenizeMethod[] = [];
        for (const name of this.tokenizers.blockMethods) {
          const tokenizer = tokenizers[name];
          const blockStart = starts?.[name];
          if (tokenizer) {
            methods.push(blockStart ? { blockStart, tokenize: tokenizer } : { tokenize: tokenizer });
          }
        }
        built = { dispatch: dispatchOf(methods), methods };
        blockTokenizeBuilt.set(this.tokenizers, built);
      }
      this.blockTokenizeBuilt = built;
    }
    return this.tokenize(value, location, built.methods, built.dispatch);
  }

  /**
   * Tokenizes inline content.
   *
   * @param value - The text.
   * @param location - Where it starts.
   * @returns The inline nodes.
   */
  public tokenizeInline(value: string, location: RemarkPoint): RemarkNode[] {
    const tokenizers = this.inlineTokenizers;
    // Rebuilt only when the tokenizers in use are swapped, as a link swaps them while it reads its content.
    if (this.inlineTokenizeMethodsFor !== tokenizers) {
      // A link swaps them back on its way out, so each set's list and dispatch are kept rather than built again.
      let built = inlineTokenizeBuilt.get(tokenizers);
      if (!built) {
        const methods: InlineTokenizer[] = [];
        for (const name of this.tokenizers.inlineMethods) {
          const tokenizer = tokenizers[name];
          if (tokenizer) {
            methods.push(tokenizer);
          }
        }
        built = { dispatch: dispatchOf(methods), methods };
        inlineTokenizeBuilt.set(tokenizers, built);
      }
      this.inlineTokenizeMethods = built.methods;
      this.inlineTokenizeDispatch = built.dispatch;
      this.inlineTokenizeMethodsFor = tokenizers;
    }
    return this.tokenize(value, location, this.inlineTokenizeMethods, this.inlineTokenizeDispatch);
  }

  /**
   * The offset of a point, or `-1` outside the document.
   *
   * @param line - The line, from 1.
   * @param column - The column, from 1.
   * @returns The offset.
   */
  public toOffset(line: number, column: number): number {
    const lineStarts = this.lineStarts;
    const last = lineStarts.at(-1) ?? 0;
    let offset = -1;
    if (line >= 1 && line <= lineStarts.length) {
      // Line 1 starts at 0. Reading `lineStarts[-1]` for it instead is a property lookup off the array's fast path, and
      // every point of every node asks for an offset.
      offset = (line === 1 ? 0 : lineStarts[line - 2] ?? 0) + column - 1 || 0;
    }
    return offset > -1 && offset < last ? offset : -1;
  }

  /**
   * Removes the backslash of each escape.
   *
   * @param value - The value.
   * @returns The value without its escapes' backslashes.
   */
  public unescape(value: string): string {
    let previous = 0;
    let index = value.indexOf('\\');
    const queue: string[] = [];

    while (index !== -1) {
      queue.push(value.slice(previous, index));
      previous = index + 1;
      const character = value.charAt(previous);

      // A backslash before a character it does not escape stays.
      if (!character || !ESCAPES.includes(character)) {
        queue.push('\\');
      }

      index = value.indexOf('\\', previous + 1);
    }

    queue.push(value.slice(previous));

    return queue.join('');
  }

  // Upstream's `add`: adjacent text merges; blockquotes do not in `commonmark` and `gfm` modes.
  private addEaten<Node extends RemarkNode>(frame: TokenizeFrame, node: Node, parent?: RemarkParent): Node {
    const children = parent ? parent.children : frame.tokens;
    const previous = children.at(-1);
    let result: RemarkNode = node;

    if (previous?.type === 'text' && node.type === 'text' && isMergeable(previous) && isMergeable(node)) {
      previous.value += node.value;
      result = previous;
    }

    if (result !== previous) {
      children.push(result);
    }

    return result as Node;
  }

  // Adds a node at the range eaten from `current`, as the function an eat returns does.
  private applyEaten<Node extends RemarkNode>(
    frame: TokenizeFrame,
    current: RemarkPoint,
    indentation: number[],
    node: Node,
    parent?: RemarkParent
  ): Node {
    if (node.position) {
      return this.place(frame, this.addEaten(frame, this.place(frame, node, current), parent), current, indentation);
    }

    // A new node gets the position the two placings give it at once: the first leaves an empty indent that the second
    // copies the eaten lines' indentation after. Merging reads only its start and end.
    node.position = { end: this.pointOf(frame), indent: [...indentation], start: current };
    const result = this.addEaten(frame, node, parent);
    return result === node ? node : this.place(frame, result, current, indentation);
  }

  /*
   * Eats `subvalue` off the frame's value and moves its point past it, and gives the point it started at. Upstream takes
   * that point three times, through `getOffset`, `position` and `now`, each a closure or a copy; one serves all three,
   * since nothing changes it before the text is eaten and it is only read afterwards.
   */
  private consume(frame: TokenizeFrame, subvalue: string): RemarkPoint {
    const current = this.pointOf(frame);

    /*
     * Upstream compares the text eaten with the start of the value at every eat, which read every eaten character once
     * more and cost a fifth of a long note's parse. The tokenizers eat only what they read off the value, and the
     * oracles check every position, so only a text longer than the value is refused; the 1.15.1 metadata worker refuses
     * none.
     */
    if (subvalue.length > frame.value.length) {
      throw new Error('Incorrectly eaten value');
    }

    frame.value = frame.value.slice(subvalue.length);

    this.updatePosition(frame, subvalue);

    // Obsidian's copy leaves the start at the first text eaten, where upstream leaves it at the first node added.
    if (subvalue) {
      this.atStart = false;
    }

    return current;
  }

  // The frame of the `tokenize` call running, which every eat acts on.
  private currentFrame(): TokenizeFrame {
    if (!this.frame) {
      throw new Error('Nothing is being tokenized');
    }
    return this.frame;
  }

  private eatAndReset<Node extends RemarkNode>(frame: TokenizeFrame, subvalue: string, node: Node, parent?: RemarkParent): Node {
    const startLine = frame.line;
    const startColumn = frame.column;
    const before = frame.value;
    const wasAtStart = this.atStart;
    const current = this.consume(frame, subvalue);
    const indentation = this.indentationAfter(current.line, frame.line);
    const after = frame.value;
    const result = this.applyEaten(frame, current, indentation, node, parent);

    frame.line = startLine;
    frame.column = startColumn;
    frame.value = this.putBack(frame, subvalue, before, after);
    this.atStart = wasAtStart;

    return result;
  }

  private eatAndTest(frame: TokenizeFrame, subvalue: string): RemarkPosition {
    const startLine = frame.line;
    const startColumn = frame.column;
    const before = frame.value;
    const start = this.consume(frame, subvalue);
    const after = frame.value;
    const result: RemarkPosition = { end: this.pointOf(frame), indent: [], start };

    frame.line = startLine;
    frame.column = startColumn;
    frame.value = this.putBack(frame, subvalue, before, after);

    return result;
  }

  private eatSubvalue(frame: TokenizeFrame, subvalue: string): EatApply {
    const current = this.consume(frame, subvalue);
    const indentation = this.indentationAfter(current.line, frame.line);

    // Upstream made `reset` and `test` closures for every eat, and only a few tokenizers ever call them. An anonymous
    // arrow, since a bundler keeping names wraps every named function expression it creates in a call.
    return <Node extends RemarkNode>(node: Node, parent?: RemarkParent): Node => this.applyEaten(frame, current, indentation, node, parent);
  }

  // The indentation of each line after `firstLine` up to `lastLine`: those an eaten text covers after its first.
  private indentationAfter(firstLine: number, lastLine: number): number[] {
    const indentation: number[] = [];
    for (let next = firstLine + 1; next <= lastLine; next++) {
      indentation.push((this.offset.get(next) ?? 0) + 1);
    }
    return indentation;
  }

  private indentFrom(position: RemarkPoint): number[] {
    const result: number[] = [];
    let line = position.line;

    while (this.offset.has(++line)) {
      result.push((this.offset.get(line) ?? 0) + 1);
    }

    return result;
  }

  // Upstream's `position()` made this a closure over `before` for every eat.
  private place<Carrier extends PositionCarrier>(frame: TokenizeFrame, node: Carrier, before: RemarkPoint, indent?: number[]): Carrier {
    const previous = node.position;
    const start = previous ? previous.start : before;
    let combined: number[] = [];
    let n = previous?.end.line ?? 0;
    const l = before.line;
    let nodeIndent = indent;

    node.position = { end: this.pointOf(frame), indent: [], start };

    // A merged node: its start stays, and the indent between the two parts, which is empty, is filled in.
    if (previous && nodeIndent && previous.indent) {
      combined = previous.indent;

      if (n < l) {
        while (++n < l) {
          combined.push((this.offset.get(n) ?? 0) + 1);
        }

        combined.push(before.column);
      }

      nodeIndent = [...combined, ...nodeIndent];
    }

    node.position.indent = nodeIndent ?? [];

    return node;
  }

  // Upstream's `now`.
  private pointOf(frame: TokenizeFrame): RemarkPoint {
    return { column: frame.column, line: frame.line, offset: this.toOffset(frame.line, frame.column) };
  }

  /*
   * Putting the text back restores the string it was eaten from rather than `subvalue + value`: the concatenation is
   * flattened into a fresh copy of the rest of the document by the next slice, and every node value sliced from it keeps
   * that copy alive, so a long note held one copy per reset.
   */
  private putBack(frame: TokenizeFrame, subvalue: string, before: string, after: string): string {
    if (frame.value === after) {
      return before;
    }

    // The text no longer ends as the call's text does, so no index of it is an index into that text.
    frame.scope.isValid = false;
    return subvalue + frame.value;
  }

  private tokenize(
    initialValue: string,
    location: RemarkPoint,
    methods: readonly TokenizeMethod[],
    methodDispatch: TokenizeDispatch | undefined
  ): RemarkNode[] {
    const tokens: RemarkNode[] = [];

    if (!initialValue) {
      return tokens;
    }

    const scope = new TokenizeScope(initialValue.length);
    const frame = new TokenizeFrame(initialValue, location, tokens, scope);
    const outerFrame = this.frame;
    const outerScope = this.scope;
    const dispatch = scanMemoSettings.isStartCharacterGateEnabled ? methodDispatch : undefined;
    const eat = this.eat;

    // Sync the initial offset.
    this.updatePosition(frame, '');

    this.frame = frame;
    this.scope = scanMemoSettings.isEnabled ? scope : undefined;
    try {
      // Try every tokenizer; when one eats, start over on the rest.
      while (frame.value) {
        const value = frame.value;
        let matched = false;
        // Most tokenizers fail at once on any other first character, and are tried at every position the text reaches.
        const candidates = dispatch ? (dispatch.byCode[value.codePointAt(0) ?? ASCII_CODE_COUNT] ?? dispatch.ungated) : methods;

        // A block's first characters are read once per place, and only when a block tokenizer asks.
        let firstCode = NaN;
        let afterIndentCode = NaN;
        let isMeasured = false;

        for (const method of candidates) {
          if (method.notInLink && this.inLink) {
            continue;
          }

          if (dispatch && method.blockStart) {
            if (!isMeasured) {
              firstCode = value.codePointAt(0) ?? NaN;
              afterIndentCode = codeAfterIndent(value);
              isMeasured = true;
            }
            if (!method.blockStart(firstCode, afterIndentCode)) {
              continue;
            }
          }

          method.tokenize(this, eat, frame.value, false);

          matched = value.length !== frame.value.length;

          if (matched) {
            break;
          }
        }

        if (!matched) {
          throw new Error('Infinite loop');
        }
      }
    } finally {
      this.frame = outerFrame;
      this.scope = outerScope;
    }

    this.eof = this.pointOf(frame);

    return tokens;
  }

  private updatePosition(frame: TokenizeFrame, subvalue: string): void {
    let lastIndex = -1;
    let index = subvalue.indexOf('\n');

    while (index !== -1) {
      frame.line++;
      lastIndex = index;
      index = subvalue.indexOf('\n', index + 1);
    }

    if (lastIndex === -1) {
      frame.column += subvalue.length;
    } else {
      frame.column = subvalue.length - lastIndex;
    }

    const lineOffset = this.offset.get(frame.line);
    if (lineOffset !== null) {
      if (lastIndex !== -1) {
        frame.column += lineOffset;
      } else if (frame.column <= lineOffset) {
        frame.column = lineOffset + 1;
      }
    }
  }
}

/**
 * The memos of one `tokenize` call. Every value a tokenizer of that call is given is a suffix of the text it reads, so
 * an index into a value is an index into the text once the value's start, the text's length less the value's, is added.
 * A scan that would run to the end of the text once per position can then reuse what an earlier position found.
 */
export class TokenizeScope {
  /**
   * Whether every value is still a suffix of the text. Text put back by a reset after more was eaten is not, and turns
   * the memos off for the rest of the call.
   */
  public isValid = true;

  // All three are made on first use: most `tokenize` calls read a heading or a short line and need none.
  private foundIndices: Map<string, LocatedIndex> | undefined;

  private locatedIndices: LocatedIndex[] | undefined;

  private memos: Map<string, Map<number, number>> | undefined;

  /**
   * Creates the memos of a text.
   *
   * @param length - The text's length.
   */
  public constructor(public readonly length: number) {}

  /**
   * `value.indexOf(search, fromIndex)`, remembered by `search`: what a search found from an earlier start still holds
   * for any start up to that place, so a character searched for from every block start is read once over the text.
   *
   * @param value - A suffix of the text.
   * @param search - What to find.
   * @param fromIndex - Where in `value` to search from.
   * @returns The index in `value`, or `-1`.
   */
  public indexOf(value: string, search: string, fromIndex: number): number {
    const base = this.length - value.length;
    const from = base + fromIndex;
    this.foundIndices ??= new Map();
    let entry = this.foundIndices.get(search);
    if (!entry) {
      entry = { at: -1, from: Infinity };
      this.foundIndices.set(search, entry);
    }
    if (!(entry.from <= from && (entry.at === -1 || from <= entry.at))) {
      const index = value.indexOf(search, fromIndex);
      entry.at = index === -1 ? -1 : base + index;
      entry.from = from;
    }
    return entry.at === -1 ? -1 : entry.at - base;
  }

  /**
   * Where a locator last found its construct. The entry is updated in place, so a locator asked at every text run
   * allocates nothing after its first search, and it is found by the locator's place in the inline methods rather than
   * by its name, which every text run would hash once per locator.
   *
   * @param slot - The locator's index in the inline methods.
   * @returns The entry, with `from` set to `Infinity` before the first search.
   */
  public located(slot: number): LocatedIndex {
    this.locatedIndices ??= [];
    let entry = this.locatedIndices[slot];
    if (!entry) {
      entry = { at: -1, from: Infinity };
      this.locatedIndices[slot] = entry;
    }
    return entry;
  }

  /**
   * The memo a scan keeps under `name`.
   *
   * @param name - The scan's name.
   * @returns The memo.
   */
  public memo(name: string): Map<number, number> {
    this.memos ??= new Map();
    let map = this.memos.get(name);
    if (!map) {
      map = new Map();
      this.memos.set(name, map);
    }
    return map;
  }
}

// The code of the first character after the spaces and tabs that open `value`, or `NaN` when none follows them.
function codeAfterIndent(value: string): number {
  let index = 0;
  let code = value.codePointAt(0) ?? NaN;
  // Spaces and tabs are one code unit each, so the index moves by code points too.
  while (code === SPACE_CODE || code === TAB_CODE) {
    code = value.codePointAt(++index) ?? NaN;
  }
  return code;
}

// Only text nodes that cover as much source as their value, on one line, merge.
/*
 * The tokenizers to try at each first character, in their order: those that name it among their start characters and
 * those that name none. Built once per list, which a parser keeps for as long as its tokenizers stay the same.
 */
function dispatchOf(methods: readonly TokenizeMethod[]): TokenizeDispatch {
  const ungated = methods.filter((method) => method.startCharacters === undefined);

  // The block list, and the text-only list a link reads its content with, gate nothing: an empty table reads past its end.
  if (ungated.length === methods.length) {
    return { byCode: [], ungated };
  }

  // A character no tokenizer names starts only the ungated ones; NaN, from an empty value, and non-ASCII read past the end.
  const byCode: (readonly TokenizeMethod[])[] = Array.from({ length: ASCII_CODE_COUNT }, () => ungated);
  for (const method of methods) {
    const startCharacters = method.startCharacters ?? '';
    for (const character of startCharacters) {
      const code = character.codePointAt(0) ?? ASCII_CODE_COUNT;
      if (code >= ASCII_CODE_COUNT) {
        throw new Error(`A start character must be ASCII: ${character}`);
      }
      if (byCode[code] === ungated) {
        byCode[code] = methods.filter((candidate) => candidate.startCharacters?.includes(character) ?? true);
      }
    }
  }

  return { byCode, ungated };
}

function isMergeable(node: RemarkNode): boolean {
  if (node.type !== 'text' || !node.position) {
    return true;
  }

  const { end, start } = node.position;

  return start.line !== end.line || end.column - start.column === node.value.length;
}

/* eslint-enable no-magic-numbers, no-useless-assignment, unicorn/consistent-boolean-name, unicorn/consistent-class-member-order, unicorn/no-break-in-nested-loop, unicorn/prefer-ternary -- The port ends here. */
