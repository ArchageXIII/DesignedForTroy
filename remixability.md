# Keep a game remixable

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

TROY can upload, publish, and play bundles that are too large for the remix
editor. Remixability has a separate bundle and editable-file limits so the editor and AI remix
worker can read, change, validate, and save the application safely.

## Hard eligibility limits

A remixable game must contain **10,000,000 bytes (10 MB) or less uncompressed**
and **500 game files or fewer**, inclusive. Count accepted game code and all
assets after ZIP expansion and filtering, including media, fonts, WebAssembly,
binary files and `.txt` data. Compressing the ZIP does not reduce this total.
Storage content encoding is decoded before measurement.

Directories, skipped files, temporary archives and generated metadata do not
count. TROY capture/manual artwork is excluded only with verified platform
provenance. Developer artwork inside the game bundle counts; a reserved filename
alone never grants an exemption.

Every individual remix-editable file must be **1,000,000 bytes or smaller**.
This is a decimal byte limit, not a character count or 1 MiB. The rule applies
to these extensions:

- `.css`
- `.htm` and `.html`
- `.js` and `.mjs`
- `.json`
- `.svg`

If any one of those files is larger than 1,000,000 bytes, the bundle can still
be uploaded and may still be published, but TROY disables **Remixable** for that
version and its published game. Generated and refined remixes are subject to
the same hard ceiling and cannot save an oversized editable file.

## Recommended working target

Aim for **750,000 bytes or less per remix-editable file**. The 250,000-byte
margin leaves room for an AI or manual remix to add behavior without immediately
crossing the hard ceiling.

Split large application bundles into focused modules or chunks. Keep large
dictionaries, level catalogs, and other static content separate from application
code. `.json` is remix-editable and therefore counts toward the ceiling;
`.txt`, media, fonts, WebAssembly, and binary model files do not currently count
as remix-editable files. Use the extension that truthfully describes the file—do
not rename executable code simply to bypass eligibility checks.

The editable ceiling applies per file in addition to total-size and file-count
limits. Noneditable assets still count toward both totals.

TROY preserves creator consent when a limit disables Remixable. An eligible
replacement restores availability only with that consent. Generated results over
the total-size/count limits remain saved, previewable, playable and publishable,
but cannot be refined or remixed further. Generated editable files exceeding
the per-file ceiling are still rejected. Context generation remains independent.

## Check the final browser build

Measure the compiled folder that will actually be uploaded, not the source
project. On PowerShell, this lists remix-editable files above the recommended
working target:

```powershell
Get-ChildItem .\dist -Recurse -File |
  Where-Object {
    $_.Extension -in '.css', '.htm', '.html', '.js', '.json', '.mjs', '.svg' -and
    $_.Length -gt 750000
  } |
  Select-Object FullName, Length
```

Anything above 750,000 bytes deserves review. Anything above 1,000,000 bytes
must be split or reduced if the game is to remain remixable.

## Other upload limits

The remix ceiling does not replace the normal bundle contract. Each uploaded
file must still be smaller than 50 MiB. ZIP uploads must be smaller than 250 MiB
and meet the expanded-size and entry-count limits in [the bundle and asset
contract](assets.md).

[`bundle-policy.json`](bundle-policy.json) is the machine-readable source of
truth. Read `remix.maxBundleBytes`, `remix.maxBundleFileCount`,
`remix.maxEditableFileBytes`,
`remix.recommendedEditableFileBytes`, and `remix.editableExtensions` rather
than copying the values into build tooling.
