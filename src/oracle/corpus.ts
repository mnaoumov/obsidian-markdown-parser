/**
 * @file
 *
 * The oracle corpus: hand-written documents for Obsidian syntax, and deterministic fuzzed documents. A fuzzed
 * document is 1 to 6 line fragments from one piece set, joined by newlines, with frontmatter added to one in 8.
 */

/**
 * Options of {@link buildCorpus}.
 */
export interface BuildCorpusOptions {
  /**
   * How many documents to build from each piece set.
   *
   * @default 300
   */
  readonly perSet?: number;

  /**
   * The random seed.
   *
   * @default 12345
   */
  readonly seed?: number;
}

/**
 * One corpus document.
 */
export interface CorpusDocument {
  /**
   * A stable identifier: `<set>-<index>`.
   */
  readonly id: string;

  /**
   * The piece set it was built from, or `hand`.
   */
  readonly set: string;

  /**
   * The markdown.
   */
  readonly text: string;
}

const CODE_INDENT_WIDTH = 4;
const CODE_INDENT = ' '.repeat(CODE_INDENT_WIDTH);

const GAP = ['para', 'text more', '   para', '    code', '\tcode', ' \tx', '', '', '', '  ', '> q', '>', '> [!note]', '   > q', '    > q', '```', '~~~', '````', '``` a`b', '```js', '%%', '%% x %%', 'x %%', '%% end', '$$', '$$ x $$', 'x $$', '$$$', '***', '___', '---', '===', '  ---', '* * *x', '# H', '#', '  # x', '#x', '###### x ##', '<div>', '</div>', '<span>', '<!-- c', 'c -->', '<!-- c -->', '<script>', '</script>', '<?php', '?>', '<a href="x">', '| a | b |', '| - | - |', 'a|b', '-|-', 'x|y', '|x', '|-|', ':-|-:', String.raw`a \| b`, '> ```', '> $$', 'lazy', '\t', CODE_INDENT, ' \t', '\t\t', ' '.repeat(CODE_INDENT_WIDTH + 1)];
const RICH = ['- A', '- B', '  - C', '    - D', '1. E', '10. F', '  1. G', '   - F', '', '', '  ', CODE_INDENT, 'text', '  text', '    text', '      code', '> q', '> - G', '>', '> ', '>   - H', '>     - D', '> > - K', '> ```', '> %%', '  ```', '```', '````', '~~~', '   ```', '- ```', '- %%', '  %%', '%%', '%% x %%', 'x %%', '$$', '  $$', '$$ x $$', 'x $$', '- $$', '# H', '- ', '- [x] T', '+ L', '\t- D', '\t', '***', '* I', '  * J', '  ~~~', '>   ```', '  %% x', '  - ```'];
const ORD = ['1. A', '2. B', '9. C', '10. D', '1) E', '  1. F', ' 1. G', '- H', '* I', '    - J', '   - K', '     - L', '       - M', '\t- N', '\t\t- O', '  text', '    text', '   text', ' text', 'lazy', '', '', '\t', '\ttext', '1.  P', '1.     Q', '    1. R', '- [ ] T', '1. [x] U', '      text'];
const QUOTE = [...RICH.map((p) => `> ${p}`), ...RICH.map((p) => `>${p}`), '>', '> ', 'lazy', '', '1. A', '1) E', '- H', '* I', '9. C', '  text'];
const INLINE = ['a [[Note]] b', '![[img.png|200]]', '[[A#B|c]]', '[x](y.md)', '[x](<a b.md>)', '![i](p.png)', '#tag x', 'a #t/b', '#123', 'x[^1] y', '[^1]: def', '[^a]: d ^bid', '^[inline]', '^[]', 'p ^abc', '^abc', 'a *b ^x* c', '`code ^x`', '==hi==', '~~del~~', '%%c ^q%%', '$x$', '[a]: /u "t"', '[a][]', 'https://x.y', '<http://a>', 'x@y.z^ab', '- [ ] [a]: /u', '> [^2]: z', '- item ^li', '  - sub ^ls', '# H ^h', '| a ^c |', '', '', 'text', '---', 'k: [[L]]', 'tags: [a]'];
const EMPH = ['*a*', '**b**', '***c***', '_d_', '__e__', 'a*b*c', 'a_b_c', '*a **b** c*', '**a *b* c**', '*a', 'b*', '** x **', '*`c`*', '~~s~~', '==h==', '==*e*==', '`a`', '``a`b``', '` a `', String.raw`\*x\*`, '&amp;', '&#35;', 'a  ', 'a\\', '<b>x</b>', '<!-- c -->', 'x<br>y', '[*l*](u)', '**[[W]]**', '*#t*', 'text', '', '# *H*', '> *q*', '- **L**'];
const TABLE = ['| a | b |', '| - | - |', '|---|---|', '| :-- | --: |', '|:-:|', '| 1 | 2 |', '| `c|d` | e |', String.raw`| a \| b | c |`, '| **b** | [[L|x]] |', '| ==h== | #t |', '| $x$ | %%c%% |', '|a|b|c|', '| one |', '| x | y | z |', 'a | b', '- | -', '--- | ---', ':-- | --:', '1 | 2', 'a|b', '-|-', 'x | y', '  | i | j |', '    | c | d |', 'para', 'text', '', '', '- item', '1. item', '> | q | r |', '> | - | - |', '| <b>x</b> | y |', '| ^id |', '|', '||', '| - |', 'a | b |', '| a | b', '| $x | y$ |', '| $$ | x |', '| *a | b* |', '| <b>x | y</b> |', '# H', '| #t/a | é |'];
const HTML = ['<div>', '</div>', '<div class="a">', '<div class="a">b</div>', '<span>x</span> y', 'a <b>c</b> d', 'a <i class="x">i</i>', '<br>', '<br/>', '<hr />', '<img src="a.png">', '<p>', '</p>', '<script>', 'var a = "s"; // c', 'if (a < b) { f(); }', '</script>', '<script src="x.js"></script>', '<style>', '.a { color: red; }', 'p > b::after { content: "x" }', '</style>', '<style>.b{margin:0}</style>', '<!-- c', 'c -->', '<!-- c -->', 'x <!-- c --> y', '<pre>', '</pre>', '<textarea>', '</textarea>', '<details>', '<summary>S</summary>', '</details>', '<a href="x">l</a>', '<a', 'href="y">', '<table><tr><td>1</td></tr></table>', '<?php echo 1; ?>', '<!DOCTYPE html>', '<![CDATA[ x ]]>', '<x-y z>', '<div', '>', 'text', '**b**', '', '', '- <b>l</b>', '> <div>q</div>', '    <div>', '</span>', '<span', '&lt;b&gt;', '<u>[[L]]</u>', '> <div>', '> </div>', '> text <b>x</b>', '> <!-- c', '- <div>x</div>', '#тег <i>x</i>'];
// eslint-disable-next-line no-template-curly-in-string -- A JavaScript template literal is one of the code lines the fenced-language pieces exercise.
const LANG = ['```js', '```javascript', '```ts', '```typescript', '```python', '```py', '```css', '```html', '```json', '```yaml', '```bash', '```sh', '```sql', '```java', '```c', '```cpp', '```csharp', '```rust', '```go', '```diff', '```markdown', '```md', '```xml', '```php', '```ruby', '```dataview', '```mermaid', '```unknownlang', '``` python', '```js title', '~~~python', '~~~', '```', '```', '```', 'const a = 1; // c', 'let s = "str', 'x = `t ${y}`', '/* block', 'end */', 'def f(x):', '    return "s"', '"""doc', '# comment', '.a { color: #fff; }', '{"k": [1, true, null]}', 'key: value', '- item', 'echo $HOME | grep x', 'SELECT * FROM t WHERE a = 1;', 'int main() { return 0; }', '+ added', '- removed', '@@ -1 +1 @@', '<div class="x">', '# Heading', '**not bold**', '[[not link]]', 'fn main() {}', 'graph TD; A-->B', 'TABLE file.name', 'text', '', ''];
const NEST = ['- a', '  - b', '    - c', '      - d', '        - e', '1. a', '   1. b', '      1. c', '   - b', '  1. b', '- [ ] t', '  - [x] u', '* s', '  + t', '\t- tab', '\t\t- tab2', '\t1. tab', '  text', '    text', '      text', '        code', '  ```', '    ```', '  ```js', '    ```py', '  ~~~', '  const a = 1;', '    x = 1', '  > q', '    > q', '  > - lq', '- > q', '1. > q', '  >', '- ```', '1. ```', '  $$', '  x^2', '  %%', '- # H', '  - # H', '- ', '-', '1.', '', '', 'lazy', '> - a', '>   - b', '>     - c', '> 1. a', '>    - b', '  | a | b |', '  | - | - |', '  <div>', '  </div>'];
const OBSIDIAN = ['> [!note]', '> [!tip]- Title', '> [!warning]+ **T**', '> body', '>> [!info]', 'lazy', '', '[[Note]]', '[[Note|alias]]', '[[Note#Heading]]', '[[Note#^block]]', '![[embed.png]]', '![[Note#H|x]]', '#tag', '#nested/tag', '#t-a_b', 'a#nottag', '#1', '%%comment%%', '%%', 'multi', '%%', '$e=mc^2$', '$$', 'x^2', '$$', 'p ^block-id', '==mark==', '[^1]', '[^1]: note', '^[inline note]', '- [ ] todo', '- [x] done', '- [?] odd', '1. [ ] n', '| a | b |', '|---|---|', '| 1 | 2 |', '<div>', 'html', '</div>', '---', 'title: x', '---'];

