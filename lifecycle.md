# Lifecycle

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

TROY lifecycle state is authoritative. Games run inside retained iframes, so a
game that has moved off-screen may still have a visible document and may not
receive a browser visibility change.

Subscribe during boot, pause synchronously, and do not return a storage promise
from the inactive handler:

```js
let desiredActive = true;

function queueCheckpointSave(checkpoint) {
  void troy.storage.save(checkpoint).catch((error) => {
    console.warn("Checkpoint save failed; gameplay can continue.", error);
  });
}

const unsubscribe = troy.lifecycle.subscribe((event) => {
  desiredActive = event.state === "active";
  resetTransientInput();

  if (desiredActive) {
    refreshLayout();
    resumeWithFreshAnimationFrame();
    void resumeAudioFromLifecycle().catch(() => {});
    return;
  }

  pauseSimulationSynchronously();
  void pauseAudio().catch(() => {});
  const checkpoint = captureCompleteCheckpoint();
  queueCheckpointSave(checkpoint);
});

// Call this when the subscriber no longer owns the game loop.
unsubscribe();
```

Capture the checkpoint synchronously before starting the save. Treat storage
failure as a recoverable gameplay condition. A lifecycle handler has two
seconds to finish; returning or awaiting a slow storage request can fault that
iframe's managed lifecycle.

The returned promise includes indirect work: `return queueSave()` and
`await persistCheckpoint()` also block acknowledgement when those helpers return
a storage promise. `void save()` alone does not catch rejection; attach a catch
inside the helper. Do not put later checkpoints behind an earlier pending save.
The two-second deadline is a failure boundary, not a storage budget. Prove that
the matching lifecycle acknowledgement arrives **before** a delayed save settles.

## Mobile lifecycle in retained iframes

Mobile operating systems can suspend or discard work without delivering final
`pointerup` or `pointercancel` events. On every TROY inactive event, clear all
transient input state:

- active pointer and touch maps;
- held keyboard or controller buttons;
- pointer captures where practical;
- pending haptics;
- drag, swipe, and gesture state.

Apply the same reset on browser blur and when `document.hidden` becomes true.
Reset, pause, and resume operations must be idempotent because browser and TROY
events can arrive together.

```js
function resetTransientInput() {
  heldKeys.clear();
  activePointers.clear();
  navigator.vibrate?.(0);
}

window.addEventListener("blur", resetTransientInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) resetTransientInput();
});
```

Persistent progress belongs in the TROY checkpoint. Active fingers, pressed
buttons, animation timestamps, and device-specific interaction state must not
be restored.

