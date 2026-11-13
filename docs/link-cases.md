# Link cases: where a link leads in the vault shapes the forum reports name

The owner's forum reports name link behaviour that shows only in a live vault, in shapes no other oracle builds: a note name shared by a root note and a note in a folder, a renamed note whose name has spaces, a file with no extension, the links `generateMarkdownLink` writes to those and to an attachment, and a note composer merge across folders. The parse of every one of these links is right: the worker caches the link the note holds, and `parseMetadata` agrees. What goes wrong is where the link leads. This page measures that on a live Obsidian, case by case, and says which rule each failure breaks. The links a user writes by hand to special names and headings are in [`link-parity.md`](link-parity.md), and the vault surfaces of special names in [`special-names.md`](special-names.md).

## The rules

1. **A wikilink names one note across the vault.** From `F/B.md`, `[[A]]` goes to the root `A.md`, not `F/A.md`. Staff closed t/69542 as intentional: "We want `[[A]]` to point to the same note across the vault". So that link is marked *expected*.
2. **A markdown link's destination is a URL.** CommonMark calls it a link destination, and a relative URL is resolved against the document it is in ([RFC 3986, section 5](https://www.rfc-editor.org/rfc/rfc3986#section-5)). Every other markdown editor does this, and the owner's post names VS Code and Typora. So `[x](A.md)` in `F/B.md` names `F/A.md`, and a link that goes elsewhere is a defect. The staff reply on t/69542 defends the wikilink only. This is not a parity defect in [`link-parity.md`](link-parity.md)'s sense: the two formats agree with each other here, and both go to the root note. It is the markdown link that disagrees with every other reader of the same file, which is the case of the open request t/69560 for a link resolution setting.
3. **A file the vault shows is reachable by a link to its name.** The vault indexes a file with no extension and the file explorer lists it, so a link to it should reach it.
4. **Round trip.** A link Obsidian writes itself, by `generateMarkdownLink`, by a rename's link update or by a merge, reaches the file it was written for. `generateMarkdownLink` also writes no leading `!` unless an embed was asked for (1.10.0's changelog, t/106790) and no `undefined` display text (t/86606).

## How it is measured

```sh
npx jiti scripts/links/link-cases-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]
npm run link-cases
```

`scripts/links/link-cases-oracle.ts` writes the files of each case of `src/oracle/links/link-cases.ts` into the empty vault of an owned Obsidian, through the vault, with link updates on and the `shortest` link format. Then each case acts. One renames a file through `fileManager.renameFile`. One merges a note into another with note composer's `mergeFile`, as its *Merge current file with another file* command does. The generator cases ask `generateMarkdownLink` for a link with `Use [[Wikilinks]]` on and then off, and write both links into the case's note. Last, the oracle reads the note's text and every link and embed its cache holds, with the file the app's own `getFirstLinkpathDest` sends each one to, which is what clicking the link opens. `npm run link-cases` prints the table below.

The oracle is pinned to 1.15.1 (`oracle/link-cases-obsidian-1.15.1.json`). The 1.15.0 insider build, read on 2026-10-25, gives every read the same. `src/oracle/links/link-cases.test.ts` pins every verdict, and checks that `parseMetadata` gives the cached links of every case's note.

## What was found

