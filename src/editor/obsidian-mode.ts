/**
 * @file
 *
 * The editor's line mode: the markdown mode wrapped by a TypeScript port of the HyperMD mode (MIT, copyright
 * laobubu), which adds math, tables, footnotes, front matter, hashtags and the `line-*` classes, plus Obsidian's own
 * syntax as measured against the live editor.
 */

/* eslint-disable complexity, no-magic-numbers, prefer-named-capture-group, unicorn/consistent-function-scoping, unicorn/prefer-simple-condition-first -- A line-for-line port of an upstream tokenizer: its regular expressions, nested helpers, declaration order and condition order stay as upstream wrote them. */

import type {
  MarkdownState,
  Stream
} from './markdown-mode.ts';
import type { AnyMode } from './mode.ts';

import {
  createMarkdownMode,
  matchRe,
  URL_RE
} from './markdown-mode.ts';
import {
  copyState,
  startState
} from './mode.ts';
import {
  getCodeMode,
  HTML_MODE,
  isHtmlInText,
  TEX_MODE,
  YAML_MODE
} from './sub-modes.ts';

const TOKEN_BREAK_RE = /[^\\][$|]/u;
// Obsidian counts a tab in a footnote continuation's indentation as four spaces, wherever it stands.
const TAB_WIDTH = 4;
const LIST_RE = /^(?:[*\-+]|^[0-9]+([.)]))\s+/u;
// An internal link or an embed that its line closes: its embed mark and its text.
const INTERNAL_LINK_START_RE = /^(!?)\[\[(.*?)\]\]/u;
const EMAIL_RE = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/u;
// Obsidian: a table's head and delimiter rows, the rows that continue it, and a delimiter cell.
const SIMPLE_TABLE_RE = /^\s*[^|].*?\|.*[^|]\s*$/u;
const SIMPLE_TABLE_ROW_RE = /^\s*[^|].*\|/u;
const NORMAL_TABLE_RE = /^\|(?:[^|]+\|)+?\s*$/u;
const NORMAL_TABLE_ROW_RE = /^\|/u;
const TABLE_DELIMITER_CELL_RE = /^\s*(?::\s*)?-+(?:\s*:)?\s*$/u;

const enum LinkType {
  None = 0,
  Barelink = 1,
  Footref = 2,
  Normal = 3,
  Footnote = 4,
  Barelink2 = 5,
  Footref2 = 6
}

const LINK_STYLE = new Map<LinkType, string>([
  [LinkType.Barelink, 'hmd-barelink'],
  [LinkType.Barelink2, 'hmd-barelink2'],
  [LinkType.Footnote, 'hmd-barelink hmd-footnote line-HyperMD-footnote'],
  [LinkType.Footref, 'hmd-barelink footref'],
  [LinkType.Footref2, 'hmd-footref2']
]);

const enum NextMaybe {
  None = 0,
  FrontMatter = 1,
  FrontMatterEnd = 2
}

const enum TableType {
  None = 0,
  Simple = 1,
  Normal = 2
}

/**
 * The editor mode.
 */
export interface ObsidianMode {
  blankLine: (state: ObsidianState) => null | string;
  copyState: (state: ObsidianState) => ObsidianState;
  startState: () => ObsidianState;
  token: (stream: Stream, state: ObsidianState) => null | string;
}

/**
 * The editor mode's state: the markdown state plus the HyperMD and Obsidian fields.
 */
export interface ObsidianState extends MarkdownState {
  hmdEnteredMath: boolean;
  hmdFootnote: boolean;
  hmdInnerExitChecker: ExitChecker | null;
  hmdInnerMode: AnyMode | null;
  hmdInnerState: null | object;
  hmdInnerStyle: string | undefined;
  hmdIsHeading: boolean;
  hmdLineStartedWithMath: boolean;
  hmdLinkType: LinkType;
  hmdMathBlock: boolean;
  hmdNextMaybe: NextMaybe;
  hmdOverride: ((stream: Stream, state: ObsidianState) => null | string) | null;
  hmdTable: TableType;
  hmdTableCol: number;
  hmdTableColumns: string[];
  hmdTableRow: number;
  hmdWasHeading: boolean;
  inlineFootnote: boolean;
}

type ExitChecker = (stream: Stream, state: ObsidianState) => ExitInfo | null;

interface ExitInfo {
  endPos?: number;
  skipInnerMode?: boolean;
  style?: string;
}

