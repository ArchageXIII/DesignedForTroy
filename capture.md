# Automatic capture splash screens

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

Games are strongly advised to provide a representative splash screen for
TROY's automatic portrait screenshot. Show the game in play or another image
that accurately represents the experience instead of an empty opening state,
default menu, or generic title screen.

Register the handler immediately during module initialization:

```js
import { troy } from "/shared/troy-game-api-v1.js";

const unregisterCaptureSplash = troy.capture.registerSplashScreen(async () => {
  renderRepresentativeGameplay();
  await document.fonts?.ready;
  await new Promise(requestAnimationFrame);
});
```

TROY invokes the handler only while producing an automatic screenshot. Merely
registering it does not change normal play, previews, or feed swipes, and the
game must not show the capture splash automatically. A newer registration
replaces the previous handler. The returned function unregisters that specific
registration.

Complex engines often keep a loading or recovery veil above their canvas.
Check capture z-index ordering explicitly: decode and lay out the capture view,
temporarily suppress engine veils for capture only, cross later browser paint
frames, and then resolve the handler. A ready capture element underneath a
**Loading** or **Resuming game…** overlay is not capture-ready.

The handler may return normally or return a promise. TROY treats completion as
the signal that the frame is visually stable, so resolve only after local
images, fonts, layout, canvas rendering, and other required work are ready.
The capture worker allows five seconds for the handler.

Automatic screenshots use a 430 by 932 CSS-pixel portrait viewport. Use the
available viewport rather than hard-coding those dimensions so the same scene
is easy to test locally. Keep every required asset inside the uploaded game or
use `data:` and `blob:` URLs: automatic capture blocks remote requests.

If the game does not register a handler within the short discovery window, or
if its handler throws, rejects, times out, or cannot be captured, TROY reloads
the game from a clean page and uses the normal `troy:surface-ready` capture
path. Capture splash support is recommended rather than required.

## What the local host proves

Use **Request capture splash** in the offline development host to invoke the
registered handler and inspect its success or failure in the protocol log. The
host intentionally leaves the representative view visible so you can inspect
it. Choose **Reload / restore game** when you are finished to recreate the
iframe and return to normal play.

The canonical starter's **Run all API checks** control also verifies invalid
handler rejection, replacement, stale and active unregister behavior, handler
rejection, and the five-second timeout when it is running inside the local
host.

The local host validates the SDK contract and visual readiness only. It does
not create a WebP, apply the automatic worker's remote-request restrictions,
or run the clean-page default fallback. Those behaviors belong to TROY's
automatic capture pipeline and must be accepted after upload.

## Automatic capture acceptance

After uploading the exact locally tested bundle:

1. Inspect the generated portrait poster and confirm it shows the intended
   stable representative view without missing local assets.
2. Confirm every asset needed by the splash is bundled with the game or uses a
   `data:` or `blob:` URL. A successful local-host request does not prove that
   the automatic worker will permit a remote asset.
3. In a temporary test version, omit the registration or make the handler
   reject. Confirm the generated poster comes from a clean normal-page load,
   without partial splash mutations.
4. Restore the valid handler before publishing.

A source-less `MutationObserver` error seen only on the local control page is
the known signature of injected browser tooling. The runner and SDK do not use
`MutationObserver`; follow the console-attribution steps in `testing.md`.
