import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import test from 'node:test';
const sdkPath = new URL('../tools/troy-game-api-v1.js', import.meta.url);
const publicSourcePath = () => sdkPath;
async function waitUntil(predicate,message){const end=Date.now()+2000;while(Date.now()<end){const result=predicate();if(result)return result;await new Promise(r=>setTimeout(r,5));}throw new Error(message);}
test("top-level SDK degrades safely and validates state", async () => {
  const sdkSource = await readFile(
    sdkPath,
    "utf8",
  );
  const sdkUrl = `data:text/javascript;base64,${Buffer.from(sdkSource).toString("base64")}`;
  const { troy, TroyApiError } = await import(sdkUrl);
  const connection = await troy.ready;

  assert.deepEqual(connection, {
    available: false,
    mode: "unavailable",
    reason: "top-level",
  });
  assert.equal(await troy.storage.load(), undefined);
  assert.deepEqual(await troy.storage.save({ schemaVersion: 1 }), {
    persisted: false,
  });
  assert.deepEqual(await troy.storage.clear(), { persisted: false });

  assert.deepEqual(await troy.storage.save("x".repeat(65_534)), {
    persisted: false,
  });

  await assert.rejects(
    () => troy.storage.save({ invalid: undefined }),
    (error) => error instanceof TroyApiError && error.code === "INVALID_STATE",
  );

  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(
    () => troy.storage.save(cyclic),
    (error) => error instanceof TroyApiError && error.code === "INVALID_STATE",
  );

  await assert.rejects(
    () => troy.storage.save("x".repeat(65_535)),
    (error) => error instanceof TroyApiError && error.code === "QUOTA_EXCEEDED",
  );
});


