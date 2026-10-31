# Link parity: what a wikilink cannot express, and the links Obsidian writes wrong

A markdown link can backslash-escape any ASCII punctuation, so `[\[](a.md)` shows `[`, and no wikilink spells that out. Wikilinks have no spec, so a gap like this breaks no spec, and calling it a defect needs a rule to measure against. This page states the rule, measures every gap on a live Obsidian, and says where each one goes.

## The rule

Obsidian's help names the two formats side by side and calls them interchangeable ([Internal links](https://help.obsidian.md/links), *Supported formats for internal links*):

> The examples above are equivalent, and they appear the same way in the editor and links to the same note.

One setting, `Use [[Wikilinks]]`, picks the format Obsidian writes, and the help says the autocomplete keeps working with it off: "When you select one of the suggested files, Obsidian instead generates a Markdown link." So two rules follow from Obsidian's own design, with no outside spec needed:

1. **Parity on what a link is for.** Any target (a note, a heading, a block) with any display text can be written in either format. A link one format can express and the other cannot is a defect. Features beyond that core are out of scope: a markdown link's title (`[a](b "c")`) has no wikilink counterpart and is not counted, and neither is inline formatting inside a markdown link's display text, which a wikilink shows literally by design.
2. **Round trip.** Every link Obsidian writes itself, by the autocomplete or by `fileManager.generateMarkdownLink`, reaches what it was written for and shows the text it should. The targets are every file the vault shows, not only the names Obsidian lets you create, because a note can arrive from a file manager, sync or git with a name Obsidian would refuse.

**Where the help states a rule, the help comes first.** Its *Invalid characters* note says:

> A string which contains the following characters may not work as a link: `# | ^ : %% [[ ]]`.

So a note name or heading holding one of those is a documented limitation, not a defect, and is marked *documented* below. The note is read as covering the string a link targets, a note name or a heading, and not display text, which no link resolves.

## How it is measured

```sh
npx jiti scripts/links/link-parity-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]
npm run link-parity
```

`scripts/links/link-parity-oracle.ts` writes every target of `src/oracle/links/link-parity.ts` straight onto the disk of an owned Obsidian's vault, never through the app: 42 note names, 26 headings (one per note, so no two collide), a note for the display texts, a note with a block id, and 37 notes of two headings each. It asks the app to write a link to each target in both formats, by its editor's link autocomplete and by `generateMarkdownLink`, then writes every link, hand-written or app-written, into a note of its own, again on disk. 998 notes in all. For each note it reads the cached link, the first link Reading view renders, and where each one leads by the app's own `parseLinktext`, `getFirstLinkpathDest` and `resolveSubpath`. A link **works** when both lead to the expected file, heading or block, the cache holds one link and Reading view renders one, and Reading view shows the expected text. `npm run link-parity` prints the tables below from the oracle.

The hand-written forms tried are: for a wikilink `plain`, `escaped` (a backslash before each of `[ ] # ^ | \ %`), `with-extension`, `percent-encoded` and `folder-path`; for a markdown link `plain`, `angle` (`<...>`), `escaped` (a backslash before each punctuation character), `percent-encoded` (`encodeURIComponent`) and `entity` (`&` as `&amp;`); for a heading also `stripped`, the heading as the autocomplete writes it; for display text `escaped` and inside a table.

Only names Windows can store were tried, so `| : * ? " < > \ /` in a name are left to a non-Windows device. The oracle is pinned to 1.14.5 (`oracle/link-parity-obsidian-1.14.5.json`). The 1.15.0 insider build, read on 2026-10-25, gives every verdict and every outcome the same. `src/oracle/links/link-parity.test.ts` pins them, and checks that `parseMetadata` gives the cached link and display text of all 998 notes.

## What was found

