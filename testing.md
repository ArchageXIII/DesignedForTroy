# Integration test recipes

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

Run these from `http://127.0.0.1:4173/__troy/`:

1. **Connection:** confirm the game shows `development / available` and the
   host shows `Lifecycle managed`.
2. **Save and restore:** Add score, Set off-screen, Reload / restore game, and
   confirm the score returns.
3. **Player isolation:** enter a different fake player ID, press Enter or
   Apply player, confirm score 0, then switch back and confirm the original
   score.
4. **Pause and resume:** note the frame count, Set off-screen, confirm it
   stops, then Set active and confirm it advances.
5. **Rapid swipe:** Clear log, Simulate rapid swipes, and confirm one settled
   active lifecycle send rather than intermediate activation spam.
6. **Initial off-screen:** Reload off-screen and confirm the game reports
   inactive while the orb remains stationary.
7. **Eviction:** Add score, Set off-screen, Evict then restore, and confirm the
   score returns.
8. **Quota:** press Test the 64 KiB quota and confirm `QUOTA_EXCEEDED`.
9. **Complete contract:** press Run all API checks and confirm the starter
   reports that all public API and local capture contract checks passed and the
   score was restored. The capture checks cover an invalid handler,
   replacement, stale and active unregister behavior, rejection, and timeout;
   the timeout check takes about five seconds.
10. **Audio isolation:** start music from its explicit in-game control and note
   each media element's `paused` and `currentTime` values. Set off-screen and
   confirm every media source is paused and its playback time remains stable.
   Set active and confirm only player-enabled looping music resumes; interrupted
   one-shot effects stay stopped. Reload off-screen and confirm boot does not
   autoplay or briefly start sound. Repeat with Web Audio and confirm its context
   suspends and resumes. The initial explicit gesture is required by browser
   autoplay policy.
11. **Capture splash:** press Request capture splash and confirm the starter
    switches to its representative in-play view and the protocol log reports
    a successful capture splash result. The host deliberately leaves that view
    visible for inspection; press Reload / restore game to return to normal
    play.
12. **Standalone:** use Open the game directly, or open
    `http://127.0.0.1:4173/`, and confirm `standalone / unavailable` with no
    runtime error. Do not use `file://`.
13. **Offline:** use one of the proof levels below and repeat connection,
    lifecycle, reload, and restoration checks.
14. **Strict upload:** restart with `--strict-upload`; confirm unsupported files
    return 404, startup-critical modules use production MIME types, and normal
    boot has no CSP violations.
15. **Orientation:** switch Preview orientation between Portrait and Landscape;
    confirm the same iframe responds without a reload and remains usable in the
    game's declared Best played orientation.
16. **Abandoned frame:** choose **Discard pending frame**, send another active
    event, and confirm exactly one animation loop resumes instead of freezing
    or running at double speed.
