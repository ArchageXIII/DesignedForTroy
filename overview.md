# TROY Game API v1 reference

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

The Game API gives uploaded and remixed games lifecycle signals and one
persistent JSON snapshot. Lifecycle subscription is required for new games and
replacement versions; existing published versions remain compatible until
they are replaced. Import the versioned ES module:

```js
import troy, {
  troy as namedTroy,
  ready,
  TroyApiError,
} from "/shared/troy-game-api-v1.js";
```

TROY binds the host bridge for uploaded live games and draft/remix previews by
default. Importing the module connects the game; a working lifecycle subscription is also required. On a TROY URL,
`?labs=true` exposes a host-only API Debug HUD for testing; it does not change
whether the API is available.

The default export and named `troy` export are the same frozen API object.
`ready` is also available as `troy.ready`.

For maximum uploaded-game compatibility, use relative paths for game-owned
assets and vendor third-party browser libraries. Same-origin `fetch()` and XHR
can load supported bundled files, while external connections remain blocked.
See the [bundle and asset contract](assets.md) for the exact file allowlist,
MIME mapping, size guidance, and CSP.

For a game to remain remixable, each editable HTML, CSS, JavaScript, JSON, and
SVG file must be 1,000,000 bytes or smaller. The recommended working target is
750,000 bytes per file. See [remixable file-size limits](remixability.md).

## Complete contract