1. **A wikilink cannot carry `[[` or `]]` in a note name.** `[[x]]y]]` ends at the first `]]`, and no escape exists for a name: `[[x\]\]y]]` looks for a note named `x\]\]y`. Every markdown form reaches `x]]y` and `x[[y`. *Documented*, so no defect, but a parity gap all the same. A single `[` or `]` works in both formats.
2. **A wikilink's display text cannot hold `[[` or `]]`, or start or end with a space.** `[[t|a]]b]]` shows `a`, `[[t|a[[b]]` is no link to `t`, and `[[t|  a]]` shows `a`. The escaped markdown link shows each exactly. The help documents none of it, so it is a **defect by rule 1**. `|` is fine: `[[t|a|b]]` shows `a|b`.
3. **A markdown link cannot reach a note whose name starts with a space.** The destination is trimmed, in every form. `[[link-parity/ x]]` reaches it, the plain `[[ x]]` does not, and both writers write a link that misses it. Rule 1 and rule 2, a minor defect.
4. **Neither format reaches a note with `#` in its name.** `#` starts the subpath in a wikilink and in a markdown link alike, and `%23` is not decoded: the app decodes a destination with `decodeURI`, which leaves every reserved character (`# $ & + , / : ; = ? @`) encoded. *Documented.* A side effect that is not documented: a destination encoded with `encodeURIComponent`, the obvious reading of the help's "make sure to URL encode the link destination", breaks any name with `$ & + , ; = @`.
5. **Headings are matched by a key, so a heading that differs from an earlier one only in punctuation, case or spacing cannot be reached by any link.** The second of `# a b` and `# a<c>b` is unreachable for every ASCII punctuation character `<c>` but `'`, `-` and `_`, and so is the second of `ab` and `AB`, of `a b` and `a  b`, and of `a b` and `a` + no-break space + `b`. A link to the second one, in either format, lands on the first (for `a#b`, whose `#` splits the subpath, nowhere), and so does the link the autocomplete writes for it, so this is a **defect by both rules**, in neither format alone. The help documents none of it. Its `#heading#subheading` path reaches a heading under another parent, not a sibling. Two headings with the same text, `a b` twice or `ab` and `ab␣` (the parser drops a trailing space), are the same heading and are not counted.
6. **The markdown links Obsidian writes are not escaped.** With `Use [[Wikilinks]]` off, the autocomplete and `generateMarkdownLink` write the note's name or the heading's text as display text, and the destination, as they are. So the link they write for a note named `x]y` or `x]]y` is no link at all, for `x%y`, `x%%y`, `x(y` and `x)y` it is no link to the note, for `x&amp;y` it silently reaches **another note**, `x&y`, and for `x[y`, `x[[y`, `^x`, `x==y==z` and `x~~y~~z` it shows the wrong text. The autocomplete's markdown link to a heading fails the same way for `a]b`, `a]]b`, `a[[b]]c`, `[[t]] x`, `a%b` and `a&amp;b`: it writes the heading's text as display text, unescaped. An alias passed to `generateMarkdownLink` is not escaped either. The same names and headings all work as wikilinks, or are documented, and a hand-escaped markdown link reaches every one. A **defect by rule 2**, and against the help's own instruction to URL encode the destination.
7. **`generateMarkdownLink` does not strip a heading subpath the way the autocomplete does.** Passed `#a|b`, `#a#b`, `#a]]b`, `#a[[b]]c` or `#a #t b` as written, it writes a wikilink that misses the heading, while the autocomplete writes `[[H#a b]]`, which reaches it. Its markdown link misses `#a#b`, `#a%b`, `#a%%b%%c`, `#a:b`, `#a #t b` and `#a&amp;b` the same way. The API takes the subpath it is given, so this is the caller's to strip; recorded, not counted.
8. **A name with a no-break space is shadowed.** The vault makes a no-break space in a path a space, so `x` + no-break space + `y` `.md` is indexed as `x y.md`, the path another file on disk already holds, and no link of either format reaches the first. That is a vault surface rather than a link format, so it goes with the broad sweep of special names.

Everything else measured has parity: every other note name, heading and display text, and the block id, has a working form in each format, and both writers get it right.

## Where each one goes

