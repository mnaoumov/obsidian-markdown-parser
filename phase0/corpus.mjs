// Phase 0 corpus: deterministic fuzzed documents plus hand-written cases for Obsidian syntax.
// The piece sets are line fragments; a document is 1-6 of them from one set, joined by newlines.

const gap = ['para', 'text more', '   para', '    code', '\tcode', ' \tx', '', '', '', '  ', '> q', '>', '> [!note]', '   > q', '    > q', '```', '~~~', '````', '``` a`b', '```js', '%%', '%% x %%', 'x %%', '%% end', '$$', '$$ x $$', 'x $$', '$$$', '***', '___', '---', '===', '  ---', '* * *x', '# H', '#', '  # x', '#x', '###### x ##', '<div>', '</div>', '<span>', '<!-- c', 'c -->', '<!-- c -->', '<script>', '</script>', '<?php', '?>', '<a href="x">', '| a | b |', '| - | - |', 'a|b', '-|-', 'x|y', '|x', '|-|', ':-|-:', 'a \\| b', '> ```', '> $$', 'lazy', '\t', '    ', ' \t', '\t\t', '     '];
const rich = ['- A', '- B', '  - C', '    - D', '1. E', '10. F', '  1. G', '   - F', '', '', '  ', '    ', 'text', '  text', '    text', '      code', '> q', '> - G', '>', '> ', '>   - H', '>     - D', '> > - K', '> ```', '> %%', '  ```', '```', '````', '~~~', '   ```', '- ```', '- %%', '  %%', '%%', '%% x %%', 'x %%', '$$', '  $$', '$$ x $$', 'x $$', '- $$', '# H', '- ', '- [x] T', '+ L', '\t- D', '\t', '***', '* I', '  * J', '  ~~~', '>   ```', '  %% x', '  - ```'];
const ord = ['1. A', '2. B', '9. C', '10. D', '1) E', '  1. F', ' 1. G', '- H', '* I', '    - J', '   - K', '     - L', '       - M', '\t- N', '\t\t- O', '  text', '    text', '   text', ' text', 'lazy', '', '', '\t', '\ttext', '1.  P', '1.     Q', '    1. R', '- [ ] T', '1. [x] U', '      text'];
const quote = [...rich.map((p) => `> ${p}`), ...rich.map((p) => `>${p}`), '>', '> ', 'lazy', '', '1. A', '1) E', '- H', '* I', '9. C', '  text'];
const inline = ['a [[Note]] b', '![[img.png|200]]', '[[A#B|c]]', '[x](y.md)', '[x](<a b.md>)', '![i](p.png)', '#tag x', 'a #t/b', '#123', 'x[^1] y', '[^1]: def', '[^a]: d ^bid', '^[inline]', '^[]', 'p ^abc', '^abc', 'a *b ^x* c', '`code ^x`', '==hi==', '~~del~~', '%%c ^q%%', '$x$', '[a]: /u "t"', '[a][]', 'http://x.y', '<http://a>', 'x@y.z^ab', '- [ ] [a]: /u', '> [^2]: z', '- item ^li', '  - sub ^ls', '# H ^h', '| a ^c |', '', '', 'text', '---', 'k: [[L]]', 'tags: [a]'];
const emph = ['*a*', '**b**', '***c***', '_d_', '__e__', 'a*b*c', 'a_b_c', '*a **b** c*', '**a *b* c**', '*a', 'b*', '** x **', '*`c`*', '~~s~~', '==h==', '==*e*==', '`a`', '``a`b``', '` a `', '\\*x\\*', '&amp;', '&#35;', 'a  ', 'a\\', '<b>x</b>', '<!-- c -->', 'x<br>y', '[*l*](u)', '**[[W]]**', '*#t*', 'text', '', '# *H*', '> *q*', '- **L**'];
const obsidian = ['> [!note]', '> [!tip]- Title', '> [!warning]+ **T**', '> body', '>> [!info]', 'lazy', '', '[[Note]]', '[[Note|alias]]', '[[Note#Heading]]', '[[Note#^block]]', '![[embed.png]]', '![[Note#H|x]]', '#tag', '#nested/tag', '#t-a_b', 'a#nottag', '#1', '%%comment%%', '%%', 'multi', '%%', '$e=mc^2$', '$$', 'x^2', '$$', 'p ^block-id', '==mark==', '[^1]', '[^1]: note', '^[inline note]', '- [ ] todo', '- [x] done', '- [?] odd', '1. [ ] n', '| a | b |', '|---|---|', '| 1 | 2 |', '<div>', 'html', '</div>', '---', 'title: x', '---'];
const sets = { emph, gap, inline, obsidian, ord, quote, rich };

