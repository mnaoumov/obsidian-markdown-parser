# Special note names: what each vault surface does with them

Obsidian warns about some characters when you name a note, and refuses others, but a file can reach the vault from a file manager, sync or git with any name its file system allows, and Obsidian indexes it. This page measures what every vault surface does with such a note, on a live Obsidian, and says where each failure goes. The links a user can write by hand to such names are measured in [`link-parity.md`](link-parity.md); this page covers everything else, and the links Obsidian writes itself.

## What the current build warns about and refuses

Typed into the file explorer's rename on Obsidian 1.14.5 for Windows:

| Typed | Saved | Message |
| --- | --- | --- |
| `r#s`, `r^s`, `r[s`, `r]s` | yes | Links will not work with file names containing any of these characters: # ^ [ ] \| |
| `r%s` | yes | - |
| `r\|s`, `r:s`, `r*s` | no | File name cannot contain any of these characters: * " \ / < > : \| ? |
| `.rs` | no | File name must not start with a dot. |

So `# ^ [ ] |` are a **warning**, not a refusal: the rename shows it while you type and saves the name anyway. `|` is refused only because it is in the platform's set. The app's own checks, read in its `app.js` ([`provenance.md`](provenance.md)), say the same and add what this machine cannot show: off Windows the refused set is `\ / :`, on Android also `* ? < > "`, and on Windows a name may not end in a dot or a space or be a reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`). `app.vault.create` applies only the refusal, not the warning.

## The rules

1. **A file in the vault is a note.** Every file the vault holds, by any name its file system allows, is indexed, listed in the file explorer, opened, offered by the quick switcher and found by search. A file no surface shows is a defect.
2. **Round trip.** Every link Obsidian writes itself reaches the note it was written for: the wikilink `generateMarkdownLink` writes (and so the autocomplete, drag and drop, which uses it, and a properties link holding it), the links a rename or move rewrites, and the URL "Copy Obsidian URL" writes.
3. **Where the help states a rule, the help comes first.** Its *Invalid characters* note says "A string which contains the following characters may not work as a link: `# | ^ : %% [[ ]]`", and its *Obsidian URI* page says the `open` action's `file` is read like a link, with `%23` opening a heading. So a failure that goes through a link, for a name holding one of those, is marked *documented*. A name starting with a dot is *documented* too: Obsidian refuses to create one and does not index one, by design.

## How it is measured

```sh
npx jiti scripts/special-names-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]
npm run special-names [-- --details]
```

`scripts/special-names-oracle.ts` writes 27 note names (`src/oracle/special-names.ts`) straight onto the disk of an owned Obsidian's vault, never through the app, each holding a word unique to it. For each name it asks `generateMarkdownLink` for the wikilink from a linker note in another folder, and writes the linker on disk with that link as body link, as an embed and as a properties link. It then reads, per name:

| Surface | What is read |
| --- | --- |
| indexed | the vault note whose file on disk is this name's, and that the vault reads this file's text through it |
| explorer | the title the file explorer shows |
| open | the note a new leaf opens, with its text in the editor |
| switcher | whether the quick switcher offers the note for the name, typed composed (NFC) |
| search | whether a global search for the note's word finds it |
| link | whether the linker's body link leads to the note, by `parseLinktext` and `getFirstLinkpathDest` |
| backlinks | whether `getBacklinksForFile` lists the linker |
| graph | whether the graph view has the note as a node, and an edge from the linker |
| embed | whether the embed, rendered as Reading view renders it, shows the note's text |
| property | whether the properties link leads to the note |
| uri | the note `obsidian://open` opens for the URL "Copy Obsidian URL" writes |
| rename | whether the linker still leads to the note after `fileManager.renameFile` to a plain name, and after renaming it back |
| move | the same for a move into another folder, keeping the name |
| rename-onto | whether a plainly named note's linker leads to it after it is renamed onto the special name |

It also types the names above into the file explorer's rename, and, for each pair of files the vault indexes under one path, edits the one note through the vault and reads both files from disk. The oracle is pinned to 1.14.5 (`oracle/special-names-obsidian-1.14.5.json`); the 1.15.0 insider build, read on 2026-10-25, gives the same verdict on every name and surface. `src/oracle/special-names.test.ts` pins the verdicts, the shadowing writes and the rename checks.

