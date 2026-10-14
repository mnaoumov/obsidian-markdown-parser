/**
 * @file
 *
 * The markdown line mode underneath the editor's classes: a TypeScript port of the CodeMirror 5 `markdown` mode
 * (MIT, copyright Marijn Haverbeke and others), as Obsidian forks it. With its editor layer, it is configured the
 * way HyperMD configures it and carries the rules Obsidian adds, and the Obsidian layer in `obsidian-mode.ts` wraps
 * it. Without that layer, it is the fork with its own default options, which is what a ```` ```markdown ```` block
 * runs.
 *
 * The port keeps the original's control flow on purpose: the editor's quirks are this tokenizer's behaviour, so the
 * structure is what makes them reproducible.
 */

/* eslint-disable complexity, no-magic-numbers, prefer-named-capture-group, unicorn/consistent-function-scoping, unicorn/name-replacements, unicorn/prefer-simple-condition-first -- A line-for-line port of an upstream tokenizer: its names, regular expressions, nested helpers and condition order stay as upstream wrote them. */

import type { StringStream as CodeMirrorStringStream } from '@codemirror/streamparser';

import type { AnyMode } from './mode.ts';

import {
  copyState,
  startState
} from './mode.ts';

/**
 * The editor layer of the markdown mode: HyperMD's token types and options, and the rules Obsidian adds.
 */
export interface MarkdownEditorConfig {
  /**
   * Reads an Obsidian inline construct at the start of an inline token, when the layer above allows them.
   */
  readonly inlineHook: (stream: Stream, state: MarkdownState) => string | undefined;
}

/**
 * The HTML mode the markdown mode switches to.
 */
export interface MarkdownHtmlConfig {
  /**
   * Whether a state of the HTML mode sits in plain text outside every tag.
   */
  readonly isInText: (state: object) => boolean;

  /**
   * The HTML mode.
   */
  readonly mode: AnyMode;
}

/**
 * The markdown mode, with its internal token functions exposed for the layer that wraps it.
 */
export interface MarkdownMode {
  blankLine: (state: MarkdownState) => null;
  blockNormal: TokenFunction;
  copyState: (state: MarkdownState) => MarkdownState;
  getType: (state: MarkdownState) => null | string;
  htmlBlock: TokenFunction;
  inlineNormal: TokenFunction;
  startState: () => MarkdownState;
  token: (stream: Stream, state: MarkdownState) => null | string;
}

/**
 * Configuration of {@link createMarkdownMode}.
 */
export interface MarkdownModeConfig {
  /**
   * The editor layer. Without it, the mode is Obsidian's fork with the options below.
   */
  readonly editor?: MarkdownEditorConfig;

  /**
   * Finds the mode for a fenced code block's info string.
   */
  readonly getCodeMode: (name: string) => AnyMode | null;

  /**
   * Whether formatting marks get `formatting-*` classes. Always on with the editor layer.
   */
  readonly highlightFormatting?: boolean;

  /**
   * The HTML mode, and whether a state of it sits in plain text outside every tag.
   */
  readonly html: MarkdownHtmlConfig;

  /**
   * Whether `~~` marks strikethrough. Always on with the editor layer.
   */
  readonly strikethrough?: boolean;

  /**
   * Whether a list item may open with a task marker. Always on with the editor layer.
   */
  readonly taskLists?: boolean;
}

/**
 * The markdown mode's state. Fields beyond the CodeMirror 5 ones belong to the Obsidian layer.
 */
export interface MarkdownState {
  block: TokenFunction;
  code: number;
  codeOpenedInQuote: boolean;
  comment: boolean;
  em: false | string;
  emoji: boolean;
  extensionsAllowed: boolean;
  f: TokenFunction;
  fencedEndRE: null | RegExp;
  fenceIndent: number;
  fenceInList: boolean;
  footref: FootrefState | null;
  formatting: Formatting;
  hashtag: boolean;
  header: number;
  highlight: boolean;
  hr: boolean;
  htmlState: null | object;
  image?: boolean;
  imageAltText?: boolean;
  imageMarker?: boolean;
  indentation: number;
  indentationDiff: null | number;
  indentedCode: boolean;
  inline: TokenFunction;
  internalLink: InternalLinkState | null;
  lineStartQuote: number;
  linkHref: boolean;
  linkText: boolean;
  linkTitle: boolean;
  list: boolean | null;
  listStack: number[];
  localMode: AnyMode | null;
  localState: null | object;
  mdInside: boolean;
  prevLine: LineInfo;
  quote: number;
  quoteFence: number;
  quoteOpen: boolean;
  setext: number;
  strikethrough: boolean;
  strong: false | string;
  taskClosed?: boolean;
  taskList: boolean;
  taskOpen?: boolean;
  text: (stream: Stream, state: MarkdownState) => null | string | undefined;
  thisLine: LineInfo;
  trailingSpace: number;
  trailingSpaceNewLine: boolean;
}

/**
 * The line cursor the markdown mode reads, which can look at following lines.
 */
export interface Stream extends CodeMirrorStringStream {
  /**
   * Reads the line `n` lines after the current one.
   */
  lookAhead: (n: number) => string | undefined;
}

/**
 * A token function: reads one token and returns its classes.
 */
export type TokenFunction = (stream: Stream, state: MarkdownState) => null | string;

interface FootrefState {
  readonly inline: boolean;
}

type Formatting = false | string | string[];

interface InternalLinkState {
  readonly embed: boolean;
  readonly hasAlias: boolean;
  part: 'alias' | 'target';
}

interface LineInfo {
  fencedCodeEnd?: boolean;
  header?: boolean;
  hr?: boolean;
  stream: null | Stream;
}