const hand = [
  '# Heading 1\n## Heading 2\n###### Heading 6\nSetext\n===\nSetext 2\n---\n',
  '*em* **strong** ***both*** _u_ __uu__ ~~strike~~ ==highlight== `code`\n',
  '- a\n  - b\n    - c\n      - d\n        - e\n- f\n',
  '1. one\n2. two\n   1. nested\n   2. nested\n3. three\n',
  '- [ ] open\n- [x] done\n  - [ ] nested task\n- [-] custom\n',
  '> quote\n> > nested\n> > > deeper\n> back\nlazy line\n',
  '> [!note] Title\n> body *em*\n> - list in callout\n\n> [!tip]- Folded\n> hidden\n',
  '> [!warning]+ Open\n> > [!info] Nested callout\n> > text\n',
  '[[Note]] [[Note|alias]] [[Note#Heading]] [[Note#^abc|x]] ![[image.png]] ![[Note#Heading|200]]\n',
  '[md](link.md) [ext](https://example.com "t") ![img](a.png) <https://auto.link> https://bare.link\n',
  '#tag #nested/tag #t_1 not#tag #123 #\n',
  'text %%inline comment%% text\n%%\nblock comment\n%%\n',
  'inline $x^2$ math and $$display$$ inline\n$$\n\\frac{a}{b}\n$$\n',
  'paragraph ^block-id\n\n- item ^item-id\n\n| a |\n| - |\n| b |\n\n^table-id\n',
  'text[^1] and ^[inline footnote]\n\n[^1]: The definition\n    continued\n',
  '| head | er |\n| :--- | ---: |\n| a | b |\n| `c` | **d** |\n',
  '<div class="x">\n<b>bold</b>\n</div>\n\n<span>inline</span> text <!-- c -->\n',
  '```js\nconst a = 1;\n```\n~~~\ntilde\n~~~\n    indented code\n',
  '---\ntitle: Front\ntags: [a, b]\n---\n# After\n',
  '***\n---\n___\n* * *\n',
  '- list\n\n  continuation\n\n      code in list\n- ```\n  fenced in list\n  ```\n',
  '> ```\n> code in quote\n> ```\n> $$\n> m\n> $$\n',
  'escape \\*not em\\* \\[[not link]] \\#nottag &amp; &#123;\n',
  'line with trailing spaces  \nnext\\\nhard break\n',
  '[ref]: https://example.com\n[ref] [text][ref] [text][]\n',
  '- a\n- b\n\n\n- c\n1. x\n2) y\n+ z\n* w\n',
  '\t- tab list\n\t\t- tab nested\n\ttext\n',
  '# H %%c%% [[l]] #t ==h== $m$\n> # quoted heading\n- # list heading\n'
];

/**
 * @param {{ perSet?: number, seed?: number }} [options]
 * @returns {{ id: string, set: string, text: string }[]}
 */
export function buildCorpus({ perSet = 300, seed = 12_345 } = {}) {
  let state = seed;
  const rand = (k) => {
    state = (state * 1_103_515_245 + 12_345) & 0x7f_ff_ff_ff;
    return Math.floor((state / 0x80_00_00_00) * k);
  };
  const docs = hand.map((text, i) => ({ id: `hand-${i}`, set: 'hand', text }));
  for (const [name, pieces] of Object.entries(sets)) {
    for (let i = 0; i < perSet; i++) {
      const len = 1 + rand(6);
      const lines = [];
      for (let j = 0; j < len; j++) {
        lines.push(pieces[rand(pieces.length)]);
      }
      const text = (rand(8) === 0 ? '---\na: 1\n---\n' : '') + lines.join('\n') + (rand(2) ? '\n' : '');
      docs.push({ id: `${name}-${i}`, set: name, text });
    }
  }
  return docs;
}
