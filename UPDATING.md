# Compatibility and updates

The public v1 guides are maintained in DesignedForTroy. The runtime SDK and upload
policy remain supported TROY snapshots. No runtime operation reads a sibling
checkout. [provenance.json](provenance.json) records the source revision and the
SHA-256 of each deliberately selected source file's Git blob before adaptation.
Hashes refer to the pinned commit, never to platform-converted working-tree bytes.

1. Obtain a reviewed TROY source revision. Read its contracts and compare API,
   protocol, policy and behavioral changes. Never copy the whole source tree.
2. Extract `client/public/shared/troy-game-api-v1.js` to
   `tools/troy-game-api-v1.js` and `functions/game-bundle-policy.json` to
   `bundle-policy.json` **without byte changes** from the pinned Git commit. Use a
   binary-safe process capture such as Node `execFileSync("git", ["show",
   "<commit>:<path>"], {cwd: upstream})` and `writeFile` with its Buffer result.
   Do not use shell text redirection or a checkout that converts line endings.
   Update the source revision and
   source hashes in provenance.json. Preserve applicable third-party notices.
3. Reconcile the public guides, starter and harness. Keep required API/lifecycle,
   conditional storage and recommended capture language consistent. Preserve
   published-game compatibility and snapshot migration across replacements.
4. Keep both public MCP tools and all existing `troy://` resources stable.
   New incompatible contracts require a separately reviewed version.
5. Run `node scripts/build-kit.mjs`, `node scripts/test.mjs`, and
   `node scripts/build-kit.mjs --check`. Check a clean checkout and extract the ZIP
   to a directory with spaces. Run ordinary and strict harness modes and stdio MCP.
   Finish Browser acceptance and record upload/device limitations.
6. Review the resulting diff, source provenance and checksums. Commit the ZIP and
   manifest together with their inputs. User acceptance is required before merge
   or any separately scoped production action.

Use `gh` directly for authorized GitHub PR creation, updates and checks, following
[the repository GitHub workflow](AGENTS.md). Verify the active CLI account and
target repository before writes; a connector attempt is not a prerequisite.

The builder explicitly lists public files, sorts their paths, fixes the ZIP DOS
timestamp to 2026-01-01, stores bytes without compression, and emits no ambient
filesystem metadata. Uncompressed ZIP is deliberate: it is portable and
byte-reproducible across Node versions without package dependencies.

`manifest.json` lists SHA-256 and byte length for every payload file. It excludes
itself to avoid a circular digest. The archive contains that manifest plus all
payload files. `dist/SHA256SUMS` hashes both the ZIP and the external manifest.
The ZIP and SHA256SUMS are not recursively included in the ZIP. Extracted kits
can rebuild both outputs and run the same tests.

The immutable SDK and policy checks compare the payload to recorded source hashes;
when an upstream checkout is available, independently compare its actual bytes
at the recorded revision. A matching recorded hash alone does not establish that
a different upstream revision is compatible.
