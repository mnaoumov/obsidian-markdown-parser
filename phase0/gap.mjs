// Phase 0 gap measurement: parses the oracle corpus with plain @lezer/markdown (+ GFM), maps its node types to
// the nearest editor class tokens, and scores the prediction against the oracle per character and per line.
//
// The mapping is deliberately stateless: every class is a function of the Lezer node and its ancestors. Whatever
// it cannot reach is either Obsidian syntax plain Lezer does not parse, a nested sub-language, or editor line state.
//
// usage: node phase0/gap.mjs [samplesPerToken=6] [tree|lines|state]
//        node phase0/gap.mjs show <docId>...   (line-by-line oracle vs prediction for chosen documents)
// input: phase0/out/oracle.json; output: phase0/out/gap-<stage>.json (scores + mismatch samples)

import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GFM,
  parser
} from '@lezer/markdown';

const here = dirname(fileURLToPath(import.meta.url));
const md = parser.configure(GFM);

// Tokens no plain-markdown construct produces: they need an Obsidian syntax extension.
const EXTENSION_TOKENS = /^(?:hmd-internal-link|formatting-link-start|formatting-link-end|link-alias|link-alias-pipe|link-has-alias|hmd-embed|formatting-embed|hashtag|hashtag-begin|hashtag-end|formatting-hashtag|tag-.*|comment-start|comment-end|commentformatting|math|math-|math-block|formatting-math|formatting-math-begin|formatting-math-end|HyperMD-math|highlight|formatting-highlight|formatting-highlight-end|blockid|footref|hmd-footref2|inline-footnote|inline-footnote-start|inline-footnote-end|formatting-inline-footnote|hmd-callout|HyperMD-callout|hmd-frontmatter|HyperMD-footnote|hmd-footnote|hmd-footnote-url|hmd-barelink|hmd-barelink2)$/u;
// Tokens of an embedded sub-language: the HTML tokenizer, fenced-code languages, the frontmatter's YAML.
const SUBLANGUAGE_TOKENS = /^(?:tag|bracket|attribute|string-2|hmd-html-begin|hmd-html-end|keyword|def|variable|variable-2|number|operator|atom|property|meta|b|error|1|string)$/u;

export const lineStartsOf = (text) => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
};

/** The oracle's classes: a Set per character (token classes) and per line (line classes). */
export function oracleSets(text, nodes, starts) {
  const tok = Array.from({ length: text.length }, () => new Set());
  const line = starts.map(() => new Set());
  for (const [from, to, depth, name] of nodes) {
    const names = name.split('_').filter(Boolean);
    if (depth === 1 && names.length > 0 && names.every((n) => n.startsWith('HyperMD-'))) {
      const l = lineIndex(starts, from);
      for (const n of names) {
        line[l].add(n);
      }
      continue;
    }
    for (let i = from; i < to; i++) {
      if (text[i] !== '\n') {
        for (const n of names) {
          tok[i].add(n);
        }
      }
    }
  }
  return { line, tok };
}

