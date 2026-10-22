import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [runner, sdk, starter, bonus] = await Promise.all([
  read("../tools/troy-dev.mjs"), read("../tools/troy-game-api-v1.js"),
  read("../game/game.js"), read("../game/bonus-loader.js"),
]);
// Execute the real generated control page without opening an HTTP server. Only
// module import/export syntax is removed in the isolated game realm below.
const factory = runner.slice(runner.indexOf("function controlPage("), runner.indexOf("async function chooseSdkPath("));
assert.match(factory, /^function controlPage/);
const page = vm.runInNewContext(`(${factory.trim()})`)("regression", false, "");
const hostScript = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

function eventTarget(extra = {}) {
  const handlers = new Map();
  return Object.assign({
    addEventListener(type, handler) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(handler); },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    dispatchEvent(event) { for (const handler of handlers.get(event.type) ?? []) handler(event); },
  }, extra);
}

function dom() {
  const nodes = new Map();
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, eventTarget({ textContent: "", value: "", disabled: false, hidden: false, style: {}, parentElement: { clientWidth: 300 }, scrollHeight: 0 }));
    return nodes.get(selector);
  };
  return eventTarget({ hidden: false, body: { dataset: {}, classList: { toggle() {} } },
    fonts: { ready: Promise.resolve() }, querySelector: get, querySelectorAll: () => [], nodes });
}

export async function fixture({ initial = "active", load = "0", save = "0", saved, gameSource } = {}) {
  let now = 0; let nextId = 1;
  const timers = new Map(); const frames = new Map(); const messages = []; const errors = [];
  const setTimer = (fn, delay = 0, interval = 0) => { const id = nextId++; timers.set(id, { fn, at: now + delay, interval }); return id; };
  const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const clock = {
    setTimeout: (fn, delay) => setTimer(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => setTimer(fn, delay, delay), clearInterval: id => timers.delete(id),
    performance: { now: () => now, mark() {} },
    requestAnimationFrame: fn => { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  class Channel {
    constructor() {
      const a = eventTarget({ closed: false, start() {}, close() { this.closed = true; } });
      const b = eventTarget({ closed: false, start() {}, close() { this.closed = true; } });
      for (const [from, to] of [[a, b], [b, a]]) from.postMessage = data => {
        if (from.closed || to.closed) return;
        messages.push({ at: now, ...structuredClone(data) });
        queueMicrotask(() => { if (!from.closed && !to.closed) to.dispatchEvent({ type: "message", data }); });
      };
      this.port1 = a; this.port2 = b;
    }
  }
  const hostDocument = dom(); const gameDocument = dom(); const storage = new Map();
  const storageKey = player => `troy-dev-api:v1:${player}:regression`;
  if (saved !== undefined) storage.set(storageKey("developer"), JSON.stringify(saved));
  for (const [id, value] of Object.entries({ "storage-latency": "0", "storage-load": load, "storage-save": save, "storage-clear": "inherit", player: "developer", "preview-orientation": "portrait" })) hostDocument.querySelector(`#${id}`).value = value;
  for (const id of ["increment", "sound", "quota-test", "api-test", "bonus-load"]) gameDocument.querySelector(`#${id}`).disabled = true;
  const realm = document => {
    const target = eventTarget({ ...clock, document, TextEncoder, TextDecoder, AbortController,
      navigator: { vibrate() {} }, Event: class { constructor(type) { this.type = type; } },
      console: { warn: (...args) => errors.push(args), error: (...args) => errors.push(args), log() {} },
      location: { origin: "http://local.test" } });
    const context = vm.createContext(target);
    vm.runInContext("globalThis.window = globalThis", context);
    return { context, window: vm.runInContext("globalThis", context) };
  };
  const host = realm(hostDocument); const game = realm(gameDocument);
  host.window.MessageChannel = Channel;
  host.window.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  hostDocument.querySelector("#game").contentWindow = game.window;
  hostDocument.querySelector("#game").contentDocument = gameDocument;
  game.window.parent = host.window;
  host.window.postMessage = data => queueMicrotask(() => host.window.dispatchEvent({ type: "message", data, origin: "http://local.test", source: game.window }));
  game.window.postMessage = (data, _origin, ports) => queueMicrotask(() => game.window.dispatchEvent({ type: "message", data, ports, origin: "http://local.test", source: host.window }));
  vm.runInContext(hostScript, host.context, { filename: "actual-control-page.js" });
  if (initial === "inactive") hostDocument.querySelector("#initial-offscreen").onclick();
  vm.runInContext(sdk.replace(/^export default troy;\s*$/m, "").replace(/^export /gm, ""), game.context, { filename: "actual-sdk.js" });
  vm.runInContext(bonus.replace(/^export /gm, ""), game.context, { filename: "actual-bonus-loader.js" });
  const body = gameSource ?? starter.replace(/^import .*;\r?\n/gm, "");
  const boot = vm.runInContext(`(async () => { ${body}\n})()`, game.context, { filename: "actual-game.js" });
  boot.catch(error => errors.push(error));
  await drain();
  return {
    messages, errors, storage, storageKey, gameDocument, hostDocument, boot, drain,
    evaluate: source => vm.runInContext(source, game.context),
    respondStorage: response => vm.runInContext(`port.postMessage(${JSON.stringify({ kind: "storage-response", ...response })})`, host.context),
    log: () => hostDocument.querySelector("#log").textContent,
    set: (operation, setting) => { hostDocument.querySelector(`#storage-${operation}`).value = setting; },
    async click(id, target = "host") {
      const node = (target === "host" ? hostDocument : gameDocument).querySelector(`#${id}`);
      if (!node.disabled) { node.onclick?.(); node.dispatchEvent({ type: "click" }); }
      await drain();
    },
    async tick(ms) {
      const end = now + ms;
      while (true) {
        const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry; now = timer.at; timers.delete(id);
        if (timer.interval) timers.set(id, { ...timer, at: now + timer.interval });
        timer.fn(); await drain();
      }
      now = end; await drain();
    },
    async frame() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now); await drain(); },
  };
}