test("top-level capture splash accepts only valid same-window v1 requests", async () => {
  const sdkSource = await readFile(
    publicSourcePath("/shared/troy-game-api-v1.js"),
    "utf8",
  );
  const globalNames = [
    "window",
    "parent",
    "location",
    "postMessage",
    "addEventListener",
    "removeEventListener",
  ];
  const originalDescriptors = new Map(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const messageHandlers = new Set();
  const postedMessages = [];

  Object.defineProperties(globalThis, {
    window: { configurable: true, value: globalThis },
    parent: { configurable: true, value: globalThis },
    location: { configurable: true, value: { origin: "https://troy.test" } },
    postMessage: {
      configurable: true,
      value(message, targetOrigin) {
        postedMessages.push({ message, targetOrigin });
      },
    },
    addEventListener: {
      configurable: true,
      value(type, handler) {
        if (type === "message") messageHandlers.add(handler);
      },
    },
    removeEventListener: {
      configurable: true,
      value(type, handler) {
        if (type === "message") messageHandlers.delete(handler);
      },
    },
  });

  try {
    const sdkUrl =
      `data:text/javascript;base64,${Buffer.from(sdkSource).toString("base64")}` +
      `#capture-window-${Date.now()}`;
    const { troy } = await import(sdkUrl);
    let calls = 0;
    const unregister = troy.capture.registerSplashScreen(async () => {
      await Promise.resolve();
      calls += 1;
    });
    const request = {
      type: "troy:game-api:capture-splash-request",
      protocolVersion: 1,
      requestId: "window-capture",
    };
    const dispatch = (overrides = {}) => {
      const event = {
        data: request,
        source: globalThis,
        origin: "https://troy.test",
        ...overrides,
      };
      for (const handler of messageHandlers) handler(event);
    };

    dispatch({ source: {} });
    dispatch({ origin: "https://invalid.test" });
    dispatch({ data: { ...request, protocolVersion: 2 } });
    await Promise.resolve();
    assert.equal(calls, 0);

    dispatch();
    const result = await waitUntil(
      () => postedMessages.find((entry) => (
        entry.message.type === "troy:game-api:capture-splash-result" &&
        entry.message.requestId === "window-capture"
      )),
      "Valid same-window capture request did not complete.",
    );
    assert.equal(result.message.ok, true);
    assert.equal(result.targetOrigin, "https://troy.test");
    assert.equal(calls, 1);
    unregister();
  } finally {
    for (const name of globalNames) {
      const descriptor = originalDescriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test("embedded SDK reports lifecycle retention capability only for subscribers", async () => {
  const sdkSource = await readFile(
    publicSourcePath("/shared/troy-game-api-v1.js"),
    "utf8",
  );
  const globalNames = [
    "window",
    "parent",
    "location",
    "addEventListener",
    "removeEventListener",
  ];
  const originalDescriptors = new Map(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const fakeParent = { postMessage() {} };
  const windowMessageHandlers = new Set();
  const channel = new MessageChannel();
  const hostMessages = [];
  let payloadJson;

  channel.port1.addEventListener("message", (event) => {
    hostMessages.push(event.data);

    if (event.data?.kind === "storage-request") {
      if (event.data.operation === "save") payloadJson = event.data.payloadJson;
      if (event.data.operation === "clear") payloadJson = undefined;
      channel.port1.postMessage({
        kind: "storage-response",
        requestId: event.data.requestId,
        ok: true,
        result: event.data.operation === "load" ? { payloadJson } : { persisted: true },
      });
    }
  });
  channel.port1.start();

  Object.defineProperties(globalThis, {
    window: { configurable: true, value: globalThis },
    parent: { configurable: true, value: fakeParent },
    location: { configurable: true, value: { origin: "https://troy.test" } },
    addEventListener: {
      configurable: true,
      value(type, handler) {
        if (type === "message") {
          windowMessageHandlers.add(handler);
        }
      },
    },
    removeEventListener: {
      configurable: true,
      value(type, handler) {
        if (type === "message") {
          windowMessageHandlers.delete(handler);
        }
      },
    },
  });

  try {
    const sdkUrl =
      `data:text/javascript;base64,${Buffer.from(sdkSource).toString("base64")}` +
      `#embedded-${Date.now()}`;
    const { troy } = await import(sdkUrl);

    assert.ok(windowMessageHandlers.size >= 2);
    for (const handler of windowMessageHandlers) handler({
      data: {
        type: "troy:game-api:connect",
        protocolVersion: 1,
        mode: "development",
      },
      source: fakeParent,
      origin: "https://troy.test",
      ports: [channel.port2],
    });

    assert.deepEqual(await troy.ready, {
      available: true,
      mode: "development",
    });

    await waitUntil(
      () => hostMessages.find((message) => (
        message.kind === "capabilities" && message.lifecycle === false
      )),
      "SDK did not report its initial legacy capability.",
    );

    const capabilitiesBeforeStorage = hostMessages.filter(
      (message) => message.kind === "capabilities",
    ).length;
    assert.deepEqual(await troy.storage.save({ score: 1 }), { persisted: true });
    assert.deepEqual(await troy.storage.load(), { score: 1 });
    assert.deepEqual(await troy.storage.clear(), { persisted: true });
    assert.equal(await troy.storage.load(), undefined);
    payloadJson = "broken JSON";
    await assert.rejects(troy.storage.load(), error => error.code === "INVALID_STORED_STATE");
    assert.equal(
      hostMessages.filter((message) => message.kind === "capabilities").length,
      capabilitiesBeforeStorage,
    );

    const unsubscribeFirst = troy.lifecycle.subscribe(() => {});
    await waitUntil(
      () => hostMessages.filter((message) => (
        message.kind === "capabilities" && message.lifecycle === true
      )).length >= 1,
      "First lifecycle subscriber did not enable retention capability.",
    );

    const unsubscribeSecond = troy.lifecycle.subscribe(() => {});
    unsubscribeFirst();
    await waitUntil(
      () => hostMessages.filter((message) => (
        message.kind === "capabilities" && message.lifecycle === true
      )).length >= 3,
      "Capability did not remain enabled while a subscriber remained.",
    );

    unsubscribeSecond();
    await waitUntil(
      () => hostMessages.filter((message) => (
        message.kind === "capabilities" && message.lifecycle === false
      )).length >= 2,
      "Final unsubscribe did not restore legacy capability.",
    );

    assert.throws(
      () => troy.capture.registerSplashScreen(null),
      (error) => error?.code === "INVALID_HANDLER",
    );
    let firstCaptureCalls = 0;
    let secondCaptureCalls = 0;
    const unregisterFirstCapture = troy.capture.registerSplashScreen(() => {
      firstCaptureCalls += 1;
    });
    const unregisterSecondCapture = troy.capture.registerSplashScreen(async () => {
      await Promise.resolve();
      secondCaptureCalls += 1;
    });
    unregisterFirstCapture();
    await waitUntil(
      () => hostMessages.some((message) => (
        message.kind === "capabilities" && message.captureSplash === true
      )),
      "Capture splash capability was not advertised.",
    );
    channel.port1.postMessage({ kind: "capture-splash-request", requestId: "capture-success" });
    await waitUntil(
      () => hostMessages.find((message) => (
        message.kind === "capture-splash-result" && message.requestId === "capture-success"
      )),
      "Capture splash request did not complete.",
    );
    assert.equal(firstCaptureCalls, 0);
    assert.equal(secondCaptureCalls, 1);

    unregisterSecondCapture();
    channel.port1.postMessage({ kind: "capture-splash-request", requestId: "capture-missing" });
    const missingCapture = await waitUntil(
      () => hostMessages.find((message) => (
        message.kind === "capture-splash-result" && message.requestId === "capture-missing"
      )),
      "Unregistered capture splash did not report unavailable.",
    );
    assert.equal(missingCapture.ok, false);
    assert.equal(missingCapture.error.code, "CAPTURE_SPLASH_UNAVAILABLE");

    const unregisterRejectedCapture = troy.capture.registerSplashScreen(() => {
      throw new Error("Deliberate capture failure.");
    });
    channel.port1.postMessage({ kind: "capture-splash-request", requestId: "capture-rejected" });
    const rejectedCapture = await waitUntil(
      () => hostMessages.find((message) => (
        message.kind === "capture-splash-result" && message.requestId === "capture-rejected"
      )),
      "Rejected capture splash did not report failure.",
    );
    assert.equal(rejectedCapture.ok, false);
    assert.equal(rejectedCapture.error.code, "CAPTURE_SPLASH_HANDLER_FAILED");
    unregisterRejectedCapture();

    assert.throws(() => troy.lifecycle.subscribe(null), error => error.code === "INVALID_HANDLER");
    const delivered = [];
    const stopLifecycle = troy.lifecycle.subscribe(async event => {
      delivered.push(event.state);
      if (event.sequence === 3) throw new Error("Deliberate lifecycle rejection");
    });
    const send = (sequence, state) => channel.port1.postMessage({
      kind: "lifecycle", eventId: `test-${sequence}-${state}`,
      event: { sequence, state, surface: state === "active" ? "onscreen" : "offscreen", reason: "navigation" },
    });
    send(1, "inactive"); send(2, "active"); send(2, "inactive");
    await waitUntil(() => hostMessages.find(m => m.kind === "lifecycle-ack" && m.eventId === "test-2-inactive"), "Lifecycle acknowledgements missing");
    assert.deepEqual(delivered, ["inactive", "active"]);
    send(3, "inactive");
    const rejected = await waitUntil(() => hostMessages.find(m => m.kind === "lifecycle-ack" && m.eventId === "test-3-inactive"), "Lifecycle rejection missing");
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "LIFECYCLE_HANDLER_FAILED");
    stopLifecycle();
  } finally {
    channel.port1.close();
    channel.port2.close();

    for (const name of globalNames) {
      const descriptor = originalDescriptors.get(name);

      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }
});