Games must follow the [embedded-play contract](assets.md#embedded-play-contract):
stay in the supplied viewport, preserve TROY navigation, and do not request
fullscreen or bypass host permissions. Browser capability denial must not stop
startup or gameplay. These requirements do not add or change SDK methods.

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type ReadyResult =
  | {
      available: true;
      mode: "development" | "preview" | "production";
    }
  | {
      available: false;
      mode: "unavailable";
      reason: "top-level" | "timeout" | "no-host";
    };

type LifecycleEvent = {
  state: "active" | "inactive";
  surface: "onscreen" | "offscreen";
  reason: "initial" | "navigation" | "document" | "focus" | "overlay";
  sequence: number;
};

type CaptureSplashHandler = () => void | Promise<void>;

type TroyApi = {
  protocolVersion: 1;
  quotaBytes: 65536;
  ready: Promise<ReadyResult>;
  lifecycle: {
    subscribe(
      handler: (event: LifecycleEvent) => void | Promise<void>,
    ): () => void;
  };
  capture: {
    registerSplashScreen(handler: CaptureSplashHandler): () => void;
  };
  storage: {
    load(): Promise<JsonValue | undefined>;
    save(value: JsonValue): Promise<{ persisted: boolean }>;
    clear(): Promise<{ persisted: boolean }>;
  };
};

class TroyApiError extends Error {
  code: string;
}
```

## Ready results

| Situation | Result |
| --- | --- |
| Local development host | `{ available: true, mode: "development" }` |
| Draft or remix preview | `{ available: true, mode: "preview" }` |
| Published game | `{ available: true, mode: "production" }` |
| Game opened directly at top level | `{ available: false, mode: "unavailable", reason: "top-level" }` |
| Embedded page with no compatible host response after 5 seconds | `{ available: false, mode: "unavailable", reason: "timeout" }` |
| Reserved no-host fallback | `{ available: false, mode: "unavailable", reason: "no-host" }` |

Top-level rendering resolves immediately. An unavailable API does not stop the
game: storage has the standalone return behavior described below.

## Lifecycle events

| Field | Values and meaning |
| --- | --- |
| `state` | `active` when play may run; `inactive` when it must pause |
| `surface` | `onscreen` for the current surface; `offscreen` for a warmed or departed surface |
| `reason` | `initial`, `navigation`, `document`, `focus`, or `overlay` |
| `sequence` | Monotonically increasing for that iframe instance |

`initial` is the first settled state. `navigation` covers swipes and slot
changes. `document` covers page visibility. `focus` covers window focus, and
`overlay` covers a blocking TROY overlay.

`subscribe()` opts the iframe into managed lifecycle behavior and returns an
unsubscribe function. It also protects the iframe from legacy hard reloads
while it remains in TROY's previous/current/next cache. Storage use alone does
not opt in. The latest state is replayed to late subscribers. Handlers run in
delivery order; TROY waits for all returned promises. Pause and reset input
synchronously. Capture a checkpoint synchronously, then start a caught storage
save without returning its promise from the lifecycle handler.

Removing the final subscriber restores legacy behavior. Handler rejection or
timeout permanently faults that iframe instance; it cannot re-register until
TROY recreates it. Retention remains host-only and bounded, so games must still
save on inactive.

## Storage returns

| Call | Hosted result | Standalone/unavailable result |
| --- | --- | --- |
| `load()` | Saved JSON value, or `undefined` when empty | `undefined` |
| `save(value)` | `{ persisted: true }` | `{ persisted: false }` |
| `clear()` | `{ persisted: true }` | `{ persisted: false }` |

The complete serialized snapshot, including keys, is limited to 65,536 UTF-8
bytes (64 KiB). Valid roots include every JSON type, not just objects. Numbers must be
finite; objects must be plain; cycles, functions, symbols, bigints,
`undefined`, and class instances are invalid.

`save()` performs JSON and quota validation before checking host availability,
so invalid or oversized state still rejects in standalone mode.

## Automatic capture splash

Games are strongly advised to call
`troy.capture.registerSplashScreen(handler)` during initialization. TROY calls
the handler only for its automatic portrait screenshot; registration does not
display anything during ordinary play. The handler should render a stable,
representative view of the game in play or another accurate image instead of a
default menu or empty opening screen.

The handler may return a promise and should resolve only when local assets,
fonts, layout, and canvas rendering are ready. A newer registration replaces
the previous one, and the returned function unregisters only its own
registration. Missing or failed capture support falls back to a clean normal
game load. See the [capture guide](capture.md) for the complete workflow.

## Errors and timeouts

Storage and validation failures reject with `TroyApiError`. The stable SDK
codes are:

| Code | Meaning |
| --- | --- |
| `INVALID_HANDLER` | `subscribe()` or `registerSplashScreen()` was called without a function |
| `INVALID_STATE` | A save contains a non-JSON value, cycle, non-finite number, or non-plain object |
| `QUOTA_EXCEEDED` | Serialized UTF-8 state is larger than 65,536 bytes (64 KiB) |
| `INVALID_STORED_STATE` | A host returned a stored value that is not valid JSON |
| `INVALID_REQUEST` | The host rejected an unsupported protocol operation |
| `REQUEST_FAILED` | A host or backend failure supplied no more specific code |
| `LIFECYCLE_HANDLER_FAILED` | A lifecycle handler rejected without its own error code; this is reported to the host |

Backend failures retain the more specific host-provided code when one exists,
so callers should always display or log `error.code` without assuming the list
of infrastructure codes is closed.

There is no separate SDK timer for an individual storage request. The
connection handshake retries every 200 ms and resolves unavailable after five
seconds instead of rejecting. A successful connection clears both timers.
A lifecycle handler has two seconds to finish; rejection or timeout
(`LIFECYCLE_TIMEOUT` in the host log) marks that iframe unmanaged and restores
legacy handling. The timeout is not thrown back into game code.
The host pauses acknowledgement deadlines while its document is suspended and
gives the current event a fresh two-second window on return. An acknowledgement
for a superseded event cannot fault the newer lifecycle state.

## Snapshot versioning

Published versions of the same TROY game share a snapshot. Put a
game-controlled `schemaVersion` inside it and migrate older shapes after
`load()`:

```js
const saved = await troy.storage.load();
const state =
  saved?.schemaVersion === 2
    ? saved
    : migrateToVersion2(saved);

await troy.storage.save({ ...state, schemaVersion: 2 });
```

Guest and signed-in account snapshots remain separate. Preview snapshots are
session-scoped and never overwrite live player state. Keep migrations
backward-compatible with any snapshot a previously published version could
have written.

TROY binds game and player identity in the parent. Game code never supplies or
receives those IDs.

## More guides

- [Lifecycle](lifecycle.md)
- [Storage](storage.md)
- [Automatic capture splash](capture.md)
- [Uploaded bundle and asset contract](assets.md)
- [Complex HTML5 engine integration](engines.md)
- [Offline development](offline-dev.md)
- [Testing checklist](testing.md)
- [Developer kit README](README.md)

## First-play performance

TROY manages optional background package saving; game code controls first-play
loading cost. Use stable relative asset URLs, load only the opening scene
initially, and defer later content without delaying lifecycle acknowledgements.
Follow the required rules, runnable example and agent delivery checklist in
[Fast first play and TROY caching](assets.md#fast-first-play-and-troy-caching).
The SDK API is unchanged; package availability is not an offline guarantee.

Remix eligibility also requires at most **10,000,000 uncompressed bytes (10 MB)**
and **500 accepted game files**, inclusive. All assets count, including media
and binary files. Only editable extensions have the 1,000,000-byte per-file
ceiling. See [remix eligibility](remixability.md).