function lineIndex(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * The stateless mapping from a plain Lezer tree to the editor's classes.
 *
 * With `lineRules`, it also applies the editor's block rules that a single line and its tree context decide: quote
 * depth counted from the line's own `>` marks, no lists, headings or code blocks inside a quote, ATX headings only
 * at column 0 outside lists, indented code only after a blank line, unindented lazy lines leave the list, marks
 * swallow every following space, and trailing double spaces are marked whatever follows.
 */
export function predict(text, starts, { inlineState = false, lineRules = false } = {}) {
  const tree = md.parse(text);
  const tok = Array.from({ length: text.length }, () => new Set());
  const line = starts.map(() => new Set());
  const lineEnd = (l) => (l + 1 < starts.length ? starts[l + 1] - 1 : text.length);
  const add = (from, to, ...cls) => {
    for (let i = from; i < to; i++) {
      if (text[i] !== '\n') {
        for (const c of cls) {
          tok[i].add(c);
        }
      }
    }
  };
  const addLine = (l, ...cls) => {
    for (const c of cls) {
      line[l].add(c);
    }
  };
  const linesOf = (from, to) => {
    const out = [];
    for (let l = lineIndex(starts, from); l <= lineIndex(starts, Math.max(from, to - 1)); l++) {
      out.push(l);
    }
    return out;
  };
  const skipSpaces = (pos, limit = text.length) => {
    while (pos < limit && (text[pos] === ' ' || text[pos] === '\t')) {
      pos++;
    }
    return pos;
  };
  const isBlank = (l) => text.slice(starts[l], lineEnd(l)).trim() === '';

  // Per-character and per-line nesting, resolved to the innermost level after the walk.
  const charQuote = new Array(text.length).fill(0);
  const markQuote = new Array(text.length).fill(0);
  const lineQuote = new Array(starts.length).fill(0);
  const lineHasQuoteMark = new Array(starts.length).fill(false);
  const lineQuoteContentStart = starts.slice();
  const charList = new Array(text.length).fill(0);
  const lineList = new Array(starts.length).fill(0);
  const lineHasListMark = new Array(starts.length).fill(false);
  const noList = new Array(text.length).fill(false);
  const lineInQuoteTree = new Array(starts.length).fill(false);
  const lineInTopCode = new Array(starts.length).fill(false);
  const lexicalMarks = starts.map(() => []);
  if (lineRules) {
    starts.forEach((s, l) => {
      let pos = skipSpaces(s, Math.min(s + 3, lineEnd(l)));
      if (text[pos] !== '>') {
        return;
      }
      while (text[pos] === '>') {
        const end = skipSpaces(pos + 1, lineEnd(l));
        lexicalMarks[l].push([pos, end]);
        pos = end;
      }
      lineQuoteContentStart[l] = pos;
    });
  }

  const skipped = (node, ctx) => {
    if (!lineRules) {
      return false;
    }
    const { from, name } = node;
    const l = lineIndex(starts, from);
    if (ctx.quote > 0 && /^(?:ListItem|TaskMarker|ATXHeading\d|SetextHeading\d|FencedCode|CodeBlock|Table)$/u.test(name)) {
      return true;
    }
    // An indented ATX heading cannot interrupt a paragraph.
    if (/^ATXHeading\d$/u.test(name) && ctx.list === 0 && from > starts[l] && l > 0 && !isBlank(l - 1)) {
      return true;
    }
    // A list item opened on its parent item's line is plain text to the editor.
    if (name === 'ListItem' && node.parent?.parent?.name === 'ListItem' && lineIndex(starts, node.parent.parent.from) === l) {
      return true;
    }
    // Indented code right after a non-blank line other than a closing fence is not code to the editor.
    if (name === 'CodeBlock') {
      return l > 0 && !isBlank(l - 1) && !lineInTopCode[l - 1];
    }
    return name === 'HardBreak';
  };

  const walk = (node, ctx) => {
    const { from, name, to } = node;
    let child = ctx;
    let m;
    if (skipped(node, ctx)) {
      // The editor does not see this construct here: keep only what its children contribute.
    } else if ((m = /^ATXHeading(\d)$/u.exec(name))) {
      const n = m[1];
      add(from, to, 'header', `header-${n}`);
      for (const l of linesOf(from, to)) {
        addLine(l, 'HyperMD-header', `HyperMD-header-${n}`);
      }
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'HeaderMark') {
          add(c.from, c.from === from ? skipSpaces(c.to, to) : c.to, 'formatting', 'formatting-header', `formatting-header-${n}`);
        }
      }
    } else if ((m = /^SetextHeading(\d)$/u.exec(name))) {
      const n = m[1];
      const lines = linesOf(from, to);
      const underline = lines.at(-1);
      add(from, to, 'header', `header-${n}`);
      for (const l of lines) {
        addLine(l, ...(l === underline ? ['HyperMD-header-line', `HyperMD-header-line-${n}`] : ['HyperMD-header', `HyperMD-header-${n}`]));
      }
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'HeaderMark') {
          add(c.from, c.to, 'formatting', 'formatting-header', `formatting-header-${n}`);
        }
      }
    } else if (inlineState && (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'InlineCode')) {
      // Emphasis and code spans come from the line-state pass below instead.
    } else if (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'Strikethrough' || name === 'InlineCode') {
      const [cls, mark] = {
        Emphasis: ['em', 'formatting-em'],
        InlineCode: ['inline-code', 'formatting-code'],
        Strikethrough: ['strikethrough', 'formatting-strikethrough'],
        StrongEmphasis: ['strong', 'formatting-strong']
      }[name];
      add(from, to, cls);
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'EmphasisMark' || c.name === 'StrikethroughMark' || c.name === 'CodeMark') {
          add(c.from, c.to, 'formatting', mark);
        }
      }
    } else if (name === 'FencedCode') {
      const lines = linesOf(from, to);
      for (const l of lines) {
        lineInTopCode[l] ||= ctx.quote === 0;
      }
      const last = node.lastChild;
      const closed = lines.length > 1 && last?.name === 'CodeMark' && lineIndex(starts, last.from) === lines.at(-1);
      lines.forEach((l, i) => {
        addLine(l, 'HyperMD-codeblock', 'HyperMD-codeblock-bg');
        if (i === 0) {
          addLine(l, 'HyperMD-codeblock-begin', 'HyperMD-codeblock-begin-bg');
        }
        if (closed && i === lines.length - 1) {
          addLine(l, 'HyperMD-codeblock-end', 'HyperMD-codeblock-end-bg');
        }
        const start = i === 0 ? from : Math.max(lineQuoteContentStart[l], starts[l]);
        add(start, lineEnd(l), 'hmd-codeblock');
        if (i === 0 || (closed && i === lines.length - 1)) {
          add(start, lineEnd(l), 'formatting', 'formatting-code-block');
        } else {
          for (let p = start; p < lineEnd(l); p++) {
            noList[p] = true;
          }
        }
      });
    } else if (name === 'CodeBlock') {
      linesOf(from, to).forEach((l, i) => {
        lineInTopCode[l] ||= ctx.quote === 0;
        const start = i === 0 ? (lineRules ? skipSpaces(from, lineEnd(l)) : from) : Math.max(lineQuoteContentStart[l], starts[l]);
        add(start, lineEnd(l), 'hmd-indented-code');
        add(skipSpaces(start, lineEnd(l)), lineEnd(l), 'inline-code');
      });
    } else if (name === 'Blockquote') {
      const k = ctx.quote + 1;
      child = { ...ctx, quote: k };
      for (const l of linesOf(from, to)) {
        lineInQuoteTree[l] = true;
      }
      for (const l of lineRules ? [] : linesOf(from, to)) {
        lineQuote[l] = Math.max(lineQuote[l], k);
        for (let i = Math.max(starts[l], from); i < lineEnd(l); i++) {
          charQuote[i] = Math.max(charQuote[i], k);
        }
      }
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'QuoteMark' && !lineRules) {
          const end = skipSpaces(c.to, Math.min(c.to + 1, text.length));
          add(c.from, end, 'formatting', 'formatting-quote', `formatting-quote-${k}`);
          for (let i = c.from; i < end; i++) {
            markQuote[i] = k;
          }
          const l = lineIndex(starts, c.from);
          lineHasQuoteMark[l] = true;
          lineQuoteContentStart[l] = Math.max(lineQuoteContentStart[l], end);
        }
      }
    } else if (name === 'ListItem') {
      const d = ctx.list + 1;
      child = { ...ctx, list: d };
      const mark = node.firstChild;
      const ordered = node.parent?.name === 'OrderedList';
      const markEnd = skipSpaces(mark.to, lineRules ? lineEnd(lineIndex(starts, mark.to)) : Math.min(mark.to + 1, text.length));
      add(mark.from, markEnd, 'formatting', 'formatting-list', ordered ? 'formatting-list-ol' : 'formatting-list-ul');
      const markLine = lineIndex(starts, mark.from);
      lineHasListMark[markLine] = true;
      const indentStart = lineQuoteContentStart[markLine];
      if (mark.from > indentStart) {
        add(indentStart, mark.from, 'hmd-list-indent', `hmd-list-indent-${lineRules ? Math.max(1, d - 1) : d - 1}`);
      }
      if (lineRules && node.getChild('FencedCode') && lineIndex(starts, node.getChild('FencedCode').from) === markLine) {
        addLine(markLine, 'HyperMD-list-line-nobullet');
      }
      // With line rules, a line without a mark stays in the item only when indented to the item's content.
      const contentColumn = mark.to + 1 - starts[markLine];
      const indentOf = (l) => skipSpaces(lineQuoteContentStart[l], lineEnd(l)) - lineQuoteContentStart[l];
      for (const l of linesOf(from, to)) {
        if (isBlank(l) || (lineRules && l !== markLine && indentOf(l) < contentColumn && !text.slice(starts[l], lineEnd(l)).includes('\t'))) {
          continue;
        }
        lineList[l] = Math.max(lineList[l], d);
        const start = l === markLine ? mark.from : lineQuoteContentStart[l];
        for (let i = start; i < lineEnd(l); i++) {
          charList[i] = Math.max(charList[i], d);
        }
      }
    } else if (name === 'TaskMarker') {
      add(from, to, 'formatting', 'formatting-task', text[from + 1] === ' ' ? 'meta' : 'property');
      for (let i = from; i < to; i++) {
        noList[i] = true;
      }
      addLine(lineIndex(starts, from), 'HyperMD-task-line');
    } else if (name === 'Link' || name === 'Image') {
      const marks = [];
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'LinkMark') {
          marks.push(c);
        } else if (c.name === 'URL' || c.name === 'LinkTitle') {
          add(c.from, c.to, 'string', 'url');
        } else if (c.name === 'LinkLabel') {
          add(c.from, c.to, 'string', 'url');
          add(c.from, c.from + 1, 'formatting', 'formatting-link-string');
          add(c.to - 1, c.to, 'formatting', 'formatting-link-string');
        }
      }
      const image = name === 'Image';
      const textCls = image ? ['image', 'image-alt-text', 'link'] : ['link'];
      const [open, close, paren, end] = marks;
      if (open && close) {
        if (image) {
          add(open.from, open.from + 1, 'formatting', 'formatting-image', 'image', 'image-marker');
          add(open.from + 1, open.to, 'formatting', 'formatting-image', ...textCls);
          add(close.from, close.to, 'formatting', 'formatting-image', ...textCls);
        } else {
          add(open.from, open.to, 'formatting', 'formatting-link', ...textCls);
          add(close.from, close.to, 'formatting', 'formatting-link', ...textCls);
        }
        add(open.to, close.from, ...textCls);
      }
      if (paren && end) {
        add(paren.from, end.to, 'string', 'url');
        add(paren.from, paren.to, 'formatting', 'formatting-link-string');
        add(end.from, end.to, 'formatting', 'formatting-link-string');
      }
    } else if (name === 'Autolink') {
      add(from, from + 1, 'formatting', 'formatting-link', 'link');
      add(to - 1, to, 'formatting', 'formatting-link', 'link');
      add(from + 1, to - 1, 'link', 'url');
      return;
    } else if (name === 'URL' && ['Paragraph', 'TableCell', 'SetextHeading1', 'SetextHeading2'].includes(node.parent?.name) || name === 'URL' && /^ATXHeading/u.test(node.parent?.name ?? '')) {
      add(from, to, 'url');
    } else if (name === 'LinkReference') {
      addLine(lineIndex(starts, from), 'HyperMD-footnote');
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'LinkLabel') {
          add(c.from, c.to + 1, 'hmd-barelink', 'hmd-footnote', 'link');
          add(c.from, c.from + 1, 'formatting', 'formatting-link');
          add(c.to - 1, c.to + 1, 'formatting', 'formatting-link');
        } else if (c.name === 'URL') {
          add(c.from, c.to, 'hmd-footnote-url', 'url');
        }
      }
      return;
    } else if (name === 'HorizontalRule') {
      add(from, to, 'hr');
      addLine(lineIndex(starts, from), 'HyperMD-hr', 'HyperMD-hr-bg');
    } else if (name === 'Escape') {
      add(from, from + 1, 'formatting-escape', 'hmd-escape-backslash');
      add(from + 1, to, 'escape', 'hmd-escape-char');
    } else if (name === 'HardBreak') {
      if (text[from] === ' ') {
        const end = text[to - 1] === '\n' ? to - 1 : to;
        for (let i = from; i < end; i++) {
          add(i, i + 1, i === end - 1 ? 'trailing-space-new-line' : (end - 1 - i) % 2 === 1 ? 'trailing-space-a' : 'trailing-space-b');
        }
      }
    } else if (name === 'Comment' || name === 'CommentBlock') {
      add(from, to, 'comment');
    } else if (name === 'Table') {
      const header = node.getChild('TableHeader');
      const cols = header ? header.getChildren('TableCell').length : 0;
      linesOf(from, to).forEach((l, i) => {
        addLine(l, 'HyperMD-table-row', `HyperMD-table-row-${i}`, `HyperMD-table-${cols}`);
        const s = starts[l];
        const e = lineEnd(l);
        const body = text.slice(s, e);
        const pipes = [];
        for (let p = 0; p < body.length; p++) {
          if (body[p] === '|' && body[p - 1] !== '\\') {
            pipes.push(s + p);
          }
        }
        const first = skipSpaces(s, e);
        let inner = 0;
        for (const p of pipes) {
          const outer = p === first || text.slice(p + 1, e).trim() === '';
          add(p, p + 1, 'hmd-table-sep', outer ? 'hmd-table-sep-dummy' : `hmd-table-sep-${inner++}`);
        }
      });
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      walk(c, child);
    }
  };
  walk(tree.topNode, { list: 0, quote: 0 });

  if (lineRules) {
    let prevDepth = 0;
    starts.forEach((s, l) => {
      const marks = lexicalMarks[l];
      const inQuote = (marks.length > 0 && !lineInTopCode[l]) || lineInQuoteTree[l];
      if (!inQuote || (isBlank(l) && marks.length === 0)) {
        prevDepth = 0;
        return;
      }
      const depth = marks.length || prevDepth || 1;
      lineQuote[l] = depth;
      lineHasQuoteMark[l] = marks.length > 0;
      for (let i = marks[0]?.[0] ?? s; i < lineEnd(l); i++) {
        charQuote[i] = depth;
      }
      marks.forEach(([a, b], j) => {
        add(a, b, 'formatting', 'formatting-quote', `formatting-quote-${j + 1}`);
        for (let i = a; i < b; i++) {
          markQuote[i] = j + 1;
        }
      });
      prevDepth = depth;
    });
    starts.forEach((s, l) => {
      const end = lineEnd(l);
      const trailing = /\S( {2,})$/u.exec(text.slice(lineQuoteContentStart[l], end));
      if (trailing && !lineInTopCode[l]) {
        for (let i = end - trailing[1].length; i < end; i++) {
          add(i, i + 1, i === end - 1 ? 'trailing-space-new-line' : 'trailing-space-a');
        }
      }
    });
  }

  if (inlineState) {
    // A one-pass inline state machine with no lookahead: an opener styles the text after it whether or not it
    // ever closes, the state rides across lines, and only a blank line (or a code block) resets it.
    const skip = (i) => [...tok[i]].some((t) => /^(?:formatting-list|formatting-quote|hmd-list-indent|formatting-escape|escape|url|formatting-task|hmd-codeblock|hmd-indented-code|hr)$/u.test(t));
    let em = '';
    let strong = '';
    let code = 0;
    starts.forEach((s, l) => {
      const style = () => [em && 'em', strong && 'strong'].filter(Boolean);
      if (lineInTopCode[l] && (l === 0 || !lineInTopCode[l - 1])) {
        // The line opening a code block still wears the emphasis carried into it.
        add(s, lineEnd(l), ...style());
      }
      if (isBlank(l) || lineInTopCode[l]) {
        em = '';
        strong = '';
        code = 0;
        return;
      }
      const end = lineEnd(l);
      for (let i = s; i < end;) {
        if (skip(i)) {
          add(i, i + 1, ...style());
          i++;
          continue;
        }
        const ch = text[i];
        let n = 1;
        while (text[i + n] === ch && i + n < end) {
          n++;
        }
        if (ch === '`') {
          if (!code || n === code) {
            add(i, i + n, 'formatting', 'formatting-code', 'inline-code', ...style());
            code = code ? 0 : n;
          } else {
            add(i, i + n, 'inline-code', ...style());
          }
          i += n;
          continue;
        }
        if (code) {
          add(i, i + 1, 'inline-code', ...style());
          i++;
          continue;
        }
        if (ch === '*' || ch === '_') {
          const before = text[i - 1] ?? ' ';
          const after = text[i + n] ?? ' ';
          const canOpen = /\S/u.test(after) && (ch === '*' || !/\w/u.test(before));
          const canClose = /\S/u.test(before) && (ch === '_' ? !/\w/u.test(after) : true);
          const run = Math.min(n, 3);
          const wantEm = run !== 2;
          const wantStrong = run >= 2;
          const closing = (wantStrong ? strong === ch : true) && (wantEm ? em === ch : true) && canClose;
          const opening = !closing && canOpen && (wantStrong ? !strong : true) && (wantEm ? !em : true);
          if (closing || opening) {
            if (opening) {
              em = wantEm ? ch : em;
              strong = wantStrong ? ch : strong;
            }
            add(i, i + run, 'formatting', run === 1 ? 'formatting-em' : 'formatting-strong', ...style());
            if (closing) {
              em = wantEm ? '' : em;
              strong = wantStrong ? '' : strong;
            }
            i += run;
            continue;
          }
        }
        add(i, i + 1, ...style());
        i++;
      }
    });
  }
  starts.forEach((_s, l) => {
    if (lineQuote[l]) {
      addLine(l, 'HyperMD-quote', `HyperMD-quote-${lineQuote[l]}`);
      if (!lineHasQuoteMark[l]) {
        addLine(l, 'HyperMD-quote-lazy');
      }
    }
    if (lineList[l]) {
      addLine(l, 'HyperMD-list-line', `HyperMD-list-line-${lineList[l]}`);
      if (!lineHasListMark[l]) {
        addLine(l, 'HyperMD-list-line-nobullet');
        const s = lineQuoteContentStart[l];
        const e = skipSpaces(s, lineEnd(l));
        if (e > s) {
          add(s, e, 'hmd-list-indent', `hmd-list-indent-${lineList[l]}`);
        }
      }
    }
  });
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      continue;
    }
    const q = markQuote[i] || charQuote[i];
    if (q) {
      tok[i].add('quote').add(`quote-${q}`);
    }
    if (charList[i] && !noList[i] && !(tok[i].has('hmd-list-indent'))) {
      tok[i].add(`list-${((charList[i] - 1) % 3) + 1}`);
    }
  }
  return { line, tok };
}

