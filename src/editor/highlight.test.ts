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
  MAIN_CLASS_ORACLE_SEED,
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

function readOracle(name: string): OracleFile {
  return readOracleFile(name) as OracleFile;
}

describe('highlight', () => {
  for (const [name, known] of KNOWN_DIFFERENCES) {
    it(`should match the live editor on every document of ${name} but the known differences`, () => {
      const oracle = readOracle(name);
      const differing = oracle.docs.filter((document) => compareDocument(document).differences.length > 0).map((document) => document.id);
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

  it('should resume from the state after any line outside a block with the same result', () => {
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
