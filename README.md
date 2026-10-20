# Designed for TROY

The public, self-contained developer toolkit for games made by people and coding
agents for TROY. These guides are canonical here; the SDK and upload policy are
pinned snapshots of the supported TROY v1 runtime.

**Every game developed for TROY must integrate the TROY Game API and implement
working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio.**
Games with meaningful progress or preferences **must implement API storage**.
Capture integration is **recommended**. This applies to starters, engine adapters,
new games, replacement versions, and remixes, whether built by humans or agents.
Importing the SDK alone is insufficient. Existing published games remain compatible
until replacement.

## Start playing

Use Node.js 22 or newer. Clone this repository or extract the checked-in
[complete ZIP](dist/troy-game-dev-kit-v1.zip), then run from its root:

```sh
node tools/troy-dev.mjs game
```

Open [the local harness](http://127.0.0.1:4173/__troy/). Add score, set off-screen,
restore, switch fake players, enable sound with a click, and run the starter's API
checks. The [starter instructions](game/README.md) explain each control.

Stop with Ctrl+C, then repeat using the uploaded-game extension, MIME, and CSP rules:

```sh
node tools/troy-dev.mjs game --strict-upload
```

No npm install, Firebase, account, secrets, credentials, or external assets are
needed. Keep the game's import at `/shared/troy-game-api-v1.js`; the harness serves
the bundled SDK there. Open [the game directly](http://127.0.0.1:4173/) to test
standalone fallback. Opening `index.html` with `file://` is unsupported.

## Read and build

| Guide | Purpose |
| --- | --- |
| [Overview](overview.md) | Complete v1 API, errors, quotas and compatibility |
| [Lifecycle](lifecycle.md) | Pause/resume, input cleanup and audio |
| [Storage](storage.md) | Checkpoints, migration and restoration |
| [Capture](capture.md) | Recommended representative splash hook |
| [Assets and loading](assets.md) | Upload policy, CSP, cold start and deferred content |
| [Remixability](remixability.md) | Editable files and bundle limits |
| [Engines](engines.md) | Maintained wrappers for compiled HTML5 engines |
| [Offline development](offline-dev.md) | Local harness and proof limits |
| [Testing](testing.md) | Local, upload and real-device acceptance |
| [Updates](UPDATING.md) | Provenance, snapshots and reproducible releases |
| [Agent instructions](AGENTS.md) | Implementation and delivery requirements |

Upload **only your game's files**, with `index.html` at the root, using
[TROY upload](https://troy-6c65c.web.app/upload). The complete toolkit ZIP is a
development kit, not a game upload. [Upload with API Debug](https://troy-6c65c.web.app/upload?labs=true)
exposes diagnostics; the API also works without labs.

Local success does not prove uploaded preview behavior, production capture,
package caching, mobile composition, or Android interruption handling. Complete
the separate acceptance steps in [Testing](testing.md) before release.

## Local MCP for coding agents

```sh
node tools/troy-mcp.mjs
```

This read-only stdio server reads the bundled guides, starter instructions and
manifest. It requires no server hosting, network connection or credentials.
Configure an MCP client with command `node` and an absolute script path:

```json
{
  "mcpServers": {
    "troy": {
      "command": "node",
      "args": ["C:/path with spaces/DesignedForTroy/tools/troy-mcp.mjs"]
    }
  }
}
```

It preserves `get_troy_game_api_guide`, `get_troy_engine_integration_guide`,
`troy://game-api/v1/*` and `troy://engine-integration/v1/*`.
The two tools return complete relevant documents; engine topics intentionally share
the engine guide so important context is not lost. `loading` returns the asset
guide, `install` returns offline development, and resource reads return actual
bundled content. The transport is one UTF-8 JSON-RPC message per line.

## Verify and reproduce

```sh
node scripts/test.mjs
node scripts/build-kit.mjs --check
node scripts/build-kit.mjs
```

Tests use only Node built-ins. Build produces a deterministic, uncompressed ZIP
with fixed timestamps, sorted paths, and a [checksum manifest](manifest.json).
The ZIP contains the same runnable layout, docs, tests, provenance, and build
scripts as the checkout. See [UPDATING](UPDATING.md) for checksum scope.

MIT © 2026 Magicave Holdings. See [LICENSE](LICENSE) and [notices](NOTICE).