export const categoryOf = (t) => (EXTENSION_TOKENS.test(t) ? 'extension' : SUBLANGUAGE_TOKENS.test(t) ? 'sublanguage' : 'markdown');
/** Prints each line of a document with the classes the oracle and the prediction disagree on. */
function show(oracle, ids) {
  for (const id of ids) {
    const d = oracle.docs.find((x) => x.id === id);
    const starts = lineStartsOf(d.text);
    const o = oracleSets(d.text, d.source, starts);
    const p = predict(d.text, starts, { inlineState: process.env.STAGE === 'state', lineRules: process.env.STAGE === 'lines' || process.env.STAGE === 'state' });
    console.log(`=== ${id} ${JSON.stringify(d.text)}`);
    starts.forEach((s, l) => {
      const e = l + 1 < starts.length ? starts[l + 1] - 1 : d.text.length;
      const fmt = (set) => [...(set ?? [])].sort().join(' ');
      const lineDiff = fmt(o.line[l]) === fmt(p.line[l]) ? '' : `   LINE obs[${fmt(o.line[l])}] lez[${fmt(p.line[l])}]`;
      console.log(`${String(l).padStart(3)} ${JSON.stringify(d.text.slice(s, e))}${lineDiff}`);
      let runStart = s;
      for (let i = s; i <= e; i++) {
        const key = (k) => `${fmt(o.tok[k])}|${fmt(p.tok[k])}`;
        if (i === e || key(i) !== key(runStart)) {
          if (fmt(o.tok[runStart]) !== fmt(p.tok[runStart])) {
            console.log(`      ${runStart - s}-${i - s} ${JSON.stringify(d.text.slice(runStart, i))} obs[${fmt(o.tok[runStart])}] lez[${fmt(p.tok[runStart])}]`);
          }
          runStart = i;
        }
      }
    });
  }
}

