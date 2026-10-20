import test from "node:test";
import assert from "node:assert/strict";
import { createBonusLoader } from "../game/bonus-loader.js";
import { loadBonusContent } from "../game/bonus-content.js";

const { Response } = globalThis;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("construction makes no optional requests; demand deduplicates and reuses success", async () => {
  let imports = 0; let fetches = 0; const states = []; const data = deferred();
  const loader = createBonusLoader({ isActive: () => true, onState: state => states.push(state),
    importContent: async () => { imports++; return { loadBonusContent: () => { fetches++; return data.promise; } }; } });
  assert.equal(imports, 0);
  const first = loader.load(); assert.equal(loader.load(), first);
  data.resolve({ message: "Bonus ready" }); await first; await loader.load();
  assert.equal(imports, 1); assert.equal(fetches, 1);
  assert.equal(states.at(-1).status, "ready");
});

test("cancelling during import prevents a late module from starting its data fetch", async () => {
  const module = deferred(); let fetches = 0; let active = true; const states = [];
  const loader = createBonusLoader({ isActive: () => active, onState: state => states.push(state), importContent: () => module.promise });
  const first = loader.load(); active = false; loader.cancel(); await first;
  module.resolve({ loadBonusContent: async () => { fetches++; return { message: "Ready" }; } });
  await Promise.resolve(); assert.equal(fetches, 0); assert.equal(states.at(-1).status, "paused");
  await loader.load(); assert.equal(fetches, 0);
  active = true; await loader.load(); assert.equal(fetches, 1); assert.equal(states.at(-1).status, "ready");
});

test("inactive fetch is aborted and cannot overwrite a newer successful request", async () => {
  const old = deferred(); const began = deferred(); let count = 0; let oldSignal; const states = [];
  const loader = createBonusLoader({ isActive: () => true, onState: state => states.push(state), importContent: async () => ({
    loadBonusContent: signal => { if (++count === 1) { oldSignal = signal; began.resolve(); return old.promise; } return { message: "New" }; },
  }) });
  const first = loader.load(); await began.promise; loader.cancel(); await first;
  assert.equal(oldSignal.aborted, true); await loader.load(); old.resolve({ message: "Stale" }); await Promise.resolve();
  assert.equal(states.at(-1).message, "New");
});

test("timeout covers import and body work, then an explicit retry succeeds", async () => {
  for (const phase of ["import", "body"]) {
    let failed = true; let signal; const states = [];
    const loader = createBonusLoader({ isActive: () => true, onState: state => states.push(state), timeoutMs: 10,
      importContent: () => phase === "import" && failed ? new Promise(() => {}) : Promise.resolve({
        loadBonusContent: input => { signal = input; return failed ? new Promise(() => {}) : { message: "Ready" }; },
      }),
    });
    await loader.load(); assert.equal(states.at(-1).status, "failed"); assert.match(states.at(-1).message, /timed out/);
    if (phase === "body") { assert.equal(signal.aborted, true); failed = false; await loader.load(); assert.equal(states.at(-1).status, "ready"); }
    // A permanently pending native import cannot be cancelled: the message offers reload.
    else assert.match(states.at(-1).message, /reload/);
  }
});

test("rejected imports and failed data allow explicit retries with no automatic retry loop", async () => {
  for (const phase of ["import", "data"]) {
    let attempts = 0; const states = [];
    const loader = createBonusLoader({ isActive: () => true, onState: state => states.push(state), importContent: async () => {
      if (phase === "import" && ++attempts === 1) throw new Error("Module unavailable");
      return { loadBonusContent: async () => { if (phase === "data" && ++attempts === 1) throw new Error("HTTP 503"); return { message: "Ready" }; } };
    } });
    await loader.load(); assert.equal(states.at(-1).status, "failed"); assert.equal(attempts, 1);
    await loader.load(); assert.equal(states.at(-1).status, "ready");
  }
});

test("bonus JSON uses a stable relative URL, forwards cancellation, and rejects invalid responses", async () => {
  const previous = globalThis.fetch; const signal = new globalThis.AbortController().signal;
  try {
    for (const [response, error] of [[new Response("unavailable", { status: 503 }), /503/], [new Response("not json"), /JSON|Unexpected/],
      [new Response('{"message":42}'), /invalid/], [new Response('{"message":"Ready"}'), null]]) {
      globalThis.fetch = async (url, options) => {
        assert.ok(url.pathname.endsWith("/game/bonus-content.json")); assert.equal(url.search, "");
        assert.equal(options.signal, signal); assert.equal(options.cache, undefined); return response;
      };
      if (error) await assert.rejects(loadBonusContent(signal), error);
      else assert.deepEqual(await loadBonusContent(signal), { message: "Ready" });
    }
  } finally { globalThis.fetch = previous; }
});
