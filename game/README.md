# TROY Game API v1 starter

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

This is the canonical runnable starter included in
`troy-game-dev-kit-v1.zip`. It needs Node.js 22 or newer, but no npm install.

Keep it in the supplied viewport under the
[embedded-play contract](../assets.md#embedded-play-contract). Focus the animation
stage and hold an arrow key while pressing/releasing a pointer: the visible key
count must remain held. Pointer cancellation releases only its own pointer;
Set off-screen clears all keys and pointers. Sound starts only through Enable
sound; unsupported/denied audio leaves play working and offers another gesture.

At the second playable animation frame, `body.dataset.firstUsableMs` records
milliseconds since navigation and `body.dataset.startupResources` records local
resource timing URLs/bytes. These diagnostics exclude later bonus content and
are local measurements, not a host API or physical-device performance claim.

Abbreviated extracted-kit layout (the full kit also includes MCP, tests, provenance and build scripts):

```text
troy-game-dev-kit-v1/
├── game/
│   ├── index.html
│   ├── game.js
│   ├── bonus-loader.js
│   ├── bonus-content.js
│   └── bonus-content.json
├── tools/
│   ├── troy-dev.mjs
│   ├── troy-game-api-v1.js
│   └── troy-mcp.mjs
├── overview.md
├── lifecycle.md
├── storage.md
├── capture.md
├── assets.md
├── engines.md
├── offline-dev.md
├── testing.md
├── bundle-policy.json
└── README.md
```

From PowerShell:

```powershell
cd .\troy-game-dev-kit-v1
node tools/troy-dev.mjs game
```

Add `--strict-upload` to apply the uploaded extension, MIME, and CSP contract
before opening a TROY preview.

Open `http://127.0.0.1:4173/__troy/`. The runner finds the SDK beside
`troy-dev.mjs` and serves it to the game at
`/shared/troy-game-api-v1.js`. Keep the SDK filename unchanged.

Use the control page to set the game off-screen, reload or evict it, simulate
rapid swipes, and switch fake players. To test the standalone fallback, open
`http://127.0.0.1:4173/` in another tab. Do not double-click `index.html`; a
`file://` page cannot resolve the root-relative SDK URL.

After the starter subscribes, the host shows
`Lifecycle managed · retention protected`. Storage use without a subscriber
shows legacy reload behavior. A rejected or two-second lifecycle handler
changes the same iframe instance to `Lifecycle faulted · legacy reload`.

Press **Request capture splash** to invoke the starter's registered
representative in-play view. TROY uses the same hook for automatic screenshots
but never calls it during ordinary game swipes. The local host deliberately
leaves the view visible for inspection; choose **Reload / restore game** to
return to normal play.

The first press of **Enable sound** satisfies browser autoplay rules. After
that user gesture, lifecycle events suspend and resume the audio context.

Press **Run all API checks** for a non-destructive exercise of ready,
lifecycle subscribe and unsubscribe, load, save, clear, standalone returns,
and `TroyApiError`. In the local host it also checks capture handler validation,
replacement, unregister behavior, rejection, and timeout. The check restores
the current score and canonical capture registration when it finishes.

The local host does not take the production WebP, block remote requests like
the automatic capture worker, or run the clean-page fallback. Follow the
post-upload acceptance checks in `capture.md` before publishing.

The full reference is also included at the top of the extracted kit:

- [Complete API reference](../overview.md)
- [Lifecycle guide](../lifecycle.md)
- [Storage guide](../storage.md)
- [Automatic capture splash guide](../capture.md)
- [Uploaded bundle and asset contract](../assets.md)
- [Complex HTML5 engine integration](../engines.md)
- [Offline development](../offline-dev.md)
- [Testing checklist](../testing.md)

## Restore and save without blocking lifecycle

The starter registers lifecycle before waiting for its saved score. During a
pending or failed load, it acknowledges inactive immediately, keeps gameplay
paused and avoids saving default progress. **Retry saved state** starts an explicit
new restoration attempt; an older result cannot replace newer restored state.
Play controls become available only after a successful, supported snapshot or
successful empty load. Capture remains available while restoration is pending.

Use the host's per-operation storage overrides to test 2.5-second, rejected and
never-resolving saves independently of initial Load. Inactive saves are caught
and detached; another checkpoint can be attempted even if the previous one never
settles. Follow the [fault matrix](../testing.md#storage-and-startup-fault-matrix)
and compare matching ACK timing with storage completion.

## Load optional content without delaying play

The initial game imports the tiny `bonus-loader.js` coordinator. **Load bonus
content** then dynamically imports `bonus-content.js` and fetches the relative
`bonus-content.json`. Both optional files stay off the startup request path.
The module has no top-level effects. The coordinator deduplicates requests,
aborts after ten seconds or inactivity, ignores late results, and offers retry.
It does not change scores, start audio or load during ordinary capture.

Keep playing while the optional request is delayed or fails. Reactivation does
not restart optional work automatically. Module imports cannot be aborted;
repeated module failures may require reloading the game with the same URLs.
See [the loading rules and delivery checklist](../assets.md#fast-first-play-and-troy-caching).

For this starter only, `performance.getEntriesByName('troy-starter-first-usable')`
records when the initialized, interactive opening scene crosses a frame boundary.
It is not a SDK readiness API or a substitute for a compiled engine's own
presentation proof. The strict runner serves game files with `no-store`, so a
repeat local load does not measure TROY's HTTP or package-cache savings.
