# Storage

**Required:** Every game developed for TROY must integrate the TROY Game API and implement working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio. Games with meaningful progress or preferences must implement API storage. Capture integration is recommended. This applies to humans and agents, starters, engine adapters, new games, replacements, and remixes. Existing published games remain compatible until replacement.

TROY exposes one JSON checkpoint per game and player:

```js
const saved = await troy.storage.load();
await troy.storage.save({ schemaVersion: 1, level: 4, score: 820 });
await troy.storage.clear();
```

The serialized checkpoint, including property names, must not exceed 65,536
UTF-8 bytes (64 KiB). Values may contain JSON primitives, arrays, and plain objects.
Cycles, functions, `undefined`, non-finite numbers, and class instances are
rejected.

Signed-out production state is local to the browser. Signed-in state follows
the account. Guest state is not merged on sign-in. Draft and remix preview
state is isolated from live state and expires with the preview session.

Account storage is last-write-wins. The TROY host serializes account writes and
coalesces queued saves to the newest complete checkpoint. Put a game-owned
`schemaVersion` in the checkpoint so future game versions can migrate old
state safely.

## Lifecycle-safe checkpoints

Pause gameplay and capture the complete checkpoint synchronously when TROY
becomes inactive. Start saving immediately, but catch failure and return from
the lifecycle subscriber without awaiting storage:

```js
function queueCheckpointSave() {
  const checkpoint = captureCompleteCheckpoint();

  void troy.storage.save(checkpoint).catch((error) => {
    console.warn("TROY checkpoint was not persisted.", error);
  });
}
```

Do not chain every future save behind a game-owned promise. A suspended WebView
or interrupted network can abandon a request. Let TROY serialize saves, keep
the newest complete checkpoint available, and treat save errors as recoverable
gameplay errors rather than lifecycle errors.

Transient state does not belong in the checkpoint. Never restore active
pointers, held controls, animation-frame handles, audio-context state,
timestamps, accumulated frame delta, or viewport-specific layout values.
