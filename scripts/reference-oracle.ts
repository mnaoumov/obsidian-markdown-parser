/**
 * @file
 *
 * Writes the `cmark-gfm` reference file (`src/oracle/reference-html.ts`): the HTML `cmark-gfm` 0.29.0.gfm.13, the GFM
 * spec's own implementation, gives for every spec example and every GFM quirk probe. The spec examples let the suites
 * check that it passes the GFM spec before its HTML is trusted for a probe; the probes are what the test-case export
 * takes it for. It runs `cmark-gfm` through the Python `cmarkgfm` binding, which bundles it, with `uv`; there is no
 * JavaScript build of that release.
 *
 * Usage: `jiti scripts/reference-oracle.ts`. It writes `oracle/reference-cmark-gfm-0.29.0.gfm.13.json`, and needs to
 * run again when a GFM quirk probe is added or changed.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  GfmReferenceFile,
  GfmReferenceRead
} from '../src/oracle/reference-html.ts';
import type { SpecOracleFile } from '../src/oracle/spec-oracle-file.ts';

import {
  PINNED_ORACLE_DIRECTORY,
  readOracleFile,
  specOracleFileName
} from '../src/oracle/oracle-location.ts';
import { QUIRK_PROBES } from '../src/oracle/quirk-probes.ts';
import {
  GFM_REFERENCE_FILE_NAME,
  GFM_REFERENCE_VERSION
} from '../src/oracle/reference-html.ts';

const JSON_INDENT = 2;
const MAX_OUTPUT_BYTES = 67_108_864;
const CMARKGFM = 'cmarkgfm@2025.10.22';
const EXTENSIONS = ['table', 'autolink', 'tagfilter', 'strikethrough', 'tasklist'];

// Reads a JSON array of documents from stdin and writes `{ version, html }`, the `cmark-gfm` version and each document's
// HTML, rendered with the extensions in argv and raw HTML kept, as the spec's tests render it.
const RENDER_PY = `
import json, sys
from cmarkgfm import cmark
documents = json.loads(sys.stdin.buffer.read().decode('utf-8'))
version = cmark._cmark.ffi.string(cmark._cmark.lib.cmark_version_string()).decode('utf-8')
html = [cmark.markdown_to_html_with_extensions(document, options=cmark.Options.CMARK_OPT_UNSAFE, extensions=sys.argv[1:]) for document in documents]
sys.stdout.buffer.write(json.dumps({ 'html': html, 'version': version }).encode('utf-8'))
`;

interface RenderOutput {
  readonly html: readonly string[];
  readonly version: string;
}

function main(): void {
  const spec = readOracleFile(specOracleFileName()) as SpecOracleFile;
  const markdowns = [...new Set([...spec.examples.map((example) => example.markdown), ...QUIRK_PROBES.filter((probe) => probe.preset === 'gfm').map((probe) => probe.markdown)])];
  const [packageName, packageVersion] = CMARKGFM.split('@') as [string, string];
  const result = spawnSync('uv', ['run', '--no-project', '--with', `${packageName}==${packageVersion}`, 'python', '-I', '-c', RENDER_PY, ...EXTENSIONS], {
    encoding: 'utf-8',
    input: JSON.stringify(markdowns),
    maxBuffer: MAX_OUTPUT_BYTES
  });
  if (result.status !== 0) {
    throw new Error(`cmark-gfm failed: ${result.error?.message ?? result.stderr}`);
  }
  const output = JSON.parse(result.stdout) as RenderOutput;
  if (output.version !== GFM_REFERENCE_VERSION) {
    throw new Error(`${CMARKGFM} bundles cmark-gfm ${output.version}, not ${GFM_REFERENCE_VERSION}`);
  }
  const documents = markdowns.map((markdown, index): GfmReferenceRead => ({ html: output.html[index] ?? '', markdown }));
  const file: GfmReferenceFile = {
    documents,
    meta: { extensions: EXTENSIONS, implementation: `cmark-gfm@${output.version}`, via: CMARKGFM }
  };
  const path = join(PINNED_ORACLE_DIRECTORY, GFM_REFERENCE_FILE_NAME);
  writeFileSync(path, `${JSON.stringify(file, null, JSON_INDENT)}\n`);
  console.log(`${String(documents.length)} documents written to ${path}`);
}

main();
