/**
 * @file
 *
 * The release differential: what a new Obsidian build changes in the family tables of the bug finders. Each table
 * counts the findings of one judge run per family; this diffs one version's table with another's, family by family,
 * and writes the result as markdown.
 */

import type { LiveSurfaceFile } from './checks/live-surfaces.ts';

import { judgeLiveSurfaceFile } from './checks/live-surfaces.ts';
import { selfCheckFamilyOf } from './checks/self-check-families.ts';
import { compareCodeUnits } from './classes/score.ts';

/**
 * A number on each of the two versions.
 */
export interface DifferentialVersionCounts {
  /**
   * On the older version.
   */
  readonly from: number;

  /**
   * On the newer version.
   */
  readonly to: number;
}

/**
 * The two versions a differential compares.
 */
export interface DifferentialVersions {
  /**
   * The older version.
   */
  readonly from: string;

  /**
   * The newer version.
   */
  readonly to: string;
}

/**
 * How a family moved between the two versions.
 */
export type FamilyChange = 'appeared' | 'changed' | 'unchanged' | 'vanished';

/**
 * One family of a table, with the number of findings in it.
 */
export interface FamilyCount {
  /**
   * The family's identifier, `unclassified...` for findings no family takes.
   */
  readonly id: string;

  /**
   * The family's verdict.
   */
  readonly kind: string;

  /**
   * The number of findings in it.
   */
  readonly total: number;
}

/**
 * One family's row of the differential.
 */
export interface FamilyDifference {
  /**
   * How it moved.
   */
  readonly change: FamilyChange;

  /**
   * Its count on the older version, 0 when it was not found there.
   */
  readonly from: number;

  /**
   * Its identifier.
   */
  readonly id: string;

  /**
   * Its verdict, the newer version's when both have it.
   */
  readonly kind: string;

  /**
   * Its count on the newer version, 0 when it is not found there.
   */
  readonly to: number;
}

/**
 * One judge run's table on both versions, or the reason it was skipped.
 */
export interface FamilyTablePair {
  /**
   * The number of documents judged on each version, when known.
   */
  readonly documents?: DifferentialVersionCounts;

  /**
   * The table on the older version.
   */
  readonly from?: readonly FamilyCount[];

  /**
   * What the table is.
   */
  readonly name: string;

  /**
   * Why it was not run, when it was not.
   */
  readonly skipped?: string;

  /**
   * The table on the newer version.
   */
  readonly to?: readonly FamilyCount[];
}

const CHANGE_ORDER: readonly FamilyChange[] = ['appeared', 'vanished', 'changed', 'unchanged'];

/**
 * Diffs two family tables: a family only the newer one has appeared, one only the older one has vanished, and one both
 * have changed or not by its count.
 *
 * @param from - The older version's table.
 * @param to - The newer version's table.
 * @returns A row per family, appeared first, then vanished, changed and unchanged, each by identifier.
 */
export function diffFamilies(from: readonly FamilyCount[], to: readonly FamilyCount[]): FamilyDifference[] {
  const older = new Map(from.map((family) => [family.id, family]));
  const newer = new Map(to.map((family) => [family.id, family]));
  const rows: FamilyDifference[] = [];
  const ids = new Set([...older.keys(), ...newer.keys()]);
  for (const id of ids) {
    const before = older.get(id);
    const after = newer.get(id);
    rows.push({ change: changeOf(before, after), from: before?.total ?? 0, id, kind: after?.kind ?? before?.kind ?? '', to: after?.total ?? 0 });
  }
  return rows.toSorted((left, right) => CHANGE_ORDER.indexOf(left.change) - CHANGE_ORDER.indexOf(right.change) || compareCodeUnits(left.id, right.id));
}

/**
 * Writes the differential of every table as markdown.
 *
 * @param versions - The two versions.
 * @param tables - Each judge run's tables.
 * @returns The report.
 */
export function formatDifferential(versions: DifferentialVersions, tables: readonly FamilyTablePair[]): string {
  const lines: string[] = [];
  const summary: string[] = [];
  for (const table of tables) {
    lines.push(`## ${table.name}`, '');
    if (table.from === undefined || table.to === undefined) {
      lines.push(`Skipped: ${table.skipped ?? 'no table on one of the versions'}.`, '');
      summary.push(`${table.name}: skipped`);
      continue;
    }
    const rows = diffFamilies(table.from, table.to);
    const moved = rows.filter((row) => row.change !== 'unchanged');
    summary.push(`${table.name}: ${moved.length === 0 ? 'no family moved' : CHANGE_ORDER.filter((change) => change !== 'unchanged').map((change) => `${String(rows.filter((row) => row.change === change).length)} ${change}`).join(', ')}`);
    const documents = table.documents === undefined ? '' : ` Judged ${String(table.documents.from)} documents on ${versions.from} and ${String(table.documents.to)} on ${versions.to}.`;
    lines.push(`${String(rows.length)} families: ${String(sumOf(table.from))} findings on ${versions.from}, ${String(sumOf(table.to))} on ${versions.to}.${documents}`, '');
    if (table.documents !== undefined && table.documents.from !== table.documents.to) {
      lines.push('The two versions\' oracles hold different documents, so a count can move with the corpus rather than the build: the drift report\'s `new` column names them.', '');
    }
    lines.push(
      `| Family | Verdict | ${versions.from} | ${versions.to} | Change |`,
      '| --- | --- | ---: | ---: | --- |',
      ...rows.map((row) => `| \`${row.id}\` | ${row.kind} | ${String(row.from)} | ${String(row.to)} | ${row.change} |`),
      ''
    );
  }
  return [`# Release differential: Obsidian ${versions.from} to ${versions.to}`, '', ...summary.map((line) => `- ${line}`), '', ...lines].join('\n');
}

/**
 * Counts the live surface judges' findings on an oracle file per self-check family.
 *
 * @param file - The live surface oracle file.
 * @returns The families, by count, then by identifier.
 */
export function liveSurfaceFamilyCounts(file: LiveSurfaceFile): FamilyCount[] {
  const totals = new Map<string, number>();
  const kinds = new Map<string, string>();
  for (const findings of judgeLiveSurfaceFile(file).values()) {
    for (const finding of findings) {
      const family = selfCheckFamilyOf(finding.key, finding.excerpt);
      const id = family?.id ?? `unclassified:${finding.key}`;
      totals.set(id, (totals.get(id) ?? 0) + 1);
      kinds.set(id, family?.kind ?? 'unclassified');
    }
  }
  return [...totals].map(([id, total]) => ({ id, kind: kinds.get(id) ?? 'unclassified', total }))
    .toSorted((left, right) => right.total - left.total || compareCodeUnits(left.id, right.id));
}

function changeOf(before: FamilyCount | undefined, after: FamilyCount | undefined): FamilyChange {
  if (before === undefined) {
    return 'appeared';
  }
  if (after === undefined) {
    return 'vanished';
  }
  return before.total === after.total ? 'unchanged' : 'changed';
}

function sumOf(families: readonly FamilyCount[]): number {
  return families.reduce((sum, family) => sum + family.total, 0);
}
