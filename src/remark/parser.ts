/**
 * @file
 *
 * The core of the `remark-parse` 8 engine: a TypeScript port of `remark-parse` 8.0.3's parser, tokenizer factory,
 * position tracking and unescaping (MIT, Titus Wormer), with `vfile-location` 3 and `state-toggle` folded in.
 *
 * It is configured as Obsidian runs it, `commonmark: true` and `gfm: true`, so the branches of the other modes are
 * gone. The tokenizers are in `block.ts` and `inline.ts`.
 */

/* eslint-disable no-magic-numbers, no-useless-assignment, unicorn/consistent-boolean-name, unicorn/consistent-class-member-order, unicorn/no-break-in-nested-loop, unicorn/no-declarations-before-early-exit, unicorn/prefer-ternary -- A line-for-line port: its control flow and names stay as upstream wrote them, and perfectionist/sort-classes orders public members first. */

import type {
  RemarkNode,
  RemarkParent,
  RemarkPoint,
  RemarkPosition,
  RemarkRoot
} from './types.ts';

import { decodeEntities } from './entities.ts';

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
}

/**
 * Adds a node at an eaten range.
 */
export interface EatApply {
  /**
   * Adds a node to `parent`, or to the tokens being made, and gives it its position.
   *
   * @param node - The node.
   * @param parent - The parent, if not the tokens being made.
   * @returns The node, or the text node it merged into.
   */
  <Node extends RemarkNode>(node: Node, parent?: RemarkParent): Node;

  /**
   * Adds a node as {@link EatApply} does, then puts the eaten text back: for a node whose children eat it again.
   *
   * @param node - The node.
   * @param parent - The parent, if not the tokens being made.
   * @returns The node.
   */
  readonly reset: <Node extends RemarkNode>(node: Node, parent?: RemarkParent) => Node;

  /**
   * The range the eaten text covers; the text is put back.
   *
   * @returns The range.
   */
  readonly test: () => RemarkPosition;
}

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
 * What a tokenizer gives: the node it added, or in silent mode whether it would.
 */
export type TokenizerResult = boolean | RemarkNode | undefined;

type Interruptors = readonly BlockTokenizerName[];

interface PositionCarrier {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The parser attaches source positions after the node has been constructed.
  position?: RemarkPosition;
}

interface TokenizeMethod {
  readonly notInLink?: boolean;
  readonly tokenize: BlockTokenizer;
}

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
 * Whether the scans keep {@link TokenizeScope} memos. Only the differential test turns them off, to check that a parse
 * with them gives the tree a parse without them does.
 */
export const scanMemoSettings = { isEnabled: true };

/**
 * Where a locator last found its construct in a {@link TokenizeScope}'s text, as indices into that text.
 */
export interface LocatedIndex {
  /**
   * The index it found, or `-1` for none.
   */
  readonly at: number;

  /**
   * The index it searched from.
   */
  readonly from: number;
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
  public readonly offset = new Map<number, number>();

  /**
   * The memos of the innermost `tokenize` call running.
   */
  public scope: TokenizeScope | undefined;

  private readonly lineStarts: number[];

