/* eslint-disable import-x/no-nodejs-modules -- The package manifests and the sources are files read from disk in Node. */
import {
  readFileSync,
  statSync
} from 'node:fs';
import {
  dirname,
  join,
  relative,
  resolve
} from 'node:path';
import { fileURLToPath } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules -- Only the imports above need Node. */
import {
  describe,
  expect,
  it
} from 'vitest';

import { compareCodeUnits } from '../oracle/classes/score.ts';

const IMPORT_RE = /^\s*(?:import|export)\b[^'";]*?\bfrom\s+'(?<specifier>[^']+)'|^\s*import\s+'(?<sideEffect>[^']+)'|\bimport\(\s*'(?<dynamic>[^']+)'\s*\)/gmu;

interface ExportConditions {
  readonly default: string;
}

type ExportTarget = ExportConditions | string;

interface ImportClosure {
  readonly files: string[];
  readonly packageSpecifiers: string[];
}

interface PackageJson {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly exports: Readonly<Record<string, ExportTarget>>;
}

interface TsConfig {
  readonly files: readonly string[];
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const metadataPackageFolder = join(root, 'packages', 'metadata');
const rootPackage = readJson(join(root, 'package.json')) as PackageJson;
const metadataPackage = readJson(join(metadataPackageFolder, 'package.json')) as PackageJson;
const metadataEntries = (readJson(join(metadataPackageFolder, 'tsconfig.build.json')) as TsConfig).files.map((file) => resolve(metadataPackageFolder, file));

describe('the metadata package', () => {
  const closure = importClosureOf(metadataEntries);

  it('imports no package beyond its own dependencies, which are the root package\'s at the same versions', () => {
    const packageNames = [...new Set(closure.packageSpecifiers.map((specifier) => packageNameOf(specifier)))];
    expect(packageNames.toSorted(compareCodeUnits)).toEqual(Object.keys(metadataPackage.dependencies).toSorted(compareCodeUnits));
    for (const [name, version] of Object.entries(metadataPackage.dependencies)) {
      expect(rootPackage.dependencies[name], name).toBe(version);
    }
  });

  it('builds from the remark engine and the metadata projection only, with no editor or adapter module', () => {
    const sourceFolder = join(root, 'src');
    const folders = new Set(closure.files.map((file) => toPosix(relative(sourceFolder, dirname(file)))));
    expect([...folders].toSorted(compareCodeUnits)).toEqual(['entries', 'metadata', 'remark']);
  });

  it('exports each entry it builds, and only those', () => {
    const entries = metadataEntries.map((file) => toPosix(relative(root, file)));
    expect(exportedSources(metadataPackage, './dist/')).toEqual(entries.toSorted(compareCodeUnits));
  });
});

describe('the root package', () => {
  it('exports each entry its build compiles, and only those', () => {
    const entries = (readJson(join(root, 'tsconfig.build.json')) as TsConfig).files.map((file) => toPosix(relative(root, resolve(root, file))));
    expect(exportedSources(rootPackage, './dist/lib/')).toEqual(entries.toSorted(compareCodeUnits));
  });
});

function exportedSources(packageJson: PackageJson, outDirectory: string): string[] {
  return Object.entries(packageJson.exports)
    .filter(([subpath]) => subpath !== './package.json')
    .map(([, target]) => (typeof target === 'string' ? target : target.default))
    .map((target) => `src/${target.slice(outDirectory.length).replace(/\.js$/u, '.ts')}`)
    .toSorted(compareCodeUnits);
}

function importClosureOf(entries: readonly string[]): ImportClosure {
  const files = new Set<string>();
  const packageSpecifiers: string[] = [];
  const pending = [...entries];

  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (files.has(file)) {
      continue;
    }

    files.add(file);
    for (const match of readFileSync(file, 'utf-8').matchAll(IMPORT_RE)) {
      const specifier = match.groups?.['specifier'] ?? match.groups?.['sideEffect'] ?? match.groups?.['dynamic'] ?? '';
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        statSync(target);
        pending.push(target);
      } else {
        packageSpecifiers.push(specifier);
      }
    }
  }

  return { files: [...files], packageSpecifiers };
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}