const TAG_RE = /^[^\u{2000}-\u{206F}\u{2E00}-\u{2E7F}'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/u;

interface EnterModeOptions {
  readonly endTag?: string;
  readonly exitChecker?: ExitChecker;
  readonly fallbackMode?: () => AnyMode;
  readonly skipFirstToken?: boolean;
  readonly style?: string;
}

/**
 * Creates the editor mode.
 *
 * @returns The mode.
 */
export function createObsidianMode(): ObsidianMode {
  const rawMode = createMarkdownMode({
    editor: { inlineHook: (stream, state) => enterMath(stream, state as ObsidianState) },
    getCodeMode,
    html: { isInText: isHtmlInText, mode: HTML_MODE }
  });

  function modeOverride(stream: Stream, state: ObsidianState): null | string {
    const exit = state.hmdInnerExitChecker?.(stream, state) ?? null;
    const extraStyle = state.hmdInnerStyle;
    let ans = (!exit?.skipInnerMode) && state.hmdInnerMode && state.hmdInnerState
      ? state.hmdInnerMode.token(stream, state.hmdInnerState) ?? ''
      : '';
    if (extraStyle) {
      ans += ` ${extraStyle}`;
    }
    if (exit) {
      if (exit.style) {
        ans += ` ${exit.style}`;
      }
      if (exit.endPos !== undefined) {
        stream.pos = exit.endPos;
      }
      state.hmdInnerExitChecker = null;
      state.hmdInnerMode = null;
      state.hmdInnerState = null;
      state.hmdOverride = null;
    }
    ans += innerLineClasses(stream, state);
    if (exit) {
      state.hmdMathBlock = false;
    }
    return ans.trim() || null;
  }

  // Obsidian: the line classes of a token read by an inner mode.
  function innerLineClasses(stream: Stream, state: ObsidianState): string {
    let ans = state.hmdMathBlock ? ' line-HyperMD-math' : '';
    if (stream.eol() && state.quote) {
      ans += ` line-HyperMD-quote line-HyperMD-quote-${String(state.quote)} line-HyperMD-quote-lazy`;
    }
    return ans;
  }

  /*
   * Obsidian: math opens inside the markdown inline flow, after the line's block structure is read. Inline `$` math
   * opens before a non-space and closes after one; a `$$` that is the line's first non-space and is followed by no other
   * `$` on its line, escaped or not, opens a math block, whose lines carry `HyperMD-math`. A markdown link's text opens
   * no math.
   */
  function enterMath(stream: Stream, state: ObsidianState): string | undefined {
    const temporary = matchRe(stream, /^\${1,2}/u, false);
    if (!temporary) {
      // A bare URL or email address.
      return !state.hmdLinkType && (matchRe(stream, URL_RE) || matchRe(stream, EMAIL_RE)) ? `${rawMode.getType(state) ?? ''} url` : undefined;
    }
    if (state.linkText || state.hmdLinkType === LinkType.Footref) {
      return undefined;
    }
    if (!isMathAt(stream)) {
      state.hmdLineStartedWithMath = false;
      return undefined;
    }
    if (stream.pos === 0) {
      state.hmdLineStartedWithMath = true;
    }
    const endTag = temporary[0];
    const mathLevel = endTag.length;
    const endStyle = 'formatting formatting-math formatting-math-end math-';
    const endAtTag = createSimpleInnerModeExitChecker(endTag, { style: endStyle });
    let ans = enterMode(stream, state, TEX_MODE, {
      // Obsidian: in a table, math also ends before a pipe.
      exitChecker: (s, st) => st.hmdTable && s.string.charAt(s.start) === '|' ? { endPos: s.start, style: endStyle } : endAtTag(s, st),
      fallbackMode: () => createDummyMode(endTag),
      style: mathLevel === 1 ? ['math', ...openSpanStyles(state)].join(' ') : 'math'
    });
    ans += ` formatting formatting-math formatting-math-begin${mathLevel === 2 ? ' math-block' : ''}`;
    if (mathLevel === 2 && /^\s*\$\$[^$]*$/u.test(stream.string)) {
      state.hmdMathBlock = true;
    }
    state.hmdEnteredMath = true;
    return ans + innerLineClasses(stream, state);
  }

  function enterMode(stream: Stream, state: ObsidianState, mode: AnyMode | null, opt: EnterModeOptions): string {
    let innerMode = mode;
    if (!innerMode) {
      innerMode = opt.endTag === undefined ? opt.fallbackMode?.() ?? null : createDummyMode(opt.endTag);
      if (!innerMode) {
        throw new Error('no mode');
      }
    }
    state.hmdInnerExitChecker = opt.endTag === undefined ? opt.exitChecker ?? null : createSimpleInnerModeExitChecker(opt.endTag);
    state.hmdInnerStyle = opt.style;
    state.hmdInnerMode = innerMode;
    state.hmdOverride = modeOverride;
    state.hmdInnerState = startState(innerMode);
    let ans = opt.style ?? '';
    if (!opt.skipFirstToken) {
      // As in HyperMD, a first token without a style is concatenated as the string `null`, which becomes a class.
      ans += ` ${String(innerMode.token(stream, state.hmdInnerState))}`;
    }
    return ans.trim();
  }

  function token(stream: Stream, state: ObsidianState): null | string {
    if (state.hmdOverride) {
      return state.hmdOverride(stream, state);
    }
    // Obsidian: in a table, the spaces beside a pipe are a token of their own, with no classes.
    if (state.hmdTable && stream.peek() === ' ') {
      if (stream.string.charAt(stream.pos - 1) === '|' && stream.string.charAt(stream.pos - 2) !== '\\') {
        matchRe(stream, /^ +/u);
        return null;
      }
      if (matchRe(stream, /^ +\|/u)) {
        stream.backUp(1);
        return null;
      }
    }
    if (state.hmdNextMaybe === NextMaybe.FrontMatter) {
      if (stream.string === '---') {
        state.hmdNextMaybe = NextMaybe.FrontMatterEnd;
        return enterMode(stream, state, YAML_MODE, {
          exitChecker(s, st) {
            if (s.string === '---') {
              st.hmdNextMaybe = NextMaybe.None;
              return { endPos: 3 };
            }
            return null;
          },
          style: 'hmd-frontmatter'
        });
      }
      state.hmdNextMaybe = NextMaybe.None;
    }

    let wasInHTML = state.f === rawMode.htmlBlock;
    const wasInCodeFence = state.code === -1;
    const isBol = stream.start === 0;
    const wasLinkText = state.linkText;
    const wasLinkHref = state.linkHref;
    const wasInternalLink = state.internalLink !== null;
    if (isBol) {
      // Obsidian: a link's type does not carry over to the next line.
      state.hmdLinkType = LinkType.None;
      state.hmdWasHeading = state.hmdIsHeading;
      state.hmdIsHeading = false;
      // Obsidian: an inline footnote ends with its line.
      state.inlineFootnote = false;
      // Obsidian: a code span opened by one or two backticks does not run past the end of its line.
      if (state.code === 1 || state.code === 2) {
        state.code = 0;
      }
    }
    let isInMarkdown = !(wasInCodeFence || wasInHTML);
    let isInMarkdownInline = isInMarkdown && !(state.code || state.quoteFence || state.indentedCode || state.linkHref);
    /*
     * Obsidian: two tokens that start a line are read without the markdown mode, which then never sees that line: a
     * block id that is the whole line, and math once an earlier line has started with math. A `$` that does not open
     * math clears that memory.
     */
    if (isBol && isInMarkdownInline) {
      if (matchRe(stream, /^\^[A-Za-z0-9-]+$/u)) {
        return 'blockid';
      }
      if (state.hmdLineStartedWithMath && stream.peek() === '$' && !state.internalLink && isMathAt(stream)) {
        // Link text ends with its line, which the markdown mode records only once it reads the line.
        state.linkText = false;
        const math = enterMath(stream, state);
        state.hmdEnteredMath = false;
        return math ?? null;
      }
    }
    /*
     * Obsidian: the token after a line's leading whitespace is read for math before the markdown mode reads the line's
     * block structure, so math opens there even where that structure would be indented code, unless the line above is
     * indented code.
     */
    if (
      !isBol && isInMarkdownInline && state.f === state.block && stream.peek() === '$' && !state.internalLink
      && /^\s+$/u.test(stream.string.slice(0, stream.start)) && isMathAt(stream)
    ) {
      state.linkText = false;
      const math = enterMath(stream, state);
      state.hmdEnteredMath = false;
      return math ?? null;
    }
    let ans = '';
    let temporary: null | RegExpMatchArray;
    // Obsidian: a line after a footnote definition indented by a whole number of tab stops continues it.
    if (isBol && state.hmdFootnote) {
      const leading = /^\s*/u.exec(stream.string)?.[0] ?? '';
      const indentation = leading.length + (leading.length - leading.replaceAll('\t', '').length) * (TAB_WIDTH - 1);
      if (indentation > 0 && indentation % TAB_WIDTH === 0 && /\S/u.test(stream.string) && !LIST_RE.test(stream.string.trimStart())) {
        ans += ' line-HyperMD-footnote';
      } else {
        state.hmdFootnote = false;
      }
    }
    // Obsidian: a heading mark right after a bullet is read here, so it wears no other class.
    if (isInMarkdown && state.list && !state.header && stream.peek() === '#' && /^\s*[*+-]\s$/u.test(stream.string.slice(0, stream.pos))) {
      const heading = matchRe(stream, /^(#+)(?: |$)/u);
      if (heading) {
        const level = String((heading[1] ?? '').length);
        state.header = (heading[1] ?? '').length;
        return `formatting formatting-header formatting-header-${level} header header-${level}`;
      }
    }
    /*
     * Obsidian: a pipe in a table ends every inline span open in its cell. A pipe inside an internal link keeps its
     * alias-pipe class, which is read before the reset, and ends the link.
     */
    if (state.hmdTable && stream.peek() === '|' && stream.string.charAt(stream.pos - 1) !== '\\') {
      if (state.internalLink) {
        ans += ' link-alias-pipe';
        state.f = rawMode.inlineNormal;
        state.inline = rawMode.inlineNormal;
      }
      resetTableCell(state);
    }
    const wasInComment = state.comment;
    const wasInMarkdownInline = isInMarkdownInline;
    // Obsidian splits an escape into its backslash and its character only in a token that starts at the backslash.
    const isEscapeAt = isInMarkdownInline && stream.peek() === '\\';
    const wasInDefinitionDestination = state.f === rawMode.footnoteUrl || state.f === rawMode.footnoteUrlTitle;
    state.extensionsAllowed = isInMarkdownInline;
    /*
     * Obsidian: a mark read here ends its token where the mark says, while the markdown mode still reads a token from
     * where the mark leaves the cursor, and the token keeps that read's classes but not its length.
     */
    let tokenEnd = -1;
    // Whether the markdown mode's read leaves the state as it was.
    let isReadOnCopy = false;
    let isFootrefStart = false;
    // An internal link a footnote reference's label opens, and the match that opens it.
    let footrefInternalLink: null | RegExpMatchArray = null;
    /*
     * Obsidian: `[^label]` is a footnote reference when its label holds no `]` and no whitespace, and may be empty,
     * unless a `:` follows it at the start of the line. `[^` is one token, whose markdown read changes the state, so a
     * `[` there opens link text instead. Each character of the label and the closing `]` is a token whose markdown read
     * changes nothing, except that a `%%` there still opens or closes a comment. A reference inside an internal link
     * ends the link, whose alias class its opening mark keeps, and the rest of the link is plain text. These markdown
     * reads open no internal link, which is the layer's: a label character starting one opens it as a token of its own
     * and ends the reference, so the link's next character is read inside the link.
     */
    if (isInMarkdownInline && state.internalLink && stream.peek() === '[' && matchRe(stream, /^\[\^[^\]\s]*\]/u, false)) {
      if (state.internalLink.part === 'alias') {
        ans += ' link-alias';
      }
      state.internalLink = null;
      state.f = rawMode.inlineNormal;
      state.inline = rawMode.inlineNormal;
    }
    if (isInMarkdownInline && !state.internalLink) {
      if (state.hmdLinkType === LinkType.Footref) {
        isReadOnCopy = true;
        tokenEnd = stream.pos + 1;
        if (stream.peek() === ']') {
          state.hmdLinkType = LinkType.None;
          ans += ` formatting formatting-link formatting-link-end ${LINK_STYLE.get(LinkType.Footref) ?? ''}`;
        } else if ((footrefInternalLink = matchRe(stream, INTERNAL_LINK_START_RE, false))) {
          state.hmdLinkType = LinkType.None;
          ans += ` formatting-link formatting-link-start${footrefInternalLink[1] ? ' formatting-embed' : ''} ${LINK_STYLE.get(LinkType.Footref) ?? ''}`;
        }
      } else if (stream.peek() === '[' && (temporary = matchRe(stream, /^\[\^[^\]\s]*\](:?)/u, false)) && !(isBol && temporary[1])) {
        stream.pos += 2;
        ans += ' formatting formatting-link formatting-link-start';
        state.hmdLinkType = LinkType.Footref;
        tokenEnd = stream.pos;
        isFootrefStart = true;
      }
      // Obsidian: a block id ending the line is read here, so it wears no other class.
      if (stream.peek() === '^' && matchRe(stream, /^\^[A-Za-z0-9-]+$/u)) {
        return `${ans} blockid`.trim();
      }
    }
    /*
     * Obsidian: `^[` opens an inline footnote, whose body is read as inline markdown. The first `]` outside link text,
     * a footnote reference, an internal link, an image and code closes it, and the `]` closing a footnote reference
     * closes it too. The token the markdown mode reads after a closing `]` sees none of Obsidian's inline syntax.
     */
    if (isInMarkdownInline && !state.inlineFootnote && stream.match('^[', false)) {
      state.inlineFootnote = true;
      ans += ' inline-footnote-start formatting-inline-footnote';
      tokenEnd = stream.pos + 2;
    } else if (isInMarkdownInline && state.inlineFootnote && !state.internalLink && state.hmdLinkType === LinkType.None && !state.image && stream.peek() === ']') {
      state.inlineFootnote = false;
      ans += ' footref inline-footnote inline-footnote-end formatting-inline-footnote';
      stream.next();
      tokenEnd = stream.pos;
      state.extensionsAllowed = false;
    }
    const readState = isReadOnCopy ? rawMode.copyState(state) : state;
    if (footrefInternalLink || (isFootrefStart && matchRe(stream, INTERNAL_LINK_START_RE, false))) {
      readState.extensionsAllowed = false;
    }
    ans += ` ${rawMode.token(stream, readState) ?? ''}`;
    if (footrefInternalLink) {
      state.internalLink = { embed: Boolean(footrefInternalLink[1]), hasAlias: (footrefInternalLink[2] ?? '').includes('|'), part: 'target' };
      state.f = rawMode.internalLink;
      state.inline = rawMode.internalLink;
    }
    // A comment mark is the layer above's in Obsidian, so it keeps its length and its effect on the state.
    if ((isReadOnCopy || isFootrefStart) && readState.comment !== wasInComment) {
      state.comment = readState.comment;
      tokenEnd = stream.pos;
    }
    /*
     * Obsidian: a read after a mark that opens its line leaves the line's block structure unread. HTML that read opens
     * is left half open: the token goes on as inline text, while the HTML block and its state wait for the next line.
     */
    if (isFootrefStart && isBol && state.f === state.block) {
      state.f = rawMode.inlineNormal;
      state.inline = rawMode.inlineNormal;
    }
    if (tokenEnd !== -1) {
      stream.pos = tokenEnd;
    }
    if (state.header) {
      state.hmdIsHeading = true;
    }
    if (state.hmdEnteredMath) {
      state.hmdEnteredMath = false;
      return ans.trim();
    }
    // Obsidian: a token read as markdown inline text inside a `%%` comment carries `comment`.
    if (wasInComment && wasInMarkdownInline && !/\b(?:blockid|commentformatting)\b/u.test(ans)) {
      ans += ' comment';
    }

    let isInHTML = state.f === rawMode.htmlBlock;
    // Obsidian: in a table, HTML ends at a pipe read as text, a string or an attribute.
    if (state.hmdTable && isInHTML) {
      const htmlToken = stream.current();
      if (/(?:^|[^\\])\|/u.test(htmlToken) && (!ans.trim() || /string|attribute|error/u.test(ans))) {
        isInHTML = false;
        wasInHTML = false;
        state.htmlState = null;
        state.block = rawMode.blockNormal;
        state.f = rawMode.inlineNormal;
        state.inline = rawMode.inlineNormal;
        stream.pos = htmlToken === '|' ? stream.start : stream.start + 1;
      }
    }
    const isInCodeFence = state.code === -1;
    isInMarkdown &&= !(isInHTML || isInCodeFence);
    isInMarkdownInline = isInMarkdown && !(state.code || state.quoteFence || state.indentedCode || state.linkHref);
    if (isInMarkdownInline && (temporary = TOKEN_BREAK_RE.exec(stream.current()))) {
      stream.pos = stream.start + (temporary.index ?? 0) + 1;
    }
    let current = stream.current();
    if (isInHTML !== wasInHTML) {
      ans += isInHTML ? ' hmd-html-begin' : ' hmd-html-end';
      // Obsidian: a definition's label gives its classes before the read, so a token of it that opens HTML wears them.
      if (isInHTML && state.hmdLinkType === LinkType.Footnote) {
        ans += ` link ${LINK_STYLE.get(LinkType.Footnote) ?? ''}`;
      }
    }
    if (wasInCodeFence || isInCodeFence) {
      if (!state.localMode || !wasInCodeFence) {
        ans = ans.replace('inline-code', '');
      }
      ans += ' hmd-codeblock line-HyperMD-codeblock line-background-HyperMD-codeblock-bg';
      // Obsidian: a fence opened in a list item marks its lines as list lines without a bullet.
      if (state.list !== false) {
        ans += ' line-HyperMD-list-line line-HyperMD-list-line-nobullet';
      }
      if (isInCodeFence !== wasInCodeFence) {
        if (!isInCodeFence) {
          ans += ' line-HyperMD-codeblock-end line-background-HyperMD-codeblock-end-bg';
        } else if (!wasInCodeFence) {
          ans += ' line-HyperMD-codeblock-begin line-background-HyperMD-codeblock-begin-bg';
        }
      }
    }
    if (isInMarkdown) {
      let tableType = state.hmdTable;
      if (isBol && tableType) {
        const rowRE = tableType === TableType.Simple ? SIMPLE_TABLE_ROW_RE : NORMAL_TABLE_ROW_RE;
        if (rowRE.test(stream.string)) {
          state.hmdTableCol = 0;
          state.hmdTableRow++;
        } else {
          resetTable(state);
        }
      }
      if (isBol && state.header) {
        ans += /^(?:---+|===+)\s*$/u.test(stream.string) && state.prevLine.header ? ` line-HyperMD-header-line line-HyperMD-header-line-${String(state.header)}` : ` line-HyperMD-header line-HyperMD-header-${String(state.header)}`;
      }
      if (state.indentedCode) {
        ans += ' hmd-indented-code';
      }
      if (state.quote) {
        /*
         * Obsidian: any markdown token read while a quote is open marks its line a quote line, unless another quote
         * mark follows it; a line whose first quote mark is not within 3 spaces of its start is a lazy one.
         */
        // A space the mode reads with no style before a definition's destination marks nothing.
        if ((ans.trim() || !wasInDefinitionDestination) && (!matchRe(stream, /^\s*>/u, false) || stream.eol())) {
          ans += ` line-HyperMD-quote line-HyperMD-quote-${String(state.quote)}`;
          if (!/^ {0,3}>/u.test(stream.string)) {
            ans += ' line-HyperMD-quote-lazy';
          }
        }
        if (isBol && (temporary = /^\s+/u.exec(current))) {
          stream.pos = temporary[0].length;
          ans += ' hmd-indent-in-quote';
          return ans.trim();
        }
      }
      const maxNonCodeIndentation = (state.listStack.at(-1) ?? 0) + 3;
      const isTokenIsIndent = isBol && /^\s+$/u.test(current) && (state.list !== false || stream.indentation() <= maxNonCodeIndentation);
      const tokenIsListBullet = state.list && ans.includes('formatting-list');
      if (tokenIsListBullet || (isTokenIsIndent && (state.list !== false || matchRe(stream, LIST_RE, false)))) {
        let listLevel = state.listStack.length;
        if (isTokenIsIndent) {
          if (matchRe(stream, LIST_RE, false)) {
            if (state.list === false) {
              listLevel++;
            }
          } else {
            while (listLevel > 0 && stream.pos < (state.listStack[listLevel - 1] ?? 0)) {
              listLevel--;
            }
            if (!listLevel) {
              return ans.trim() || null;
            }
            ans += ` line-HyperMD-list-line-nobullet line-HyperMD-list-line line-HyperMD-list-line-${String(listLevel)}`;
          }
          ans += ` hmd-list-indent hmd-list-indent-${String(listLevel)}`;
        } else if (tokenIsListBullet) {
          ans += ` line-HyperMD-list-line line-HyperMD-list-line-${String(listLevel)}`;
        }
      }
      if (wasLinkText !== state.linkText) {
        if (wasLinkText) {
          ans += ` ${LINK_STYLE.get(state.hmdLinkType) ?? ''}`;
          if (state.hmdLinkType === LinkType.Footnote) {
            state.hmdFootnote = true;
          }
          state.hmdLinkType = LinkType.None;
        } else {
          temporary = matchRe(stream, /^([^\]]*)\](\(| ?\[|:)?/u, false);
          const label = temporary?.[1] ?? '';
          const isLineStart = /^\s*$/u.test(stream.string.slice(0, stream.start));
          // Obsidian: a definition's label may be empty, or be the `^` the markdown mode read with its opening mark.
          if (!temporary || (!label && !(temporary[2] === ':' && isLineStart))) {
            state.hmdLinkType = LinkType.Barelink;
          } else if (!temporary[2]) {
            state.hmdLinkType = label.startsWith('^') && !/\s/u.test(label) ? LinkType.Footref : LinkType.Barelink;
          } else if (temporary[2] === ':') {
            /*
             * Obsidian: only a definition opening its line is a footnote, and not one whose label is a `^` with
             * whitespace after it, which is a plain link definition.
             */
            state.hmdLinkType = isLineStart && !(label.startsWith('^') && /\s/u.test(label)) ? LinkType.Footnote : LinkType.Normal;
          } else if ((temporary[2] === '[' || temporary[2] === ' [') && stream.string.charAt(stream.pos + temporary[0].length) === ']') {
            state.hmdLinkType = LinkType.Barelink2;
          } else {
            state.hmdLinkType = LinkType.Normal;
          }
        }
      } else if (state.linkText && state.internalLink && !wasInternalLink) {
        // Obsidian: an internal link opened in link text ends the link's type, whose style its opening mark wears.
        ans += ` ${LINK_STYLE.get(state.hmdLinkType) ?? ''}`;
        state.hmdLinkType = LinkType.None;
      } else if (isBol && state.linkText && /^\s*$/u.test(stream.string.slice(0, stream.start)) && matchRe(stream, /^[^\]]+\]:/u, false)) {
        /*
         * Obsidian: link text left open on the line above hides the new link this line opens, but not a footnote
         * definition, which it reads apart from link text.
         */
        state.hmdLinkType = LinkType.Footnote;
      }
      if (wasLinkHref !== state.linkHref) {
        if (!wasLinkHref) {
          if (current === '[' && stream.peek() !== ']') {
            state.hmdLinkType = LinkType.Footref2;
          }
        } else if (state.hmdLinkType) {
          ans += ` ${LINK_STYLE.get(state.hmdLinkType) ?? ''}`;
          state.hmdLinkType = LinkType.None;
        }
      }
      if (state.hmdLinkType !== LinkType.None) {
        ans += ` ${LINK_STYLE.get(state.hmdLinkType) ?? ''}`;
        // Obsidian: a footnote label's text between its brackets wears the footnote style twice, and its marks once.
        if (state.hmdLinkType === LinkType.Footnote && wasLinkText && state.linkText && !ans.includes('formatting-link')) {
          ans += ` ${LINK_STYLE.get(state.hmdLinkType) ?? ''}`;
        }
      }
      if (state.inlineFootnote) {
        ans += ' footref inline-footnote';
      }
      /*
       * Obsidian: the token that makes its line indented code is split too, as an escape of the rest of the line, since
       * the line is still inline markdown when the token starts.
       */
      if (isEscapeAt && (ans.includes('formatting-escape') || state.indentedCode) && current.length > 1) {
        const escapedLength = current.length - 1;
        const escapedCharStyle = `${ans.replace('formatting-escape', 'escape')} hmd-escape-char`;
        state.hmdOverride = (s, st): string => {
          s.pos += escapedLength;
          st.hmdOverride = null;
          return escapedCharStyle.trim();
        };
        ans += ' hmd-escape-backslash';
        stream.pos -= escapedLength;
        return ans;
      }
      if (!ans.trim()) {
        let isTableSeparator = false;
        if (current.startsWith('|')) {
          stream.pos = stream.start + 1;
          current = '|';
          isTableSeparator = true;
        }
        // Obsidian: a table does not interrupt a paragraph; its header row follows a blank line or a heading.
        if (isTableSeparator && (tableType || !state.prevLine.stream || !/\S/u.test(state.prevLine.stream.string) || state.hmdWasHeading)) {
          if (!tableType) {
            /*
             * Obsidian: a row starting with a pipe and holding no empty cell heads a table when the next line is a
             * delimiter row of the same shape. A row with an inner pipe, starting and ending with something else, heads
             * one when the next line has that shape too. Dashes may be single, and the column counts need not agree.
             */
            const nextLine = stream.lookAhead(1) ?? '';
            if (SIMPLE_TABLE_RE.test(stream.string)) {
              tableType = SIMPLE_TABLE_RE.test(nextLine) ? TableType.Simple : TableType.None;
            } else if (NORMAL_TABLE_RE.test(stream.string)) {
              tableType = NORMAL_TABLE_RE.test(nextLine) ? TableType.Normal : TableType.None;
            }
            const rowStyles = (tableType === TableType.Normal ? nextLine.replace(/^\s*\|/u, '').replace(/\|\s*$/u, '') : nextLine).split('|');
            if (rowStyles.some((cell) => !TABLE_DELIMITER_CELL_RE.test(cell))) {
              tableType = TableType.None;
            }
            if (tableType) {
              state.hmdTable = tableType;
              state.hmdTableColumns = rowStyles;
              state.hmdTableRow = 0;
              state.hmdTableCol = 0;
            }
          }
          if (tableType) {
            const colUbound = state.hmdTableColumns.length - 1;
            // Obsidian: a row is marked by a separator read while its column count is still 0.
            if (state.hmdTableCol === 0) {
              ans += ` line-HyperMD-table-${String(tableType)} line-HyperMD-table-row line-HyperMD-table-row-${String(state.hmdTableRow)}`;
            }
            if (
              tableType === TableType.Normal
              && ((state.hmdTableCol === 0 && /^\s*\|$/u.test(stream.string.slice(0, stream.pos))) || matchRe(stream, /^\s*$/u, false))
            ) {
              ans += ' hmd-table-sep hmd-table-sep-dummy';
            } else if (state.hmdTableCol < colUbound) {
              const col = state.hmdTableCol++;
              ans += ` hmd-table-sep hmd-table-sep-${String(col)}`;
            }
          }
        }
      }
      if (isInMarkdownInline && wasInMarkdownInline) {
        if (state.hashtag) {
          // Obsidian: the rest of a tag drops the emphasis it opened in.
          ans = `${ans} `.replaceAll(/(?:(?:formatting )?formatting-em|em) /gu, '');
          let isEndHashtag = false;
          if (!ans.includes('formatting') && !/^\s*$/u.test(current)) {
            const tagChars = TAG_RE.exec(current)?.[0].length ?? 0;
            if (current.length > tagChars) {
              stream.backUp(current.length - tagChars);
              current = current.slice(0, tagChars);
              isEndHashtag = true;
            }
          }
          isEndHashtag ||= stream.eol() || !TAG_RE.test(stream.peek() ?? '');
          ans += ' hashtag meta';
          if (isEndHashtag) {
            ans += ` hashtag-end ${tagClass(current)}`;
            state.hashtag = false;
          }
        } else if (
          current === '#' && !state.linkText && !state.image && !state.internalLink
          && (isBol || /^\s*$/u.test(stream.string.charAt(stream.start - 1)))
        ) {
          const name = TAG_RE.exec(stream.string.slice(stream.pos))?.[0];
          if (name && !/^\d+$/u.test(name)) {
            state.hashtag = true;
            ans += ` formatting formatting-hashtag hashtag-begin hashtag meta ${tagClass(name)}`;
          }
        }
      }
      // Obsidian: the line must also have been inline markdown before the token, so not the line after indented code.
      if (isInMarkdownInline && wasInMarkdownInline && current === '<') {
        let endTag: null | string = null;
        if (matchRe(stream, /^!(?:[A-Z]+)/u)) {
          endTag = '>';
        } else if (stream.match('?')) {
          endTag = '?>';
        } else if (stream.match('![CDATA[')) {
          endTag = ']]>';
        }
        if (endTag !== null) {
          return enterMode(stream, state, null, {
            endTag,
            style: `${ans} comment hmd-cdata-html`.trim()
          });
        }
      }
    }
    return ans.trim() || null;
  }

  return {
    blankLine(state: ObsidianState): null | string {
      let ans: null | string | undefined;
      const innerMode = state.hmdInnerMode;
      if (innerMode) {
        if (innerMode.blankLine && state.hmdInnerState) {
          ans = innerMode.blankLine(state.hmdInnerState, 2);
        }
      } else {
        ans = rawMode.blankLine(state);
      }
      let style = ans ?? '';
      // Front matter must open on the first line.
      if (state.hmdNextMaybe === NextMaybe.FrontMatter) {
        state.hmdNextMaybe = NextMaybe.None;
      }
      state.hmdLinkType = LinkType.None;
      // Obsidian: a blank line inside a footnote definition stays in it.
      if (state.hmdFootnote) {
        style += ' line-HyperMD-footnote';
      }
      if (state.hmdMathBlock) {
        style += ' line-HyperMD-math';
      }
      if (state.code === -1) {
        style += ' line-HyperMD-codeblock line-background-HyperMD-codeblock-bg';
      }
      resetTable(state);
      return style.trim() || null;
    },
    copyState(s: ObsidianState): ObsidianState {
      const ans = rawMode.copyState(s) as ObsidianState;
      ans.hmdTableColumns = [...s.hmdTableColumns];
      ans.hmdInnerState = s.hmdInnerMode && s.hmdInnerState ? copyState(s.hmdInnerMode, s.hmdInnerState) : null;
      return ans;
    },
    startState(): ObsidianState {
      return {
        ...rawMode.startState(),
        hmdEnteredMath: false,
        hmdFootnote: false,
        hmdInnerExitChecker: null,
        hmdInnerMode: null,
        hmdInnerState: null,
        hmdInnerStyle: undefined,
        hmdIsHeading: false,
        hmdLineStartedWithMath: false,
        hmdLinkType: LinkType.None,
        hmdMathBlock: false,
        hmdNextMaybe: NextMaybe.FrontMatter,
        hmdOverride: null,
        hmdTable: TableType.None,
        hmdTableCol: 0,
        hmdTableColumns: [],
        hmdTableRow: 0,
        hmdWasHeading: false,
        inlineFootnote: false
      };
    },
    token
  };
}