  /**
   * Creates a parser over a document.
   *
   * @param text - The document.
   * @param tokenizers - The tokenizers.
   */
  public constructor(private readonly text: string, public readonly tokenizers: RemarkTokenizers) {
    this.inlineTokenizers = { ...tokenizers.inline };
    this.lineStarts = [];
    for (const match of text.matchAll(LINE_ENDING_RE)) {
      this.lineStarts.push(match.index + match[0].length);
    }
    this.lineStarts.push(text.length + 1);
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
    return interruptors.some((name) => Boolean(this.tokenizers.block[name]?.(this, eat, value, true)));
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
   * @returns The memo, or `undefined` when there is no text to key it by.
   */
  public scanMemo(name: string, value: string): ScanMemo | undefined {
    const scope = this.scopeOf(value);
    return scope && { base: scope.length - value.length, map: scope.memo(name) };
  }

  /**
   * The memos of the innermost `tokenize` call running, when `value` can be keyed by them.
   *
   * @param value - A value a tokenizer of that call was given: a suffix of its text.
   * @returns The memos, or `undefined` when there is no text to key them by.
   */
  public scopeOf(value: string): TokenizeScope | undefined {
    const scope = this.scope;
    return scope?.isValid && value.length <= scope.length ? scope : undefined;
  }

  /**
   * Tokenizes blocks.
   *
   * @param value - The text.
   * @param location - Where it starts.
   * @returns The blocks.
   */
  public tokenizeBlock(value: string, location: RemarkPoint): RemarkNode[] {
    const tokenizers = this.tokenizers.block;
    const methods: TokenizeMethod[] = [];
    for (const name of this.tokenizers.blockMethods) {
      const tokenizer = tokenizers[name];
      if (tokenizer) {
        methods.push({ tokenize: tokenizer });
      }
    }
    return this.tokenize(value, location, methods);
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
    const methods: InlineTokenizer[] = [];
    for (const name of this.tokenizers.inlineMethods) {
      const tokenizer = tokenizers[name];
      if (tokenizer) {
        methods.push(tokenizer);
      }
    }
    return this.tokenize(value, location, methods);
  }

  /**
   * The offset of a point, or `-1` outside the document.
   *
   * @param line - The line, from 1.
   * @param column - The column, from 1.
   * @returns The offset.
   */
  public toOffset(line: number, column: number): number {
    const last = this.lineStarts.at(-1) ?? 0;
    let offset = -1;
    if (line >= 1 && line <= this.lineStarts.length) {
      offset = (this.lineStarts[line - 2] ?? 0) + column - 1 || 0;
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

  private indentFrom(position: RemarkPoint): number[] {
    const result: number[] = [];
    let line = position.line;

    while (this.offset.has(++line)) {
      result.push((this.offset.get(line) ?? 0) + 1);
    }

    return result;
  }

  private tokenize(
    initialValue: string,
    location: RemarkPoint,
    methods: readonly TokenizeMethod[]
  ): RemarkNode[] {
    // eslint-disable-next-line @typescript-eslint/no-this-alias, consistent-this, unicorn/no-this-assignment -- The nested functions below are the upstream closure over the parser.
    const parser = this;
    const offset = this.offset;
    const tokens: RemarkNode[] = [];
    let value = initialValue;
    let line = location.line;
    let column = location.column;

    if (!value) {
      return tokens;
    }

    const eat = Object.assign(eatSubvalue, { now });
    const scope = new TokenizeScope(value.length);
    const outerScope = parser.scope;

    // Sync the initial offset.
    updatePosition('');

    parser.scope = scanMemoSettings.isEnabled ? scope : undefined;
    try {
      // Try every tokenizer; when one eats, start over on the rest.
      // eslint-disable-next-line no-unmodified-loop-condition -- The tokenizers change `value` through `eat`.
      while (value) {
        let matched = false;

        for (const method of methods) {
          if (method.notInLink && parser.inLink) {
            continue;
          }

          const valueLength = value.length;

          method.tokenize(parser, eat, value, false);

          matched = valueLength !== value.length;

          if (matched) {
            break;
          }
        }

        if (!matched) {
          throw new Error('Infinite loop');
        }
      }
    } finally {
      parser.scope = outerScope;
    }

    parser.eof = now();

    return tokens;

    function updatePosition(subvalue: string): void {
      let lastIndex = -1;
      let index = subvalue.indexOf('\n');

      while (index !== -1) {
        line++;
        lastIndex = index;
        index = subvalue.indexOf('\n', index + 1);
      }

      if (lastIndex === -1) {
        column += subvalue.length;
      } else {
        column = subvalue.length - lastIndex;
      }

      const lineOffset = offset.get(line);
      if (lineOffset !== undefined) {
        if (lastIndex !== -1) {
          column += lineOffset;
        } else if (column <= lineOffset) {
          column = lineOffset + 1;
        }
      }
    }

    // Called before the first character is eaten; the function it gives is called after the last.
    function getOffset(): () => number[] {
      const indentation: number[] = [];
      let pos = line + 1;

      return () => {
        const last = line + 1;

        while (pos < last) {
          indentation.push((offset.get(pos) ?? 0) + 1);
          pos++;
        }

        return indentation;
      };
    }

    function now(): RemarkPoint {
      return { column, line, offset: parser.toOffset(line, column) };
    }

    function position(): <Carrier extends PositionCarrier>(node: Carrier, indent?: number[]) => Carrier {
      const before = now();

      return (node, indent) => {
        const previous = node.position;
        const start = previous ? previous.start : before;
        let combined: number[] = [];
        let n = previous?.end.line ?? 0;
        const l = before.line;
        let nodeIndent = indent;

        node.position = { end: now(), indent: [], start };

        // A merged node: its start stays, and the indent between the two parts, which is empty, is filled in.
        if (previous && nodeIndent && previous.indent) {
          combined = previous.indent;

          if (n < l) {
            while (++n < l) {
              combined.push((offset.get(n) ?? 0) + 1);
            }

            combined.push(before.column);
          }

          nodeIndent = [...combined, ...nodeIndent];
        }

        node.position.indent = nodeIndent ?? [];

        return node;
      };
    }

    function add<Node extends RemarkNode>(node: Node, parent?: RemarkParent): Node {
      const children = parent ? parent.children : tokens;
      const previous = children.at(-1);
      let result: RemarkNode = node;

      // Adjacent text merges; blockquotes do not in `commonmark` and `gfm` modes.
      if (previous?.type === 'text' && node.type === 'text' && isMergeable(previous) && isMergeable(node)) {
        previous.value += node.value;
        result = previous;
      }

      if (result !== previous) {
        children.push(result);
      }

      return result as Node;
    }

    function eatSubvalue(subvalue: string): EatApply {
      const indent = getOffset();
      const pos = position();
      const current = now();

      if (!value.startsWith(subvalue)) {
        throw new Error('Incorrectly eaten value');
      }

      // Putting the text back restores this string rather than `subvalue + value`: the concatenation is flattened into
      // a fresh copy of the rest of the document by the next slice, and every node value sliced from it keeps that copy
      // alive, so a long note held one copy per reset.
      const before = value;
      value = value.slice(subvalue.length);
      const after = value;

      updatePosition(subvalue);

      // Obsidian's copy leaves the start at the first text eaten, where upstream leaves it at the first node added.
      const wasAtStart = parser.atStart;
      if (subvalue) {
        parser.atStart = false;
      }

      const indentation = indent();

      return Object.assign(apply, { reset, test });

      function apply<Node extends RemarkNode>(node: Node, parent?: RemarkParent): Node {
        return pos(add(pos(node), parent), indentation);
      }

      function reset<Node extends RemarkNode>(node: Node, parent?: RemarkParent): Node {
        const result = apply(node, parent);

        line = current.line;
        column = current.column;
        value = putBack();
        parser.atStart = wasAtStart;

        return result;
      }

      function test(): RemarkPosition {
        const result = pos<PositionCarrier>({});

        line = current.line;
        column = current.column;
        value = putBack();

        if (!result.position) {
          throw new Error('Unreachable: a tested range always has a position');
        }

        return result.position;
      }

      function putBack(): string {
        if (value === after) {
          return before;
        }

        // The text no longer ends as the call's text does, so no index of it is an index into that text.
        scope.isValid = false;
        return subvalue + value;
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

  /**
   * Where each locator last found its construct.
   */
  public readonly located = new Map<string, LocatedIndex>();

  private readonly memos = new Map<string, Map<number, number>>();

  /**
   * Creates the memos of a text.
   *
   * @param length - The text's length.
   */
  public constructor(public readonly length: number) {}

  /**
   * The memo a scan keeps under `name`.
   *
   * @param name - The scan's name.
   * @returns The memo.
   */
  public memo(name: string): Map<number, number> {
    let map = this.memos.get(name);
    if (!map) {
      map = new Map();
      this.memos.set(name, map);
    }
    return map;
  }
}

// Only text nodes that cover as much source as their value, on one line, merge.
function isMergeable(node: RemarkNode): boolean {
  if (node.type !== 'text' || !node.position) {
    return true;
  }

  const { end, start } = node.position;

  return start.line !== end.line || end.column - start.column === node.value.length;
}

/* eslint-enable no-magic-numbers, no-useless-assignment, unicorn/consistent-boolean-name, unicorn/consistent-class-member-order, unicorn/no-break-in-nested-loop, unicorn/no-declarations-before-early-exit, unicorn/prefer-ternary -- The port ends here. */