/**
 * The fuzzing piece sets, by name.
 */
export const PIECE_SETS: ReadonlyMap<string, readonly string[]> = new Map([
  ['emph', EMPH],
  ['gap', GAP],
  ['html', HTML],
  ['inline', INLINE],
  ['lang', LANG],
  ['nest', NEST],
  ['obsidian', OBSIDIAN],
  ['ord', ORD],
  ['quote', QUOTE],
  ['rich', RICH],
  ['table', TABLE]
]);

const HAND = [
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

const LCG_MULTIPLIER = 1_103_515_245;
const LCG_INCREMENT = 12_345;
const LCG_RANGE = 0x80_00_00_00;
const MAX_LINES = 6;
const FRONTMATTER_ONE_IN = 8;
const TRAILING_NEWLINE_ONE_IN = 2;
const DEFAULT_PER_SET = 300;
const DEFAULT_SEED = 12_345;

/**
 * Builds the corpus. The same options always give the same documents.
 *
 * @param options - How many documents and which seed.
 * @returns The documents: the hand-written ones first, then each piece set in name order.
 */
export function buildCorpus(options: BuildCorpusOptions = {}): CorpusDocument[] {
  const { perSet = DEFAULT_PER_SET, seed = DEFAULT_SEED } = options;
  let state = seed;
  function rand(k: number): number {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_RANGE;
    return Math.floor((state / LCG_RANGE) * k);
  }
  const docs: CorpusDocument[] = HAND.map((text, index) => ({ id: `hand-${String(index)}`, set: 'hand', text }));
  for (const [name, pieces] of PIECE_SETS) {
    for (let index = 0; index < perSet; index++) {
      const length = 1 + rand(MAX_LINES);
      const lines: string[] = [];
      for (let index_ = 0; index_ < length; index_++) {
        lines.push(pieces[rand(pieces.length)] ?? '');
      }
      const frontmatter = rand(FRONTMATTER_ONE_IN) === 0 ? '---\na: 1\n---\n' : '';
      const trailingNewline = rand(TRAILING_NEWLINE_ONE_IN) ? '\n' : '';
      docs.push({ id: `${name}-${String(index)}`, set: name, text: frontmatter + lines.join('\n') + trailingNewline });
    }
  }
  return docs;
}
