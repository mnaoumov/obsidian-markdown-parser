import {
  describe,
  expect,
  it
} from 'vitest';

import { renderRemarkHtml } from './html.ts';
import { parseRemark } from './parse.ts';

function render(markdown: string): string {
  return renderRemarkHtml(parseRemark(markdown));
}

describe('renderRemarkHtml', () => {
  it('renders nothing for an empty document, and ends other documents with a line ending', () => {
    expect(render('')).toBe('');
    expect(render('a')).toBe('<p>a</p>\n');
  });

  it('renders tasks as checkboxes, and marks their list', () => {
    expect(render('- [?] a\n- [ ] b')).toBe(
      '<ul class="contains-task-list">\n<li class="task-list-item"><input checked="" disabled="" type="checkbox"> a</li>\n<li class="task-list-item"><input disabled="" type="checkbox"> b</li>\n</ul>\n'
    );
    expect(render('- [x] ```\n  c\n  ```')).toBe(
      '<ul class="contains-task-list">\n<li class="task-list-item"><input checked="" disabled="" type="checkbox">\n<pre><code>c\n</code></pre>\n</li>\n</ul>\n'
    );
  });

  it('wraps a loose list item\'s paragraphs, and numbers an ordered list from its start', () => {
    expect(render('3. a\n\n4. b')).toBe('<ol start="3">\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ol>\n');
  });

  it('renders a table\'s alignments, and pads short rows to the alignment row', () => {
    expect(render('| a  |b|\n|:-|-:|\n| c |')).toBe(
      '<table>\n<thead>\n<tr>\n<th align="left">a</th>\n<th align="right">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="left">c</td>\n<td align="right"></td>\n</tr>\n</tbody>\n</table>\n'
    );
  });

  it('resolves references through their definitions, case-insensitively, and reverts the others to their source', () => {
    expect(render('[A] ![I]\n\n[a]: /u "t"\n[i]: /i.png')).toBe('<p><a href="/u" title="t">A</a> <img alt="I" src="/i.png"></p>\n');
    expect(render('[b][c] [d][] ![e][f] [*g*]')).toBe('<p>[b][c] [d][] ![e][f] [<em>g</em>]</p>\n');
  });

  it('renders code with the language of its info string', () => {
    expect(render('```js x\nb\n```\n\n    c')).toBe('<pre><code class="language-js">b\n</code></pre>\n<pre><code>c\n</code></pre>\n');
  });

  it('percent-encodes link targets, keeping the escapes already there', () => {
    expect(render('[a](<b c>) [d](%zz) [e](ü%C3%BC) [f](\u{1F600})')).toBe('<p><a href="b%20c">a</a> <a href="%25zz">d</a> <a href="%C3%BC%C3%BC">e</a> <a href="%F0%9F%98%80">f</a></p>\n');
  });

  it('drops the whitespace after a hard break, and the whitespace around a line ending in text', () => {
    expect(render('a\\\n   *b*  \nc \n d')).toBe('<p>a<br>\n<em>b</em><br>\nc\nd</p>\n');
  });

  it('passes raw HTML through and escapes text as a DOM serializes it', () => {
    expect(render('<div>\n\na & b < c > d\u{A0}"e"\n\n</div>')).toBe('<div>\n<p>a &amp; b &lt; c &gt; d&nbsp;"e"</p>\n</div>\n');
  });

  it('renders the rest of the block and inline nodes', () => {
    expect(render('# h\n\n> q\n\n***\n\n~~d~~ **s** `c\nd`')).toBe(
      '<h1>h</h1>\n<blockquote>\n<p>q</p>\n</blockquote>\n<hr>\n<p><del>d</del> <strong>s</strong> <code>c d</code></p>\n'
    );
  });
});