// The fork's own token types, which HyperMD overrides for the editor.
const DEFAULT_TOKEN_TYPES = {
  code: 'comment',
  em: 'em',
  emoji: 'builtin',
  formatting: 'formatting',
  header: 'header',
  hr: 'hr',
  image: 'image',
  imageAltText: 'image-alt-text',
  imageMarker: 'image-marker',
  linkEmail: 'link',
  linkHref: 'string',
  linkInline: 'link',
  linkText: 'link',
  list1: 'variable-2',
  list2: 'variable-3',
  list3: 'keyword',
  quote: 'quote',
  strikethrough: 'strikethrough',
  strong: 'strong'
} as const;

const EDITOR_TOKEN_TYPES = {
  code: 'inline-code',
  em: 'em',
  emoji: 'builtin',
  formatting: 'formatting',
  header: 'header',
  hr: 'line-HyperMD-hr line-background-HyperMD-hr-bg hr',
  image: 'image',
  imageAltText: 'image-alt-text',
  imageMarker: 'image-marker',
  linkEmail: 'link',
  linkHref: 'string',
  linkInline: 'link',
  linkText: 'link',
  list1: 'list-1',
  list2: 'list-2',
  list3: 'list-3',
  quote: 'quote',
  strikethrough: 'strikethrough',
  strong: 'strong'
} as const;

const HR_RE = /^([*\-_])(?:\s*\1){2,}\s*$/u;
const LIST_RE = /^(?:[*\-+]|^[0-9]+([.)]))\s+/u;
const TASK_LIST_RE = /^\[(.)\](?=\s)/u;

/**
 * A bare URL, as HyperMD recognises one (from the CodeMirror 5 GFM mode).
 */
