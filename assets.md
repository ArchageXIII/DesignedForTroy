# Uploaded bundle and asset contract

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

A TROY game is a browser-ready static folder with an `index.html` entry file.
Upload compiled browser output, not source files that still require a development
server. Use `./relative-paths` for game-owned files. The only TROY-owned
root-relative game import is `/shared/troy-game-api-v1.js`.

## Accepted file types

| Kind | Extensions |
| --- | --- |
| HTML, styles, and modules | `.html`, `.htm`, `.css`, `.js`, `.mjs` |
| Data, 3D, and WebAssembly | `.bin`, `.glb`, `.gltf`, `.json`, `.txt`, `.wasm` |
| Images | `.gif`, `.ico`, `.jpeg`, `.jpg`, `.png`, `.svg`, `.webp` |
| Audio and video | `.m4a`, `.mp3`, `.mp4`, `.ogg`, `.wav`, `.webm` |
| Fonts | `.otf`, `.ttf`, `.woff`, `.woff2` |

Extensionless files are accepted for compatibility and served as
`application/octet-stream`. Give startup-critical files an explicit supported
extension. Files outside this policy are skipped by the uploader and cannot be
published as part of a new bundle.

Each individual file must be smaller than 50 MiB. TROY does not currently set
a hard total-bundle limit, but bundles over 100 MiB or 500 files receive a
warning because upload, publication, first play, and remix inspection can take
materially longer. Prefer loading large audio, video, and 3D assets only when
the current screen or level needs them.

## ZIP uploads

The upload workspace accepts one `.zip` archive as an alternative to selecting
loose files or a folder. ZIP is a transport format only: after upload, TROY
validates and expands the accepted contents into the same versioned bundle used
by every other upload path. When a loose selection contains 200 or more files,
the workspace suggests ZIP because one transfer is usually faster, but the
developer can continue with the loose files.

ZIP archives must be smaller than 250 MiB and may contain at most 10,000 total
entries, 5,000 accepted game files, and 1 GiB of expanded file data. The normal
50 MiB per-file limit still applies. Encrypted entries, symbolic links, unsafe
or duplicate paths, paths over 512 UTF-8 bytes, and oversized manifests are
rejected. Unsupported files are skipped as they are for folder uploads.

Archive tools often add one or more wrapper folders. TROY repeatedly removes a
shared leading folder while every file is still below it, so an archive shaped
like `download/empty/my-game/index.html` is staged with `index.html` at the
bundle root. Normalization stops as soon as files occupy the current root or
the contents branch into different root folders.

The machine-readable policy, including the MIME type for every extension, is
[`bundle-policy.json`](bundle-policy.json).

## Remixable file sizes

Upload eligibility and remix eligibility are separate. To keep a game
remixable, every individual `.css`, `.htm`, `.html`, `.js`, `.json`, `.mjs`,
and `.svg` file must be 1,000,000 bytes or smaller. Aim for 750,000 bytes or
less per editable file so later changes have room to grow. See [Keep a game
remixable](remixability.md) for the full rule, recommendations, and a local
size-check command.

## Loading restrictions

Uploaded game documents use a restrictive Content Security Policy. Same-origin
`fetch()` and XMLHttpRequest are supported so games can load bundled JSON,
WebAssembly, audio buffers, and 3D assets. External connections, WebSockets,
EventSource, and remote API calls remain blocked by `connect-src 'self'`.

For maximum compatibility:

- use relative URLs for bundled assets, including same-origin `fetch()` calls;
- ship small startup data as local JavaScript modules when that avoids an extra
  request;
- use ordinary `<img>`, `<audio>`, `<video>`, stylesheet, and font loading for
  supported media;
- do not depend on remote APIs, CDNs, remote scripts, or service workers;
- vendor third-party browser libraries inside the bundle rather than loading
  them from a CDN.

```js
// dictionary-data.js
export const words = ["arc", "orb", "troy"];

// game.js
import { words } from "./dictionary-data.js";
```

The CSP is a security boundary and is intentionally stricter than a normal
local static server. Do not work around it with encoded network requests.

## Embedded-play contract

Games must stay in the supplied viewport and keep TROY navigation available.
Use responsive layout and declare the game's Best played orientation at upload;
do not request browser fullscreen on the game or an ancestor document. Do not
change iframe permissions or invoke parent capabilities to bypass restrictions.
Uploaded games must not use pointer lock, orientation lock, popups, top-level
navigation, browser modal dialogs, beforeunload traps, or browser downloads.
Permitted accelerometer and gyroscope use remains available subject to browser
support and user permission; provide a usable fallback when unavailable.

