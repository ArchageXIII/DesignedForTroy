# DesignedForTroy agent instructions

Every game developed for TROY must integrate the TROY Game API and implement
working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio.
Games with meaningful progress or preferences must implement API storage.
Capture integration is recommended. These requirements cover humans and agents,
starters and engine adapters, new games, replacements and remixes. SDK import alone
does not satisfy them. Preserve existing published-game compatibility until replacement.

Follow assets.md's embedded-play contract: keep host navigation visible within
the supplied viewport. No fullscreen (including ancestors), iframe permission
tampering or parent-capability bypasses; no pointer/orientation lock, popups,
top navigation, modal/beforeunload traps or browser downloads in uploaded games.
Use responsive layout and declared orientation, preserve permitted sensors, and
handle denied/unsupported optional APIs without aborting play. Pointer release
must not clear held keys; lifecycle inactive must clear all transient input.

Read README.md, overview.md, lifecycle.md, storage.md, assets.md and testing.md
before implementation. Read engines.md for engine adapters and remixability.md
for remixes. Keep opening dependencies small and defer later content. Report
startup dependencies, deferred triggers and measured first-play results.

This repository contains public toolkit material only. Never copy private TROY
source, staff guides, credentials, config, or application history here. The
provenance file records deliberately selected public inputs. Do not modify the
upstream TROY checkout during toolkit work.

Preserve `/shared/troy-game-api-v1.js` in games. tools/troy-game-api-v1.js and
bundle-policy.json are byte-identical supported snapshots: update them only from
a reviewed upstream revision using UPDATING.md. Documentation is canonical here.
Preserve public MCP tool names and resource identifiers. Read bundled documents
through an explicit allowlist; never expose arbitrary file reads or private topics.

Node 22+ only; ordinary starter, harness and MCP operation must require no npm
install, secrets, credentials, Firebase, or sibling repository. Avoid dependencies.
Keep root and extracted-kit commands identical. Do not add hosted MCP, npm
publishing, or another website.

Run `node scripts/test.mjs` and `node scripts/build-kit.mjs --check` after changes.
Use the Codex in-app Browser (`iab`) for UI smoke and screenshots. Record URL,
authentication/account label, visible proof and relevant console errors. Distinguish
local harness tests from uploaded preview, capture worker and physical-device
proof. Do not automatically reload active gameplay.

When required tooling fails, pause dependent work, diagnose the cause, and report
the exact failure. Continue independent work. Do not bypass tools, browser or
permissions without explicit user agreement.

Use GitHub CLI (`gh`) as the primary path for authorized GitHub operations in
this repository, including PR creation, updates and checks. Do not try the
GitHub connector first or deliberately reproduce its known integration-permission
failure. Use the connector only when the user explicitly requests it. Verify
the active CLI account and target repository before writes.
This repository preference does not change global plugin settings, credentials,
OAuth/token scopes or access permissions. CLI success does not repair connector
permissions. If `gh` fails, diagnose and report the failure under the tooling
policy above; this preference does not authorize switching tools for other
failures, new access, merges or deployments.

Use a `codex/` branch and a reviewable PR. Never merge/fast-forward main or deploy
without the user's explicit instruction for that action. Report commits, tests, evidence and limitations.