function createDummyMode(endTag: string): AnyMode {
  return {
    token(stream): null {
      const endTagSince = stream.string.indexOf(endTag, stream.start);
      if (endTagSince === -1) {
        stream.skipToEnd();
      } else if (endTagSince === 0) {
        stream.pos += endTag.length;
      } else {
        stream.pos = endTagSince;
        if (stream.string.charAt(endTagSince - 1) === '\\') {
          stream.pos++;
        }
      }
      return null;
    }
  };
}

function createSimpleInnerModeExitChecker(endTag: string, returnValueInfo: ExitInfo = {}): ExitChecker {
  return (stream) => {
    if (stream.string.slice(stream.start, stream.start + endTag.length) === endTag) {
      returnValueInfo.endPos = stream.start + endTag.length;
      return returnValueInfo;
    }
    return null;
  };
}

/**
 * Whether math opens at the cursor: `$$`, or a `$` before a non-space that a later `$` after a non-space closes.
 *
 * @param stream - The cursor, at a `$`.
 * @returns `true` when math opens.
 */
function isMathAt(stream: Stream): boolean {
  const rest = stream.string.slice(stream.pos);
  return rest.startsWith('$$') || (/^\$[^\s$]/u.test(rest) && /[^\s\\]\$/u.test(rest.slice(1)));
}

