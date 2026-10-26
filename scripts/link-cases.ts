/**
 * @file
 *
 * Prints the link case oracle's judgement as a markdown table: per case, every link of its note, where it leads and how
 * it fared, and the links `generateMarkdownLink` wrote (`src/oracle/link-cases.ts`, `docs/link-cases.md`).
 *
 * Usage: `jiti scripts/link-cases.ts [--obsidian-version <version>]`. The oracle is read from `ORACLE_DIRECTORY`, by
 * default `oracle/`.
 */

import { parseArgs } from 'node:util';

import type { LinkCasesFile } from '../src/oracle/link-cases.ts';

import {
  judgeLinkCases,
  LINK_CASES
} from '../src/oracle/link-cases.ts';
import {
  linkCasesOracleFileName,
  readOracleFile
} from '../src/oracle/oracle-location.ts';

const { values } = parseArgs({ options: { 'obsidian-version': { type: 'string' } } });
const file = readOracleFile(linkCasesOracleFileName(values['obsidian-version'])) as LinkCasesFile;
const verdicts = judgeLinkCases(file);
const MARK = { expected: 'expected', fails: '**fails**', ok: 'ok' } as const;

function code(text: string): string {
  // A `|` is shown as `¦`, since an escaped one still splits a table cell.
  const shown = text.replaceAll('|', '¦');
  return shown.includes('`') ? `\`\` ${shown} \`\`` : `\`${shown}\``;
}

console.log('| Case | Link | What it does | Status |\n| --- | --- | --- | --- |');
for (const { id, topic } of LINK_CASES) {
  const caseVerdicts = verdicts.get(id) ?? [];
  for (const verdict of caseVerdicts) {
    console.log(`| [${id}](${topic}) | ${code(verdict.original)} | ${verdict.shown} | ${MARK[verdict.status]} |`);
  }
}
