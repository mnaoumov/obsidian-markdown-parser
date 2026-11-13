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
npx jiti scripts/links/special-names-oracle.ts [--obsidian-version <version>] [--out-dir <directory>]
npm run special-names [-- --details]
```

`scripts/links/special-names-oracle.ts` writes 27 note names (`src/oracle/links/special-names.ts`) straight onto the disk of an owned Obsidian's vault, never through the app, each holding a word unique to it. For each name it asks `generateMarkdownLink` for the wikilink from a linker note in another folder, and writes the linker on disk with that link as body link, as an embed and as a properties link. It then reads, per name:

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

It also types the names above into the file explorer's rename, and, for each pair of files the vault indexes under one path, edits the one note through the vault and reads both files from disk. The oracle is pinned to 1.15.1 (`oracle/special-names-obsidian-1.15.1.json`); the earlier 1.15.0 insider read on 2026-10-25 matched the former 1.14.5 pin. The public refresh has the capture variation documented below. `src/oracle/links/special-names.test.ts` pins the verdicts, the shadowing writes and the rename checks.

Only names Windows can store were tried here. `| : * ? " < > \` and a trailing dot or space were swept on Android, in [On Android](#on-android).

### Capture settling

The normalization reader reveals each linker in Reading view, polls for its internal-link anchor from Node for up to ten seconds, clicks it once, and polls for navigation for up to ten more seconds. A missing anchor or missing `data-href` aborts the capture before it writes the oracle. A rendered link whose click opens nothing still records `opened: null`: a missing render and an unsuccessful click are different observations. These bounds do not establish why the first public 1.15.0 capture missed every anchor; the successful replay alone did not establish a cause either.