17. **Storage faults:** run the [storage and startup fault matrix](#storage-and-startup-fault-matrix),
    including a 2.5-second save, rejection and a never-resolving request. Confirm
    each inactive acknowledgement arrives before delayed storage settles and
    that an abandoned save does not prevent a later checkpoint attempt.
18. **Engine adapter:** for compiled runtimes, repeat the engine-specific matrix
    in `engines.md`: retained recovery, discarded frame, presentation proof,
    context loss, capture-over-veil, trusted audio unlock, and exactly one
    checkpointed fallback reload when recovery is deliberately made to fail.

The browser console should have no unhandled rejection or missing-favicon
noise.

## Embedded-play containment

Run the strict harness and open **Open containment probe** in a separate tab;
do not reload an active game automatically. Both parent and game responses must
show `Permissions-Policy: fullscreen=()`. Inspect the iframe's sensor grants,
`fullscreen 'none'`, and `sandbox="allow-scripts allow-same-origin"`; strict
HTML/SVG responses also carry the CSP sandbox. Repeat from a freshly extracted
kit. This checks the supported contract, not complete hostile-code isolation.

- Click Direct fullscreen, Parent fullscreen and Tamper permissions then
  fullscreen separately, with a fresh trusted gesture each time. All must reject
  while fullscreen remains absent and host controls remain visible. The probe
  restores the changed permission attributes even on failure. Do not count an
  unsupported API, missing policy introspection or activation error as a pass.
- Click Pointer lock, Orientation lock, Popup, Top navigation, Browser confirm
  and Browser download. Record exact rejection/console evidence and visible
  effects. An unsupported orientation API is inconclusive. A null popup result
  alone can be browser popup blocking; require the sandbox-specific diagnostic.
  Modal return values and download attempts cannot prove denial from page code:
  inspect browser diagnostics and downloads, or report inconclusive. Manually
  test beforeunload suppression in an isolated disposable fixture if needed;
  this probe does not install a navigation trap. Never infer untested results.
- After denials, Normal play must increment, Set off-screen must pause input
  and checkpoint, and Set active must resume without recreation. Also run the
  real starter's score, frame, restore, audio and complete API checks.
- Hold an arrow key on the starter stage while pressing/releasing a pointer.
  The held-key count must survive pointerup/cancel; releasing one pointer must
  preserve any other pointer, and keyup must preserve pointers. Inactive, blur
  and hidden-document resets must clear all transient input. Deterministic Node
  regressions exercise cancellation and concurrent inputs; distinguish those
  from trusted browser gestures and physical touch tests.

Expected console messages identify denied fullscreen/sandbox operations and
Chromium may warn about scripts plus same-origin sandbox grants. Uncaught
rejections, startup failures and lost normal input are unexpected. Report URL,
auth/fake-player label, visible proof, console messages and inconclusive cases.
Local harness results do not establish uploaded-preview, capture-worker,
physical-phone background/rotation behavior or production deployment. Repeat
the applicable uploaded and device acceptance checks for the changed build.

## Storage and startup fault matrix

The local host retains **Default storage response** (Immediate, 500 ms,
1.5 seconds, Never resolve) and adds **2.5 seconds** and **Reject request**.
The Load, Save and Clear overrides select one operation independently; **Use
default** inherits the default selector. Settings are captured when each request
starts. Changing a setting does not release an already pending request; retry
explicitly after selecting Immediate. The host lifecycle deadline stays **2000 ms**.

1. Boot with immediate Load, add score, and select Save 500 ms, 1.5 seconds,
   then 2.5 seconds in separate runs. Set off-screen and inspect the log: correlate
   `lifecycle sent` and `lifecycle acknowledged` by `eventId` and `sequence`.
   Record `elapsedMs`, successful ACK, stationary gameplay and managed retention.
   The ACK must precede the matching `storage saved`, even when the save exceeds
   two seconds. Storage logs identify the request, not its checkpoint contents.
2. Repeat with Save **Reject request** and **Never resolve**. The game must catch
   save failure, remain managed and resume in the same iframe without an unhandled
   rejection. Switch Save to Immediate, activate, change score, then set off-screen:
   a new save request must be attempted and succeed while the earlier request is
   still pending. Restore the latest score in a fresh iframe.
3. Save a known score first. Select Load **Never resolve**, then **Reload off-screen**.
   Verify inactive ACK while Load is pending, no animation/audio, no new save,
   and disabled gameplay controls. Select Load Immediate and use **Retry saved
   state**: the saved score returns and the game stays inactive until Set active.
4. Repeat initial active and inactive boot with Load **Reject request** and
   **2.5 seconds**. Failure must offer explicit retry without overwriting stored
   progress. If retry completes first, an older load's success or rejection must
   not overwrite current progress or its status. A pending load must not block ACK.
5. Request capture while Load is delayed. Let capture become ready, then let Load
   finish: the representative capture stays visible and stationary. Reload with
   immediate storage to verify that the actual saved score remains intact.
6. Repeat using the default selector with each override set to **Use default**;
   then prove an Immediate override works while the default is Never resolve.
   Return all controls to Immediate/Use default before **Run all API checks**.

`node scripts/test.mjs` executes the actual starter, bundled SDK and generated
control-page script with deterministic DOM, message-port and timer fixtures.
The regressions include a deliberately incorrect handler that returns a delayed
save: it must fault at exactly 2000 ms, and a late ACK must not restore managed
retention. This negative control ensures the test can detect the original mistake.
These tests do not prove browser rendering, trusted gestures, uploaded persistence,
or physical-device suspension; complete the Browser and uploaded checks separately.

## Uploaded-preview normal boot

Capture acceptance and gameplay boot are separate checks. After upload:

1. request and inspect the automatic Splash Screen;
2. reload the preview normally and confirm loading reaches interactive play;
3. wait at least ten seconds for delayed initialization or cosmetic-timer
   errors;
4. verify startup modules return JavaScript with the expected MIME type;
5. confirm same-origin asset fetches succeed and external connections remain
   blocked by uploaded CSP;
6. perform one real interaction so audio and media paths are exercised;
7. verify the loading screen has a bounded failure state or useful diagnostics;
8. repeat at the actual embedded play viewport, not only the 430 by 932 capture
   viewport.

An empty TROY protocol log proves only that no host/API bridge error was
reported. Module imports, game-owned asset failures, rendering exceptions, and
rejected game promises can occur entirely inside the iframe. Inspect the iframe
console and the strict runner's forwarded game-error entries.

## Real Android interruption checks

Desktop responsive mode is not sufficient for final interruption acceptance:

1. begin steering with one finger, navigate the game off-screen, release, and
   return; input must be neutral;
2. hold multiple controls, switch Android apps or lock the phone, then return;
3. repeat after leaving the app backgrounded long enough for suspension or
   discard;
4. confirm multi-touch does not trigger pinch zoom, text selection, long-press
   menus, or page scrolling;
5. confirm inactive retained iframes stop simulation, rendering, timers, audio,
   and haptics;
6. change viewport or orientation while inactive and confirm layout refreshes
   before the first resumed frame;
7. repeat background and foreground cycles and confirm exactly one game loop
   resumes each time.

## Console attribution

The control page records page errors in its protocol log with the source URL,
line, and column the browser provides. Errors sourced from `troy-dev.mjs`,
`/__troy/`, `/shared/troy-game-api-v1.js`, or a game file belong to the kit or
game and should be investigated.

Extensions, accessibility tools and browser automation can inject scripts with
a blank source, an extension URL or `unknown or injected source`. A missing URL
or isolated execution context does not establish that an error is harmless.
Use the approved Browser's supported diagnostics to correlate the exception's
script and execution context; inspect a bounded source/stack excerpt if available.
Keep private tooling source and application logs outside the public repository.

Compare the directly opened game, a minimal page without scripts, and a minimal
iframe page. Separate navigation/initialization from later observations and
interactions. Check input, rendering, lifecycle and affected Browser features;
record which behavior still works and which remains unverified. A deliberate
error in a disposable game fixture can verify that genuine page errors still
reach the iframe console and harness log. Do not suppress errors or change
browser/security settings to obtain a clean console. Follow the tooling-failure
policy in [AGENTS.md](AGENTS.md); preserve unresolved ownership or impact when
the evidence is insufficient. The runner and SDK do not use `MutationObserver`,
but that fact alone cannot attribute every observer error or validate gameplay.

## Automatic capture acceptance

The local host invokes the same registered handler and waits for visual
readiness, but it is not a screenshot-worker simulator. It does not create the
430 by 932 WebP, impose the worker's remote-request restrictions, or execute a
clean reload and default capture after failure.

After uploading the locally tested bundle, inspect its generated poster. Then
use a temporary test version with no handler and another whose handler mutates
the page before rejecting. Confirm both use a clean normal-page fallback rather
than capturing partial splash state. Confirm the final valid splash uses only
bundled, `data:`, or `blob:` assets before publishing.

## Production-feed retention acceptance

Run these with at least four published test games so three-slot retention and
eviction can both be observed:

The API host is active on ordinary uploaded-game play and preview URLs. Add
`?labs=true`, open the TROY home overlay, and choose **API Debug** to inspect
the host-only previous/current/next status. The labs query controls the HUD,
not API availability.

1. **Ungated preview:** open a draft/remix preview without labs and confirm
   `troy.ready` reports `preview / available`.
2. **HUD connection:** repeat with labs, open API Debug, and confirm the current
   slot moves from waiting to connected without showing a player ID or payload.
3. **Storage-only:** call storage without subscribing and confirm the HUD shows
   storage success while retention remains legacy.
4. **Managed forward/back:** subscribe, confirm managed retention and a pending
   then acknowledged lifecycle state, note the starter's frame count, move to the next
   game, return, and confirm the same iframe instance resumed without resetting
   its frame count.
5. **Managed two-away:** move two games away, return through the cache, and
   confirm the managed instance remains intact while it is still previous,
   current, or next.
6. **Bounded eviction:** move beyond the three-slot cache, return, and confirm a
   new iframe restores the saved score even though its frame count restarted.
7. **Legacy comparison:** repeat with a game that does not import the SDK and
   confirm existing reload behavior is unchanged.
8. **Unsubscribe:** call the returned unsubscribe function, leave the game, and
   confirm subsequent cleanup may reload it as a legacy frame.
9. **Fault fallback:** temporarily make a lifecycle handler reject, then repeat
   with a promise that exceeds two seconds. Confirm TROY logs the fault, pauses
   media best-effort, and the HUD reports faulted behavior for that iframe instance.
10. **Sticky fault:** attempt another subscription in the same faulted iframe
   and confirm retention is not restored; recreate the iframe and confirm a
   valid subscription can register normally.

## Offline proof

For the strongest proof, download and extract the kit, disable the machine's
external network adapter, start the loopback runner, and repeat the checklist.
Every required asset and the complete reference are in the archive.

If disconnecting the machine would disrupt other work, use the non-disruptive
check instead: inspect the browser Network panel and confirm every request is
to `127.0.0.1`, then search the extracted game and tools for external
`http://` or `https://` dependencies. Record this as an asset-locality check,
not as a physical offline test.

## Progressive-loading acceptance

Keep all checks above. In the starter, confirm **Add score** and animation work
before **Load bonus content** is pressed; neither `bonus-content.js` nor
`bonus-content.json` should appear in startup requests. Press the bonus control
and confirm the challenge appears. Repeat with delayed/failed JSON: score and
API controls must still work. Go off-screen during loading, return, and load
again explicitly; stale results must not change the UI. Test the ten-second
deadline, repeated clicks and malformed data without uncaught rejections.

Use the full [loading acceptance and delivery report](assets.md#acceptance-checks-and-agent-delivery-report)
for cold/warm/package cache states, startup requests/bytes and first usable screen
timing. The offline runner validates local HTTP/CSP and lifecycle behavior; use
an uploaded emulator game to prove TROY package-cache behavior.