/*
 * Obsidian: every token of `$` math, from either mark to the other, wears the emphasis, strikethrough and highlight
 * spans open around it, even from an earlier line, but not a highlight's color. `$$` math wears none of them.
 */
function openSpanStyles(state: ObsidianState): string[] {
  const styles: string[] = [];
  if (state.strong) {
    styles.push('strong');
  }
  if (state.em) {
    styles.push('em');
  }
  if (state.strikethrough) {
    styles.push('strikethrough');
  }
  if (state.highlight) {
    styles.push('highlight');
  }
  return styles;
}

function resetTable(state: ObsidianState): void {
  state.hmdTable = TableType.None;
  state.hmdTableColumns = [];
  state.hmdTableCol = 0;
  state.hmdTableRow = 0;
}

function resetTableCell(state: ObsidianState): void {
  state.code = 0;
  state.comment = false;
  state.em = false;
  state.formatting = false;
  state.hashtag = false;
  state.highlight = false;
  state.hmdLinkType = LinkType.None;
  state.internalLink = null;
  state.linkHref = false;
  state.linkText = false;
  state.linkTitle = false;
  state.strikethrough = false;
  state.strong = false;
}

// Obsidian: a tag class keeps only ASCII letters, digits, `_` and `-`.
function tagClass(name: string): string {
  return `tag-${name.replaceAll(/[^\w-]/gu, '')}`;
}

/* eslint-enable complexity, no-magic-numbers, prefer-named-capture-group, unicorn/consistent-function-scoping, unicorn/prefer-simple-condition-first -- The port ends here. */
