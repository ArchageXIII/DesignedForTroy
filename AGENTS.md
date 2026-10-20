# DesignedForTroy agent instructions

Every game developed for TROY must integrate the TROY Game API and implement
working lifecycle handling: pause/resume, input cleanup, and gesture-gated audio.
Games with meaningful progress or preferences must implement API storage.
Capture integration is recommended. These requirements cover humans and agents,
starters and engine adapters, new games, replacements and remixes. SDK import alone
does not satisfy them. Preserve existing published-game compatibility until replacement.

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

Use a `codex/` branch and a reviewable PR. Never merge/fast-forward main or deploy
without the user's explicit instruction for that action. Report commits, tests, evidence and limitations.
