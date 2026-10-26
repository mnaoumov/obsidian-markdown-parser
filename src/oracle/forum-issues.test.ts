import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  ForumIssueFile,
  ForumIssueRead
} from './forum-issues.ts';

import { parseMetadata } from '../metadata/metadata.ts';
import {
  forumIssueDocuments,
  OWNER_REPORT_SAMPLES
} from './forum-issues.ts';
import { familyOf } from './mode-families.ts';
import {
  differenceKey,
  judgeModesPredicted,
  reduceDifference
} from './mode-judge.ts';
import {
  forumIssueOracleFileName,
  oracleObsidianVersion,
  readOracleFile
} from './oracle-location.ts';
import { compareDocument } from './score.ts';

const ORACLE = readOracleFile(forumIssueOracleFileName()) as ForumIssueFile;

describe('the forum issue oracle', () => {
  it('holds every document once, in order', () => {
    expect(ORACLE.reads.map((read) => read.markdown)).toEqual(forumIssueDocuments());
  });

  it('is the editor\'s classes that the class tokenizer gives, on every character and line of every document', () => {
    const differing = ORACLE.reads.filter((read) => compareDocument({ id: read.markdown, nodes: read.nodes, set: 'forum', text: read.markdown }, { obsidianVersion: oracleObsidianVersion() }).differences.length > 0);
    expect(differing.map((read) => read.markdown)).toEqual([]);
  });

  it('is the metadata that the projection gives on every document', () => {
    const differing = ORACLE.reads.filter((read) => JSON.stringify(parseMetadata(read.markdown)) !== JSON.stringify(read.metadata));
    expect(differing.map((read) => read.markdown)).toEqual([]);
  });
});

function ownerRead(id: string): ForumIssueRead {
  const markdown = OWNER_REPORT_SAMPLES.find((sample) => sample.id === id)?.markdown;
  const read = ORACLE.reads.find((candidate) => candidate.markdown === markdown);
  if (read === undefined) {
    throw new Error(`No read of ${id}`);
  }
  return read;
}

describe('the owner\'s report samples, as Obsidian 1.14.5 reads them', () => {
  it('still breaks the front matter strings of topic 38294 in Source mode only', () => {
    const read = ownerRead('owner-38294-1');
    expect(read.sourceModeHtml).toContain('<span class="cm-hmd-frontmatter cm-string" spellcheck="false">\' and YAML syntax highlighter</span>');
    expect(read.sourceModeHtml).toContain(String.raw`<span class="cm-hmd-frontmatter cm-string" spellcheck="false">"Escaping quotes \"</span>`);
    expect(read.livePreviewHtml).not.toContain('cm-hmd-frontmatter');
    expect(read.highlightedCode?.[0]).toContain(String.raw`<span class="token string">"Escaping quotes \" and YAML syntax highligher"</span>`);
    expect(read.highlightedCode?.[0]).toContain('Single quote \' and YAML syntax highlighter\n');
  });

  it('draws no rule and no image inside a markdown fence in Live Preview, as topic 49620 was fixed', () => {
    for (const id of ['owner-49620-1', 'owner-53597-1']) {
      const html = ownerRead(id).livePreviewHtml ?? '';
      expect(html).not.toMatch(/<hr|<img(?! class="cm-widgetBuffer")/u);
    }
    expect(ownerRead('owner-49620-1').livePreviewHtml).toContain('<span class="cm-hmd-codeblock cm-hr" spellcheck="false">---</span>');
  });

  it('still leaves an image with empty alt text plain in a markdown fence\'s Prism highlighting, as topic 53597 reports', () => {
    const [code] = ownerRead('owner-53597-1').highlightedCode ?? [];
    expect(code).toMatch(/^!\[\]\(image\.png\)\n<span class="token url">/u);
  });

  it('styles bold in a markdown fence on every surface, as the team ruled in topic 76476', () => {
    const read = ownerRead('owner-76476-1');
    expect(read.sourceModeHtml).toContain('cm-strong');
    expect(read.livePreviewHtml).toContain('cm-strong');
    expect(read.highlightedCode?.[0]).toContain('<span class="token bold">');
  });

  it('carries the callout of topic 80930 onto the next item, which Live Preview draws inside the callout\'s embed', () => {
    const read = ownerRead('owner-80930-1');
    expect(read.sourceModeHtml).toContain('<div class="cm-line HyperMD-list-line HyperMD-list-line-2 HyperMD-quote HyperMD-quote-1 HyperMD-quote-lazy"');
    expect(read.livePreviewHtml).toMatch(/<div class="cm-embed-block cm-callout"[^>]*><div class="markdown-rendered[^"]*"><pre><code>&gt; \[!NOTE\][\s\S]*<li dir="auto">Subitem 2\.3<\/li>/u);
    expect(read.html).toMatch(/<\/div><\/div>\n<\/li>\n<li>Subitem 2\.3<\/li>/u);
  });

  it('files the callout of topic 80930 under a known family that cites the open topic 57053', () => {
    const { markdown } = ownerRead('owner-80930-1');
    const families = judgeModesPredicted(markdown).map((difference) => differenceKey(difference)).filter((key) => key.startsWith('editor:quote')).map((key) => familyOf(key, reduceDifference(markdown, key)));
    expect(families.map((family) => [family?.id, family?.kind, family?.forumUrl])).toEqual([['quote-onto-indented-list-item', 'known', 'https://forum.obsidian.md/t/57053']]);
  });
});
