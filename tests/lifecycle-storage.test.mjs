import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./integration-fixture.mjs";

const ack = (run, event) => run.messages.find(message => message.kind === "lifecycle-ack" && message.eventId === event.eventId);
const events = run => run.messages.filter(message => message.kind === "lifecycle");
const saves = run => run.messages.filter(message => message.kind === "storage-request" && message.operation === "save");
const text = (run, id) => run.gameDocument.querySelector(`#${id}`).textContent;

test("starter acknowledges initial inactive during pending restore without animation or default saves", async () => {
  const run = await fixture({ initial: "inactive", load: "never", saved: { schemaVersion: 1, score: 7 } });
  await run.tick(250);
  assert.equal(ack(run, events(run)[0])?.ok, true);
  assert.equal(text(run, "lifecycle"), "inactive");
  await run.frame(); await run.tick(2500);
  assert.equal(text(run, "frames"), "");
  assert.equal(saves(run).length, 0);
  assert.equal(run.gameDocument.querySelector("#increment").disabled, true);
  assert.match(run.hostDocument.querySelector("#connection").textContent, /managed/);
  run.set("load", "0");
  await run.click("restore-state", "game");
  assert.equal(text(run, "score"), "7");
  await run.frame();
  assert.equal(text(run, "frames"), "");
  await run.click("active"); await run.tick(250); await run.frame();
  assert.equal(text(run, "frames"), "1");
  assert.deepEqual(run.errors, []);
});

test("rejected restoration stays paused and preserves saved data until an explicit retry", async () => {
  const run = await fixture({ load: "reject", saved: { schemaVersion: 1, score: 9 } });
  await run.tick(250); await run.frame();
  assert.equal(ack(run, events(run)[0])?.ok, true);
  assert.match(text(run, "save-status"), /REQUEST_FAILED.*Retry saved state/);
  assert.equal(text(run, "frames"), "");
  await run.click("inactive");
  assert.equal(saves(run).length, 0);
  assert.equal(JSON.parse(run.storage.get(run.storageKey("developer"))).score, 9);
  run.set("load", "0"); await run.click("restore-state", "game");
  assert.equal(text(run, "score"), "9");
  await run.click("active"); await run.tick(250); await run.frame();
  assert.equal(text(run, "frames"), "1");
  assert.deepEqual(run.errors, []);
});

test("a late abandoned restore cannot overwrite progress after a newer successful restore", async () => {
  const run = await fixture({ load: "2500", saved: { schemaVersion: 1, score: 5 } });
  await run.tick(250);
  run.set("load", "0"); await run.click("restore-state", "game");
  await run.click("increment", "game");
  assert.equal(text(run, "score"), "6");
  await run.tick(2500);
  assert.equal(text(run, "score"), "6");
  assert.deepEqual(run.errors, []);
});

test("a late rejected restore cannot replace the newer successful result with an error", async () => {
  const run = await fixture({ load: "never", saved: { schemaVersion: 1, score: 8 } });
  const original = run.messages.find(message => message.kind === "storage-request" && message.operation === "load");
  run.set("load", "0"); await run.click("restore-state", "game");
  run.respondStorage({ requestId: original.requestId, ok: false, error: { code: "REQUEST_FAILED", message: "Old request failed" } });
  await run.drain();
  assert.equal(text(run, "score"), "8");
  assert.equal(text(run, "save-status"), "Restored score 8.");
  assert.deepEqual(run.errors, []);
});

test("late restore preserves the representative capture and never restarts its animation", async () => {
  const run = await fixture({ load: "2500", saved: { schemaVersion: 1, score: 7 } });
  await run.tick(250); await run.click("capture-splash");
  await run.frame(); await run.frame();
  assert.equal(run.messages.find(message => message.kind === "capture-splash-result")?.ok, true);
  await run.tick(2500); await run.frame();
  assert.equal(text(run, "score"), "12");
  assert.equal(text(run, "frames"), "842");
  await run.click("inactive");
  assert.equal(JSON.parse(saves(run).at(-1).payloadJson).score, 7);
  assert.deepEqual(run.errors, []);
});

