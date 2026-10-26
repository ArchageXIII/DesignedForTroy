import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../tools/containment.html", import.meta.url), "utf8");
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import troy from .*;/, "");
function probe({ request, denied = true, trusted = true } = {}) {
  const nodes = new Map(); const reports = [];
  const attributes = new Map([["allow", "accelerometer; gyroscope; fullscreen 'none'"]]);
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { append: item => reports.push(item.textContent) });
      return nodes.get(selector);
    },
    createElement: () => ({}),
    documentElement: { requestFullscreen: request }, fullscreenElement: null,
    featurePolicy: { allowsFeature: () => !denied },
  };
  const parentDocument = { ...document, documentElement: { requestFullscreen: request } };
  const context = vm.createContext({ document, parent: { document: parentDocument }, navigator: { userActivation: { isActive: trusted } },
    setTimeout, clearTimeout, troy: { lifecycle: { subscribe() {} }, ready: Promise.resolve({ available: true }), storage: { load: async () => undefined } },
    frameElement: { getAttribute: name => attributes.get(name) ?? null, setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) },
  });
  vm.runInContext("globalThis.window = globalThis", context);
  vm.runInContext(source, context);
  return { reports, attributes, async click(id) {
    nodes.get(`#${id}`).onclick({ isTrusted: trusted });
    for (let i = 0; i < 30; i++) await Promise.resolve();
  } };
}

// These test the actual probe's reporting, not browser enforcement. The HTTP
// tests verify policy delivery; trusted Browser clicks verify browser behavior.
test("probe requires both policy denial and a rejected fullscreen call, including ancestor and tampering paths", async () => {
  let calls = 0;
  const run = probe({ request: () => { calls++; return Promise.reject(new TypeError("Disallowed by policy")); } });
  for (const id of ["direct", "parent", "tamper"]) await run.click(id);
  assert.equal(calls, 3);
  assert.equal(run.reports.length, 3);
  assert.ok(run.reports.every(line => line.includes("PASS")));
  assert.equal(run.attributes.get("allow"), "accelerometer; gyroscope; fullscreen 'none'");
  assert.equal(run.attributes.has("allowfullscreen"), false);
});

test("negative control: a resolved forbidden request fails; unsupported, missing policy and untrusted requests are inconclusive", async () => {
  const escaped = probe({ request: async () => {} });
  await escaped.click("direct"); assert.match(escaped.reports[0], /FAIL/);
  for (const options of [{}, { request: async () => { throw new TypeError("No activation"); }, denied: false }, { trusted: false }]) {
    const run = probe(options);
    await run.click("direct"); assert.match(run.reports[0], /INCONCLUSIVE/);
  }
});