Only names Windows can store were tried here. `| : * ? " < > \` and a trailing dot or space were swept on Android, in [On Android](#on-android).

## What was found

1. **`# ^ [ ]` are warned about, not refused.** A note named with them is created by any rename, so these names are not only ones that arrive from outside.
2. **A note named with `^`, `[`, `]`, `%`, `%%`, a percent-encoded sequence (`%20`, `%23`, `%2F`), a dot inside, or a run of spaces works on every surface**, including every link Obsidian writes and every rename. `x[[y` and `x]]y` work too, except the body link and the embed: the help documents it, and the same link as a properties link does reach the note.
3. **A note with `#` in its name works on the file surfaces and fails on every link surface,** the URI included: `[[folder/x#y]]` is read as the heading `y` of the note `x`. Documented. One case is worth knowing: for a note `m#n` beside a note `m` with a heading `n`, the URL "Copy Obsidian URL" writes for `m#n` opens `m` instead, with no message, since `file=folder%2Fm%23n` is the documented way to write a link to that heading.
4. **A note whose name starts with a space is reached by no link Obsidian writes from another folder.** `generateMarkdownLink` writes `[[ x]]`, which misses it, so it has no backlink, no graph edge, no embed and no resolving properties link, and a rename or a move leaves its linker unresolved. A rename onto that name writes `[[folder/ x]]`, which works. This is finding 3 of [`link-parity.md`](link-parity.md), measured on the other surfaces. A **defect by rule 2**, minor.
5. **Two files whose names differ only by Unicode normalization (NFC and NFD) or by a no-break space where the other has a space are one note.** The vault indexes a path composed and with every no-break space made a space, so `café.md` and `cafe` + U+0301 `.md`, or `x y.md` and `x` + U+00A0 + `y.md`, map to one path. It keeps the file it saw last: no surface shows the other one at all, no link of either spelling reaches it, a rename onto its name is refused as "Destination file already exists!", and an edit of the shared note is written to the kept file only. A no-break space or a decomposed character alone, with no partner, works on every surface. A **defect by rule 1**: a file in the vault that nothing shows, while the explorer gives no hint that there are two.

## Where each one goes