function main() {
  const oracle = JSON.parse(readFileSync(join(here, 'out', 'oracle.json'), 'utf8'));
  if (process.argv[2] === 'show') {
    show(oracle, process.argv.slice(3));
    return;
  }
  const samplesPerToken = Number(process.argv[2] ?? 6);
  const stage = process.argv[3] ?? 'tree';
  const lineRules = stage === 'lines' || stage === 'state';
  const inlineState = stage === 'state';
  // `all` scores every document; `plain` only the documents whose oracle uses no extension or sub-language token,
  // where a miss is down to the mapping or to editor line state rather than to syntax plain Lezer does not know.
  const scores = { all: new Map(), plain: new Map() };
  const scoreIn = (map, t) => {
    if (!map.has(t)) {
      map.set(t, { fn: 0, fp: 0, samples: [], tp: 0 });
    }
    return map.get(t);
  };
  const docs = oracle.docs.map((d) => {
    const starts = lineStartsOf(d.text);
    const o = oracleSets(d.text, d.source, starts);
    const p = predict(d.text, starts, { inlineState, lineRules });
    const usesExtension = [...o.tok, ...o.line].some((s) => [...s].some((t) => categoryOf(t) !== 'markdown'));
    return { ...d, o, p, starts, usesExtension };
  });

  let exactDocs = 0;
  let exactPlainDocs = 0;
  let plainDocs = 0;
  // Residual causes, per plain document: which kinds of disagreement it shows.
  const INLINE = new Set(['em', 'strong', 'inline-code', 'strikethrough', 'formatting-em', 'formatting-strong', 'formatting-code', 'formatting-strikethrough']);
  const causeOf = (t, oSet, pSet) => {
    if (t === 'formatting') {
      // The generic mark class follows the specific one it travels with.
      const partner = [...oSet, ...pSet].find((x) => x !== 'formatting' && x.startsWith('formatting-') && oSet.has(x) !== pSet.has(x))
        ?? [...oSet, ...pSet].find((x) => x.startsWith('formatting-'));
      return partner ? causeOf(partner, oSet, pSet) : 'other';
    }
    if (t === 'formatting-code-block') {
      return 'code-block-extent';
    }
    if (INLINE.has(t)) {
      return [...pSet].some((x) => INLINE.has(x)) && [...oSet].some((x) => INLINE.has(x)) ? 'inline-mark-detail' : 'inline-unclosed-carry';
    }
    if (/codeblock|indented-code/u.test(t)) {
      return 'code-block-extent';
    }
    if (/^hmd-list-indent-\d+$/u.test(t)) {
      return 'list-indent-number';
    }
    if (/list|task/u.test(t)) {
      return 'list-structure';
    }
    if (/quote/u.test(t)) {
      return 'quote-structure';
    }
    if (/header/u.test(t)) {
      return 'heading';
    }
    return 'other';
  };
  const causeDocs = new Map();
  for (const d of docs) {
    let exact = true;
    const causes = new Set();
    const compare = (oSet, pSet, where) => {
      for (const t of new Set([...oSet, ...pSet])) {
        if (!(oSet.has(t) && pSet.has(t)) && !d.usesExtension) {
          causes.add(causeOf(t, oSet, pSet));
        }
        for (const map of d.usesExtension ? [scores.all] : [scores.all, scores.plain]) {
          const s = scoreIn(map, t);
          if (oSet.has(t) && pSet.has(t)) {
            s.tp++;
          } else {
            exact = false;
            if (oSet.has(t)) {
              s.fn++;
            } else {
              s.fp++;
            }
            if (s.samples.length < samplesPerToken && !s.samples.some((x) => x.id === d.id)) {
              s.samples.push({ id: d.id, kind: oSet.has(t) ? 'missed' : 'extra', text: d.text, where });
            }
          }
        }
      }
    };
    for (let i = 0; i < d.text.length; i++) {
      if (d.text[i] !== '\n') {
        compare(d.o.tok[i], d.p.tok[i], `char ${i} ${JSON.stringify(d.text[i])}`);
      }
    }
    d.starts.forEach((_s, l) => compare(d.o.line[l], d.p.line[l], `line ${l}`));
    exactDocs += exact ? 1 : 0;
    if (!d.usesExtension) {
      plainDocs++;
      exactPlainDocs += exact ? 1 : 0;
      for (const c of causes) {
        const entry = causeDocs.get(c) ?? { docs: 0, ids: [], only: 0 };
        entry.docs++;
        entry.only += causes.size === 1 ? 1 : 0;
        if (entry.ids.length < 8) {
          entry.ids.push(d.id);
        }
        causeDocs.set(c, entry);
      }
    }
  }

  const f1Of = (s) => (s ? Number(((2 * s.tp) / (2 * s.tp + s.fp + s.fn)).toFixed(4)) : null);
  const rows = [...scores.all.entries()].map(([token, s]) => {
    const p = scores.plain.get(token);
    return { category: categoryOf(token), f1: f1Of(s), fn: s.fn, fp: s.fp, plain: p && { f1: f1Of(p), fn: p.fn, fp: p.fp, samples: p.samples, tp: p.tp }, samples: s.samples, token, tp: s.tp };
  }).sort((a, b) => a.category.localeCompare(b.category) || (a.plain?.f1 ?? 2) - (b.plain?.f1 ?? 2) || a.f1 - b.f1 || a.token.localeCompare(b.token));

  const residualCauses = Object.fromEntries([...causeDocs.entries()].sort((a, b) => b[1].docs - a[1].docs));
  const summary = { residualCauses, stage, docs: docs.length, exactDocs, exactPlainDocs, perSet: oracle.perSet, plainDocs, sourcePreviewDiffering: docs.filter((d) => d.preview !== 'same').map((d) => d.id) };
  writeFileSync(join(here, 'out', `gap-${stage}.json`), JSON.stringify({ rows, summary }, null, 1));
  console.log(JSON.stringify(summary));
  console.log('| category | token | F1 all | TP | missed | extra | F1 plain | TP | missed | extra |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) {
    const p = r.plain ? `${r.plain.f1} | ${r.plain.tp} | ${r.plain.fn} | ${r.plain.fp}` : '- | - | - | -';
    console.log(`| ${r.category} | \`${r.token}\` | ${r.f1} | ${r.tp} | ${r.fn} | ${r.fp} | ${p} |`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