The supported host contract denies fullscreen on the application document and
game responses with `Permissions-Policy: fullscreen=()`. Game iframes use
`allow="accelerometer; gyroscope; fullscreen 'none'"` and uploaded frames use
`sandbox="allow-scripts allow-same-origin"`. Uploaded HTML and SVG additionally
receive CSP `sandbox allow-scripts allow-same-origin`. A child changing an iframe
attribute cannot relax the ancestor response's fullscreen policy. Internal
hosted frames may additionally grant `allow-downloads`; that is not an uploaded
game permission and the upload harness does not grant it.

These grants are not complete hostile-code containment: same-origin scripts can
access ancestor DOM and capabilities. Do not rely on sandbox attributes as full
same-origin isolation, or work around a denied capability via the parent.
Catch synchronous exceptions and rejected promises from supported optional APIs;
unsupported or denied audio, sensors or haptics must not abort startup or play.
Remove forbidden engine calls rather than retrying them. Continue lifecycle,
independent input cleanup, gesture-gated audio and meaningful-state API storage.
See [containment acceptance](testing.md#embedded-play-containment) for local
checks and separate uploaded-preview/device evidence requirements.

## Startup order

Assume lifecycle delivery, resize events, animation frames, capture
registration, and delayed callbacks can occur while the game is starting.
Assign safe defaults before registering callbacks, and start cosmetic timers
only after the seed, restored checkpoint, and core engine state exist:

```js
let random = Math.random;

// Register handlers only after their dependencies have safe defaults.
random = createSeededRandom(seed);
startDecorativeSimulation();
```

## Local and uploaded parity

Success in the ordinary local runner proves API integration, lifecycle, and
basic static serving. It does not prove upload filtering, production MIME
types, or uploaded CSP behavior. Run the local host with `--strict-upload` to
apply the published bundle policy and CSP, then repeat an ordinary uploaded
preview boot before publishing.

An automatic Splash Screen and ordinary gameplay are separate startup paths.
A successful capture does not prove that a normal game load becomes
interactive.

Compiled engines should generate a deterministic release folder and validate
the final uploaded shape rather than a source project or intermediate export.
Keep engine-version globals behind a maintained wrapper, correlate wrapper and
content build IDs, and fail the build if lifecycle or presentation hooks are
lost. See [complex HTML5 engine integration](engines.md).

## Fast first play and TROY caching

**TROY manages background saving; the game manages first-play loading cost.**
Agents: apply the required rules, use the recommended defaults unless the game
needs a documented exception, and include the acceptance evidence below with
the delivered bundle. Existing lifecycle, audio, storage, capture and upload
requirements still apply.

### Required rules

- Make the first usable screen work with Downloads off and an empty browser
  cache. Never wait for a complete TROY download before allowing play.
- Keep bundled URLs stable and relative: `./levels/one.json`, or
  `new URL('./levels/one.json', import.meta.url)` in a module. Do not add random
  or timestamp query parameters, force `cache: 'no-store'`/`'reload'`, or add
  application cache-busting to versioned assets. Query and range requests bypass
  TROY's package cache; unnecessary variations lose that benefit.
- Do not install a competing service worker, write into TROY's Cache Storage or
  IndexedDB, call reserved package endpoints, or make the game decode TROY
  packages. Continue requesting normal files; TROY supplies eligible cached
  responses transparently. `troy.storage` is for saved progress, not asset bytes.
- Preserve synchronous lifecycle acknowledgements. Abort deferred fetches on
  inactive/hidden, stop scheduling optional work, and ignore results from an
  abandoned load or activation. Never await downloads in a lifecycle handler.
- Keep importable feature modules free of top-level fetches, timers, rendering
  and audio. `import()` cannot be cancelled with `AbortController`; guard late
  completion before fetching data or applying results. Resume only while the
  latest TROY lifecycle permits it; browser wake alone does not grant activation.
- Give loading a bounded failure state and explicit retry. A failed optional
  asset must not disable the opening game. A missing essential asset needs an
  honest error/retry screen rather than a permanent spinner or false readiness.

TROY prepares compressed download packages when uploaded games are published.
Opt-in background saving verifies the complete package before serving files
from it. Ordinary HTTP caching also operates independently. Completed packages
still undergo freshness and publication-access checks, may be evicted, and do
not guarantee offline play. Draft previews and internal hosted games do not use
uploaded-game download packages. Do not infer package availability from a fast
request, and do not depend on an undocumented game-facing cache-status API.

### Recommended defaults

1. **Opening screen:** deliver small HTML/CSS, the minimum game logic, and only
   assets needed for the first usable scene. Render the shell promptly. Wait for
   saved state where it affects correct play; do not start a new run that can
   overwrite an existing checkpoint while restoration is pending.
2. **On demand:** load later levels, optional features, music and cosmetics when
   requested. Use `import('./feature.js')` for code and `fetch()` for level data.
   Avoid one startup `Promise.all` over the whole game's inventory. Use preload
   only for measured critical dependencies; modulepreload also fetches deferred
   code early and can defeat the intended split.
3. **Optional look-ahead:** only after the opening scene is usable, consider one
   likely next content group at a time. Deduplicate in-flight loads, retain useful
   decoded data within a bounded memory budget, release obsolete textures/audio,
   and pause speculative work when inactive. Do not prefetch the full game.
4. **Media:** use appropriately sized textures and images, small local fonts
   with usable fallbacks (`font-display: swap` for ordinary UI), and defer large
   audio/video. Do not await all fonts or audio before showing a screen that can
   use a fallback. Decode only what the current scene needs. Keep gesture-based
   audio unlock and inactive audio suspension unchanged.
5. **Code and content:** split around levels and feature boundaries, preserving
   the existing remix-editable file limits. Avoid giant startup bundles, base64
   media embedded in code, and hundreds of tiny dependent startup modules.
   TROY's decoded blocks are at most 4 MiB, but that is not an application chunk
   target: the server packs files automatically, and files can span blocks.

Deferred loading reduces first-play requests, parsing and decoding. It does
**not** reduce a complete background save: every packaged game file is included,
even optional content. Remove unused files and duplicate assets to reduce total
download/storage cost. TROY-managed capture artwork is handled separately.

Downloaded bytes, parsed code, decoded images/audio, uploaded GPU resources and
an actually usable screen are different milestones. HTTP completion alone does
not prove engine readiness. For compiled engines use the maintained adapter and
content/presentation checks in [engines.md](engines.md); do not hide the loading
veil merely because the bootstrap or SDK connected. Capture may load its own
representative scene without making those assets startup dependencies for play.

### Runnable example

The [canonical starter](game/README.md) keeps its existing game usable while
**Load bonus content** imports `bonus-content.js` and fetches
`bonus-content.json`. Neither optional resource is requested at boot. The small
`bonus-loader.js` coordinator is a startup dependency; its job is deduplication,
a ten-second deadline, cancellation and stale-result protection.

```js
// Inside a deferred, side-effect-free module; called only when the player needs it.
export async function loadLevel(signal) {
  const response = await fetch(new URL('./levels/one.json', import.meta.url), { signal });
  if (!response.ok) throw new Error(`Level returned HTTP ${response.status}`);
  return response.json(); // Validate the game's data schema before using it.
}
```

The caller catches errors, clears failed in-flight state, and offers explicit
retry with the same URL. Successful imports are cached by the browser; some
module failures can remain cached for the document lifetime. Repeated module
failure should offer a game reload, not an endless retry loop or random URL.
Cancellation must also cover a timeout during body consumption. A late import
must not start a data request after cancellation.

### Acceptance checks and agent delivery report

- Test cold first play with Downloads off, then warm HTTP play and a verified
  saved package separately. The strict local runner does not emulate TROY's
  package worker: verify that case in the uploaded emulator workflow.
- Delay or block optional content. The first usable scene and its core controls
  must still work, with no optional module/data requests before user demand.
- Test repeated clicks, HTTP failure, invalid JSON, a stalled body, inactive
  during import/fetch, and reactivation. No duplicate load, stale UI application,
  uncaught rejection, or automatic full-game download should result.
- Test capture separately; all existing lifecycle, save/restore, audio and
  real-device interruption checks remain required.
- Report the exact build, device/browser, viewport, connection simulation and
  cache state; startup dependency list; deferred content and trigger; request
  count, transferred bytes and time to the first usable screen. Report parsing/
  decoding stalls separately where measured. Do not report first paint or a
  hidden engine heartbeat as playable readiness, or present synthetic desktop
  measurements as phone performance. State untested cases explicitly.

Remix eligibility also requires at most **10,000,000 uncompressed bytes (10 MB)**
and **500 accepted game files**, inclusive. All assets count, including media
and binary files. Only editable extensions have the 1,000,000-byte per-file
ceiling. See [remix eligibility](remixability.md).
