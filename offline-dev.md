# Offline development

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

## Recommended complete kit

Download and extract `troy-game-dev-kit-v1.zip`, then run:

```powershell
cd .\troy-game-dev-kit-v1
node tools/troy-dev.mjs game
```

Before upload, repeat with the strict uploaded-bundle contract:

```powershell
node tools/troy-dev.mjs game --strict-upload
```

Strict mode applies the accepted extension policy, production MIME mapping,
and uploaded-document CSP. Both modes provide per-operation storage delay,
rejection and pending-request controls, plus discarded animation frames without
clearing the game's stored handle. Follow the
[storage fault matrix](testing.md#storage-and-startup-fault-matrix) and record
matching lifecycle event IDs, sequences and acknowledgement durations.
Use **Preview orientation** to switch the retained iframe between portrait and
landscape dimensions. This tests responsive behavior only; choose the matching
Best played metadata separately when uploading.

Open `http://127.0.0.1:4173/__troy/`.

The kit contains separate `game/` and `tools/` folders plus `overview.md`,
`lifecycle.md`, `storage.md`, `capture.md`, `assets.md`, `engines.md`,
`remixability.md`, `offline-dev.md`, `testing.md`, and the machine-readable `bundle-policy.json`
at its root.
The runner finds the sibling `troy-game-api-v1.js` and serves it to the game
through the production-identical `/shared/troy-game-api-v1.js` URL. Keep the
SDK filename unchanged.

Use **Request capture splash** on the control page to invoke the game's
registered representative capture view. The view remains visible for
inspection; choose **Reload / restore game** afterward to recreate the iframe
and return to normal play. This does not change how the game loads during
ordinary play.

This local control validates handler invocation and readiness, not the complete
automatic screenshot pipeline. It does not create a WebP, block remote
requests like the capture worker, or exercise the clean-page fallback. Inspect
the generated poster and test fallback behavior after uploading a temporary
test version, as described in `capture.md`.

The desktop control host proves TROY lifecycle delivery but cannot fully prove
Android interruption handling. Desktop responsive mode does not reproduce all
missing pointer cancellation, process suspension, screen-lock behavior, audio
wake failures, or WebView discard cases. Complete the real-device checks in
`testing.md` on Android.

## Existing static game

Place these files together in a tools folder:

- `troy-dev.mjs`
- `troy-game-api-v1.js`
- `bundle-policy.json`

Then run the host from that folder with a relative or absolute path to a game
folder containing `index.html`:

```powershell
cd C:\path\to\project\tools
node .\troy-dev.mjs "..\game"
```

Node.js 22 or newer is required. There is no package installation, Firebase
emulator, certificate, registry, or signed executable.

Use `http://127.0.0.1:4173/` for the standalone unavailable-mode test. Opening
`index.html` through `file://` is not supported because the SDK import is
root-relative.

For strict offline proof, disable the machine's external network adapter and
repeat the loopback workflow. If that would disrupt other work, inspect the
browser Network panel and confirm all requests stay on `127.0.0.1`, then
search the extracted source for external URLs. The second option proves asset
locality but should not be recorded as a physical offline test.