// CSpell:disable -- URI scheme names.
export const URL_RE =
  /^((?:(?:aaas?|about|acap|adiumxtra|af[ps]|aim|apt|attachment|aw|beshare|bitcoin|bolo|callto|cap|chrome(?:-extension)?|cid|coap|com-eventbrite-attendee|content|crid|cvs|data|dav|dict|dlna-(?:playcontainer|playsingle)|dns|doi|dtn|dvb|ed2k|facetime|feed|file|finger|fish|ftp|geo|gg|git|gizmoproject|go|gopher|gtalk|h323|hcp|https?|iax|icap|icon|im|imap|info|ipn|ipp|irc[6s]?|iris(?:\.beep|\.lwz|\.xpc|\.xpcs)?|itms|jar|javascript|jms|keyparc|lastfm|ldaps?|magnet|mailto|maps|market|message|mid|mms|ms-help|msnim|msrps?|mtqp|mumble|mupdate|mvn|news|nfs|nih?|nntp|notes|oid|opaquelocktoken|palm|paparazzi|platform|pop|pres|proxy|psyc|query|res(?:ource)?|rmi|rsync|rtmp|rtsp|secondlife|service|session|sftp|sgn|shttp|sieve|sips?|skype|sm[bs]|snmp|soap\.beeps?|soldat|spotify|ssh|steam|svn|tag|teamspeak|tel(?:net)?|tftp|things|thismessage|tip|tn3270|tv|udp|unreal|urn|ut2004|vemmi|ventrilo|view-source|webcal|wss?|wtai|wyciwyg|xcon(?:-userid)?|xfire|xmlrpc\.beeps?|xmpp|xri|ymsgr|z39\.50[rs]?):(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.-]+[.][a-z]{2,4}\/)(?:[^\s()<>]|\([^\s()<>]*\))+(?:\([^\s()<>]*\)|[^\s`*!()[\]{};:'".,<>?«»“”‘’]))/iu;
// CSpell:enable
const ATX_HEADER_RE = /^(#+)(?: |$)/u;
const SETEXT_HEADER_RE = /^ {0,3}(?:={1,}|-{2,})\s*$/u;
// Obsidian: a run of text also stops at `|` and `$`, the table and math marks.
const TEXT_RE = /^[^#![\]*_\\<>` "'(~:=|$%^]+/u;
const FENCED_CODE_RE = /^(~~~+|```+)[ \t]*([\w/+#-]*)[^\n`]*$/u;
const LINK_DEF_RE = /^\s*\[[^\]]+?\]:.*$/u;
const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}]/u;
const EXPANDED_TAB = ' '.repeat(4);
// Obsidian: the marks of a footnote definition, which wear no other style.
const FOOTNOTE_MARK = 'formatting formatting-link link';
// The fork: the characters a backslash escapes, as CommonMark defines them.
const ESCAPABLE_RE = /^[\\`*{}[\]()#+\-.!_>~|\n"$%&',/:;<=?@^]/u;

const LINK_RE = {
  ')': /^(?:[^\\()]|\\.|\((?:[^\\()]|\\.)*\))*?(?=\))/u,
  ']': /^(?:[^\\[\]]|\\.|\[(?:[^\\[\]]|\\.)*\])*?(?=\])/u
} as const;

/**
 * Creates the markdown mode.
 *
 * @param config - The sub-modes it switches to, and its options.
 * @returns The mode.
 */
export function createMarkdownMode(config: MarkdownModeConfig): MarkdownMode {
  const htmlMode = config.html.mode;
  const editor = config.editor;
  const isEditor = editor !== undefined;
  const isHighlightFormatting = isEditor || config.highlightFormatting === true;
  const isStrikethrough = isEditor || config.strikethrough === true;
  const isTaskLists = isEditor || config.taskLists === true;
  const TOKEN_TYPES = isEditor ? EDITOR_TOKEN_TYPES : DEFAULT_TOKEN_TYPES;

  function setFormatting(state: MarkdownState, formatting: Formatting): void {
    if (isHighlightFormatting) {
      state.formatting = formatting;
    }
  }

  function switchInline(stream: Stream, state: MarkdownState, f: TokenFunction): null | string {
    state.f = f;
    state.inline = f;
    return f(stream, state);
  }

  function switchBlock(stream: Stream, state: MarkdownState, f: TokenFunction): null | string {
    state.f = f;
    state.block = f;
    return f(stream, state);
  }

  function blankLine(state: MarkdownState): null {
    state.linkTitle = false;
    state.linkHref = false;
    state.linkText = false;
    state.em = false;
    state.strong = false;
    state.strikethrough = false;
    state.quote = 0;
    state.indentedCode = false;
    if (state.f === htmlBlock && state.htmlState && config.html.isInText(state.htmlState)) {
      state.f = inlineNormal;
      state.block = blockNormal;
      state.htmlState = null;
    }
    state.trailingSpace = 0;
    state.trailingSpaceNewLine = false;
    state.prevLine = state.thisLine;
    state.thisLine = { stream: null };
    return null;
  }

  function blockNormal(stream: Stream, state: MarkdownState): null | string {
    const isFirstTokenOnLine = stream.column() === state.indentation;
    const isPreviousLineIsEmpty = isLineEmpty(state.prevLine.stream);
    const isPreviousLineIsIndentedCode = state.indentedCode;
    const previousLineIsHr = state.prevLine.hr;
    const isPreviousLineIsList = state.list !== false;
    const maxNonCodeIndentation = (state.listStack.at(-1) ?? 0) + 3;

    state.indentedCode = false;

    const lineIndentation = state.indentation;
    if (state.indentationDiff === null) {
      state.indentationDiff = state.indentation;
      if (isPreviousLineIsList) {
        state.list = null;
        while (lineIndentation < (state.listStack.at(-1) ?? 0)) {
          state.listStack.pop();
          if (state.listStack.length > 0) {
            state.indentation = state.listStack.at(-1) ?? 0;
          } else {
            state.list = false;
          }
        }
        if (state.list !== false) {
          state.indentationDiff = lineIndentation - (state.listStack.at(-1) ?? 0);
        }
      }
    }

    const isAllowsInlineContinuation = !isPreviousLineIsEmpty && !previousLineIsHr && !state.prevLine.header
      && (!isPreviousLineIsList || !isPreviousLineIsIndentedCode) && !state.prevLine.fencedCodeEnd;

    const isHr = (state.list === false || previousLineIsHr === true || isPreviousLineIsEmpty)
      && state.indentation <= maxNonCodeIndentation && matchRe(stream, HR_RE) !== null;

    if (
      state.indentationDiff >= 4
      && (isPreviousLineIsIndentedCode || state.prevLine.fencedCodeEnd === true || state.prevLine.header === true || isPreviousLineIsEmpty)
    ) {
      stream.skipToEnd();
      state.indentedCode = true;
      return TOKEN_TYPES.code;
    }
    if (stream.eatSpace()) {
      return null;
    }
    let match: null | RegExpMatchArray = null;
    if (
      isFirstTokenOnLine && state.indentation <= maxNonCodeIndentation && (match = matchRe(stream, ATX_HEADER_RE))
      && (match[1] ?? '').length <= 6
    ) {
      state.quote = 0;
      state.header = (match[1] ?? '').length;
      state.thisLine.header = true;
      setFormatting(state, 'header');
      state.f = state.inline;
      return getType(state);
    }
    if (state.indentation <= maxNonCodeIndentation && stream.eat('>')) {
      state.quote = isFirstTokenOnLine ? 1 : state.quote + 1;
      state.quoteOpen = true;
      setFormatting(state, 'quote');
      stream.eatSpace();
      // Obsidian: a callout marker joins the quote mark.
      // A callout opens a quote: on a line's first mark only when the line above is not a quote line.
      return isEditor && !state.quoteFence && (!isFirstTokenOnLine || state.lineStartQuote === 0) && matchRe(stream, /^\[![^\]]+\][+-]?\s*/u)
        ? `${getType(state) ?? ''} hmd-callout line-HyperMD-callout`
        : getType(state);
    }
    /*
     * Obsidian: a fence inside a quote toggles an inline-code state instead of opening a code block. It must be the
     * first inline token after a quote mark, which may be on an earlier line when nothing followed that mark; a fence
     * that could open a code block is read as one first. The fork alone reads such a fence in `inlineNormal`.
     */
    const isAfterQuoteMark = />\s*$/u.test(stream.string.slice(0, stream.start)) || (state.quoteOpen && state.indentation > maxNonCodeIndentation);
    if (isEditor && state.quote && isAfterQuoteMark && (match = matchRe(stream, FENCED_CODE_RE))) {
      state.quoteFence = state.quoteFence ? 0 : (match[1] ?? '').length;
      return `${getType(state) ?? ''} inline-code`;
    }
    if (!isHr && !state.setext && isFirstTokenOnLine && state.indentation <= maxNonCodeIndentation && (match = matchRe(stream, LIST_RE))) {
      const listType = match[1] ? 'ol' : 'ul';

      state.indentation = lineIndentation + stream.current().length;
      state.list = true;
      state.quote = 0;

      state.listStack.push(state.indentation);
      state.em = false;
      state.strong = false;
      state.code = 0;
      state.quoteFence = 0;
      state.strikethrough = false;

      if (isTaskLists && matchRe(stream, TASK_LIST_RE, false)) {
        state.taskList = true;
      }
      state.f = state.inline;
      setFormatting(state, ['list', `list-${listType}`]);
      return getType(state);
    }
    if (isFirstTokenOnLine && state.indentation <= maxNonCodeIndentation && (match = matchRe(stream, FENCED_CODE_RE))) {
      return openFence(stream, state, match);
    }
    if (
      state.setext !== 0 || (
        (!isAllowsInlineContinuation || !isPreviousLineIsList) && !state.quote && state.list === false
        && !state.code && !state.quoteFence && !isHr && !LINK_DEF_RE.test(stream.string)
        && (match = SETEXT_HEADER_RE.exec(stream.lookAhead(1) ?? '')) !== null
        && stream.lookAhead(1) !== undefined
      )
    ) {
      if (state.setext) {
        state.header = state.setext;
        state.setext = 0;
        stream.skipToEnd();
        setFormatting(state, 'header');
      } else {
        state.header = match?.[0].startsWith('=') ? 1 : 2;
        state.setext = state.header;
      }
      state.thisLine.header = true;
      state.f = state.inline;
      return getType(state);
    }
    if (isHr) {
      stream.skipToEnd();
      state.hr = true;
      state.thisLine.hr = true;
      return TOKEN_TYPES.hr;
    }
    // Obsidian: a footnote definition opens only at the start of its line.
    return switchInline(stream, state, (isFirstTokenOnLine || !isEditor) && stream.peek() === '[' ? footnoteLink : state.inline);
  }

  function openFence(stream: Stream, state: MarkdownState, match: RegExpMatchArray): null | string {
    state.quote = 0;
    state.quoteFence = 0;
    state.fenceIndent = stream.indentation();
    state.fenceInList = state.list !== false;
    state.fencedEndRE = new RegExp(String.raw`^\s*${match[1] ?? ''}+ *$`, 'u');
    state.localMode = config.getCodeMode(match[2] ?? '');
    if (state.localMode) {
      state.localState = startState(state.localMode);
    }
    state.f = local;
    state.block = local;
    setFormatting(state, 'code-block');
    state.code = -1;
    return getType(state);
  }

  function htmlBlock(stream: Stream, state: MarkdownState): null | string {
    const htmlState = state.htmlState ?? startState(htmlMode);
    state.htmlState = htmlState;
    const style = htmlMode.token(stream, htmlState);
    if (config.html.isInText(htmlState) || (state.mdInside && stream.current().includes('>'))) {
      state.f = inlineNormal;
      state.block = blockNormal;
      state.htmlState = null;
    }
    return style;
  }

  function local(stream: Stream, state: MarkdownState): null | string {
    // Obsidian: a fence line keeps its indentation in its own token, and a fence ignores the end of its list item.
    if (stream.sol()) {
      state.indentation = (/^\s*/u.exec(stream.string)?.[0] ?? '').replaceAll('\t', () => EXPANDED_TAB).length;
    }
    const currentListInd = state.listStack.at(-1) ?? 0;
    const maxFencedEndInd = currentListInd + 3;
    // Obsidian: a closing fence is indented like the opening line, or at least as far in a list item.
    const isIndentFits = state.fenceInList ? state.indentation >= state.fenceIndent : state.indentation === state.fenceIndent;
    if (state.fencedEndRE && stream.sol() && state.indentation <= maxFencedEndInd && isIndentFits && matchRe(stream, state.fencedEndRE)) {
      setFormatting(state, 'code-block');
      const returnType = getType(state);
      state.localMode = null;
      state.localState = null;
      state.block = blockNormal;
      state.f = inlineNormal;
      state.fencedEndRE = null;
      state.code = 0;
      state.thisLine.fencedCodeEnd = true;
      return returnType;
    }
    if (state.localMode && state.localState) {
      return state.localMode.token(stream, state.localState);
    }
    stream.skipToEnd();
    return TOKEN_TYPES.code;
  }

  function getType(state: MarkdownState): null | string {
    const styles: string[] = [];

    if (state.formatting) {
      styles.push(TOKEN_TYPES.formatting);
      if (typeof state.formatting === 'string') {
        setFormatting(state, [state.formatting]);
      }
      for (const formatting of state.formatting) {
        styles.push(`${TOKEN_TYPES.formatting}-${formatting}`);
        if (formatting === 'header') {
          styles.push(`${TOKEN_TYPES.formatting}-${formatting}-${String(state.header)}`);
        } else if (formatting === 'quote') {
          styles.push(`${TOKEN_TYPES.formatting}-${formatting}-${String(state.quote)}`);
        }
      }
    }

    if (state.taskOpen) {
      styles.push('meta');
      return styles.join(' ');
    }
    if (state.taskClosed) {
      styles.push('property');
      return styles.join(' ');
    }

    if (state.linkHref) {
      styles.push(TOKEN_TYPES.linkHref, 'url');
    }
    // The fork styles a link's address like the text around it.
    if (state.strong) {
      styles.push(TOKEN_TYPES.strong);
    }
    if (state.em) {
      styles.push(TOKEN_TYPES.em);
    }
    if (state.strikethrough) {
      styles.push(TOKEN_TYPES.strikethrough);
    }
    if (state.highlight) {
      styles.push('highlight');
    }
    if (state.emoji) {
      styles.push(TOKEN_TYPES.emoji);
    }
    if (state.linkText) {
      styles.push(TOKEN_TYPES.linkText);
    }
    // Obsidian: a quote mark never wears the code style of a span it sits in.
    if ((state.code || state.quoteFence) && !styles.includes('formatting-quote')) {
      styles.push(TOKEN_TYPES.code);
    }
    if (state.image) {
      styles.push(TOKEN_TYPES.image);
    }
    if (state.imageAltText) {
      styles.push(TOKEN_TYPES.imageAltText, 'link');
    }
    if (state.imageMarker) {
      styles.push(TOKEN_TYPES.imageMarker);
    }

    if (state.header) {
      styles.push(TOKEN_TYPES.header, `${TOKEN_TYPES.header}-${String(state.header)}`);
    }

    if (state.quote) {
      styles.push(TOKEN_TYPES.quote, `${TOKEN_TYPES.quote}-${String(state.quote)}`);
    }

    if (state.list !== false) {
      const listModule = (state.listStack.length - 1) % 3;
      if (!listModule) {
        styles.push(TOKEN_TYPES.list1);
      } else if (listModule === 1) {
        styles.push(TOKEN_TYPES.list2);
      } else {
        styles.push(TOKEN_TYPES.list3);
      }
    }

    if (state.trailingSpaceNewLine) {
      styles.push('trailing-space-new-line');
    } else if (state.trailingSpace) {
      styles.push(`trailing-space-${state.trailingSpace % 2 ? 'a' : 'b'}`);
    }

    return styles.length > 0 ? styles.join(' ') : null;
  }

  function handleText(stream: Stream, state: MarkdownState): null | string | undefined {
    return matchRe(stream, TEXT_RE) ? getType(state) : undefined;
  }

  function inlineNormal(stream: Stream, state: MarkdownState): null | string {
    const isFirstTokenInQuote = state.quoteOpen;
    state.quoteOpen = false;
    const isExtensionsAllowed = isEditor && state.extensionsAllowed;
    const hooked = isExtensionsAllowed ? editor.inlineHook(stream, state) : undefined;
    if (hooked !== undefined) {
      return hooked;
    }

    const style = state.text(stream, state);
    if (style !== undefined) {
      return style;
    }

    if (state.list) {
      state.list = null;
      // Obsidian: a fence right after a list marker opens a code block, and a heading mark makes a heading.
      const fence = matchRe(stream, FENCED_CODE_RE);
      if (fence) {
        return openFence(stream, state, fence);
      }
      const heading = isEditor ? matchRe(stream, ATX_HEADER_RE) : null;
      if (heading && (heading[1] ?? '').length <= 6) {
        state.header = (heading[1] ?? '').length;
        setFormatting(state, 'header');
        // The heading mark itself does not wear the list style.
        const list = state.list;
        state.list = false;
        const type = getType(state);
        state.list = list;
        return type;
      }
      return getType(state);
    }

    if (state.taskList) {
      const task = matchRe(stream, TASK_LIST_RE);
      state.taskList = false;
      if (task || isEditor) {
        if (task?.[1] === ' ') {
          state.taskOpen = true;
        } else {
          state.taskClosed = true;
        }
        setFormatting(state, 'task');
        return isEditor ? `${getType(state) ?? ''} line-HyperMD-task-line` : getType(state);
      }
    }

    state.taskOpen = false;
    state.taskClosed = false;

    // The fork: a fence as the first inline token after a quote mark toggles a code span.
    if (!isEditor && isFirstTokenInQuote && matchRe(stream, FENCED_CODE_RE)) {
      const t = getType(state);
      state.code = state.code === 3 ? 0 : 3;
      return state.code ? getType(state) : t;
    }

    if (state.header && matchRe(stream, /^#+$/u)) {
      setFormatting(state, 'header');
      return getType(state);
    }

    if (state.quoteFence) {
      // A backtick run as long as the fence closes the state, like a code span.
      const run = matchRe(stream, /^`+/u);
      if (run && run[0].length >= 3) {
        state.quoteFence = 0;
        return `${getType(state) ?? ''} formatting formatting-code inline-code`;
      }
      // Anything else is read one character at a time, so a closing heading mark is still seen.
      if (!run) {
        stream.next();
      }
      return `${getType(state) ?? ''} inline-code`;
    }

    const ch = stream.next() ?? '';

    if (state.linkTitle) {
      state.linkTitle = false;
      let matchCh = ch === '(' ? ')' : ch;
      matchCh = matchCh.replaceAll(/([.?*+^[\]\\(){}|-])/gu, String.raw`\$1`);
      const regex = String.raw`^\s*(?:[^${matchCh}\\]+|\\\\|\\.)${matchCh}`;
      if (matchRe(stream, new RegExp(regex, 'u'))) {
        return TOKEN_TYPES.linkHref;
      }
    }

    if (ch === '`') {
      const previousFormatting = state.formatting;
      setFormatting(state, 'code');
      stream.eatWhile('`');
      const count = stream.current().length;
      if (state.code === 0 && (!state.quote || count === 1)) {
        state.code = count;
        state.codeOpenedInQuote = state.quote > 0;
        return getType(state);
      }
      if (count === state.code) {
        const t = getType(state);
        state.code = 0;
        return t;
      }
      state.formatting = previousFormatting;
      return getType(state);
    }
    if (state.code) {
      return getType(state);
    }

    if (ch === '\\' && isEditor && !stream.eol()) {
      stream.next();
      const type = getType(state);
      const formattingEscape = `${TOKEN_TYPES.formatting}-escape`;
      return type ? `${type} ${formattingEscape}` : formattingEscape;
    }
    // The fork: a backslash takes the character after it only when CommonMark lets it escape that character.
    if (ch === '\\' && !isEditor && matchRe(stream, ESCAPABLE_RE) && isHighlightFormatting) {
      const type = getType(state);
      const formattingEscape = `${TOKEN_TYPES.formatting}-escape`;
      return type ? `${type} ${formattingEscape}` : formattingEscape;
    }

    // Obsidian: `%%` comments.
    if (ch === '%' && isExtensionsAllowed && stream.eat('%')) {
      if (state.comment) {
        const t = getType(state);
        state.comment = false;
        return `${t ?? ''} comment-end formatting`;
      }
      state.comment = true;
      return `${getType(state) ?? ''} comment comment-start formatting`;
    }

    // Obsidian: `==highlight==`.
    if (ch === '=' && isEditor && stream.eat('=')) {
      if (stream.peek() === '=') {
        stream.eatWhile('=');
        return getType(state);
      }
      if (state.highlight) {
        setFormatting(state, ['highlight', 'highlight-end']);
        const t = getType(state);
        state.highlight = false;
        return t;
      }
      if (matchRe(stream, /^[^\s]/u, false)) {
        state.highlight = true;
        setFormatting(state, 'highlight');
        return getType(state);
      }
      stream.backUp(1);
    }

    // Obsidian: `[[internal links]]` and `![[embeds]]`, when the line closes them.
    if ((ch === '[' || ch === '!') && isEditor && !state.linkText && !state.image) {
      const isEmbed = ch === '!';
      const linkMatch = matchRe(stream, isEmbed ? /^\[\[([^\]]*?)\]\]/u : /^\[([^\]]*?)\]\]/u, false);
      if (linkMatch) {
        stream.pos += isEmbed ? 2 : 1;
        state.internalLink = { embed: isEmbed, hasAlias: (linkMatch[1] ?? '').includes('|'), part: 'target' };
        state.f = internalLink;
        state.inline = internalLink;
        return `${getType(state) ?? ''} formatting-link formatting-link-start${isEmbed ? ' formatting-embed' : ''}`;
      }
    }

    // Obsidian: `[^footnote]` references and `^[inline footnotes]`.
    if (isEditor && !state.linkText && !state.image && ((ch === '[' && stream.peek() === '^') || (ch === '^' && stream.peek() === '['))) {
      const isInline = ch === '^';
      const body = matchRe(stream, isInline ? /^\[([^\]]*)\]/u : /^\^([^\]]+)\]/u, false);
      if (body) {
        stream.next();
        state.footref = { inline: isInline };
        state.f = footref;
        state.inline = footref;
        const marks = isInline ? 'formatting-inline-footnote inline-footnote inline-footnote-start' : 'formatting formatting-link formatting-link-start hmd-barelink';
        return `${getType(state) ?? ''} footref ${marks}`;
      }
    }

    // Obsidian: a `^block-id` ending the line.
    if (ch === '^' && isEditor && matchRe(stream, /^[A-Za-z0-9-]+$/u)) {
      return 'blockid';
    }

    if (ch === '!' && matchRe(stream, /^\[[^\]]*\] ?(?:\(|\[)/u, false)) {
      state.imageMarker = true;
      state.image = true;
      setFormatting(state, 'image');
      return getType(state);
    }

    if (ch === '[' && state.imageMarker && matchRe(stream, /^[^\]]*\](\(.*?\)| ?\[.*?\])/u, false)) {
      state.imageMarker = false;
      state.imageAltText = true;
      setFormatting(state, 'image');
      return getType(state);
    }

    if (ch === ']' && state.imageAltText) {
      setFormatting(state, 'image');
      const type = getType(state);
      state.imageAltText = false;
      state.image = false;
      state.inline = linkHref;
      state.f = linkHref;
      return type;
    }

    if (ch === '[' && !state.image) {
      if (state.linkText && matchRe(stream, /^.*?\]/u)) {
        return getType(state);
      }
      state.linkText = true;
      setFormatting(state, 'link');
      return getType(state);
    }

    if (ch === ']' && state.linkText) {
      setFormatting(state, 'link');
      const type = getType(state);
      state.linkText = false;
      // Obsidian: a reference label must follow the link text with no space.
      const next = matchRe(stream, /^\(.*?\)|^\[.*?\]/u, false) ? linkHref : inlineNormal;
      state.inline = next;
      state.f = next;
      return type;
    }

    if (ch === '<' && matchRe(stream, /^(https?|ftps?):\/\/(?:[^\\>]|\\.)+>/u, false)) {
      state.f = linkInline;
      state.inline = linkInline;
      setFormatting(state, 'link');
      const type = getType(state);
      return `${type ? `${type} ` : ''}${TOKEN_TYPES.linkInline}`;
    }

    if (ch === '<' && matchRe(stream, /^[^> \\]+@(?:[^\\>]|\\.)+>/u, false)) {
      state.f = linkInline;
      state.inline = linkInline;
      setFormatting(state, 'link');
      const type = getType(state);
      return `${type ? `${type} ` : ''}${TOKEN_TYPES.linkEmail}`;
    }

    if (ch === '<' && matchRe(stream, /^(!--|\?|!\[CDATA\[|[a-z][a-z0-9-]*(?:\s+[a-z_:.-]+(?:\s*=\s*[^>]+)?)*\s*(?:>|$))/iu, false)) {
      const end = stream.string.indexOf('>', stream.pos);
      if (end !== -1) {
        const atts = stream.string.slice(stream.start, end);
        if (/markdown\s*=\s*(?:'|"){0,1}1(?:'|"){0,1}/u.test(atts)) {
          state.mdInside = true;
        }
      }
      stream.backUp(1);
      state.htmlState = startState(htmlMode);
      return switchBlock(stream, state, htmlBlock);
    }

    if (ch === '<' && matchRe(stream, /^\/\w*?>/u)) {
      state.mdInside = false;
      return 'tag';
    }
    if (ch === '*' || ch === '_') {
      let length = 1;
      const before = stream.pos === 1 ? ' ' : stream.string.charAt(stream.pos - 2);
      while (length < 3 && stream.eat(ch)) {
        length++;
      }
      const after = stream.peek() ?? ' ';
      const isLeftFlanking = !/\s/u.test(after) && (!PUNCTUATION.test(after) || /\s/u.test(before) || PUNCTUATION.test(before));
      const isRightFlanking = !/\s/u.test(before) && (!PUNCTUATION.test(before) || /\s/u.test(after) || PUNCTUATION.test(after));
      let nextEm: boolean | null = null;
      let nextStrong: boolean | null = null;
      if (length % 2) {
        if (!state.em && isLeftFlanking && (ch === '*' || !isRightFlanking || PUNCTUATION.test(before))) {
          nextEm = true;
        } else if (state.em === ch && isRightFlanking && (ch === '*' || !isLeftFlanking || PUNCTUATION.test(after))) {
          nextEm = false;
        }
      }
      if (length > 1) {
        if (!state.strong && isLeftFlanking && (ch === '*' || !isRightFlanking || PUNCTUATION.test(before))) {
          nextStrong = true;
        } else if (state.strong === ch && isRightFlanking && (ch === '*' || !isLeftFlanking || PUNCTUATION.test(after))) {
          nextStrong = false;
        }
      }
      if (nextStrong !== null || nextEm !== null) {
        if (nextEm === null) {
          setFormatting(state, 'strong');
        } else if (nextStrong === null) {
          setFormatting(state, 'em');
        } else {
          setFormatting(state, 'strong em');
        }
        if (nextEm === true) {
          state.em = ch;
        }
        if (nextStrong === true) {
          state.strong = ch;
        }
        const t = getType(state);
        if (nextEm === false) {
          state.em = false;
        }
        if (nextStrong === false) {
          state.strong = false;
        }
        return t;
      }
    } else if (ch === ' ' && (stream.eat('*') || stream.eat('_'))) {
      if (stream.peek() === ' ') {
        return getType(state);
      }
      stream.backUp(1);
    }

    if (ch === '~' && isStrikethrough && stream.eatWhile(ch)) {
      if (state.strikethrough) {
        setFormatting(state, 'strikethrough');
        const t = getType(state);
        state.strikethrough = false;
        return t;
      }
      if (matchRe(stream, /^[^\s]/u, false)) {
        state.strikethrough = true;
        setFormatting(state, 'strikethrough');
        return getType(state);
      }
    } else if (ch === ' ' && isStrikethrough && stream.match('~~', true)) {
      if (stream.peek() === ' ') {
        return getType(state);
      }
      stream.backUp(2);
    }

    if (ch === ' ') {
      if (matchRe(stream, /^ +$/u, false)) {
        state.trailingSpace++;
      } else if (state.trailingSpace) {
        state.trailingSpaceNewLine = true;
      }
    }

    return getType(state);
  }

  function footref(stream: Stream, state: MarkdownState): null | string {
    const isInline = state.footref?.inline ?? false;
    const context = getType(state) ?? '';
    if (stream.eat(']')) {
      state.footref = null;
      state.f = inlineNormal;
      state.inline = inlineNormal;
      const marks = isInline ? 'formatting-inline-footnote inline-footnote inline-footnote-end' : 'formatting formatting-link formatting-link-end hmd-barelink';
      return `${context} footref ${marks}`;
    }
    matchRe(stream, /^[^\]]+/u);
    return `${context} footref ${isInline ? 'inline-footnote' : 'hmd-barelink'}`;
  }

  function internalLink(stream: Stream, state: MarkdownState): null | string {
    const link = state.internalLink;
    const context = getType(state) ?? '';
    if (!link || stream.match(']]')) {
      state.internalLink = null;
      state.f = inlineNormal;
      state.inline = inlineNormal;
      return `${context} formatting-link formatting-link-end`;
    }
    const embed = link.embed ? ' hmd-embed' : '';
    if (link.part === 'target' && stream.eat('|')) {
      link.part = 'alias';
      return `${context} hmd-internal-link link-alias-pipe${embed}`;
    }
    if (link.part === 'target') {
      matchRe(stream, /^[^\]|]+/u);
      return `${context} hmd-internal-link${embed}${link.hasAlias ? ' link-has-alias' : ''}`;
    }
    matchRe(stream, /^[^\]]+/u);
    return `${context} hmd-internal-link link-alias${embed}`;
  }

  function linkInline(stream: Stream, state: MarkdownState): null | string {
    const ch = stream.next();

    if (ch === '>') {
      state.f = inlineNormal;
      state.inline = inlineNormal;
      setFormatting(state, 'link');
      const type = getType(state);
      return `${type ? `${type} ` : ''}${TOKEN_TYPES.linkInline}`;
    }

    matchRe(stream, /^[^>]+/u);

    // Obsidian: an autolink's address is also a URL.
    return isEditor ? `${TOKEN_TYPES.linkInline} url` : TOKEN_TYPES.linkInline;
  }

  function linkHref(stream: Stream, state: MarkdownState): null | string {
    if (stream.eatSpace()) {
      return null;
    }
    const ch = stream.next();
    if (ch === '(' || ch === '[') {
      const inside = getLinkHrefInside(ch === '(' ? ')' : ']');
      state.f = inside;
      state.inline = inside;
      setFormatting(state, 'link-string');
      state.linkHref = true;
      return getType(state);
    }
    return 'error';
  }

  function getLinkHrefInside(endChar: ')' | ']'): TokenFunction {
    return (stream, state) => {
      const ch = stream.next();

      if (ch === endChar) {
        state.f = inlineNormal;
        state.inline = inlineNormal;
        setFormatting(state, 'link-string');
        const returnState = getType(state);
        state.linkHref = false;
        return returnState;
      }

      matchRe(stream, LINK_RE[endChar]);
      state.linkHref = true;
      return getType(state);
    };
  }

  function footnoteLink(stream: Stream, state: MarkdownState): null | string {
    if (matchRe(stream, /^(?:[^\]\\]|\\.)*\]:/u, false)) {
      state.f = footnoteLinkInside;
      stream.next();
      setFormatting(state, 'link');
      state.linkText = true;
      if (!isEditor) {
        return getType(state);
      }
      // Obsidian: the `^` of a footnote definition belongs to the opening mark.
      stream.eat('^');
      // Obsidian joins the comment class onto this mark without a space.
      return state.comment ? `comment${FOOTNOTE_MARK}` : FOOTNOTE_MARK;
    }
    return switchInline(stream, state, inlineNormal);
  }

  function footnoteLinkInside(stream: Stream, state: MarkdownState): null | string {
    if (stream.match(']:', true)) {
      state.f = footnoteUrl;
      state.inline = footnoteUrl;
      setFormatting(state, 'link');
      const returnType = isEditor ? FOOTNOTE_MARK : getType(state);
      state.linkText = false;
      return returnType;
    }

    matchRe(stream, /^(?:[^\]\\]|\\.)+/u);

    // Obsidian: a definition's label wears the context styles, while its marks wear none.
    return isEditor ? getType(state) : TOKEN_TYPES.linkText;
  }

  function footnoteUrl(stream: Stream, state: MarkdownState): null | string {
    if (stream.eatSpace()) {
      return null;
    }
    state.f = inlineNormal;
    state.inline = inlineNormal;
    if (!isEditor) {
      // The fork: the next word is the URL, and a title may follow it, on this line or the next.
      matchRe(stream, /^[^\s]+/u);
      if (stream.peek() === undefined) {
        state.linkTitle = true;
      } else {
        matchRe(stream, /^(?:\s+(?:"(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+'|\((?:[^)\\]|\\.)+\)))?/u);
      }
      return `${TOKEN_TYPES.linkHref} url`;
    }
    // Obsidian: only a URL is marked after a definition's `]:`; anything else is plain text. A title may follow the URL.
    if (matchRe(stream, URL_RE)) {
      state.f = footnoteUrlTitle;
      return 'url hmd-footnote-url';
    }
    return inlineNormal(stream, state);
  }

  function footnoteUrlTitle(stream: Stream, state: MarkdownState): null | string {
    if (stream.eatSpace()) {
      return null;
    }
    state.f = inlineNormal;
    return matchRe(stream, /^(["']).*?\1/u) || matchRe(stream, /^\([^)]*?\)/u) ? 'hmd-footnote-url-title' : inlineNormal(stream, state);
  }

  return {
    blankLine,
    blockNormal,
    copyState(s: MarkdownState): MarkdownState {
      return {
        ...s,
        formatting: false,
        htmlState: s.htmlState && copyState(htmlMode, s.htmlState),
        listStack: [...s.listStack],
        localState: s.localMode && s.localState ? copyState(s.localMode, s.localState) : null
      };
    },
    getType,
    htmlBlock,
    inlineNormal,
    startState(): MarkdownState {
      return {
        block: blockNormal,
        code: 0,
        codeOpenedInQuote: false,
        comment: false,
        em: false,
        emoji: false,
        extensionsAllowed: true,
        f: blockNormal,
        fencedEndRE: null,
        fenceIndent: 0,
        fenceInList: false,
        footref: null,
        formatting: false,
        hashtag: false,
        header: 0,
        highlight: false,
        hr: false,
        htmlState: null,
        indentation: 0,
        indentationDiff: null,
        indentedCode: false,
        inline: inlineNormal,
        internalLink: null,
        lineStartQuote: 0,
        linkHref: false,
        linkText: false,
        linkTitle: false,
        list: false,
        listStack: [],
        localMode: null,
        localState: null,
        mdInside: false,
        prevLine: { stream: null },
        quote: 0,
        quoteFence: 0,
        quoteOpen: false,
        setext: 0,
        strikethrough: false,
        strong: false,
        taskList: false,
        text: handleText,
        thisLine: { stream: null },
        trailingSpace: 0,
        trailingSpaceNewLine: false
      };
    },
    token(stream: Stream, state: MarkdownState): null | string {
      state.formatting = false;

      if (stream !== state.thisLine.stream) {
        state.header = 0;
        state.hr = false;

        if (matchRe(stream, /^\s*$/u)) {
          blankLine(state);
          return null;
        }

        state.prevLine = state.thisLine;
        state.thisLine = { stream };
        state.lineStartQuote = state.quote;
        // Obsidian: a code span opened inside a quote does not run past the end of its line.
        if (isEditor && state.code > 0 && state.codeOpenedInQuote) {
          state.code = 0;
        }

        state.taskList = false;
        // The fork: link text and an unfinished image do not run past the end of their line.
        state.linkText = false;
        state.image = false;
        state.imageMarker = false;
        state.imageAltText = false;

        state.trailingSpace = 0;
        state.trailingSpaceNewLine = false;

        if (!state.localState && state.block !== local) {
          state.f = state.block;
          if (state.f !== htmlBlock) {
            const indentation = (matchRe(stream, /^\s*/u)?.[0] ?? '').replaceAll('\t', () => EXPANDED_TAB).length;
            state.indentation = indentation;
            state.indentationDiff = null;
            if (indentation > 0) {
              return null;
            }
          }
        }
      }
      return state.f(stream, state);
    }
  };
}

/**
 * Matches a pattern at the cursor.
 *
 * @param stream - The cursor.
 * @param pattern - The pattern, anchored with `^`.
 * @param shouldConsume - Whether to advance past the match.
 * @returns The match, or `null`.
 */
export function matchRe(stream: CodeMirrorStringStream, pattern: RegExp, shouldConsume = true): null | RegExpMatchArray {
  const match = stream.match(pattern, shouldConsume);
  return match && typeof match === 'object' ? match : null;
}

function isLineEmpty(line: null | Stream): boolean {
  return !line || !/\S/u.test(line.string);
}

/* eslint-enable complexity, no-magic-numbers, prefer-named-capture-group, unicorn/consistent-function-scoping, unicorn/name-replacements, unicorn/prefer-simple-condition-first -- The port ends here. */
