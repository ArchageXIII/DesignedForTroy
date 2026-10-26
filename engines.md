# Complex HTML5 engine integration

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

Compiled engines such as Defold and Emscripten-based runtimes need a stronger
adapter than a small JavaScript game. Treat the exported engine as an opaque
runtime and put TROY integration in a maintained HTML wrapper or build template.
Do not repeatedly patch generated or minified engine files by hand.

This guide is engine-generic. It records patterns proven with a Defold 1.12.1
application, but engine globals, audio internals, frame callbacks, and archive
formats are version-specific. Inspect the generated runtime you actually ship
and keep those details behind a small adapter.

## Integration boundary

Disable generated fullscreen controls, auto-fullscreen startup hooks, pointer
lock and orientation lock in the maintained wrapper/export settings. Keep the
canvas inside the supplied viewport, resize responsively, and declare orientation
at upload. Do not alter iframe permissions or invoke ancestor APIs. Follow the
[embedded-play contract](assets.md#embedded-play-contract), including uploaded
game restrictions on popups, navigation, browser dialogs and downloads. Catch
unsupported/denied optional API calls without aborting engine boot or gameplay;
retain permitted sensor support and its fallback controls.

Keep three responsibilities separate:

1. **TROY host state** decides whether the retained iframe is the active game.
2. **The HTML adapter** translates lifecycle, storage, capture, browser, WebGL,
   presentation, input, and audio events into engine operations.
3. **The engine application** owns simulation, checkpoints, content state, and
   an optional heartbeat or explicit render-ready signal.

Prefer a source template plus a strict post-build validator. The validator
should fail the build when required lifecycle, presentation, audio,
or diagnostic markers disappear after an engine upgrade. Capture integration is
recommended; if implemented, also validate its markers and behavior.

## Package the browser build deterministically

- Put `index.html` at the bundle root. ZIP wrapper folders are normalized by
  TROY, but a root entry file makes local and uploaded inspection unambiguous.
- Run the kit with `--strict-upload`. Generated engines commonly emit unusual
  extensions, large archives, WebAssembly, and progressive-content files; only
  files that survive TROY's bundle policy will exist after upload.
- Use relative URLs for every game-owned file. Remote libraries, content
  servers, analytics, WebSockets, and service workers must not be boot
  dependencies.
- Keep required progressive or downloadable content inside the published
  bundle and fetch it from the same origin. A separate immutable content build
  ID is useful for cache keys and diagnostics.
- Generate the release folder and ZIP from one reproducible command. Validate
  entry count, expanded bytes, root `index.html`, required files, JavaScript
  syntax, and the final SHA-256 before upload.
- Distinguish the **wrapper build** from the **game content build**. Wrapper-only
  fixes may leave content packs unchanged while still requiring a new ZIP.

See [the bundle and asset contract](assets.md) for the current allowlist,
limits, MIME types, CSP, and ZIP rules.

## Make progressive content verifiable

If the initial shell loads optional packs later, publish a local catalog that
records a schema/profile version, content build ID, relative pack URL, byte
count, integrity hash, and an acyclic dependency graph. Cache and mount content
by build ID or hash, validate it before use, coalesce concurrent callers, and
do not advance gameplay state until every required dependency is verified.

The boot shell must contain the TROY bridge, first usable UI or loading state,
bounded Retry/Back failure controls, and the catalog/mount manager. Pause new
content work while inactive. A late request may finish in the background, but
defer its gameplay callback until TROY and browser state are active again.

Test corrupt-cache redownload, missing content, duplicate mount attempts,
dependency closure, and deterministic pack hashes. Engine-specific archive and
mount formats belong in the adapter; TROY only sees static same-origin files.

## Model lifecycle as two inputs

TROY lifecycle is authoritative. Browser events are recovery evidence, not
permission to run an off-screen retained game.

```js
let desiredActive = false; // latest TROY state
let browserActive = document.hidden !== true;
let engineReady = false;

function shouldRunEngine() {
  return desiredActive && browserActive && engineReady;
}
```

Store the initial TROY state even if it arrives before engine boot. On
`inactive`, synchronously stop update, rendering, transient input, audio, and
haptics; capture a checkpoint; then start a caught asynchronous save without
returning it from the handler. Make every pause and resume operation idempotent.

On `active`, resume in place. Browser `pageshow`, visible
`visibilitychange`, `resume`, or focus may reassert engine state only while
`desiredActive` remains true. They must never reload directly or override a
newer TROY inactive event.

## Resume in place before reloading

A robust activation sequence normally does all of the following:

1. invalidate stale recovery callbacks with a generation token;
2. reset transient pointers, touches, held controls, and timing state;
3. refresh the viewport and canvas only when dimensions changed;
4. re-enable engine update and rendering;
5. request one fresh engine/main-loop frame;
6. make a small bounded number of later recovery attempts;
7. start or coalesce one recovery watchdog for the activation generation.

Do not call `window.location.reload()` after every suspension. A reload discards
the retained runtime, adds another loading interval, and can race a newer
lifecycle event. Select fallback reload only after bounded recovery evidence
fails. Immediately before committing it, revalidate the lifecycle generation,
TROY authority, browser visibility, WebGL state, and latest heartbeat/render
evidence. Checkpoint first and allow only one reload attempt per generation.

A restored WebGL context or newer lifecycle event must cancel an uncommitted
fallback. Show **Restoring game…** only after reload is actually selected.

## Prove presentation before reveal

These are different states:

- JavaScript is executing;
- the engine heartbeat is advancing;
- update frames are advancing;
- WebGL exposes non-black pixels in its drawing buffer;
- the child has crossed browser paint boundaries;
- the browser has composited the iframe visibly.

One does not prove the next. In particular, `readPixels()` can observe retained
or stale WebGL pixels while a mobile iframe remains black.

Keep a presentation veil visible on initial boot, fallback-reload boot, and a
real foreground recovery. Treat an application request to hide it as
**content-ready**, not immediate permission to expose the canvas. Reset proof
for each activation generation and release the veil only after fresh evidence,
for example:

- heartbeat and engine-frame counters both advance;
- two non-black probes succeed on distinct later engine frames;
- at least one browser `requestAnimationFrame` separates the probes;
- a final browser animation frame completes before the veil is hidden.

The exact proof must fit the game. A deliberately black scene needs an explicit
engine presentation signal rather than a color probe. Framebuffer probes must
save and restore the engine's framebuffer bindings; bind the default read
framebuffer only for the probe.

Child proof is still not compositor proof. TROY may briefly cover and
recompose the current iframe after foreground activation. Do not interpret that
host treatment as a new boot or lifecycle event, and never manipulate adjacent
retained slots from the child.

## Handle WebGL loss independently

Call `preventDefault()` on `webglcontextlost` when the engine supports restored
contexts. Record the transition and keep a bounded watchdog running even while
the context is lost. On `webglcontextrestored`, cancel any selected-but-not-
committed reload, reapply engine state, reset presentation evidence, and begin a
fresh recovery generation.

Do not use canvas resizing as a generic compositor nudge: changing backing
dimensions can destroy engine state. Separate engine recovery from host iframe
recomposition.

## Make capture a separate presentation mode

Register the capture handler during initialization. A static bundled gameplay
image is often the safest representative view for a complex engine because it
does not depend on progressive content or a particular simulation state.

Before resolving the handler:

1. display and decode every capture asset;
2. verify natural dimensions and non-zero rendered layout;
3. suppress loading or recovery veils **for capture only**;
4. wait for later browser paint frames;
5. then report capture readiness.

Check capture z-index ordering explicitly. A perfectly decoded capture layer can still
be hidden beneath a dimming or **Resuming game…** overlay. Capture success does
not prove that ordinary gameplay boot succeeds, and ordinary boot does not
prove capture readiness.

## Unlock the actual audio context from trusted input

Lifecycle activation is not browser gesture authorization. Resume Web Audio
synchronously inside a trusted child `pointerdown`, `touchend`, `click`, or
`keydown` handler, and retry on a later gesture when necessary.

For engines with a canvas-only unlock hook, use a capture-phase listener on the
child document so a gesture targeting the game's own recovery veil is still
observed. Do not cancel, forward, or synthesize the gameplay event.
Parent events do not cross the iframe boundary, and a host activity listener
must never prevent or stop the original child input.

```js
document.addEventListener("pointerdown", (event) => {
  if (!event.isTrusted || !desiredActive || !browserActive) return;
  const context = engineAdapter.getAudioContext();
  if (context?.state === "suspended" || context?.state === "interrupted") {
    try {
      // Invoke synchronously inside the trusted handler; denial is non-fatal.
      void Promise.resolve(context.resume()).catch(() => {});
    } catch { /* Retry on a later explicit sound gesture if supported. */ }
  }
}, { capture: true, passive: true });
```

Resolve the audio context through an engine-version adapter. For example,
Defold 1.12.1 used `window._dmJSDeviceShared.audioCtx` in the tested build;
other Defold or SDL/Emscripten versions may expose a different path. Never
assume a copied global exists without inspecting the generated runtime.

Suspend the real context on TROY inactive. Some engines also install their own
canvas gesture handler; if it can resume an inactive retained iframe, observe
the context and re-suspend a transition to `running` while either authoritative
state is inactive. Repeated trusted gestures should be idempotent once audio is
running.

## Reset retained input state

A retained iframe can preserve pointer capture, touch identifiers, mouse and key
maps, gestures, gamepad state, and vibration across suspension. Clear those
transient states synchronously on TROY inactive and before a fallback reload so
the returning game cannot inherit a held or duplicated control.

Prefer the engine's native input-reset or focus-loss hooks. Bridge-level blur,
pointer-cancel, touch-cancel, and `navigator.vibrate(0)` calls can be useful safety
nets, but synthetic DOM events are not a universal replacement for clearing the
engine's internal state.

During ordinary play, pointer up/cancel releases only that pointer, and keyup
releases only that key. Full input reset belongs to suspension/focus loss;
test mixed keyboard/pointer input so one release cannot cancel the other.

## Keep bounded correlated diagnostics

Persist a bounded `sessionStorage` ring that can distinguish a retained failure
from a fallback reload. Useful fields include:

- boot UUID, previous boot UUID, wrapper build, and content build ID;
- TROY lifecycle reason and sequence, desired state, browser state, and
  document visibility;
- heartbeat, engine frame, presentation generation, probe candidates, and
  confirmed frame;
- WebGL loss/restoration, watchdog start/outcome, and reload selection/commit;
- content-ready, veil show/hide, and capture-ready ordering;
- audio context source/state, trusted event type, and resume/suspend outcome.

Do not record player identity, checkpoint content, access tokens, or unbounded
engine logs. Optional last-value `data-*` attributes can expose safe state to an
isolated local harness when page globals are inaccessible.

## Acceptance matrix

Before upload, test the real generated release through the strict runner:

- initial active and initial inactive boot;
- repeated retained inactive/active cycles with the same iframe;
- a deliberately discarded animation frame;
- held pointer, touch, key, gamepad, and haptic state across suspension;
- browser `pagehide`/`pageshow` recovery while TROY authority remains active;
- WebGL context loss/restoration and reload cancellation;
- content success followed by proof-before-reveal;
- capture while a recovery veil is deliberately visible;
- first audio unlock, repeated gestures, and an inactive-iframe gesture race;
- fallback reload with a checkpoint and exactly one new boot UUID;
- ZIP policy, MIME, CSP, asset locality, and delayed console errors.

Then use the uploaded preview and a real mobile device. Desktop and synthetic
harnesses cannot fully prove OS process suspension, a genuinely hidden mobile
document, compositor visibility, screen lock behavior, or trusted-event audio
authorization. Record those as explicit device acceptance gates rather than
claiming them from responsive emulation.

Synthetic clicks may also occur entirely between two engine frames. Hold a
test interaction long enough for the engine to sample it when validating input
delivery; this timing is test-harness behavior, not a reason to synthesize input
in the integration.

## What not to generalize

- Internal engine globals and exported function names are version-specific.
- Heartbeat intervals, watchdog durations, recovery delays, and probe regions
  are tuning values, not TROY protocol requirements.
- Non-black probing is unsuitable for every art style or loading scene.
- Progressive-content mount rules and checkpoint schemas belong to the game.
- TROY does not require a reload fallback, a particular overlay design, or
  Defold-specific Lua hooks. It requires prompt lifecycle acknowledgement and
  leaves recovery implementation to the game.

Use [lifecycle.md](lifecycle.md), [capture.md](capture.md),
[assets.md](assets.md), and [testing.md](testing.md) for the normative TROY
contract and focused acceptance recipes.

## Startup content budget

Keep the bootstrap and first playable scene separate from later engine content.
Use engine-supported lazy content loading through the maintained adapter, not
patches to generated output or a second persistent download cache. Fetching a
chunk does not prove it has been decoded, mounted, uploaded to the GPU or
presented. Preserve the content-integrity and presentation checks above.
See [Fast first play and TROY caching](assets.md#fast-first-play-and-troy-caching)
for required URL/cancellation rules, on-demand defaults and measurement evidence.
