/**
 * @file
 *
 * The line cursor the modes read. It is CodeMirror's `StringStream`, which the legacy modes are written against,
 * plus `lookAhead`, which CodeMirror 5 had and the markdown mode needs for setext headings and tables.
 */

import { StringStream as CodeMirrorStringStream } from '@codemirror/streamparser';

/**
 * Reads the line `offset` lines after the current one, or `undefined` past the end of the document.
 */
export type LineReader = (offset: number) => string | undefined;

/**
 * Parameters of {@link StringStream}'s constructor.
 */
export interface StringStreamConstructorParams {
  /**
   * The line.
   */
  readonly line: string;

  /**
   * The index of the line in the document.
   */
  readonly lineIndex: number;

  /**
   * Reads a following line.
   */
  readonly readLine: LineReader;
}

const TAB_SIZE = 4;
const INDENT_UNIT = 2;

/**
 * A cursor over one line of text that can also read the lines after it.
 */
export class StringStream extends CodeMirrorStringStream {
  /**
   * The index of the line in the document.
   */
  public readonly lineIndex: number;

  /**
   * Reads a following line.
   */
  public readonly readLine: LineReader;

  /**
   * Creates a cursor at the start of a line.
   *
   * @param params - The line and how to read the lines after it.
   */
  public constructor(params: StringStreamConstructorParams) {
    super(params.line, TAB_SIZE, INDENT_UNIT);
    this.lineIndex = params.lineIndex;
    this.readLine = params.readLine;
  }

  /**
   * Reads a following line.
   *
   * @param n - How many lines ahead.
   * @returns The line, or `undefined` past the end of the document.
   */
  public lookAhead(n: number): string | undefined {
    return this.readLine(n);
  }
}
