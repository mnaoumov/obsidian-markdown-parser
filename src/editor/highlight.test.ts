import {
  describe,
  expect,
  it
} from 'vitest';

import type { OracleFile } from '../oracle/oracle-file.ts';
import type { LineState } from './highlight.ts';

import {
  CLASS_ORACLE_SEEDS,
  classOracleFileName,
  CORPUS_TEST_TIMEOUT_MS,
  MAIN_CLASS_ORACLE_SEED,
  oracleObsidianVersion,
  readOracleFile
} from '../oracle/oracle-location.ts';
import {
  compareCodeUnits,
  compareDocument
} from '../oracle/score.ts';
import {
  highlight,
  highlightLines,
  isLineStateResumable
} from './highlight.ts';

/*
 * The documents each oracle still disagrees on. A change that fixes one must remove it here, and a change that
 * breaks another fails the suite.
 */
const KNOWN_DIFFERENCES = new Map<string, readonly string[]>(CLASS_ORACLE_SEEDS.map((seed) => [classOracleFileName(seed), []]));

// The distinct class sets of a document's math spans, without the classes every math token wears.
function mathClasses(text: string): string[] {
  const sets = highlight(text).flatMap((line) => line.spans).filter((s) => s.classes.includes('math')).map((s) => s.classes.filter((c) => !/^(?:formatting|keyword$|variable-2$|math-)/u.test(c)).toSorted(compareCodeUnits).join(' '));
  return [...new Set(sets)];
}

// Whether each line of a document carries the math block's line class.
function mathLines(text: string): boolean[] {
  return highlight(text).map((line) => line.classes.includes('HyperMD-math'));
}

function readOracle(name: string): OracleFile {
  return readOracleFile(name) as OracleFile;
}

// The distinct classes of the span at a position, sorted.
function spanClassesAt(text: string, position: number): string {
  const classes = highlight(text).flatMap((line) => line.spans).find((s) => s.from <= position && position < s.to)?.classes ?? [];
  return [...new Set(classes)].toSorted(compareCodeUnits).join(' ');
}

