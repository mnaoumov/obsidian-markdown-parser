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

  it('drops a [ after a shortcut reference when no ] closes it, as Reading view does', () => {
    expect(render('[x][')).toBe('<p>[x]</p>\n');
    expect(render('a [][')).toBe('<p>a []</p>\n');
    expect(render('[x][z')).toBe('<p>[x]z</p>\n');
    expect(render('[text][ref][\n\n[ref]: /u')).toBe('<p><a href="/u">text</a>[</p>\n');
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

  it('renders the Obsidian syntax as Obsidian\'s handlers do, and comments and block ids as nothing', () => {
    expect(render('#tag [[a#b|c]] [[d#e]] ==🔴x== ==y== $m$ $$n$$ %%c%% ^id')).toBe(
      '<p><a class="tag" href="#tag">#tag</a> <a class="internal-link" data-href="a#b" href="a#b" aria-label="a > b" data-tooltip-position="top">c</a> <a class="internal-link" data-href="d#e" href="d#e">d &gt; e</a> <mark data-highlight="red">x</mark> <mark>y</mark> <span class="math math-inline">m</span> <span class="math math-block">n</span>  </p>\n'
    );
    expect(render('---\nk: v\n---\n$$\nx\n$$\n\n%%\nz\n%%')).toBe(
      '<pre class="frontmatter" style="display: none;"><code class="language-yaml">k: v</code></pre>\n<div class="math math-block">x</div>\n'
    );
  });

  it('sizes an embed by its alias, alone or after its last pipe, and shows the rest as its alternative text', () => {
    expect(render('![[i.png|200]] ![[j.png|a|100x50]] ![[k.png|b]] ![[l.png|]]')).toBe(
      '<p><span alt="i.png" class="internal-embed" src="i.png" width="200">200</span> <span alt="a" class="internal-embed" src="j.png" width="100" height="50">a|100x50</span> <span alt="b" class="internal-embed" src="k.png">b</span> <span alt="" class="internal-embed" src="l.png"></span></p>\n'
    );
  });

  it('numbers footnotes by first reference, links each reference back, and leaves a reference to no definition as text', () => {
    expect(render('a[^1] b[^1] c^[note] d[^2]\n\n[^1]: one\n\n[^2]: two')).toBe(
      '<p>a<sup class="footnote-ref" data-footnote-id="fnref-1"><a class="footnote-link" data-footref="1" href="#fn-1">[1]</a></sup> b<sup class="footnote-ref" data-footnote-id="fnref-1-1"><a class="footnote-link" data-footref="1" href="#fn-1">[1-1]</a></sup> c<sup class="footnote-ref" data-footnote-id="fnref-2"><a class="footnote-link" data-footref="[inline1" href="#fn-2">[2]</a></sup> d<sup class="footnote-ref" data-footnote-id="fnref-3"><a class="footnote-link" data-footref="2" href="#fn-3">[3]</a></sup></p>\n\n\n<section class="footnotes">\n<hr>\n<ol>\n<li data-footnote-id="fn-1"><p><p>one</p><a class="footnote-backref footnote-link" href="#fnref-1">↩︎</a><a class="footnote-backref footnote-link" href="#fnref-1-1">↩︎</a></p></li>\n<li data-footnote-id="fn-2"><p>note<a class="footnote-backref footnote-link" href="#fnref-2">↩︎</a></p></li>\n<li data-footnote-id="fn-3"><p><p>two</p><a class="footnote-backref footnote-link" href="#fnref-3">↩︎</a></p></li>\n</ol>\n</section>\n'
    );
    expect(render('u [^none]')).toBe('<p>u none</p>\n');
  });

  it('renders the rest of the block and inline nodes', () => {
    expect(render('# h\n\n> q\n\n***\n\n~~d~~ **s** `c\nd`')).toBe(
      '<h1>h</h1>\n<blockquote>\n<p>q</p>\n</blockquote>\n<hr>\n<p><del>d</del> <strong>s</strong> <code>c d</code></p>\n'
    );
  });
});