for (const setting of ["2500", "reject", "never"]) test(`starter inactive ACK and later checkpoints do not depend on ${setting} save`, async () => {
  const run = await fixture({ save: setting });
  await run.tick(250); await run.click("increment", "game"); await run.frame();
  const before = text(run, "frames");
  await run.click("inactive");
  const inactive = events(run).at(-1);
  assert.equal(ack(run, inactive)?.ok, true);
  assert.equal(ack(run, inactive).at, inactive.at);
  assert.equal(saves(run).length, 1);
  assert.deepEqual(JSON.parse(saves(run)[0].payloadJson), { schemaVersion: 1, score: 1 });
  await run.frame(); assert.equal(text(run, "frames"), before);
  await run.tick(2100);
  assert.match(run.hostDocument.querySelector("#connection").textContent, /managed/);
  if (setting === "reject") assert.match(text(run, "save-status"), /REQUEST_FAILED/);
  run.set("save", "0");
  await run.click("active"); await run.tick(250);
  await run.click("increment", "game"); await run.click("inactive");
  assert.equal(saves(run).length, 2);
  assert.equal(ack(run, events(run).at(-1))?.ok, true);
  assert.equal(JSON.parse(run.storage.get(run.storageKey("developer"))).score, 2);
  await run.tick(2500);
  assert.equal(JSON.parse(run.storage.get(run.storageKey("developer"))).score, 2, "Old delayed save must not roll back a newer checkpoint");
  assert.equal(text(run, "save-status"), "Saved score 2.");
  assert.match(run.log(), /lifecycle acknowledged .*"sequence":\d+,"elapsedMs":0/);
  assert.deepEqual(run.errors, []);
});

test("existing default selector is inherited independently by load/save/clear, including immediate overrides", async () => {
  const run = await fixture();
  await run.tick(250);
  run.hostDocument.querySelector("#storage-latency").value = "never";
  run.set("load", "inherit"); run.set("save", "inherit"); run.set("clear", "inherit");
  run.evaluate('void troy.storage.load(); void troy.storage.clear();');
  await run.click("inactive");
  const pending = run.messages.filter(message => message.kind === "storage-request").slice(-3);
  assert.deepEqual(pending.map(message => message.operation).sort(), ["clear", "load", "save"]);
  assert.equal(ack(run, events(run).at(-1))?.ok, true);
  await run.tick(2500);
  assert.equal(run.messages.some(message => message.kind === "storage-response" && pending.some(request => request.requestId === message.requestId)), false);
  run.set("save", "0"); await run.click("active"); await run.tick(250); await run.click("inactive");
  assert.equal(JSON.parse(run.storage.get(run.storageKey("developer"))).score, 0);
  run.set("clear", "reject");
  await run.evaluate('troy.storage.clear().catch(error => { document.querySelector("#save-status").textContent = error.code; })');
  assert.equal(text(run, "save-status"), "REQUEST_FAILED");
  assert.equal(run.storage.has(run.storageKey("developer")), true);
  run.set("clear", "0"); await run.evaluate("troy.storage.clear()");
  assert.equal(run.storage.has(run.storageKey("developer")), false);
});

test("negative control: awaited save still faults at exactly 2000ms and a late ACK cannot repair it", async () => {
  const run = await fixture({ initial: "inactive", save: "2500", gameSource: `
    troy.lifecycle.subscribe(event => event.state === "inactive" ? troy.storage.save({ score: 1 }) : undefined);
  ` });
  await run.tick(250);
  const inactive = events(run)[0];
  await run.tick(1999); assert.equal(ack(run, inactive), undefined);
  assert.doesNotMatch(run.log(), /lifecycle retention faulted/);
  await run.tick(1);
  assert.match(run.log(), /lifecycle deadline exceeded .*"elapsedMs":2000/);
  assert.match(run.log(), /LIFECYCLE_TIMEOUT/);
  await run.tick(500);
  assert.equal(ack(run, inactive)?.at - inactive.at, 2500);
  assert.match(run.hostDocument.querySelector("#connection").textContent, /faulted/);
});

test("harness snapshots per-operation fault settings and keeps delayed writes with the original player", async () => {
  const run = await fixture({ save: "2500" });
  await run.tick(250); await run.click("increment", "game"); await run.click("inactive");
  run.hostDocument.querySelector("#player").value = "other";
  await run.click("apply-player");
  run.set("save", "0");
  await run.tick(2500);
  assert.equal(JSON.parse(run.storage.get(run.storageKey("developer"))).score, 1);
  assert.equal(run.storage.has(run.storageKey("other")), false);
  assert.equal(run.messages.filter(message => message.kind === "storage-response").length, 1); // Initial load only; old frame's port closed.
});

test("unsupported stored schemas remain recoverable without replacing progress", async () => {
  const snapshot = { schemaVersion: 2, score: 16 };
  const run = await fixture({ saved: snapshot });
  await run.tick(250); await run.click("inactive"); await run.frame();
  assert.equal(ack(run, events(run).at(-1))?.ok, true);
  assert.match(text(run, "save-status"), /supported migration/);
  assert.equal(run.gameDocument.querySelector("#increment").disabled, true);
  assert.equal(saves(run).length, 0);
  assert.deepEqual(JSON.parse(run.storage.get(run.storageKey("developer"))), snapshot);
});

test("clearing local state prevents an earlier delayed save from recreating it", async () => {
  const run = await fixture({ save: "2500" });
  await run.tick(250); await run.click("increment", "game"); await run.click("inactive");
  await run.click("clear"); await run.tick(2500);
  assert.equal(run.storage.has(run.storageKey("developer")), false);
});
