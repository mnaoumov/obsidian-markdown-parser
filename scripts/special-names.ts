/**
 * @file
 *
 * Prints the special note name oracle's judgement as markdown tables: per name, how each vault surface fared, then what
 * the file explorer's rename does with each checked name (`src/oracle/special-names.ts`, `docs/special-names.md`).
 *
 * Usage: `jiti scripts/special-names.ts [--obsidian-version <version>] [--android] [--details]`. `--details` adds what
 * every surface did, not only the ones that failed, and `--android` judges the Android oracle. The oracle is read from
 * `ORACLE_DIRECTORY`, by default `oracle/`.
 */

import { parseArgs } from 'node:util';

import type { SpecialNamesFile } from '../src/oracle/special-names.ts';

import {
  readOracleFile,
  specialNamesAndroidOracleFileName,
  specialNamesOracleFileName
} from '../src/oracle/oracle-location.ts';
import {
  ANDROID_SPECIAL_NAMES,
  judgeSpecialNames,
  SPECIAL_NAME_SURFACES,
  SPECIAL_NAMES
} from '../src/oracle/special-names.ts';

const { values } = parseArgs({ options: { 'android': { type: 'boolean' }, 'details': { type: 'boolean' }, 'obsidian-version': { type: 'string' } } });
const isAndroid = values.android === true;
const names = isAndroid ? ANDROID_SPECIAL_NAMES : SPECIAL_NAMES;
const file = readOracleFile((isAndroid ? specialNamesAndroidOracleFileName : specialNamesOracleFileName)(values['obsidian-version'])) as SpecialNamesFile;
const verdicts = judgeSpecialNames(file, names);
const MARK = { documented: 'doc', fails: '**fails**', ok: 'ok' } as const;

function code(text: null | string): string {
  if (text === null) {
    return '-';
  }
  // A space at either end of a code span is invisible, so it is shown as `␣`, a no-break space as `⍽` and a combining
  // mark after a dotted circle. A `|` is shown as `¦`, since an escaped one still splits a table cell.
  const shown = text.replaceAll('|', '¦').replaceAll('\u{A0}', '⍽').replaceAll(/\p{M}/gu, (mark) => `◌${mark}`)
    .replaceAll(/^ +| +$/g, (spaces) => '␣'.repeat(spaces.length));
  return shown.includes('`') ? `\`\` ${shown} \`\`` : `\`${shown}\``;
}

console.log(`| Name | ${SPECIAL_NAME_SURFACES.join(' | ')} |`);
console.log(`| --- |${' --- |'.repeat(SPECIAL_NAME_SURFACES.length)}`);
for (const { name } of names) {
  const byName = verdicts.get(name);
  console.log(`| ${code(name)} | ${SPECIAL_NAME_SURFACES.map((surface) => MARK[byName?.get(surface)?.status ?? 'fails']).join(' | ')} |`);
}
console.log('\n| Name | Surface | Status | What it did |\n| --- | --- | --- | --- |');
for (const { name } of names) {
  for (const surface of SPECIAL_NAME_SURFACES) {
    const verdict = verdicts.get(name)?.get(surface);
    if (verdict !== undefined && (values.details === true || verdict.status !== 'ok')) {
      console.log(`| ${code(name)} | ${surface} | ${verdict.status} | ${code(verdict.shown)} |`);
    }
  }
}
console.log('\n| Typed name | Saved | Message |\n| --- | --- | --- |');
for (const check of file.renameChecks) {
  console.log(`| ${code(check.name)} | ${check.saved ? 'yes' : 'no'} | ${check.message ?? '-'} |`);
}