| Case | Link | What it does | Status |
| --- | --- | --- | --- |
| [folder-root-collision](https://forum.obsidian.md/t/69542) | `[[A]]` | leads to A.md | expected |
| [folder-root-collision](https://forum.obsidian.md/t/69542) | `[x](A.md)` | leads to A.md | **fails** |
| [folder-root-collision](https://forum.obsidian.md/t/69542) | `[x](./A.md)` | leads to link-cases/F/A.md | ok |
| [folder-root-collision](https://forum.obsidian.md/t/69542) | `[x](/A.md)` | leads to A.md | ok |
| [folder-root-collision-generated](https://forum.obsidian.md/t/69542) | `[[link-cases/F/A]]` | leads to link-cases/F/A.md | ok |
| [folder-root-collision-generated](https://forum.obsidian.md/t/69542) | `[A](link-cases/F/A.md)` | leads to link-cases/F/A.md | ok |
| [spaced-name-rename](https://forum.obsidian.md/t/85598) | `[x](<c d.md>)` | leads to link-cases/spaced/c d.md | ok |
| [spaced-name-rename](https://forum.obsidian.md/t/85598) | `[y](<c d.md>)` | leads to link-cases/spaced/c d.md | ok |
| [spaced-name-rename](https://forum.obsidian.md/t/85598) | `[z](c%20d.md)` | leads to link-cases/spaced/c d.md | ok |
| [spaced-name-rename](https://forum.obsidian.md/t/85598) | `[[c d]]` | leads to link-cases/spaced/c d.md | ok |
| [extensionless](https://forum.obsidian.md/t/90389) | `[[file]]` | leads nowhere | **fails** |
| [extensionless](https://forum.obsidian.md/t/90389) | `[x](file)` | leads nowhere | **fails** |
| [extensionless](https://forum.obsidian.md/t/90389) | `![[file]]` | leads nowhere | **fails** |
| [extensionless](https://forum.obsidian.md/t/90389) | `[[link-cases/extensionless/file]]` | leads nowhere | **fails** |
| [extensionless-generated](https://forum.obsidian.md/t/90389) | `[[link-cases/extensionless/file]]` | leads nowhere | **fails** |
| [extensionless-generated](https://forum.obsidian.md/t/90389) | `[](link-cases/extensionless/file)` | leads nowhere | **fails** |
| [attachment-generated](https://forum.obsidian.md/t/106790) | `[[pic.png]]` | leads to link-cases/attachment/pic.png | ok |
| [attachment-generated](https://forum.obsidian.md/t/106790) | `[](pic.png)` | leads to link-cases/attachment/pic.png | ok |
| [merge-relative-links](https://forum.obsidian.md/t/64899) | `![](../assets/i.png)` | leads nowhere | **fails** |
| [merge-relative-links](https://forum.obsidian.md/t/64899) | `![](./j.png)` | leads nowhere | **fails** |
| [merge-relative-links](https://forum.obsidian.md/t/64899) | `![[i.png]]` | leads to link-cases/merge/assets/i.png | ok |
| [merge-relative-links](https://forum.obsidian.md/t/64899) | `[[../assets/i.png]]` | leads nowhere | **fails** |

The printed table also lists each link `generateMarkdownLink` wrote, checked for a leading `!` and an `undefined`. All six are clean.

1. **A folder/root name collision.** From `link-cases/F/B.md`, `[[A]]` and `[x](A.md)` both go to the root `A.md`, and only `[x](./A.md)` reaches the note beside it. The wikilink is *expected* by rule 1. The markdown link is a **defect by rule 2**: the reader of the same file in any other editor opens `F/A.md`. The generator bug the same staff reply admitted, `[A](A.md)` written for `F/A.md`, is fixed: in both formats `generateMarkdownLink` now writes the full path, which reaches `F/A.md`.
2. **A spaced name renamed.** Renaming `a b.md` to `c d.md` rewrites `[x](<./a b.md>)` to `[x](<c d.md>)`, a destination still in angle brackets, which reaches the renamed note. So t/85598 is fixed, as staff said. The rewrite drops the `./`, but the link still resolves. The other forms, `<a b.md>`, `a%20b.md` and `[[a b]]`, are rewritten the same way and resolve too.
3. **A file with no extension.** The vault indexes `link-cases/extensionless/file`, but no link reaches it: not `[[file]]`, `[x](file)` or `![[file]]`, and not the full path either, which fits a link path with no extension being looked up as a `.md` note. Even the links `generateMarkdownLink` writes for it miss it. That is a **defect by rules 3 and 4**, and t/90389 is still open with no reply.
4. **An attachment's generated link.** `generateMarkdownLink` writes `[[pic.png]]` with wikilinks on and `[](pic.png)` with them off. Neither has a leading `!` and neither shows `undefined`, so t/106790 and t/86606 are both fixed. The markdown link has empty display text, which Reading view shows as nothing. Callers such as drag and drop add the `!` that makes it an embed, and an embed needs no text. So this is recorded and not counted.
5. **A note composer merge across folders.** Merging `link-cases/merge/src/S.md` into `link-cases/merge/dst/deep/D.md` appends the text of `S` unchanged and trashes `S`. Its relative links `![](../assets/i.png)` and `![](./j.png)`, and the relative wikilink `[[../assets/i.png]]`, are now resolved against `D`'s folder and lead nowhere. Only the name-only `![[i.png]]` survives. The merge's link update re-points the links *to* the merged note only. It does not rewrite the links the moved text holds, which `extractSection`, the split's counterpart, does through `rewriteLinksForDestination`. That is a **defect by rule 4**, and t/64899 is still open.

## Where each one goes

| Finding | Verdict | Goes to |
| --- | --- | --- |
| 1. Markdown link to a name a root note shares | defect, rule 2 | The open request t/69560 already makes the case. A reply there can add these measurements, and say that the generator half of t/69542 is fixed. |
| 1. Wikilink to the same | expected | Nothing to report. |
| 2. Spaced name rename | fixed | Nothing to report. |
| 3. Extensionless file | defect, rules 3 and 4 | A reply on t/90389 with the measurement, including that `generateMarkdownLink`'s own links miss the file. |
| 4. Attachment's generated link | fixed | Nothing to report. |
| 5. Merge with relative links | defect, rule 4 | A reply on t/64899 confirming it on 1.14.5 and 1.15.0, naming the split's rewrite as the behaviour to match. |