| Finding | Verdict | Goes to |
| --- | --- | --- |
| 1. `[[` `]]` in a note name | documented | Nothing to report. The help already warns. |
| 2. Wikilink display text with `[[`, `]]` or edge spaces | defect, rule 1 | A new forum Bug reports topic, with the help's "equivalent" as its justification. No topic covers it. |
| 3. A note name starting with a space | defect, minor | A reply on the open feature request [t/21994](https://forum.obsidian.md/t/21994), which staff opened when they ruled leading and trailing spaces unsupported in [t/21983](https://forum.obsidian.md/t/21983). The reply adds that `[[folder/ x]]` reaches the note and that both writers miss it. |
| 4. `#` in a note name; `decodeURI` and reserved characters | documented; the encoding side is a docs gap | A "Fix documentation" issue on obsidian-help: the help could say which characters to encode, since `encodeURIComponent` output breaks names with `$ & + , ; = @`. |
| 5. Heading key collisions | defect, both rules | A new forum Bug reports topic. The old report, [t/40707](https://forum.obsidian.md/t/40707), is archived in the Bug graveyard: staff called it no bug because the autocomplete then wrote a link with the punctuation stripped, and pointed to the feature request [t/40724](https://forum.obsidian.md/t/40724). The autocomplete now writes the heading as it is, and its link lands on the first heading. |
| 6. Unescaped markdown links Obsidian writes | defect, rule 2 | A reply on [t/87327](https://forum.obsidian.md/t/87327), the topic on `generateMarkdownLink` round trips, which covers the alias only. The reply widens it to the name, the destination and the autocomplete. |
| 7. `generateMarkdownLink` with a raw heading subpath | API contract | Recorded here only. |
| 8. A no-break space in a name | vault surface | The sweep of special note names. |

No finding is a corpus case for the parser: it gives the cached link and display text of every one of the 998 notes already, and the gaps are in how the app resolves and writes links, not in how it parses them.

## The full table

`npm run link-parity`, on the pinned 1.14.5. A verdict is `parity` when each format has a working hand-written form, `wikilink-gap` or `markdown-gap` when only the other has one, `neither`, or `not-indexed` when the vault shows no file at the name's path. A writer's link is `ok`, `wrong-target` (no link, or a link that leads elsewhere) or `wrong-text`. In the table, `¦` stands for `|`, `⍽` for a no-break space, and `␣` for a space at the start or end of a code span.

### Note names

| Subject | Verdict | Wikilink forms that work | Markdown forms that work | Autocomplete, wikilink | Autocomplete, markdown | API, wikilink | API, markdown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `x[y` | parity | folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x[y]]` ok, shows `x[y` | `[x[y](x[y.md)` **wrong-text**, shows `y` | `[[x[y]]` ok, shows `x[y` | `[x[y](x[y.md)` **wrong-text**, shows `y` |
| `x]y` | parity | folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x]y]]` ok, shows `x]y` | `[x]y](x]y.md)` **wrong-target**, no link | `[[x]y]]` ok, shows `x]y` | `[x]y](x]y.md)` **wrong-target**, no link |
| `x[[y` | wikilink-gap (documented) | **none** | angle, entity, escaped, percent-encoded, plain | `[[x[[y]]` **wrong-target**, shows `y` | `[x[[y](x[[y.md)` **wrong-text**, shows `y` | `[[x[[y]]` **wrong-target**, shows `y` | `[x[[y](x[[y.md)` **wrong-text**, shows `y` |
| `x]]y` | wikilink-gap (documented) | **none** | angle, entity, escaped, percent-encoded, plain | `[[x]]y]]` **wrong-target**, shows `x` | `[x]]y](x]]y.md)` **wrong-target**, no link | `[[x]]y]]` **wrong-target**, shows `x` | `[x]]y](x]]y.md)` **wrong-target**, no link |
| `x[y]z` | parity | folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x[y]z]]` ok, shows `x[y]z` | `[x[y]z](x[y]z.md)` ok, shows `x[y]z` | `[[x[y]z]]` ok, shows `x[y]z` | `[x[y]z](x[y]z.md)` ok, shows `x[y]z` |
| `x#y` | neither (documented) | **none** | **none** | `[[link-parity/x#y¦x#y]]` **wrong-target**, shows `x#y` | `[x#y](link-parity/x#y.md)` **wrong-target**, shows `x#y` | `[[link-parity/x#y]]` **wrong-target**, shows `link-parity/x > y` | `[x#y](link-parity/x#y.md)` **wrong-target**, shows `x#y` |
| `#x` | neither (documented) | **none** | **none** | `[[link-parity/#x¦#x]]` **wrong-target**, shows `#x` | `[#x](link-parity/#x.md)` **wrong-target**, shows `` | `[[link-parity/#x]]` **wrong-target**, shows `link-parity/ > x` | `[#x](link-parity/#x.md)` **wrong-target**, shows `` |
| `x^y` | parity (documented) | folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x^y]]` ok, shows `x^y` | `[x^y](x^y.md)` ok, shows `x^y` | `[[x^y]]` ok, shows `x^y` | `[x^y](x^y.md)` ok, shows `x^y` |
| `^x` | parity (documented) | folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[^x]]` ok, shows `^x` | `[^x](^x.md)` **wrong-text**, shows `` | `[[^x]]` ok, shows `^x` | `[^x](^x.md)` **wrong-text**, shows `` |
| `x#^y` | neither (documented) | **none** | **none** | `[[link-parity/x#^y¦x#^y]]` **wrong-target**, shows `x#^y` | `[x#^y](link-parity/x#^y.md)` **wrong-target**, shows `x#^y` | `[[link-parity/x#^y]]` **wrong-target**, shows `link-parity/x > ^y` | `[x#^y](link-parity/x#^y.md)` **wrong-target**, shows `x#^y` |
| `x%y` | parity | folder-path, plain, with-extension | percent-encoded | `[[x%y]]` ok, shows `x%y` | `[x%y](x%y.md)` **wrong-target**, no link | `[[x%y]]` ok, shows `x%y` | `[x%y](x%y.md)` **wrong-target**, no link |
| `x%%y` | parity (documented) | folder-path, plain, with-extension | percent-encoded | `[[x%%y]]` ok, shows `x%%y` | `[x%%y](x%%y.md)` **wrong-target**, no link | `[[x%%y]]` ok, shows `x%%y` | `[x%%y](x%%y.md)` **wrong-target**, no link |
| `x%%y%%z` | parity (documented) | folder-path, plain, with-extension | percent-encoded | `[[x%%y%%z]]` ok, shows `x%%y%%z` | `[x%%y%%z](x%%y%%z.md)` **wrong-target**, no link | `[[x%%y%%z]]` ok, shows `x%%y%%z` | `[x%%y%%z](x%%y%%z.md)` **wrong-target**, no link |
| `x{y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x{y]]` ok, shows `x{y` | `[x{y](x{y.md)` ok, shows `x{y` | `[[x{y]]` ok, shows `x{y` | `[x{y](x{y.md)` ok, shows `x{y` |
| `x}y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x}y]]` ok, shows `x}y` | `[x}y](x}y.md)` ok, shows `x}y` | `[[x}y]]` ok, shows `x}y` | `[x}y](x}y.md)` ok, shows `x}y` |
| `x(y` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped | `[[x(y]]` ok, shows `x(y` | `[x(y](x(y.md)` **wrong-target**, no link | `[[x(y]]` ok, shows `x(y` | `[x(y](x(y.md)` **wrong-target**, no link |
| `x)y` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped | `[[x)y]]` ok, shows `x)y` | `[x)y](x)y.md)` **wrong-target**, shows `x)y` | `[[x)y]]` ok, shows `x)y` | `[x)y](x)y.md)` **wrong-target**, shows `x)y` |
| `x(y)z` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x(y)z]]` ok, shows `x(y)z` | `[x(y)z](x(y)z.md)` ok, shows `x(y)z` | `[[x(y)z]]` ok, shows `x(y)z` | `[x(y)z](x(y)z.md)` ok, shows `x(y)z` |
| `x!y` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x!y]]` ok, shows `x!y` | `[x!y](x!y.md)` ok, shows `x!y` | `[[x!y]]` ok, shows `x!y` | `[x!y](x!y.md)` ok, shows `x!y` |
| `!x` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[!x]]` ok, shows `!x` | `[!x](!x.md)` ok, shows `!x` | `[[!x]]` ok, shows `!x` | `[!x](!x.md)` ok, shows `!x` |
| `x$y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, plain | `[[x$y]]` ok, shows `x$y` | `[x$y](x$y.md)` ok, shows `x$y` | `[[x$y]]` ok, shows `x$y` | `[x$y](x$y.md)` ok, shows `x$y` |
| `x&y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, plain | `[[x&y]]` ok, shows `x&y` | `[x&y](x&y.md)` ok, shows `x&y` | `[[x&y]]` ok, shows `x&y` | `[x&y](x&y.md)` ok, shows `x&y` |
| `x'y` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x'y]]` ok, shows `x'y` | `[x'y](x'y.md)` ok, shows `x'y` | `[[x'y]]` ok, shows `x'y` | `[x'y](x'y.md)` ok, shows `x'y` |
| `x+y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, plain | `[[x+y]]` ok, shows `x+y` | `[x+y](x+y.md)` ok, shows `x+y` | `[[x+y]]` ok, shows `x+y` | `[x+y](x+y.md)` ok, shows `x+y` |
| `x,y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, plain | `[[x,y]]` ok, shows `x,y` | `[x,y](x,y.md)` ok, shows `x,y` | `[[x,y]]` ok, shows `x,y` | `[x,y](x,y.md)` ok, shows `x,y` |
| `x;y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, plain | `[[x;y]]` ok, shows `x;y` | `[x;y](x;y.md)` ok, shows `x;y` | `[[x;y]]` ok, shows `x;y` | `[x;y](x;y.md)` ok, shows `x;y` |
| `x=y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, plain | `[[x=y]]` ok, shows `x=y` | `[x=y](x=y.md)` ok, shows `x=y` | `[[x=y]]` ok, shows `x=y` | `[x=y](x=y.md)` ok, shows `x=y` |
| `x==y==z` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, plain | `[[x==y==z]]` ok, shows `x==y==z` | `[x==y==z](x==y==z.md)` **wrong-text**, shows `xyz` | `[[x==y==z]]` ok, shows `x==y==z` | `[x==y==z](x==y==z.md)` **wrong-text**, shows `xyz` |
| `x@y` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, plain | `[[x@y]]` ok, shows `x@y` | `[x@y](x@y.md)` ok, shows `x@y` | `[[x@y]]` ok, shows `x@y` | `[x@y](x@y.md)` ok, shows `x@y` |
| `` x`y `` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `` [[x`y]] `` ok, shows `` x`y `` | `` [x`y](x`y.md) `` ok, shows `` x`y `` | `` [[x`y]] `` ok, shows `` x`y `` | `` [x`y](x`y.md) `` ok, shows `` x`y `` |
| `x~y` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x~y]]` ok, shows `x~y` | `[x~y](x~y.md)` ok, shows `x~y` | `[[x~y]]` ok, shows `x~y` | `[x~y](x~y.md)` ok, shows `x~y` |
| `x~~y~~z` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x~~y~~z]]` ok, shows `x~~y~~z` | `[x~~y~~z](x~~y~~z.md)` **wrong-text**, shows `xyz` | `[[x~~y~~z]]` ok, shows `x~~y~~z` | `[x~~y~~z](x~~y~~z.md)` **wrong-text**, shows `xyz` |
| `x_y` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x_y]]` ok, shows `x_y` | `[x_y](x_y.md)` ok, shows `x_y` | `[[x_y]]` ok, shows `x_y` | `[x_y](x_y.md)` ok, shows `x_y` |
| `x y` | parity | escaped, folder-path, plain, with-extension | angle, entity, percent-encoded | `[[x y]]` ok, shows `x y` | `[x y](x%20y.md)` ok, shows `x y` | `[[x y]]` ok, shows `x y` | `[x y](x%20y.md)` ok, shows `x y` |
| `␣x` | markdown-gap | folder-path | **none** | `[[ x]]` **wrong-target**, shows `x` | `[ x](%20x.md)` **wrong-target**, shows `␣x` | `[[ x]]` **wrong-target**, shows `x` | `[ x](%20x.md)` **wrong-target**, shows `␣x` |
| `x  y` | parity | escaped, folder-path, plain, with-extension | angle, entity, percent-encoded | `[[x  y]]` ok, shows `x  y` | `[x  y](x%20%20y.md)` ok, shows `x  y` | `[[x  y]]` ok, shows `x  y` | `[x  y](x%20%20y.md)` ok, shows `x  y` |
| `x.md` | parity | escaped, folder-path, percent-encoded, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x.md]]` ok, shows `x.md` | `[x.md](x.md.md)` ok, shows `x.md` | `[[x.md]]` ok, shows `x.md` | `[x.md](x.md.md)` ok, shows `x.md` |
| `x&amp;y` | parity | escaped, folder-path, plain, with-extension | entity | `[[x&amp;y]]` ok, shows `x&amp;y` | `[x&amp;y](x&amp;y.md)` **wrong-target**, shows `x&y` | `[[x&amp;y]]` ok, shows `x&amp;y` | `[x&amp;y](x&amp;y.md)` **wrong-target**, shows `x&y` |
| `x&#35;y` | neither (documented) | **none** | **none** | `[[link-parity/x&#35;y¦x&#35;y]]` **wrong-target**, shows `x&#35;y` | `[x&#35;y](link-parity/x&#35;y.md)` **wrong-target**, shows `x#y` | `[[link-parity/x&#35;y]]` **wrong-target**, shows `link-parity/x& > 35;y` | `[x&#35;y](link-parity/x&#35;y.md)` **wrong-target**, shows `x#y` |
| `x%23y` | parity | folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[x%23y]]` ok, shows `x%23y` | `[x%23y](x%23y.md)` ok, shows `x%23y` | `[[x%23y]]` ok, shows `x%23y` | `[x%23y](x%23y.md)` ok, shows `x%23y` |
| `é` | parity | escaped, folder-path, plain, with-extension | angle, entity, escaped, percent-encoded, plain | `[[é]]` ok, shows `é` | `[é](é.md)` ok, shows `é` | `[[é]]` ok, shows `é` | `[é](é.md)` ok, shows `é` |
| `x⍽y` | not-indexed | **none** | **none** | not offered | not offered | not offered | not offered |

### Headings

| Subject | Verdict | Wikilink forms that work | Markdown forms that work | Autocomplete, wikilink | Autocomplete, markdown | API, wikilink | API, markdown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `a[b]c` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H0#a[b]c]]` ok, shows `H0 > a[b]c` | `[a[b]c](H0.md#a[b]c)` ok, shows `a[b]c` | `[[H0#a[b]c]]` ok, shows `H0 > a[b]c` | `[H0](H0.md#a[b]c)` ok, shows `H0` |
| `a[[b]]c` | parity (documented) | escaped, stripped | angle, entity, percent-encoded, stripped | `[[H1#a b c]]` ok, shows `H1 > a b c` | `[a[[b]]c](H1.md#a%20b%20c)` **wrong-target**, shows `a` | `[[H1#a[[b]]c]]` **wrong-target**, shows `b` | `[H1](H1.md#a[[b]]c)` ok, shows `H1` |
| `a]]b` | parity (documented) | escaped, stripped | angle, entity, percent-encoded, stripped | `[[H2#a b]]` ok, shows `H2 > a b` | `[a]]b](H2.md#a%20b)` **wrong-target**, no link | `[[H2#a]]b]]` **wrong-target**, shows `H2 > a` | `[H2](H2.md#a]]b)` ok, shows `H2` |
| `a]b` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H3#a]b]]` ok, shows `H3 > a]b` | `[a]b](H3.md#a]b)` **wrong-target**, no link | `[[H3#a]b]]` ok, shows `H3 > a]b` | `[H3](H3.md#a]b)` ok, shows `H3` |
| `a[b` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H4#a[b]]` ok, shows `H4 > a[b` | `[a[b](H4.md#a[b)` ok, shows `b` | `[[H4#a[b]]` ok, shows `H4 > a[b` | `[H4](H4.md#a[b)` ok, shows `H4` |
| `a¦b` | parity (documented) | stripped | angle, entity, percent-encoded, stripped | `[[H5#a b]]` ok, shows `H5 > a b` | `[a¦b](H5.md#a%20b)` ok, shows `a¦b` | `[[H5#a¦b]]` **wrong-target**, shows `b` | `[H5](H5.md#a¦b)` ok, shows `H5` |
| `a#b` | parity (documented) | stripped | stripped | `[[H6#a b]]` ok, shows `H6 > a b` | `[a#b](H6.md#a%20b)` ok, shows `a#b` | `[[H6#a#b]]` **wrong-target**, shows `H6 > a > b` | `[H6](H6.md#a#b)` **wrong-target**, shows `H6` |
| `a^b` | parity (documented) | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H7#a b]]` ok, shows `H7 > a b` | `[a^b](H7.md#a%20b)` ok, shows `a^b` | `[[H7#a^b]]` ok, shows `H7 > a^b` | `[H7](H7.md#a^b)` ok, shows `H7` |
| `a%b` | parity | escaped, plain, stripped | percent-encoded, stripped | `[[H8#a%b]]` ok, shows `H8 > a%b` | `[a%b](H8.md#a%b)` **wrong-target**, no link | `[[H8#a%b]]` ok, shows `H8 > a%b` | `[H8](H8.md#a%b)` **wrong-target**, no link |
| `a%%b%%c` | parity (documented) | escaped, plain, stripped | percent-encoded, stripped | `[[H9#a b c]]` ok, shows `H9 > a b c` | `[a%%b%%c](H9.md#a%20b%20c)` ok, shows `ac` | `[[H9#a%%b%%c]]` ok, shows `H9 > a%%b%%c` | `[H9](H9.md#a%%b%%c)` **wrong-target**, no link |
| `a:b` | parity (documented) | escaped, plain, stripped | stripped | `[[H10#a b]]` ok, shows `H10 > a b` | `[a:b](H10.md#a%20b)` ok, shows `a:b` | `[[H10#a:b]]` ok, shows `H10 > a:b` | `[H10](H10.md#a:b)` **wrong-target**, no link |
| `a\b` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H11#a b]]` ok, shows `H11 > a b` | `[a\b](H11.md#a%20b)` ok, shows `a\b` | `[[H11#a\b]]` ok, shows `H11 > a\b` | `[H11](H11.md#a%5Cb)` ok, shows `H11` |
| `` a`b`c `` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `` [[H12#a`b`c]] `` ok, shows `` H12 > a`b`c `` | `` [a`b`c](H12.md#a`b`c) `` ok, shows `abc` | `` [[H12#a`b`c]] `` ok, shows `` H12 > a`b`c `` | `` [H12](H12.md#a`b`c) `` ok, shows `H12` |
| `a*b*c` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H13#a*b*c]]` ok, shows `H13 > a*b*c` | `[a*b*c](H13.md#a*b*c)` ok, shows `abc` | `[[H13#a*b*c]]` ok, shows `H13 > a*b*c` | `[H13](H13.md#a*b*c)` ok, shows `H13` |
| `a  b` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H14#a b]]` ok, shows `H14 > a b` | `[a  b](H14.md#a%20b)` ok, shows `a  b` | `[[H14#a  b]]` ok, shows `H14 > a  b` | `[H14](H14.md#a%20%20b)` ok, shows `H14` |
| `a.b` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H15#a.b]]` ok, shows `H15 > a.b` | `[a.b](H15.md#a.b)` ok, shows `a.b` | `[[H15#a.b]]` ok, shows `H15 > a.b` | `[H15](H15.md#a.b)` ok, shows `H15` |
| `a/b` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H16#a/b]]` ok, shows `H16 > a/b` | `[a/b](H16.md#a/b)` ok, shows `a/b` | `[[H16#a/b]]` ok, shows `H16 > a/b` | `[H16](H16.md#a/b)` ok, shows `H16` |
| `a #t b` | parity (documented) | stripped | stripped | `[[H17#a t b]]` ok, shows `H17 > a t b` | `[a #t b](H17.md#a%20t%20b)` ok, shows `a␣` | `[[H17#a #t b]]` **wrong-target**, shows `H17 > a  > t b` | `[H17](H17.md#a%20#t%20b)` **wrong-target**, shows `H17` |
| `a&amp;b` | parity | escaped, plain, stripped | entity | `[[H18#a&amp;b]]` ok, shows `H18 > a&amp;b` | `[a&amp;b](H18.md#a&amp;b)` **wrong-target**, shows `a&b` | `[[H18#a&amp;b]]` ok, shows `H18 > a&amp;b` | `[H18](H18.md#a&amp;b)` **wrong-target**, shows `H18` |
| `a (b) c` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H19#a (b) c]]` ok, shows `H19 > a (b) c` | `[a (b) c](H19.md#a%20(b)%20c)` ok, shows `a (b) c` | `[[H19#a (b) c]]` ok, shows `H19 > a (b) c` | `[H19](H19.md#a%20(b)%20c)` ok, shows `H19` |
| `a<b>c` | parity | escaped, plain, stripped | percent-encoded, stripped | `[[H20#a<b>c]]` ok, shows `H20 > a<b>c` | `[a<b>c](H20.md#a<b>c)` ok, shows `ac` | `[[H20#a<b>c]]` ok, shows `H20 > a<b>c` | `[H20](H20.md#a<b>c)` ok, shows `H20` |
| `a==b==c` | parity | escaped, plain, stripped | angle, entity | `[[H21#a==b==c]]` ok, shows `H21 > a==b==c` | `[a==b==c](H21.md#a==b==c)` ok, shows `abc` | `[[H21#a==b==c]]` ok, shows `H21 > a==b==c` | `[H21](H21.md#a==b==c)` ok, shows `H21` |
| `a~~b~~c` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H22#a~~b~~c]]` ok, shows `H22 > a~~b~~c` | `[a~~b~~c](H22.md#a~~b~~c)` ok, shows `abc` | `[[H22#a~~b~~c]]` ok, shows `H22 > a~~b~~c` | `[H22](H22.md#a~~b~~c)` ok, shows `H22` |
| `[[t]] x` | parity (documented) | escaped, stripped | angle, entity, percent-encoded, stripped | `[[H23#t x]]` ok, shows `H23 > t x` | `[[[t]] x](H23.md#t%20x)` **wrong-target**, shows `[t` | `[[H23#[[t]] x]]` **wrong-target**, shows `t` | `[H23](H23.md#[[t]]%20x)` ok, shows `H23` |
| `[l](t.md) x` | parity | escaped, plain, stripped | angle, entity, percent-encoded, stripped | `[[H24#[l](t.md) x]]` ok, shows `H24 > [l](t.md) x` | `[[l](t.md) x](H24.md#[l](t.md)%20x)` ok, shows `[l](t.md) x` | `[[H24#[l](t.md) x]]` ok, shows `H24 > [l](t.md) x` | `[H24](H24.md#[l](t.md)%20x)` ok, shows `H24` |
| `a $x$ b` | parity | escaped, plain, stripped | angle, entity | `[[H25#a $x$ b]]` ok, shows `H25 > a $x$ b` | `[a $x$ b](H25.md#a%20$x$%20b)` ok, shows `a 𝑥 b` | `[[H25#a $x$ b]]` ok, shows `H25 > a $x$ b` | `[H25](H25.md#a%20$x$%20b)` ok, shows `H25` |

### Display texts

| Subject | Verdict | Wikilink forms that work | Markdown forms that work | Autocomplete, wikilink | Autocomplete, markdown | API, wikilink | API, markdown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `a]b` | parity | in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a]b]]` ok, shows `a]b` | `[a]b](t.md)` **wrong-target**, no link |
| `a]]b` | wikilink-gap | **none** | escaped, escaped-in-table | - | - | `[[t¦a]]b]]` **wrong-text**, shows `a` | `[a]]b](t.md)` **wrong-target**, no link |
| `a[b` | parity | in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a[b]]` ok, shows `a[b` | `[a[b](t.md)` **wrong-text**, shows `b` |
| `a[[b` | wikilink-gap | **none** | escaped, escaped-in-table | - | - | `[[t¦a[[b]]` **wrong-target**, shows `b` | `[a[[b](t.md)` **wrong-text**, shows `b` |
| `a[b]c` | parity | in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a[b]c]]` ok, shows `a[b]c` | `[a[b]c](t.md)` ok, shows `a[b]c` |
| `a¦b` | parity | plain | escaped | - | - | `[[t¦a¦b]]` ok, shows `a¦b` | `[a¦b](t.md)` ok, shows `a¦b` |
| `a\b` | parity | in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a\b]]` ok, shows `a\b` | `[a\b](t.md)` ok, shows `a\b` |
| `a#b` | parity | in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a#b]]` ok, shows `a#b` | `[a#b](t.md)` ok, shows `a#b` |
| `a^b` | parity | in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a^b]]` ok, shows `a^b` | `[a^b](t.md)` ok, shows `a^b` |
| `a%%b%%c` | parity | in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a%%b%%c]]` ok, shows `a%%b%%c` | `[a%%b%%c](t.md)` **wrong-text**, shows `ac` |
| `a*b*` | parity | escaped, in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a*b*]]` ok, shows `a*b*` | `[a*b*](t.md)` **wrong-text**, shows `ab` |
| `` a`b` `` | parity | escaped, in-table, plain | escaped, escaped-in-table | - | - | `` [[t¦a`b`]] `` ok, shows `` a`b` `` | `` [a`b`](t.md) `` **wrong-text**, shows `ab` |
| `␣␣a` | wikilink-gap | **none** | escaped, escaped-in-table | - | - | `[[t¦  a]]` **wrong-text**, shows `a` | `[  a](t.md)` ok, shows `␣␣a` |
| `a␣␣` | wikilink-gap | **none** | escaped, escaped-in-table | - | - | `[[t¦a  ]]` **wrong-text**, shows `a` | `[a  ](t.md)` ok, shows `a␣␣` |
| `a&amp;b` | parity | escaped, in-table, plain | escaped, escaped-in-table | - | - | `[[t¦a&amp;b]]` ok, shows `a&amp;b` | `[a&amp;b](t.md)` **wrong-text**, shows `a&b` |
| `[[t]]` | wikilink-gap | **none** | escaped, escaped-in-table | - | - | `[[t¦[[t]]]]` **wrong-text**, shows `t` | `[[[t]]](t.md)` **wrong-target**, shows `[t` |
| `a\¦b` | parity | plain | escaped | - | - | `[[t¦a\¦b]]` ok, shows `a\¦b` | `[a\¦b](t.md)` **wrong-text**, shows `a¦b` |

### Block ids

| Subject | Verdict | Wikilink forms that work | Markdown forms that work | Autocomplete, wikilink | Autocomplete, markdown | API, wikilink | API, markdown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `blk-1` | parity | plain | percent-encoded, plain | - | - | `[[B#^blk-1]]` ok, shows `B > ^blk-1` | `[B](B.md#^blk-1)` ok, shows `B` |

### Heading collisions

| First heading | Second heading | The second's own text reaches | Autocomplete writes for the second | It reaches |
| --- | --- | --- | --- | --- |
| `a b` | `a!b` | **the first** | `[[C0#a!b]]` | **the first** |
| `a b` | `a"b` | **the first** | `[[C1#a"b]]` | **the first** |
| `a b` | `a#b` | **none** | `[[C2#a b]]` | **the first** |
| `a b` | `a$b` | **the first** | `[[C3#a$b]]` | **the first** |
| `a b` | `a%b` | **the first** | `[[C4#a%b]]` | **the first** |
| `a b` | `a&b` | **the first** | `[[C5#a&b]]` | **the first** |
| `a b` | `a'b` | the second | `[[C6#a'b]]` | the second |
| `a b` | `a(b` | **the first** | `[[C7#a(b]]` | **the first** |
| `a b` | `a)b` | **the first** | `[[C8#a)b]]` | **the first** |
| `a b` | `a*b` | **the first** | `[[C9#a*b]]` | **the first** |
| `a b` | `a+b` | **the first** | `[[C10#a+b]]` | **the first** |
| `a b` | `a,b` | **the first** | `[[C11#a,b]]` | **the first** |
| `a b` | `a-b` | the second | `[[C12#a-b]]` | the second |
| `a b` | `a.b` | **the first** | `[[C13#a.b]]` | **the first** |
| `a b` | `a/b` | **the first** | `[[C14#a/b]]` | **the first** |
| `a b` | `a:b` | **the first** | `[[C15#a b]]` | **the first** |
| `a b` | `a;b` | **the first** | `[[C16#a;b]]` | **the first** |
| `a b` | `a<b` | **the first** | `[[C17#a<b]]` | **the first** |
| `a b` | `a=b` | **the first** | `[[C18#a=b]]` | **the first** |
| `a b` | `a>b` | **the first** | `[[C19#a>b]]` | **the first** |
| `a b` | `a?b` | **the first** | `[[C20#a?b]]` | **the first** |
| `a b` | `a@b` | **the first** | `[[C21#a@b]]` | **the first** |
| `a b` | `a[b` | **the first** | `[[C22#a[b]]` | **the first** |
| `a b` | `a\b` | **the first** | `[[C23#a b]]` | **the first** |
| `a b` | `a]b` | **the first** | `[[C24#a]b]]` | **the first** |
| `a b` | `a^b` | **the first** | `[[C25#a b]]` | **the first** |
| `a b` | `a_b` | the second | `[[C26#a_b]]` | the second |
| `a b` | `` a`b `` | **the first** | `` [[C27#a`b]] `` | **the first** |
| `a b` | `a{b` | **the first** | `[[C28#a{b]]` | **the first** |
| `a b` | `a¦b` | **the first** | `[[C29#a b]]` | **the first** |
| `a b` | `a}b` | **the first** | `[[C30#a}b]]` | **the first** |
| `a b` | `a~b` | **the first** | `[[C31#a~b]]` | **the first** |
| `ab` | `AB` | **the first** | `[[C32#AB]]` | **the first** |
| `a b` | `a  b` | **the first** | `[[C33#a b]]` | **the first** |
| `a b` | `a⍽b` | **the first** | `[[C34#a b]]` | **the first** |
| `ab` | `ab␣` | **the first** | `[[C35#ab]]` | **the first** |
| `a b` | `a b` | **the first** | `[[C36#a b]]` | **the first** |