describe('highlight', () => {
  for (const [name, known] of KNOWN_DIFFERENCES) {
    it(`should match the live editor on every document of ${name} but the known differences`, { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
      const oracle = readOracle(name);
      const differing = oracle.docs.filter((document) => compareDocument(document, { obsidianVersion: oracleObsidianVersion() }).differences.length > 0).map((document) => document.id);
      expect(differing).toEqual(known);
    });
  }

  it('should give a line its classes and a span its token classes', () => {
    const [heading, quote] = highlight('# Title\n> quote');
    expect(heading?.classes).toEqual(['HyperMD-header', 'HyperMD-header-1']);
    expect(heading?.spans.map((s) => [s.from, s.to, s.classes.toSorted(compareCodeUnits).join(' ')])).toEqual([
      [0, 2, 'formatting formatting-header formatting-header-1 header header-1'],
      [2, 7, 'header header-1']
    ]);
    expect(quote?.classes).toEqual(['HyperMD-quote', 'HyperMD-quote-1']);
  });

  // The classes the live editor of Obsidian 1.14.4 gave these documents.
  it('should give `$` math the emphasis, strikethrough and highlight open around it, but not `$$` math', () => {
    expect(mathClasses('==🔴\n$==🔴x$')).toEqual(['highlight math', 'error highlight math']);
    expect(mathClasses('***a $x$')).toEqual(['em math strong']);
    expect(mathClasses('~~==a $x$')).toEqual(['highlight math strikethrough']);
    expect(mathClasses('# ==a $x$')).toEqual(['highlight math']);
    expect(mathClasses('**a $$x$$')).toEqual(['math']);
    expect(mathClasses('==a\n\n$x$')).toEqual(['math']);
  });

  // The classes the live editor of Obsidian 1.14.4 gave these documents.
  it('should open no math inside a markdown link\'s text', () => {
    for (const text of ['[a $x$](u)', '[a $x$]', '[a $x$][r]\n\n[r]: u', '[a $$x$$](u)', 'a [b $x$', '> [a $x$](u)', '**[a $x$](u)**']) {
      expect(mathClasses(text)).toEqual([]);
    }
    // Link text ends with its line.
    expect(mathClasses('[a\nb $x$](u)')).toEqual(['math']);
    expect(highlight('$x$\n[a\n$y$](u)')[2]?.spans.filter((s) => s.classes.includes('math'))).toHaveLength(3);
    expect(mathClasses('[a $x$] b $y$')).toEqual(['math']);
    expect(mathClasses('$x [a$ b](u)')).toEqual(['math', 'bracket math']);
    expect(mathClasses('![a $x$](u)')).toEqual(['math']);
  });

  // The line classes the live editor of Obsidian 1.14.5 gave these documents.
  it('should open a math block at a `$$` that starts its line and is followed by no other `$` on it', () => {
    expect(mathLines('$$\na\n$$')).toEqual([true, true, true]);
    expect(mathLines('$$x\n\nb\n$$')).toEqual([true, true, true, true]);
    expect(mathLines('$$x\n# h\n$$')).toEqual([true, true, true]);
    expect(mathLines('$$x\na$$b\nc')).toEqual([true, true, false]);
    expect(mathLines('$$ x')).toEqual([true]);
    expect(mathLines('a\n$$](u)')).toEqual([false, true]);
    expect(mathLines('a\n    $$x')).toEqual([false, true]);
    expect(mathLines('$$x\n$$y\nz')).toEqual([true, true, false]);
    for (const text of ['$$x$$](u)', '$$x $$', '$$x$\n$$', String.raw`$$x\$`, '$$x`$`', '$$$x', 'a $$x\nb\n$$\nc', '**$$x**', '> $$x\n> a\n> $$', '- $$x\n  a\n  $$']) {
      expect(mathLines(text).some(Boolean)).toBe(false);
    }
  });

  // The classes the live editor of Obsidian 1.14.5 gave these documents.
  it('should open math after a line\'s leading whitespace even where the line would be indented code', () => {
    const begin = 'formatting formatting-math formatting-math-begin keyword math';
    expect(spanClassesAt('    $x$ b', 4)).toBe(begin);
    expect(spanClassesAt('    $x$ b', 8)).toBe('hmd-indented-code inline-code');
    expect(spanClassesAt('\t$$x', 1)).toBe(`${begin} math-block`);
    for (const text of ['a\n\n    $x$', '# h\n    $x$', '```\n```\n    $x$', '    a\n\n    $x$', '- a\n\n      $x$', '        $x$']) {
      expect(mathClasses(text)).toEqual(['math']);
    }
    expect(mathLines('    $$\n    a\n    $$')).toEqual([true, true, true]);
    expect(mathLines('    $$x\n\n    a')).toEqual([true, true, true]);
    // A line after the math line is no indented code, since the markdown mode never read that line's block structure.
    expect(highlight('    $x$\n    a')[1]?.spans).toEqual([]);
    expect(spanClassesAt('    $x$\n    $y$', 12)).toBe(begin);
    // A `$` that opens no math, and a line after indented code.
    for (const text of ['    $ x$', '    $x', '    a $x$', '    a\n    $x$', '    $ x$\n    $y$']) {
      expect(mathClasses(text)).toEqual([]);
    }
  });

  // The classes the live editor of Obsidian 1.14.5 gave these documents.
  it('should read an inline footnote\'s body as inline markdown, up to a `]` outside a link or code', () => {
    const start = 'footref formatting-inline-footnote inline-footnote inline-footnote-start';
    const end = 'footref formatting-inline-footnote inline-footnote inline-footnote-end';
    expect(spanClassesAt('^[a **b**]', 0)).toBe(start);
    expect(spanClassesAt('^[a **b**]', 4)).toBe('footref formatting formatting-strong inline-footnote strong');
    expect(spanClassesAt('^[a **b**]', 9)).toBe(end);
    expect(spanClassesAt('^[a ==b== `c`]', 11)).toBe('footref inline-code inline-footnote');
    expect(spanClassesAt('^[a #tag c]', 5)).toBe('footref hashtag hashtag-end inline-footnote meta tag-tag');
    // Math wears neither footnote class.
    expect(spanClassesAt('^[a $x$ b]', 4)).toBe('formatting formatting-math formatting-math-begin keyword math');
    // A `]` closing link text, a code span or a footnote reference.
    expect(spanClassesAt('^[a [b] c]', 6)).toBe('footref formatting formatting-link hmd-barelink inline-footnote link');
    expect(spanClassesAt('^[a [b] c]', 9)).toBe(end);
    expect(spanClassesAt('^[a `]` b]', 5)).toBe('footref inline-code inline-footnote');
    expect(spanClassesAt('^[a [^1] c]', 7)).toBe(`${end} formatting formatting-link formatting-link-end hmd-barelink`.split(' ').toSorted(compareCodeUnits).join(' '));
    expect(spanClassesAt('^[a [^1] c]', 9)).toBe('');
    // No nested inline footnote, and none past the end of the line.
    expect(spanClassesAt('^[a ^[b] c]', 4)).toBe('footref inline-footnote');
    expect(spanClassesAt('^[a ^[b] c]', 10)).toBe(end);
    expect(spanClassesAt('^[a', 2)).toBe('footref inline-footnote');
    expect(highlight('^[a\nb]')[1]?.spans).toEqual([]);
    // Inside link text, `^[` still opens one, and the link text's `]` comes first.
    expect(spanClassesAt('[a ^[b $x$]](u)', 3)).toBe(`${start} hmd-barelink link`.split(' ').toSorted(compareCodeUnits).join(' '));
    expect(spanClassesAt('[a ^[b $x$]](u)', 11)).toBe(end);
    // The closing mark takes the classes of the markdown token after it, and what that token does to the state.
    expect(spanClassesAt('^[a][b]', 3)).toBe(`${end} formatting formatting-link hmd-barelink link`.split(' ').toSorted(compareCodeUnits).join(' '));
    expect(spanClassesAt('^[a][b]', 4)).toBe('hmd-barelink link');
    expect(spanClassesAt('^[a ==b] c==', 9)).toBe('highlight');
    // HTML ends the markdown inline flow, and the footnote classes with it.
    expect(spanClassesAt('^[a <b> c]', 9)).toBe('');
  });

  // The classes the live editor of Obsidian 1.14.5 gave these documents.
  it('should open an internal link inside a markdown link\'s text and end the link text with it', () => {
    const start = 'formatting-link formatting-link-start hmd-barelink link';
    const end = 'formatting-link formatting-link-end';
    expect(spanClassesAt('[a [[b]] c](u)', 3)).toBe(start);
    expect(spanClassesAt('[a [[b]] c](u)', 5)).toBe('hmd-internal-link link');
    expect(spanClassesAt('[a [[b]] c](u)', 6)).toBe(end);
    expect(spanClassesAt('[a [[b]] c](u)', 9)).toBe('');
    expect(spanClassesAt('[a [[b]] c](u)', 11)).toBe('');
    expect(spanClassesAt('[a [[b|c]] d](u)', 5)).toBe('hmd-internal-link link link-has-alias');
    expect(spanClassesAt('[a [[b|c]] d](u)', 6)).toBe('hmd-internal-link link link-alias-pipe');
    expect(spanClassesAt('[a [[b|c]] d](u)', 7)).toBe('hmd-internal-link link link-alias');
    expect(spanClassesAt('[a ![[b]] c](u)', 3)).toBe(`formatting-embed ${start}`);
    expect(spanClassesAt('[a ![[b]] c](u)', 6)).toBe('hmd-embed hmd-internal-link link');
    expect(spanClassesAt('[a **[[b]]** c](u)', 8)).toBe(`${end} strong`);
    // The link text has ended, so a second internal link is an ordinary one.
    expect(spanClassesAt('[a [[b]] [[c]] d](u)', 9)).toBe('formatting-link formatting-link-start');
    expect(spanClassesAt('[a [[b]] [[c]] d](u)', 11)).toBe('hmd-internal-link');
    // After the closing mark of an inline footnote, which opened the link text.
    expect(spanClassesAt('^[a][[b]] c', 4)).toBe(start);
  });

  // The classes the live editor of Obsidian 1.14.5 gave these documents.
  it('should read `[^label]` as a footnote reference when its label holds no `]` and no whitespace', () => {
    const start = 'footref formatting formatting-link formatting-link-start hmd-barelink';
    const end = 'footref formatting formatting-link formatting-link-end hmd-barelink';
    expect(spanClassesAt('[^a]', 0)).toBe(start);
    expect(spanClassesAt('[^a]', 2)).toBe('footref hmd-barelink');
    expect(spanClassesAt('[^a]', 3)).toBe(end);
    // An empty label.
    expect(spanClassesAt('[^]', 1)).toBe(start);
    expect(spanClassesAt('[^]', 2)).toBe(end);
    // Whitespace in the label makes link text.
    expect(spanClassesAt('[^a b]', 0)).toBe('formatting formatting-link hmd-barelink link');
    expect(spanClassesAt('[^a b]', 2)).toBe('hmd-barelink link');
    expect(spanClassesAt('[^ a]', 3)).toBe('hmd-barelink link');
    expect(spanClassesAt('[^a\tb]', 2)).toBe('hmd-barelink link');
    // The markdown token read after `[^` changes the state, so a `[` there opens link text.
    expect(spanClassesAt('[^[a]', 0)).toBe('formatting formatting-link formatting-link-start hmd-barelink link');
    expect(spanClassesAt('[^[a]', 2)).toBe('hmd-barelink link');
    expect(spanClassesAt('[^%%a]', 3)).toBe(`comment comment-start ${start}`);
    expect(spanClassesAt('[^%%a]', 4)).toBe('comment footref hmd-barelink');
    // A token read inside the label changes nothing, and an escape does not hide the closing `]`.
    expect(spanClassesAt('[^a[b]', 3)).toBe('footref formatting formatting-link hmd-barelink link');
    expect(spanClassesAt('[^a[b]', 4)).toBe('footref hmd-barelink');
    expect(spanClassesAt('[^a[b]', 5)).toBe(end);
    expect(spanClassesAt(String.raw`[^a\]b]`, 3)).toBe('footref formatting-escape hmd-barelink');
    expect(spanClassesAt(String.raw`[^a\]b]`, 4)).toBe(end);
    expect(spanClassesAt(String.raw`[^a\]b]`, 5)).toBe('');
    expect(spanClassesAt(String.raw`[^\]`, 1)).toBe('footref formatting formatting-escape formatting-link formatting-link-start hmd-barelink');
    expect(spanClassesAt('[^$x$]', 2)).toBe('footref hmd-barelink');
    // Inside link text, the closing `]` does not close the link text.
    expect(spanClassesAt('[a [^b] c]', 6)).toBe(`${end} link`);
    expect(spanClassesAt('[a [^b] c]', 7)).toBe('link');
    expect(spanClassesAt('[a [^b] c]', 9)).toBe('formatting formatting-link link');
    // An unclosed label, and a block id after it.
    expect(spanClassesAt('[^a', 0)).toBe('formatting formatting-link hmd-barelink link');
    expect(spanClassesAt('[^a', 1)).toBe('blockid');
  });

  // The classes the live editors of Obsidian 1.14.4 and 1.15.0 gave this document.
  it('should mark the end of emphasis, strikethrough and code spans from Obsidian 1.15 on', () => {
    const text = '*em* **strong** ***both*** ~~strike~~ `code`\n> ```\n> a ```';
    function classesAt(position: number, obsidianVersion?: string): string {
      const lines = highlight(text, obsidianVersion === undefined ? {} : { obsidianVersion });
      const classes = lines.flatMap((line) => line.spans).find((s) => s.from <= position && position < s.to)?.classes ?? [];
      // The editor renders a class once however often the mode emits it.
      return [...new Set(classes)].toSorted(compareCodeUnits).join(' ');
    }
    const closingPositions = [3, 13, 23, 35, 43, 56];
    expect(closingPositions.map((position) => classesAt(position, '1.15.0'))).toEqual([
      'em formatting formatting-em formatting-em-end',
      'formatting formatting-strong formatting-strong-end strong',
      'em formatting formatting-em formatting-em-end formatting-strong formatting-strong-end strong',
      'formatting formatting-strikethrough formatting-strikethrough-end strikethrough',
      'formatting formatting-code formatting-code-end inline-code',
      'formatting formatting-code formatting-code-end inline-code quote quote-1'
    ]);
    expect(classesAt(16, '1.15.0')).toBe('em formatting formatting-em formatting-strong strong');
    const before = closingPositions.map((position) => classesAt(position));
    expect(before).toEqual([
      'em formatting formatting-em',
      'formatting formatting-strong strong',
      'em formatting formatting-strong strong',
      'formatting formatting-strikethrough strikethrough',
      'formatting formatting-code inline-code',
      'formatting formatting-code inline-code quote quote-1'
    ]);
    expect(classesAt(16)).toBe('em formatting formatting-strong strong');
    expect(closingPositions.map((position) => classesAt(position, '1.14.5'))).toEqual(before);
    expect(classesAt(3, '1.16.0-beta')).toBe('em formatting formatting-em formatting-em-end');
    expect(classesAt(3, '2.0.0')).toBe('em formatting formatting-em formatting-em-end');
  });

  it('should run a markdown block through the fork of the markdown mode with its default options', () => {
    const lines = highlight('```markdown\n# H **b** ==h==\n- [ ] t\n```md\nx\n````');
    function classesAt(lineIndex: number, offset: number): string {
      const line = lines[lineIndex];
      const position = (line?.from ?? 0) + offset;
      return line?.spans.find((s) => s.from <= position && position < s.to)?.classes.toSorted(compareCodeUnits).join(' ') ?? '';
    }
    // No formatting classes, no highlights and no task markers, and the fork's own token types.
    expect(classesAt(1, 0)).toBe('header header-1 hmd-codeblock');
    expect(classesAt(1, 4)).toBe('header header-1 hmd-codeblock strong');
    expect(classesAt(1, 11)).toBe('header header-1 hmd-codeblock');
    expect(classesAt(2, 0)).toBe('hmd-codeblock variable-2');
    expect(classesAt(2, 2)).toBe('hmd-codeblock link variable-2');
    // A language with no mode gets CodeMirror's null mode, which styles nothing.
    expect(classesAt(4, 0)).toBe('hmd-codeblock');
  });

  it('should resume from the state after any line outside a block with the same result', { timeout: CORPUS_TEST_TIMEOUT_MS }, () => {
    const oracle = readOracle(classOracleFileName(MAIN_CLASS_ORACLE_SEED));
    for (const document of oracle.docs) {
      const lines = document.text.split('\n');
      const states: LineState[] = [];
      const full = highlightLines({
        lines,
        onLineEnd: (lineIndex, state) => {
          states[lineIndex] = state;
        }
      });
      for (let k = 0; k < lines.length - 1; k++) {
        const state = states[k];
        if (state && !isLineStateResumable(state)) {
          continue;
        }
        const resumed = highlightLines({ lines, startLine: k + 1, ...(state && { state }) });
        expect(resumed).toEqual(full.slice(k + 1));
      }
    }
  });

  it('should not take a state inside a fenced block or a script or style element as a resume point', () => {
    const lines = ['a', '```css', 'b {', '```', '<style>', 'b {', '</style>', '<script>', 'x', '</script>', '```', 'plain', '```', 'c'];
    const resumable: boolean[] = [];
    highlightLines({
      lines,
      onLineEnd: (lineIndex, state) => {
        resumable[lineIndex] = isLineStateResumable(state);
      }
    });
    // A fence with no language has no mode of its own.
    expect(resumable).toEqual([true, false, false, true, false, false, true, false, false, true, true, true, true, true]);
  });
});