| Finding | Verdict | Goes to |
| --- | --- | --- |
| 1. `# ^ [ ]` only warned about | by design | Nothing to report. |
| 2. Names that work | - | Nothing to report. |
| 3. `#` in a name, and the `m#n` URL | documented | Nothing to report; the help covers both halves. |
| 4. A name starting with a space | defect, rule 2 | The forum report on it from [`link-parity.md`](link-parity.md), with the surfaces measured here. |
| 5. NFC/NFD and no-break space shadowing | defect, rule 1 | The NFC/NFD half is already reported on the forum, in [NFD-NFC Normalization Issues with Wiki Links in Obsidian](https://forum.obsidian.md/t/nfd-nfc-normalization-issues-with-wiki-links-in-obsidian/95629), which "Incorrect handling not NFC-normalized file names" was merged into. The no-break space half goes there as a reply. |

No finding is a corpus case for the parser: the parser reads a note's text, and every failure here is in how the app indexes, resolves or writes paths.

## On Android

```sh
emulator -avd obsidian_test -read-only -no-window -no-snapshot-load -no-snapshot-save
adb install -r Obsidian-1.14.4.apk
adb shell monkey -p md.obsidian 1
npx jiti scripts/special-names-oracle.ts --android [--serial <serial>]
npm run special-names -- --android [--details]
```

`--android` reads the same surfaces in Obsidian for Android, for 39 names: the desktop's 27, at the same indices, and 12 that Windows cannot store (`DEVICE_SPECIAL_NAMES`): `x|y`, `x:y`, `x*y`, `x?y`, `x"y`, `x<y`, `x>y`, `x\y`, the notes `x.` and `x␣` (the files `x..md` and `x .md`), and a note `y` in each of the folders `x.` and `x␣`. `scripts/android-vault.ts` opens a fresh vault in the app's own storage, `/sdcard/Android/data/md.obsidian/files/special-names-oracle`, the folder the app lists its app storage vaults from. It writes and reads the vault's files over `adb shell`, never through the app, and calls into the app over its WebView's DevTools protocol. The explorer's rename gets the desktop's typed names and `r?s`, `r"s`, `r<s`, `r>s`, `r\s`, `rs.` and `rs␣`. The oracle was read on 2026-10-26 from Obsidian 1.14.4, the newest with an APK (1.14.5 shipped for desktop only), on an Android 17 emulator booted read-only, so that nothing it did stayed on the device. It is in `oracle/special-names-android-obsidian-1.14.4.json`, and the Android half of `src/oracle/special-names.test.ts` pins it.

Where the vault lives matters. Checked with `adb shell` before the sweep:

- **Shared storage refuses the names.** In `/sdcard/Documents`, creating a file whose name holds `| : * ? " < > \` fails with `Operation not permitted`, so in a vault there such a file cannot arrive by any means. A trailing dot or space is stored.
- **App storage takes every name, but folds them.** `Ab.md` and `ab.md` are one file there, and so are `café.md` composed and decomposed. The vault adapter still reports the vault as case sensitive (`adapter.insensitive` is `false`). That loses nothing in the one case tried: `vault.create('case.md')` beside `Case.md` is refused as "File already exists.".

What was found on Android, beyond the desktop's findings above, which all hold there too except where a finding below says otherwise:

1. **Android refuses `\ : * ? " < >` in a rename and saves `| # ^ [ ]`, a trailing dot and a trailing space.** This is the set read from the bundle, and a leading dot is refused as on the desktop. The oracle found no tooltip and no notice for any typed name, the warned ones included, where the desktop shows its warning as a tooltip.
2. **A note named with `: * ? " < >` that arrived anyway works on every surface, and a rename of it is one way.** The file surfaces, every link Obsidian writes, the properties link and the URI all reach it. The link to `x:y` resolves even though the help's *Invalid characters* note names `:`. A rename to a plain name works. Renaming it back, moving it into another folder under its own name, and renaming another note onto its name are each refused with "File name cannot contain any of the following characters: \ / : * ? < > \"". The refusal is the app's own message, so it is by design, and these surfaces are marked *documented*.
3. **`x|y` works on the file surfaces and the URI, and fails on its links.** Android has no `|` in its refused set, so it is stored and renamed freely. Its link failures are documented, since `|` is in the help's note.
4. **A note named with `\` is not in the vault at all.** The file is on disk, but the vault never lists it, even in `adapter.files`, so no surface shows it. Renaming another note onto `x\y` is refused with "The parent object of the destination does not exist". A **defect by rule 1**: a file that a sync or a file manager brings in with a backslash disappears.
5. **A name ending in a space fails like one starting with a space (the desktop's finding 4), and worse.** `generateMarkdownLink` writes `[[x ]]`, which misses it, so it has no backlink, no graph edge, no embed and no resolving properties link, and a rename or a move leaves its linker unresolved. Unlike a leading space, a rename onto the name writes `[[special-names/onto/x ]]`, which does not resolve either. Windows stores `x .md` too, so the desktop may well do the same, but this was not measured there. A **defect by rule 2**.
6. **The quick switcher does not offer a name starting with a space on Android.** The desktop offers it. Minor.
7. **A note ending in a dot works on every surface, and so does a note in a folder ending in a dot or a space.**
8. **The composed and decomposed `café` are one file in app storage, so their rows measure the file system, not the app.** The file is stored under the name written first, the decomposed one, and holds the text written last. `café` therefore reads as not indexed, `cafe◌́` as reading another name's text, and an edit through the vault reaches both names. The no-break space pair is two files, and it shadows as on the desktop (the desktop's finding 5).

| Finding | Verdict | Goes to |
| --- | --- | --- |
| 1. The rename's refused set | by design | Nothing to report. |
| 2. `: * ? " < >` renames one way | by design | Nothing to report. |
| 3. `x\|y` | documented | Nothing to report. |
| 4. `\` invisible | defect, rule 1 | A forum report, drafted with 5 and 6. |
| 5. A trailing space | defect, rule 2 | With the desktop's finding 4's forum report. |
| 6. Switcher and a leading space | defect, rule 1, minor | With the desktop's finding 4's forum report. |
| 7. Trailing dots and spaces in folders | - | Nothing to report. |
| 8. Folding in app storage | file system | Nothing to report on its own. It matters to a vault synced from a case-sensitive system, which is where the Sync question goes. |

## The full table

`npm run special-names`, on the pinned 1.14.5. `ok` works, `doc` fails where the help documents it, **fails** fails where it does not. In the table, `␣` stands for a space at the start or end of a code span, `⍽` for a no-break space, and `◌` for the base of a combining mark.

| Name | indexed | explorer | open | switcher | search | link | backlinks | graph | embed | property | uri | rename | move | rename-onto |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `plain` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x#y` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `#x` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `x^y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `^x` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x[y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x]y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x[y]z` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x[[y` | ok | ok | ok | ok | ok | doc | ok | ok | doc | ok | ok | ok | ok | doc |
| `x]]y` | ok | ok | ok | ok | ok | doc | ok | ok | doc | ok | ok | ok | ok | doc |
| `x#^y` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `m#n` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `x%%y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x%y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x%20y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x%23y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x%2Fy` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `.x` | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `x.y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `␣x` | ok | ok | ok | ok | ok | **fails** | **fails** | **fails** | **fails** | **fails** | ok | **fails** | **fails** | ok |
| `x  y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x⍽y` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** |
| `p⍽q` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `café` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `cafe◌́` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** |
| `nai◌̈ve` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |

Every surface that is not `ok`, with what it did:

| Name | Surface | Status | What it did |
| --- | --- | --- | --- |
| `x#y` | link | documented | `[[special-names/x#y]] does not resolve` |
| `x#y` | backlinks | documented | `no backlink` |
| `x#y` | graph | documented | `node, no edge` |
| `x#y` | embed | documented | `does not show the note` |
| `x#y` | property | documented | `does not resolve` |
| `x#y` | uri | documented | `opens nothing` |
| `x#y` | rename | documented | `[[special-names/x#y]] does not resolve; back, [[special-names/x#y]] does not resolve` |
| `x#y` | move | documented | `[[special-names/x#y]] does not resolve; back, [[special-names/x#y]] does not resolve` |
| `x#y` | rename-onto | documented | `[[special-names/onto/x#y]] does not resolve` |
| `#x` | link | documented | `[[special-names/#x]] does not resolve` |
| `#x` | backlinks | documented | `no backlink` |
| `#x` | graph | documented | `node, no edge` |
| `#x` | embed | documented | `does not show the note` |
| `#x` | property | documented | `does not resolve` |
| `#x` | uri | documented | `opens nothing` |
| `#x` | rename | documented | `[[special-names/#x]] does not resolve; back, [[special-names/#x]] does not resolve` |
| `#x` | move | documented | `[[special-names/#x]] does not resolve; back, [[special-names/#x]] does not resolve` |
| `#x` | rename-onto | documented | `[[special-names/onto/#x]] does not resolve` |
| `x[[y` | link | documented | `[[x[[y]] does not resolve` |
| `x[[y` | embed | documented | `does not show the note` |
| `x[[y` | rename-onto | documented | `[[special-names/onto/x[[y]] does not resolve` |
| `x]]y` | link | documented | `[[x]]y]] does not resolve` |
| `x]]y` | embed | documented | `does not show the note` |
| `x]]y` | rename-onto | documented | `[[special-names/onto/x]]y]] does not resolve` |
| `x#^y` | link | documented | `[[special-names/x#^y]] does not resolve` |
| `x#^y` | backlinks | documented | `no backlink` |
| `x#^y` | graph | documented | `node, no edge` |
| `x#^y` | embed | documented | `does not show the note` |
| `x#^y` | property | documented | `does not resolve` |
| `x#^y` | uri | documented | `opens nothing` |
| `x#^y` | rename | documented | `[[special-names/x#^y]] does not resolve; back, [[special-names/x#^y]] does not resolve` |
| `x#^y` | move | documented | `[[special-names/x#^y]] does not resolve; back, [[special-names/x#^y]] does not resolve` |
| `x#^y` | rename-onto | documented | `[[special-names/onto/x#^y]] does not resolve` |
| `m#n` | link | documented | `[[special-names/m#n]] does not resolve` |
| `m#n` | backlinks | documented | `no backlink` |
| `m#n` | graph | documented | `node, no edge` |
| `m#n` | embed | documented | `does not show the note` |
| `m#n` | property | documented | `does not resolve` |
| `m#n` | uri | documented | `opens special-names/m.md` |
| `m#n` | rename | documented | `[[special-names/m#n]] does not resolve; back, [[special-names/m#n]] does not resolve` |
| `m#n` | move | documented | `[[special-names/m#n]] does not resolve; back, [[special-names/m#n]] does not resolve` |
| `m#n` | rename-onto | documented | `[[special-names/onto/m#n]] does not resolve` |
| `.x` | indexed | documented | `not indexed` |
| `.x` | explorer | documented | `no item` |
| `.x` | open | documented | `nothing to open` |
| `.x` | switcher | documented | `not offered among 0` |
| `.x` | search | documented | `finds nothing` |
| `.x` | link | documented | `[[.x]] does not resolve` |
| `.x` | backlinks | documented | `no backlink` |
| `.x` | graph | documented | `no node, no edge` |
| `.x` | embed | documented | `does not show the note` |
| `.x` | property | documented | `does not resolve` |
| `.x` | uri | documented | `no URL` |
| `.x` | rename | documented | `nothing to rename` |
| `.x` | move | documented | `nothing to rename` |
| `.x` | rename-onto | documented | `[[.x]] does not resolve` |
| `␣x` | link | fails | `[[ x]] does not resolve` |
| `␣x` | backlinks | fails | `no backlink` |
| `␣x` | graph | fails | `node, no edge` |
| `␣x` | embed | fails | `does not show the note` |
| `␣x` | property | fails | `does not resolve` |
| `␣x` | rename | fails | `[[ x]] does not resolve; back, [[ x]] does not resolve` |
| `␣x` | move | fails | `[[ x]] does not resolve; back, [[ x]] does not resolve` |
| `x⍽y` | indexed | fails | `not indexed` |
| `x⍽y` | explorer | fails | `no item` |
| `x⍽y` | open | fails | `nothing to open` |
| `x⍽y` | switcher | fails | `not offered among 16` |
| `x⍽y` | search | fails | `finds nothing` |
| `x⍽y` | link | fails | `[[x⍽y]] does not resolve` |
| `x⍽y` | backlinks | fails | `no backlink` |
| `x⍽y` | graph | fails | `no node, no edge` |
| `x⍽y` | embed | fails | `does not show the note` |
| `x⍽y` | property | fails | `does not resolve` |
| `x⍽y` | uri | fails | `no URL` |
| `x⍽y` | rename | fails | `nothing to rename` |
| `x⍽y` | move | fails | `nothing to rename` |
| `x⍽y` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |
| `cafe◌́` | indexed | fails | `not indexed` |
| `cafe◌́` | explorer | fails | `no item` |
| `cafe◌́` | open | fails | `nothing to open` |
| `cafe◌́` | switcher | fails | `not offered among 1` |
| `cafe◌́` | search | fails | `finds nothing` |
| `cafe◌́` | link | fails | `[[cafe◌́]] does not resolve` |
| `cafe◌́` | backlinks | fails | `no backlink` |
| `cafe◌́` | graph | fails | `no node, no edge` |
| `cafe◌́` | embed | fails | `does not show the note` |
| `cafe◌́` | property | fails | `does not resolve` |
| `cafe◌́` | uri | fails | `no URL` |
| `cafe◌́` | rename | fails | `nothing to rename` |
| `cafe◌́` | move | fails | `nothing to rename` |
| `cafe◌́` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |

## The full table on Android

`npm run special-names -- --android`, on Obsidian 1.14.4 for Android, with the same marks as above. The last table is what the explorer's rename did with each typed name.

| Name | indexed | explorer | open | switcher | search | link | backlinks | graph | embed | property | uri | rename | move | rename-onto |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `plain` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x#y` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `#x` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `x^y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `^x` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x[y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x]y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x[y]z` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x[[y` | ok | ok | ok | ok | ok | doc | ok | ok | doc | ok | ok | ok | ok | doc |
| `x]]y` | ok | ok | ok | ok | ok | doc | ok | ok | doc | ok | ok | ok | ok | doc |
| `x#^y` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `m#n` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | doc | doc | doc | doc |
| `x%%y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x%y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x%20y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x%23y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x%2Fy` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `.x` | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc | doc | ok |
| `x.y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `␣x` | ok | ok | ok | **fails** | ok | **fails** | **fails** | **fails** | **fails** | **fails** | ok | **fails** | **fails** | ok |
| `x  y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x⍽y` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** |
| `p⍽q` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `café` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | ok |
| `cafe◌́` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** |
| `nai◌̈ve` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x¦y` | ok | ok | ok | ok | ok | doc | doc | doc | doc | doc | ok | doc | doc | doc |
| `x:y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | doc | doc | doc |
| `x*y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | doc | doc | doc |
| `x?y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | doc | doc | doc |
| `x"y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | doc | doc | doc |
| `x<y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | doc | doc | doc |
| `x>y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | doc | doc | doc |
| `x\y` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** |
| `x.` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x␣` | ok | ok | ok | ok | ok | **fails** | **fails** | **fails** | **fails** | **fails** | ok | **fails** | **fails** | **fails** |
| `x./y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x /y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |

| Name | Surface | Status | What it did |
| --- | --- | --- | --- |
| `x#y` | link | documented | `[[special-names/x#y]] does not resolve` |
| `x#y` | backlinks | documented | `no backlink` |
| `x#y` | graph | documented | `node, no edge` |
| `x#y` | embed | documented | `does not show the note` |
| `x#y` | property | documented | `does not resolve` |
| `x#y` | uri | documented | `opens nothing` |
| `x#y` | rename | documented | `[[special-names/x#y]] does not resolve; back, [[special-names/x#y]] does not resolve` |
| `x#y` | move | documented | `[[special-names/x#y]] does not resolve; back, [[special-names/x#y]] does not resolve` |
| `x#y` | rename-onto | documented | `[[special-names/onto/x#y]] does not resolve` |
| `#x` | link | documented | `[[special-names/#x]] does not resolve` |
| `#x` | backlinks | documented | `no backlink` |
| `#x` | graph | documented | `node, no edge` |
| `#x` | embed | documented | `does not show the note` |
| `#x` | property | documented | `does not resolve` |
| `#x` | uri | documented | `opens nothing` |
| `#x` | rename | documented | `[[special-names/#x]] does not resolve; back, [[special-names/#x]] does not resolve` |
| `#x` | move | documented | `[[special-names/#x]] does not resolve; back, [[special-names/#x]] does not resolve` |
| `#x` | rename-onto | documented | `[[special-names/onto/#x]] does not resolve` |
| `x[[y` | link | documented | `[[x[[y]] does not resolve` |
| `x[[y` | embed | documented | `does not show the note` |
| `x[[y` | rename-onto | documented | `[[special-names/onto/x[[y]] does not resolve` |
| `x]]y` | link | documented | `[[x]]y]] does not resolve` |
| `x]]y` | embed | documented | `does not show the note` |
| `x]]y` | rename-onto | documented | `[[special-names/onto/x]]y]] does not resolve` |
| `x#^y` | link | documented | `[[special-names/x#^y]] does not resolve` |
| `x#^y` | backlinks | documented | `no backlink` |
| `x#^y` | graph | documented | `node, no edge` |
| `x#^y` | embed | documented | `does not show the note` |
| `x#^y` | property | documented | `does not resolve` |
| `x#^y` | uri | documented | `opens nothing` |
| `x#^y` | rename | documented | `[[special-names/x#^y]] does not resolve; back, [[special-names/x#^y]] does not resolve` |
| `x#^y` | move | documented | `[[special-names/x#^y]] does not resolve; back, [[special-names/x#^y]] does not resolve` |
| `x#^y` | rename-onto | documented | `[[special-names/onto/x#^y]] does not resolve` |
| `m#n` | link | documented | `[[special-names/m#n]] does not resolve` |
| `m#n` | backlinks | documented | `no backlink` |
| `m#n` | graph | documented | `node, no edge` |
| `m#n` | embed | documented | `does not show the note` |
| `m#n` | property | documented | `does not resolve` |
| `m#n` | uri | documented | `opens special-names/m.md` |
| `m#n` | rename | documented | `[[special-names/m#n]] does not resolve; back, [[special-names/m#n]] does not resolve` |
| `m#n` | move | documented | `[[special-names/m#n]] does not resolve; back, [[special-names/m#n]] does not resolve` |
| `m#n` | rename-onto | documented | `[[special-names/onto/m#n]] does not resolve` |
| `.x` | indexed | documented | `not indexed` |
| `.x` | explorer | documented | `no item` |
| `.x` | open | documented | `nothing to open` |
| `.x` | switcher | documented | `not offered among 0` |
| `.x` | search | documented | `finds nothing` |
| `.x` | link | documented | `[[.x]] does not resolve` |
| `.x` | backlinks | documented | `no backlink` |
| `.x` | graph | documented | `no node, no edge` |
| `.x` | embed | documented | `does not show the note` |
| `.x` | property | documented | `does not resolve` |
| `.x` | uri | documented | `no URL` |
| `.x` | rename | documented | `nothing to rename` |
| `.x` | move | documented | `nothing to rename` |
| `␣x` | switcher | fails | `not offered among 18` |
| `␣x` | link | fails | `[[ x]] does not resolve` |
| `␣x` | backlinks | fails | `no backlink` |
| `␣x` | graph | fails | `node, no edge` |
| `␣x` | embed | fails | `does not show the note` |
| `␣x` | property | fails | `does not resolve` |
| `␣x` | rename | fails | `[[ x]] does not resolve; back, [[ x]] does not resolve` |
| `␣x` | move | fails | `[[ x]] does not resolve; back, [[ x]] does not resolve` |
| `x⍽y` | indexed | fails | `not indexed` |
| `x⍽y` | explorer | fails | `no item` |
| `x⍽y` | open | fails | `nothing to open` |
| `x⍽y` | switcher | fails | `not offered among 19` |
| `x⍽y` | search | fails | `finds nothing` |
| `x⍽y` | link | fails | `[[x⍽y]] does not resolve` |
| `x⍽y` | backlinks | fails | `no backlink` |
| `x⍽y` | graph | fails | `no node, no edge` |
| `x⍽y` | embed | fails | `does not show the note` |
| `x⍽y` | property | fails | `does not resolve` |
| `x⍽y` | uri | fails | `no URL` |
| `x⍽y` | rename | fails | `nothing to rename` |
| `x⍽y` | move | fails | `nothing to rename` |
| `x⍽y` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |
| `café` | indexed | fails | `not indexed` |
| `café` | explorer | fails | `no item` |
| `café` | open | fails | `nothing to open` |
| `café` | switcher | fails | `offered first` |
| `café` | search | fails | `finds special-names/café.md` |
| `café` | link | fails | `[[café]] does not resolve` |
| `café` | backlinks | fails | `no backlink` |
| `café` | graph | fails | `no node, no edge` |
| `café` | embed | fails | `does not show the note` |
| `café` | property | fails | `does not resolve` |
| `café` | uri | fails | `no URL` |
| `café` | rename | fails | `nothing to rename` |
| `café` | move | fails | `nothing to rename` |
| `cafe◌́` | indexed | fails | `as special-names/café.md, reading another file` |
| `cafe◌́` | explorer | fails | `shows café` |
| `cafe◌́` | open | fails | `opens special-names/café.md` |
| `cafe◌́` | switcher | fails | `offered first` |
| `cafe◌́` | search | fails | `finds nothing` |
| `cafe◌́` | link | fails | `[[café]] resolves` |
| `cafe◌́` | backlinks | fails | `lists the linker` |
| `cafe◌́` | graph | fails | `node, edge` |
| `cafe◌́` | embed | fails | `shows the note` |
| `cafe◌́` | property | fails | `resolves` |
| `cafe◌́` | uri | fails | `opens special-names/café.md` |
| `cafe◌́` | rename | fails | `[[R25]] resolves; back, [[special-names/café]] resolves` |
| `cafe◌́` | move | fails | `[[special-names/moved/café]] resolves; back, [[special-names/café]] resolves` |
| `cafe◌́` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |
| `x¦y` | link | documented | `[[x¦y]] does not resolve` |
| `x¦y` | backlinks | documented | `no backlink` |
| `x¦y` | graph | documented | `node, no edge` |
| `x¦y` | embed | documented | `does not show the note` |
| `x¦y` | property | documented | `does not resolve` |
| `x¦y` | rename | documented | `[[x¦y]] does not resolve; back, [[x¦y]] does not resolve` |
| `x¦y` | move | documented | `[[x¦y]] does not resolve; back, [[x¦y]] does not resolve` |
| `x¦y` | rename-onto | documented | `[[special-names/onto/x¦y]] does not resolve` |
| `x:y` | rename | documented | `[[R28]] resolves; back, <<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x:y` | move | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve; back, no link does not resolve` |
| `x:y` | rename-onto | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x*y` | rename | documented | `[[R29]] resolves; back, <<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x*y` | move | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve; back, no link does not resolve` |
| `x*y` | rename-onto | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x?y` | rename | documented | `[[R30]] resolves; back, <<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x?y` | move | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve; back, no link does not resolve` |
| `x?y` | rename-onto | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x"y` | rename | documented | `[[R31]] resolves; back, <<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x"y` | move | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve; back, no link does not resolve` |
| `x"y` | rename-onto | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x<y` | rename | documented | `[[R32]] resolves; back, <<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x<y` | move | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve; back, no link does not resolve` |
| `x<y` | rename-onto | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x>y` | rename | documented | `[[R33]] resolves; back, <<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x>y` | move | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve; back, no link does not resolve` |
| `x>y` | rename-onto | documented | `<<refused: File name cannot contain any of the following characters: \⍽/⍽:⍽*⍽?⍽<⍽>⍽">> does not resolve` |
| `x\y` | indexed | fails | `not indexed` |
| `x\y` | explorer | fails | `no item` |
| `x\y` | open | fails | `nothing to open` |
| `x\y` | switcher | fails | `not offered among 0` |
| `x\y` | search | fails | `finds nothing` |
| `x\y` | link | fails | `[[x\y]] does not resolve` |
| `x\y` | backlinks | fails | `no backlink` |
| `x\y` | graph | fails | `no node, no edge` |
| `x\y` | embed | fails | `does not show the note` |
| `x\y` | property | fails | `does not resolve` |
| `x\y` | uri | fails | `no URL` |
| `x\y` | rename | fails | `nothing to rename` |
| `x\y` | move | fails | `nothing to rename` |
| `x\y` | rename-onto | fails | `<<refused: The parent object of the destination does not exist>> does not resolve` |
| `x␣` | link | fails | `[[x ]] does not resolve` |
| `x␣` | backlinks | fails | `no backlink` |
| `x␣` | graph | fails | `node, no edge` |
| `x␣` | embed | fails | `does not show the note` |
| `x␣` | property | fails | `does not resolve` |
| `x␣` | rename | fails | `[[x ]] does not resolve; back, [[x ]] does not resolve` |
| `x␣` | move | fails | `[[x ]] does not resolve; back, [[x ]] does not resolve` |
| `x␣` | rename-onto | fails | `[[special-names/onto/x ]] does not resolve` |

| Typed name | Saved | Message |
| --- | --- | --- |
| `r#s` | yes | - |
| `r^s` | yes | - |
| `r[s` | yes | - |
| `r]s` | yes | - |
| `r¦s` | yes | - |
| `r%s` | yes | - |
| `r:s` | no | - |
| `r*s` | no | - |
| `.rs` | no | - |
| `r?s` | no | - |
| `r"s` | no | - |
| `r<s` | no | - |
| `r>s` | no | - |
| `r\s` | no | - |
| `rs.` | yes | - |
| `rs␣` | yes | - |
