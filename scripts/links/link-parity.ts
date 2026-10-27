/**
 * @file
 *
 * Prints the link parity oracle's judgement as markdown tables: per note name, heading, display text and block id, the
 * hand-written forms of each format that work and how the links Obsidian writes fare, then the heading collisions
 * (`src/oracle/links/link-parity.ts`, `docs/link-parity.md`).
 *
 * Usage: `jiti scripts/links/link-parity.ts [--obsidian-version <version>]`. The oracle is read from `ORACLE_DIRECTORY`, by
 * default `oracle/`.
 */

import { parseArgs } from 'node:util';

import type {
  LinkParityFile,
  LinkParityKind,
  WrittenLinkVerdict
} from '../../src/oracle/links/link-parity.ts';

import { judgeLinkParity } from '../../src/oracle/links/link-parity.ts';
import {
  linkParityOracleFileName,
  readOracleFile
} from '../../src/oracle/oracle-location.ts';

const { values } = parseArgs({ options: { 'obsidian-version': { type: 'string' } } });
const file = readOracleFile(linkParityOracleFileName(values['obsidian-version'])) as LinkParityFile;
const KINDS: readonly LinkParityKind[] = ['target', 'heading', 'display', 'block'];
const TITLES: Record<LinkParityKind, string> = { block: 'Block ids', display: 'Display texts', heading: 'Headings', target: 'Note names' };
const WRITERS = [['autocomplete', 'wikilink'], ['autocomplete', 'markdown'], ['api', 'wikilink'], ['api', 'markdown']] as const;

function code(text: null | string): string {
  if (text === null) {
    return '-';
  }
  // A space at either end of a code span is invisible, and markdownlint refuses it, so it is shown as `␣`. A `|` is
  // shown as `¦`, since an escaped one after a backslash, as in `a\|b`, still splits a table cell.
  const shown = text.replaceAll('|', '¦').replaceAll('\n', '⏎').replaceAll('\u{A0}', '⍽')
    .replaceAll(/^ +| +$/g, (spaces) => '␣'.repeat(spaces.length));
  return shown.includes('`') ? `\`\` ${shown} \`\`` : `\`${shown}\``;
}

function writtenCell(written: readonly WrittenLinkVerdict[], writer: string, format: string): string {
  const verdict = written.find((item) => item.writer === writer && item.format === format);
  if (verdict === undefined) {
    return '-';
  }
  if (verdict.outcome === 'not-offered') {
    return 'not offered';
  }
  const outcome = verdict.outcome === 'ok' ? 'ok' : `**${verdict.outcome}**`;
  return `${code(verdict.markdown)} ${outcome}${verdict.shown === null ? ', no link' : `, shows ${code(verdict.shown)}`}`;
}

const REACHED = ['**the first**', 'the second'];

function reached(index: null | number): string {
  return index === null ? '-' : REACHED[index] ?? '**none**';
}

console.log(`Obsidian ${file.meta.appVersion ?? 'unknown'}`);
const subjects = judgeLinkParity(file);
for (const kind of KINDS) {
  console.log(`\n### ${TITLES[kind]}\n`);
  console.log('| Subject | Verdict | Wikilink forms that work | Markdown forms that work | Autocomplete, wikilink | Autocomplete, markdown | API, wikilink | API, markdown |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const subject of subjects) {
    if (subject.kind !== kind) {
      continue;
    }
    const verdict = `${subject.verdict}${subject.isDocumented ? ' (documented)' : ''}`;
    const writtenCells = WRITERS.map(([writer, format]) => writtenCell(subject.written, writer, format));
    console.log(`| ${[code(subject.subject), verdict, subject.wikilinkForms.join(', ') || '**none**', subject.markdownForms.join(', ') || '**none**', ...writtenCells].join(' | ')} |`);
  }
}
console.log('\n### Heading collisions\n');
console.log('| First heading | Second heading | The second\'s own text reaches | Autocomplete writes for the second | It reaches |');
console.log('| --- | --- | --- | --- | --- |');
for (const collision of file.collisions) {
  console.log(`| ${code(collision.first)} | ${code(collision.second)} | ${reached(collision.rawReach)} | ${code(collision.autocompleteWrote)} | ${reached(collision.autocompleteReach)} |`);
}