Rename link updates and quick-switcher offers are sampled throughout a four-second window and must agree on the last three samples. An early cached success cannot end the rename wait. A final unresolved link or empty offer list is accepted, and offer order is preserved; a snapshot still changing at the bound aborts the capture. This catches bounded settling failures without requiring a particular product result or forcing agreement with an older oracle. The waits do not prove that an update cannot arrive after their bounds.

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
| 4. A name starting with a space | defect, rule 2 | The reply on the feature request [t/21994](https://forum.obsidian.md/t/21994) from [`link-parity.md`](link-parity.md), with the surfaces measured here. |
| 5. NFC/NFD and no-break space shadowing | defect, rule 1 | The NFC/NFD half is already reported on the forum, in [NFD-NFC Normalization Issues with Wiki Links in Obsidian](https://forum.obsidian.md/t/nfd-nfc-normalization-issues-with-wiki-links-in-obsidian/95629), which "Incorrect handling not NFC-normalized file names" was merged into. The no-break space half goes there as a reply. |

No finding is a corpus case for the parser: the parser reads a note's text, and every failure here is in how the app indexes, resolves or writes paths.

## On Android

```sh
emulator -avd obsidian_test -read-only -no-window -no-snapshot-load -no-snapshot-save
adb install -r Obsidian-1.14.4.apk
adb shell monkey -p md.obsidian 1
npx jiti scripts/links/special-names-oracle.ts --android [--serial <serial>]
npm run special-names -- --android [--details]
```

`--android` reads the same surfaces in Obsidian for Android, for 39 names: the desktop's 27, at the same indices, and 12 that Windows cannot store (`DEVICE_SPECIAL_NAMES`): `x|y`, `x:y`, `x*y`, `x?y`, `x"y`, `x<y`, `x>y`, `x\y`, the notes `x.` and `x␣` (the files `x..md` and `x .md`), and a note `y` in each of the folders `x.` and `x␣`. `scripts/capture/android-vault.ts` opens a fresh vault in the app's own storage, `/sdcard/Android/data/md.obsidian/files/special-names-oracle`, the folder the app lists its app storage vaults from. It writes and reads the vault's files over `adb shell`, never through the app, and calls into the app over its WebView's DevTools protocol. The explorer's rename gets the desktop's typed names and `r?s`, `r"s`, `r<s`, `r>s`, `r\s`, `rs.` and `rs␣`. The oracle was read on 2026-10-26 from Obsidian 1.14.4, the newest with an APK (1.14.5 shipped for desktop only), on an Android 17 emulator booted read-only, so that nothing it did stayed on the device. It is in `oracle/special-names-android-obsidian-1.14.4.json`, and the Android half of `src/oracle/links/special-names.test.ts` pins it.

Where the vault lives matters. Checked with `adb shell` before the sweep:

- **Shared storage refuses the names.** In `/sdcard/Documents`, creating a file whose name holds `| : * ? " < > \` fails with `Operation not permitted`, so in a vault there such a file cannot arrive by any means. A trailing dot or space is stored.
- **App storage takes every name, but folds them.** `Ab.md` and `ab.md` are one file there, and so are `café.md` composed and decomposed. The vault adapter still reports the vault as case sensitive (`adapter.insensitive` is `false`). That loses nothing in the one case tried: `vault.create('case.md')` beside `Case.md` is refused as "File already exists.".

What was found on Android, beyond the desktop's findings above, which all hold there too except where a finding below says otherwise:

1. **Android refuses `\ : * ? " < >` in a rename and saves `| # ^ [ ]`, a trailing dot and a trailing space.** This is the set read from the bundle, and a leading dot is refused as on the desktop. The oracle found no tooltip and no notice for any typed name, the warned ones included, where the desktop shows its warning as a tooltip.
2. **A note named with `: * ? " < >` that arrived anyway works on every surface, and a rename of it is one way.** The file surfaces, every link Obsidian writes, the properties link and the URI all reach it. The link to `x:y` resolves even though the help's *Invalid characters* note names `:`. A rename to a plain name works. Renaming it back, moving it into another folder under its own name, and renaming another note onto its name are each refused with "File name cannot contain any of the following characters: \ / : * ? < > \"". The refusal is the app's own message, so it is by design, and these surfaces are marked *documented*.
3. **`x|y` works on the file surfaces and the URI, and fails on its links.** Android has no `|` in its refused set, so it is stored and renamed freely. Its link failures are documented, since `|` is in the help's note.
4. **A note named with `\` is not in the vault at all.** The file is on disk, but the vault never lists it, even in `adapter.files`, so no surface shows it. Renaming another note onto `x\y` is refused with "The parent object of the destination does not exist". A **defect by rule 1**: a file that a sync or a file manager brings in with a backslash disappears.
5. **A name ending in a space fails like one starting with a space (the desktop's finding 4), and worse.** `generateMarkdownLink` writes `[[x ]]`, which misses it, so it has no backlink, no graph edge, no embed and no resolving properties link, and a rename or a move leaves its linker unresolved. Unlike a leading space, a rename onto the name writes `[[special-names/onto/x ]]`, which does not resolve either. The desktop does the same: Windows stores `x .md`, and one run of the desktop oracle with that name added, on 1.14.5 and on 1.15.0 on 2026-10-26, gave these verdicts on every surface. That run is not part of the pinned oracle. A **defect by rule 2**.
6. **The quick switcher does not show the note `␣x` on Android, but this is a measuring artefact, not a defect.** On both platforms the switcher reads a typed leading space as if it were not there, so `␣x` comes after every other name that starts with `x`: on the desktop it is offered 18th of 19. The Android list stops at 18 entries and also leaves out names that do match, such as `x[[y`. With the 12 extra names of the Android sweep, `␣x` falls off the end of the list.
7. **A note ending in a dot works on every surface, and so does a note in a folder ending in a dot or a space.**
8. **The composed and decomposed `café` are one file in app storage, so their rows measure the file system, not the app.** The file is stored under the name written first, the decomposed one, and holds the text written last. `café` therefore reads as not indexed, `cafe◌́` as reading another name's text, and an edit through the vault reaches both names. The no-break space pair is two files, and it shadows as on the desktop (the desktop's finding 5).

| Finding | Verdict | Goes to |
| --- | --- | --- |
| 1. The rename's refused set | by design | Nothing to report. |
| 2. `: * ? " < >` renames one way | by design | Nothing to report. |
| 3. `x\|y` | documented | Nothing to report. |
| 4. `\` invisible | defect, rule 1 | A reply on [Obsidian incorrectly interprets the backslash "\" in filenames as a directory divisor](https://forum.obsidian.md/t/55686), where staff said `\` is a path separator on every system. The reply asks for a notice instead of the silence. |
| 5. A trailing space | defect, rule 2 | A reply on [A space at the end of a file name breaks autocomplete](https://forum.obsidian.md/t/37412), the open bug report for it. |
| 6. Switcher and a leading space | measuring artefact | Nothing to report. |
| 7. Trailing dots and spaces in folders | - | Nothing to report. |
| 8. Folding in app storage | file system | Nothing to report on its own. It matters to a vault synced from a case-sensitive system, which is where the Sync question goes. |

## Names in neither normal form

```sh
npx jiti scripts/links/special-names-oracle.ts --normalization [--obsidian-version <version>] [--out-dir <directory>]
npm run special-names -- --normalization [--details]
```

The sweep above tried names that are wholly NFC or wholly NFD. `--normalization` sweeps 21 names (`NORMALIZATION_NAMES`) that are neither, or that test how far normalization goes, through the same surfaces:

| Group | Names |
| --- | --- |
| Mixed form | `m` + composed `é` + decomposed `й` (U+0438 U+0306), and `k` + decomposed `é` (U+0065 U+0301) + composed `й`: each equals neither its NFC nor its NFD |
| Mark order | `e` + U+0302 U+0323, two marks in the order NFD does not use; and `o` with the same two marks in both orders at once, the non-canonical one written last |
| Three spellings at once | `néй` composed, decomposed and mixed, the mixed one written last; and `péй` the same, the composed one written last |
| Typed in other spellings | `qéй` composed, with links also typed in two mixed spellings |
| Bare combining mark | U+0301 at the start of a name, and after a space in the middle of one |
| Compatibility characters | `ﬁx` (U+FB01), `Ａx` (U+FF21) and `x²`, each beside `fix`, `Ax` and `x2`, the names NFKC would make of them |

Beyond the surfaces, the sweep reads, for each name:

| Read | What is read |
| --- | --- |
| file on disk | the file the vault note reads (`adapter.files[path].realpath`), before and after its rename round trips, and after the rename onto the name |
| lookups | what `getAbstractFileByPath` finds under the path in each spelling: the name as written, its NFC, its NFD and any typed spelling |
| typed links | for each spelling, a linker on disk with one link typed by hand as a wikilink, a markdown link with its destination percent-encoded, and one with it in angle brackets: the note `resolvedLinks` maps it to, the link path the metadata cache holds, the `data-href` of its anchor in Reading view and the note a click on it opens, and the note the editor's "Follow link under cursor" opens from the linker's own text, with any note that created |
| spelling renames | `fileManager.renameFile` of a second file of the name to each other spelling of it and back, with the vault path and the file on disk after each |

The oracle is pinned to 1.15.1 (`oracle/special-names-normalization-obsidian-1.15.1.json`). The earlier 1.15.0 insider read on 2026-10-26 matched the former 1.14.5 pin apart from quick-switcher offer order. The public refresh also varied in offer inclusion, with no change in the cache, Reading-view or editor-follow outcomes ([capture notes](oracles.md#public-1150-complete-captures)). `src/oracle/links/special-names.test.ts` pins them. NTFS stores a name exactly as written and compares names code unit by code unit (apart from letter case), so on Windows every difference below comes from Obsidian, not from the file system.

What was found:

1. **The vault path of a note is the NFC of its file's name, whatever form that name is in, and the file keeps its own name on disk.** A mixed form, a non-canonical order of marks or a decomposed name, alone, works on every surface, as finding 5 found for a decomposed one. The explorer shows the NFC name.
2. **Two or three spellings of one name are one note, and the vault keeps the file it saw last, whichever form it is in.** With the mixed `néй` written last, the vault reads the mixed file under the composed path, and the composed file, which a user would call the "real" one, is hidden. The other spellings are hidden as finding 5 describes: no surface shows them, and an edit of the note goes to the kept file only.
3. **`getAbstractFileByPath` finds a note under its NFC spelling only.** The file's own name on disk, NFD or mixed, finds nothing, so a plugin that takes a path from the file system or from another app has to normalize it first. This was already reported for `getFileByPath` and a decomposed name, in post 4 of [t/95629](https://forum.obsidian.md/t/nfd-nfc-normalization-issues-with-wiki-links-in-obsidian/95629).
4. **A link typed in any spelling but NFC resolves everywhere except where the editor follows it, and there it creates a second note.** The metadata cache composes every link it reads: the cached link path is NFC, so `resolvedLinks`, backlinks and the graph count the link as resolved, and Reading view's anchor carries the NFC path, so a click there opens the note. The vault keeps the note's text as written, though, and the editor's "Follow link under cursor" follows the text: for an NFD or mixed link, wikilink or markdown, percent-encoded or not, it creates `néй 1.md` beside `néй.md` and opens that. A bare `[[name]]` passed to `workspace.openLinkText` creates the note at the vault root. This is the first report of [t/95629](https://forum.obsidian.md/t/nfd-nfc-normalization-issues-with-wiki-links-in-obsidian/95629) (macOS, 1.8.3, where links built from `os.listdir()` names created new notes when clicked), still there on 1.14.5 and 1.15.0. It also holds for mixed forms and for markdown links. A **defect**: one link, one target, two outcomes depending on the view.
5. **A rename to another spelling of the same name is accepted and does nothing.** `fileManager.renameFile` resolves without an error, and both the vault path and the name on disk stay as they were. Every rename to a different name, though, writes the NFC spelling on disk: a mixed `néи◌̆.md` renamed away and back is `néй.md` afterwards, and a plainly named note renamed onto a mixed name is stored composed. So Obsidian can change a file's normal form only as a side effect of a real rename.
6. **A hidden NFC file strands a moved note.** Where the kept file is not the NFC spelling and a hidden file is, as with the mixed `néй` written last, moving or renaming the note away works, but moving it back is refused with "Destination file already exists!". The refusal names a file no surface shows, and nothing in the vault holds that path any more. The hidden file stays out of the vault after the note leaves, even 10 seconds later, until something writes to it on disk, when the vault indexes it. Where the hidden spelling is not NFC, as with `o` and its marks in the canonical order or the decomposed `café`, the round trip works, since Windows keeps NFC and NFD as two names. A **defect by rule 1**, and a sharper form of finding 5.
7. **A combining mark with no base character, at the start of a name or after a space, works on every surface.** Such a name is already NFC and NFD, so nothing changes it.
8. **No layer applies compatibility normalization (NFKC or NFKD).** `ﬁx.md` and `fix.md`, `Ａx.md` and `Ax.md`, and `x².md` and `x2.md` are two notes each, on every surface, with links, lookups and renames keeping them apart.

| Finding | Verdict | Goes to |
| --- | --- | --- |
| 1. NFC vault paths | by design | Nothing on its own; it is where the others come from. |
| 2. Several spellings | defect, rule 1 | A reply on [t/95629](https://forum.obsidian.md/t/nfd-nfc-normalization-issues-with-wiki-links-in-obsidian/95629), with findings 4 and 6: mixed forms shadow as NFD ones do, and the last file written wins. |
| 3. `getAbstractFileByPath` | known | Already in post 4 of t/95629. |
| 4. The editor's follow creates a note | defect | The same reply, as the measurement that the topic's first report still holds on 1.14.5 and 1.15.0, for every non-NFC spelling and for markdown links too. |
| 5. Spelling renames | by design | Nothing to report. |
| 6. A stranded note | defect, rule 1 | The same reply. |
| 7. Bare marks | - | Nothing to report. |
| 8. No NFKC | - | Nothing to report. |

### The normalization sweep on Android

```sh
npx jiti scripts/links/special-names-oracle.ts --android --normalization [--serial <serial>] [--out-dir <directory>]
npm run special-names -- --android --normalization [--details]
```

The same 21 names were read on Obsidian 1.14.4 for Android in the app-storage vault described above, on the Android 17 emulator. The oracle is `oracle/special-names-normalization-android-obsidian-1.14.4.json`, pinned by `src/oracle/links/special-names.test.ts` alongside the desktop sweep.

1. **App storage folds canonically equivalent spellings before Obsidian sees them.** Each of the `o`, `n` and `p` groups is one file, retaining the spelling written first and the contents written last. Reading either spelling over `adb shell` after an edit through the vault gives the same edited text. Unlike NTFS, this storage cannot hold the separate files that the desktop vault shadows; the missing spellings in the surface table therefore do not represent hidden files. The kept note fails the text checks because the last write replaced its expected text with its partner's.
2. **The ligature `ﬁx` and `fix` also share one file.** It retains `ﬁx.md`, so Obsidian indexes `ﬁx` only. A typed link to `fix` neither resolves nor creates a note: the file system already holds that name as `ﬁx`. This is a storage folding difference, not Obsidian applying NFKC: `Ａx` and `Ax`, and `x²` and `x2`, remain separate notes. The observation is limited to this emulator's app storage.
3. **The non-NFC link defect remains.** Every reachable name has an NFC vault path, and only that spelling works with `getAbstractFileByPath`. Links typed in another spelling resolve in the cache and Reading view, but following them in the editor creates and opens a second note with a space and `1` appended, just as on the desktop. Bare combining marks work too.
4. **No moved note is stranded.** A rename to another spelling is accepted without changing the file; a real rename or move away and back stores the NFC spelling. Since the storage holds only one file per equivalent name, there is no hidden NFC file to refuse the return, unlike desktop finding 6.

Not measured here: macOS, where APFS keeps a name's form but compares names regardless of it, and HFS+ stored them decomposed; and Obsidian Sync, which the owned test instance has no account for.

## The full table

`npm run special-names`, recorded on 1.14.5. The 1.15.0 capture differed only in `.x` after rename-onto: it recorded a resolving link, but a separate 1.15.0 probe still left `.x` unindexed, so that was not evidence of a version fix ([capture notes](oracles.md#public-1150-complete-captures)). The current 1.15.1 capture records it unresolved again, as 1.14.5 did, and its rename to `r*s` was refused without the notice read ([capture notes](oracles.md#public-1151-complete-captures)). `ok` works, `doc` fails where the help documents it, **fails** fails where it does not. In the table, `␣` stands for a space at the start or end of a code span, `⍽` for a no-break space, and `◌` for the base of a combining mark.

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

## The full table of names in neither normal form

`npm run special-names -- --normalization`, recorded on 1.14.5, with the same marks as above.

| Name | indexed | explorer | open | switcher | search | link | backlinks | graph | embed | property | uri | rename | move | rename-onto |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `plain` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `méи◌̆` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `ke◌́й` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `e◌̂◌̣` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `o◌̣◌̂` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | ok |
| `o◌̂◌̣` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | **fails** |
| `néй` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | ok |
| `ne◌́и◌̆` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** |
| `néи◌̆` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | **fails** | **fails** | **fails** |
| `pe◌́и◌̆` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | ok |
| `péи◌̆` | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** | **fails** |
| `péй` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | **fails** |
| `qéй` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `◌́x` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x ◌́y` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `ﬁx` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `fix` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `Ａx` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `Ax` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x²` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `x2` | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |

| Name | Surface | Status | What it did |
| --- | --- | --- | --- |
| `o◌̣◌̂` | indexed | fails | `not indexed` |
| `o◌̣◌̂` | explorer | fails | `no item` |
| `o◌̣◌̂` | open | fails | `nothing to open` |
| `o◌̣◌̂` | switcher | fails | `not offered among 2` |
| `o◌̣◌̂` | search | fails | `finds nothing` |
| `o◌̣◌̂` | link | fails | `[[o◌̣◌̂]] does not resolve` |
| `o◌̣◌̂` | backlinks | fails | `no backlink` |
| `o◌̣◌̂` | graph | fails | `no node, no edge` |
| `o◌̣◌̂` | embed | fails | `does not show the note` |
| `o◌̣◌̂` | property | fails | `does not resolve` |
| `o◌̣◌̂` | uri | fails | `no URL` |
| `o◌̣◌̂` | rename | fails | `nothing to rename` |
| `o◌̣◌̂` | move | fails | `nothing to rename` |
| `o◌̂◌̣` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |
| `néй` | indexed | fails | `not indexed` |
| `néй` | explorer | fails | `no item` |
| `néй` | open | fails | `nothing to open` |
| `néй` | switcher | fails | `offered first` |
| `néй` | search | fails | `finds nothing` |
| `néй` | link | fails | `[[néй]] does not resolve` |
| `néй` | backlinks | fails | `no backlink` |
| `néй` | graph | fails | `no node, no edge` |
| `néй` | embed | fails | `does not show the note` |
| `néй` | property | fails | `does not resolve` |
| `néй` | uri | fails | `no URL` |
| `néй` | rename | fails | `nothing to rename` |
| `néй` | move | fails | `nothing to rename` |
| `ne◌́и◌̆` | indexed | fails | `not indexed` |
| `ne◌́и◌̆` | explorer | fails | `no item` |
| `ne◌́и◌̆` | open | fails | `nothing to open` |
| `ne◌́и◌̆` | switcher | fails | `not offered among 10` |
| `ne◌́и◌̆` | search | fails | `finds nothing` |
| `ne◌́и◌̆` | link | fails | `[[ne◌́и◌̆]] does not resolve` |
| `ne◌́и◌̆` | backlinks | fails | `no backlink` |
| `ne◌́и◌̆` | graph | fails | `no node, no edge` |
| `ne◌́и◌̆` | embed | fails | `does not show the note` |
| `ne◌́и◌̆` | property | fails | `does not resolve` |
| `ne◌́и◌̆` | uri | fails | `no URL` |
| `ne◌́и◌̆` | rename | fails | `nothing to rename` |
| `ne◌́и◌̆` | move | fails | `nothing to rename` |
| `ne◌́и◌̆` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |
| `néи◌̆` | rename | fails | `<<no special-names/néй.md>> does not resolve; back, no link does not resolve` |
| `néи◌̆` | move | fails | `[[special-names/moved/néй]] resolves; back, <<refused: Destination file already exists!>> does not resolve` |
| `néи◌̆` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |
| `pe◌́и◌̆` | indexed | fails | `not indexed` |
| `pe◌́и◌̆` | explorer | fails | `no item` |
| `pe◌́и◌̆` | open | fails | `nothing to open` |
| `pe◌́и◌̆` | switcher | fails | `not offered among 10` |
| `pe◌́и◌̆` | search | fails | `finds nothing` |
| `pe◌́и◌̆` | link | fails | `[[pe◌́и◌̆]] does not resolve` |
| `pe◌́и◌̆` | backlinks | fails | `no backlink` |
| `pe◌́и◌̆` | graph | fails | `no node, no edge` |
| `pe◌́и◌̆` | embed | fails | `does not show the note` |
| `pe◌́и◌̆` | property | fails | `does not resolve` |
| `pe◌́и◌̆` | uri | fails | `no URL` |
| `pe◌́и◌̆` | rename | fails | `nothing to rename` |
| `pe◌́и◌̆` | move | fails | `nothing to rename` |
| `péи◌̆` | indexed | fails | `not indexed` |
| `péи◌̆` | explorer | fails | `no item` |
| `péи◌̆` | open | fails | `nothing to open` |
| `péи◌̆` | switcher | fails | `not offered among 10` |
| `péи◌̆` | search | fails | `finds nothing` |
| `péи◌̆` | link | fails | `[[péи◌̆]] does not resolve` |
| `péи◌̆` | backlinks | fails | `no backlink` |
| `péи◌̆` | graph | fails | `no node, no edge` |
| `péи◌̆` | embed | fails | `does not show the note` |
| `péи◌̆` | property | fails | `does not resolve` |
| `péи◌̆` | uri | fails | `no URL` |
| `péи◌̆` | rename | fails | `nothing to rename` |
| `péи◌̆` | move | fails | `nothing to rename` |
| `péи◌̆` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |
| `péй` | rename-onto | fails | `<<refused: Destination file already exists!>> does not resolve` |