Keep input sources independent during play: `pointerup`, `pointercancel` and
lost pointer capture release only the affected pointer; they must not clear a
still-held keyboard key or another pointer. Key release clears only that key.
Use the complete reset above for lifecycle inactive, blur and hidden documents.
The starter exposes held-key/pointer counts for this check. Respect the
[embedded viewport and browser capability restrictions](assets.md#embedded-play-contract);
use responsive controls instead of fullscreen or pointer/orientation lock.

## Resume with a fresh frame

A suspended mobile WebView can discard a pending `requestAnimationFrame`
callback while game code still holds its numeric handle. On activation:

1. cancel any stored frame handle;
2. reset the stored handle, previous timestamp, and accumulated delta;
3. refresh viewport, canvas, orientation, and safe-area dependent layout;
4. schedule exactly one new frame;
5. use a generation token if stale callbacks could create duplicate loops.

`pageshow` and a visible `visibilitychange` are recovery hints, not independent
activation signals. They may refresh the loop only when the latest TROY state
is still active.

```js
window.addEventListener("pageshow", () => {
  if (desiredActive) resumeWithFreshAnimationFrame();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && desiredActive) resumeWithFreshAnimationFrame();
});
```

Initial lifecycle state can arrive before the engine is ready. Store the
requested state independently, give callback dependencies safe defaults, and
apply `desiredActive` after boot finishes. A warmed game can start inactive and
must not briefly run simulation underneath another game.

Register the subscriber before awaiting `troy.ready`, `storage.load()`, or engine
startup, once its synchronous dependencies have safe defaults. Keep restoration
readiness separate from `desiredActive`: acknowledge and pause immediately, but
start neither simulation nor checkpoint saves until existing progress has been
restored. Apply the latest lifecycle state after restoration, even when it is
inactive. A failed or pending load must not silently become an empty checkpoint.
Offer explicit retry and ignore completion from older attempts. The
[starter](game/game.js) demonstrates this ordering, including capture during a
pending restoration. See the [storage fault tests](testing.md#storage-and-startup-fault-matrix).

## Gesture and audio policy

Each game iframe owns gestures that begin inside it. A viewport meta tag alone
does not prevent Android pinch, long-press, or selection behavior.

```css
html,
body {
  overscroll-behavior: none;
}

.game-surface {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

button,
input,
textarea,
select {
  touch-action: manipulation;
}
```

Do not rely only on `maxTouchPoints` or `(pointer: coarse)` to select touch
controls. An observed `pointerType === "touch"` is authoritative.

Browsers require a trusted user gesture before starting media or Web Audio.
Use an explicit in-game Start or Sound control. Do not add `autoplay`, call
`play()` during boot, or treat every `pointerdown` or `keydown` as permission:
that input may be the start of navigation rather than an intentional sound
choice.

Track the player's sound choice separately from lifecycle state. Start or
resume looping music only while TROY is active and the document is visible.
On inactive, synchronously pause every `<audio>` and `<video>` element and
suspend any Web Audio context. On activation, resume only the player-enabled
loop; do not resume a one-shot effect that was interrupted off-screen.

```js
const music = document.querySelector("#music");
const media = [...document.querySelectorAll("audio, video")];
let soundEnabled = false;

function pauseAllMedia() {
  media.forEach((element) => element.pause());
  void audioContext?.suspend().catch(() => {});
}

function resumeWantedAudio() {
  if (!soundEnabled || !desiredActive || document.hidden) return;
  void music.play().catch(() => {});
  void audioContext?.resume().catch(() => {});
}

soundButton.addEventListener("click", () => {
  soundEnabled = true;
  resumeWantedAudio();
});
```

Call `pauseAllMedia()` inside the synchronous inactive path and
`resumeWantedAudio()` inside the active path. Treat resume failure as non-fatal
and retry from the next explicit sound gesture.

## Subscription and bounded retention

The first lifecycle subscription is the iframe's retention registration. TROY
protects it from legacy hard reloads while it remains in the
previous/current/next cache. Importing the SDK or using storage without a
lifecycle subscriber does not enable retention.

Removing the final subscriber removes that protection. Handler rejection or a
two-second timeout faults that iframe instance until TROY recreates it.
Retention remains bounded: feed eviction, identity changes, version changes,
or explicit host eviction can recreate the iframe. Always save a complete
restorable checkpoint.

An event contains:

- `state`: `active` or `inactive`;
- `surface`: `onscreen` or `offscreen`;
- `reason`: `initial`, `navigation`, `document`, `focus`, or `overlay`;
- `sequence`: a monotonically increasing number for that iframe.

The host coalesces top-level browser lifecycle signals into suspension epochs.
The first hidden `visibilitychange`, `pagehide`, or freeze signal starts an
epoch and makes the logical current slot inactive. Duplicate inactive signals
stay in that epoch. The first visible `visibilitychange`, `pageshow`, mobile
`resume`, or window focus queues exactly one current-slot activation. Later
foreground signals in the same epoch do not produce more lifecycle events. If
a TROY overlay blocks activation, the host retains it until the overlay closes.

That activation preserves the first `document` or `focus` reason and receives a
fresh monotonically increasing sequence number. Previous and next slots do not
receive browser foreground reassertions; their lifecycle remains
navigation-driven. Blur alone is not authoritative because ordinary focus
movement between the host, an iframe, browser chrome, and developer tools can
produce it while the page remains visible. Games must still handle lifecycle
idempotently. A restored visible page does not wait for `document.hasFocus()`,
including during initial boot, because it is not a reliable mobile foreground
signal.

TROY may briefly place its loading card above the current iframe and apply a
bounded presentation-only recompose while delivering that foreground
activation. This neither reloads the iframe nor adds lifecycle events. Games
should resume in place from the authoritative activation and must not infer a
new boot from the host presentation treatment.

Compiled engines must distinguish an advancing main loop or WebGL drawing
buffer from a frame that is ready to reveal. Use a bounded recovery generation,
prove fresh presentation before removing a child loading veil, and select a
checkpointed reload only after resume-in-place evidence fails. The complete
adapter pattern is in [complex HTML5 engine integration](engines.md).

Fast-swipe candidates are not activated. Warmed previous and next games receive
an initial inactive state after loading.
