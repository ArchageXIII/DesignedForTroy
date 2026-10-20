const PROTOCOL_VERSION = 1;
const QUOTA_BYTES = 64 * 1024;
const HELLO_TYPE = "troy:game-api:hello";
const CONNECT_TYPE = "troy:game-api:connect";
const CAPTURE_SPLASH_AVAILABLE_TYPE = "troy:game-api:capture-splash-available";
const CAPTURE_SPLASH_REQUEST_TYPE = "troy:game-api:capture-splash-request";
const CAPTURE_SPLASH_RESULT_TYPE = "troy:game-api:capture-splash-result";
const CONNECTION_TIMEOUT_MS = 5000;
const CONNECTION_RETRY_MS = 200;
const DOCUMENT_ID = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class TroyApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TroyApiError";
    this.code = code;
  }
}

function validateJsonValue(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TroyApiError("INVALID_STATE", "State numbers must be finite.");
    }
    return;
  }

  if (typeof value !== "object") {
    throw new TroyApiError(
      "INVALID_STATE",
      "State must contain only JSON-compatible values.",
    );
  }

  if (seen.has(value)) {
    throw new TroyApiError("INVALID_STATE", "State must not contain cycles.");
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => validateJsonValue(entry, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      throw new TroyApiError(
        "INVALID_STATE",
        "State objects must be plain JSON objects.",
      );
    }

    Object.entries(value).forEach(([key, entry]) => {
      if (typeof key !== "string") {
        throw new TroyApiError("INVALID_STATE", "State keys must be strings.");
      }
      validateJsonValue(entry, seen);
    });
  }

  seen.delete(value);
}

function serializeState(value) {
  validateJsonValue(value);
  const payloadJson = JSON.stringify(value);
  const sizeBytes = new TextEncoder().encode(payloadJson).byteLength;

  if (sizeBytes > QUOTA_BYTES) {
    throw new TroyApiError(
      "QUOTA_EXCEEDED",
      `State uses ${sizeBytes} bytes; the TROY limit is ${QUOTA_BYTES} bytes.`,
    );
  }

  return { payloadJson, sizeBytes };
}

function toApiError(error, fallbackCode = "REQUEST_FAILED") {
  if (error instanceof TroyApiError) {
    return error;
  }

  if (error && typeof error === "object") {
    const code = typeof error.code === "string" ? error.code : fallbackCode;
    const message =
      typeof error.message === "string" && error.message
        ? error.message
        : "The TROY API request failed.";
    return new TroyApiError(code, message);
  }

  return new TroyApiError(fallbackCode, "The TROY API request failed.");
}

let connectionState = "connecting";
let connectionPort = null;
let connectionResult = null;
let latestLifecycleEvent = null;
let lifecycleSequenceSeen = -1;
let lifecycleHandlers = new Set();
let requestSequence = 0;
let lifecycleDispatchChain = Promise.resolve();
let lifecycleFaulted = false;
let loadingState = null;
let captureSplashRegistration = null;
let captureSplashRegistrationSequence = 0;
const pendingRequests = new Map();
let connectionTimeout = null;
let connectionRetry = null;

function clearConnectionTimers() {
  globalThis.clearTimeout(connectionTimeout);
  globalThis.clearInterval(connectionRetry);
  connectionTimeout = null;
  connectionRetry = null;
}

let resolveReady;
export const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

function settleUnavailable(reason = "no-host") {
  if (connectionState !== "connecting") {
    return;
  }

  connectionState = "unavailable";
  clearConnectionTimers();
  globalThis.removeEventListener?.("message", handleConnectMessage);
  connectionResult = {
    available: false,
    mode: "unavailable",
    reason,
  };
  resolveReady(connectionResult);
}

function postCapabilities() {
  connectionPort?.postMessage({
    kind: "capabilities",
    lifecycle: lifecycleHandlers.size > 0,
    captureSplash: captureSplashRegistration !== null,
    loading: loadingState !== null,
  });
  if (loadingState) connectionPort?.postMessage({ kind: "loading", ...loadingState });
}

function postCaptureWindowMessage(message) {
  if (
    typeof globalThis.window === "undefined" ||
    typeof globalThis.postMessage !== "function" ||
    !globalThis.location?.origin
  ) {
    return;
  }

  globalThis.postMessage(message, globalThis.location.origin);
}

function announceCaptureSplashAvailability() {
  postCaptureWindowMessage({
    type: CAPTURE_SPLASH_AVAILABLE_TYPE,
    protocolVersion: PROTOCOL_VERSION,
    available: captureSplashRegistration !== null,
  });
}

async function dispatchCaptureSplash(requestId, respond) {
  const registration = captureSplashRegistration;

  if (!registration) {
    respond({
      requestId,
      ok: false,
      error: {
        code: "CAPTURE_SPLASH_UNAVAILABLE",
        message: "The game has not registered a capture splash screen.",
      },
    });
    return;
  }

  try {
    await registration.handler();
    respond({ requestId, ok: true });
  } catch (error) {
    const apiError = toApiError(error, "CAPTURE_SPLASH_HANDLER_FAILED");
    respond({
      requestId,
      ok: false,
      error: {
        code: apiError.code,
        message: apiError.message,
      },
    });
  }
}

function handleCaptureWindowMessage(event) {
  const message = event.data;

  if (
    event.source !== globalThis ||
    event.origin !== globalThis.location.origin ||
    !message ||
    message.type !== CAPTURE_SPLASH_REQUEST_TYPE ||
    message.protocolVersion !== PROTOCOL_VERSION ||
    typeof message.requestId !== "string" ||
    !message.requestId
  ) {
    return;
  }

  void dispatchCaptureSplash(message.requestId, (result) => {
    postCaptureWindowMessage({
      type: CAPTURE_SPLASH_RESULT_TYPE,
      protocolVersion: PROTOCOL_VERSION,
      ...result,
    });
  });
}

async function dispatchLifecycle(message) {
  if (lifecycleFaulted) return;
  const event = message?.event;
  const eventId = message?.eventId;

  if (
    !event ||
    typeof event !== "object" ||
    typeof event.sequence !== "number" ||
    event.sequence <= lifecycleSequenceSeen
  ) {
    connectionPort?.postMessage({
      kind: "lifecycle-ack",
      eventId,
      ok: true,
    });
    return;
  }

  lifecycleSequenceSeen = event.sequence;
  latestLifecycleEvent = Object.freeze({ ...event });
  const handlers = [...lifecycleHandlers];

  try {
    // Wait for every handler before advancing the serial queue, even if one
    // rejects. A stuck handler is quarantined by the host's current deadline.
    const results = await Promise.allSettled(handlers.map((handler) => Promise.resolve().then(() => handler(latestLifecycleEvent))));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
    connectionPort?.postMessage({
      kind: "lifecycle-ack",
      eventId,
      ok: true,
    });
  } catch (error) {
    const apiError = toApiError(error, "LIFECYCLE_HANDLER_FAILED");
    connectionPort?.postMessage({
      kind: "lifecycle-ack",
      eventId,
      ok: false,
      error: {
        code: apiError.code,
        message: apiError.message,
      },
    });
  }
}

function handlePortMessage(event) {
  const message = event.data;

  if (!message || typeof message !== "object") {
    return;
  }

  if (message.kind === "lifecycle-fault") {
    // Arbitrary async handlers cannot be cancelled safely. Quarantine this
    // document; the host offers an explicit restart instead of replaying work.
    lifecycleFaulted = true;
    return;
  }

  if (message.kind === "lifecycle" && !lifecycleFaulted) {
    lifecycleDispatchChain = lifecycleDispatchChain
      .then(() => dispatchLifecycle(message))
      .catch(() => {
        // dispatchLifecycle reports handler failures to the host.
      });
    return;
  }

  if (message.kind === "capture-splash-request" && typeof message.requestId === "string") {
    void dispatchCaptureSplash(message.requestId, (result) => {
      connectionPort?.postMessage({
        kind: "capture-splash-result",
        ...result,
      });
    });
    return;
  }

  if (message.kind !== "storage-response" || typeof message.requestId !== "string") {
    return;
  }

  const pending = pendingRequests.get(message.requestId);

  if (!pending) {
    return;
  }

  pendingRequests.delete(message.requestId);

  if (!message.ok) {
    pending.reject(toApiError(message.error));
    return;
  }

  pending.resolve(message.result);
}

function handleConnectMessage(event) {
  const message = event.data;

  if (
    connectionState !== "connecting" ||
    event.source !== globalThis.parent ||
    event.origin !== globalThis.location.origin ||
    !message ||
    message.type !== CONNECT_TYPE ||
    message.protocolVersion !== PROTOCOL_VERSION ||
    !event.ports?.[0]
  ) {
    return;
  }

  globalThis.removeEventListener("message", handleConnectMessage);
  clearConnectionTimers();
  connectionState = "connected";
  connectionPort = event.ports[0];
  connectionPort.addEventListener("message", handlePortMessage);
  connectionPort.start();
  connectionResult = {
    available: true,
    mode:
      message.mode === "development" ||
      message.mode === "preview" ||
      message.mode === "production"
        ? message.mode
        : "production",
  };
  resolveReady(connectionResult);
  postCapabilities();
}

async function requestStorage(operation, payloadJson) {
  const connection = await ready;

  if (!connection.available || !connectionPort) {
    if (operation === "load") {
      return undefined;
    }

    return { persisted: false };
  }

  requestSequence += 1;
  const requestId = `storage-${requestSequence}`;

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    connectionPort.postMessage({
      kind: "storage-request",
      requestId,
      operation,
      ...(payloadJson === undefined ? {} : { payloadJson }),
    });
  });
}

if (typeof globalThis.window !== "undefined") {
  globalThis.addEventListener("message", handleCaptureWindowMessage);
}

if (
  typeof globalThis.window === "undefined" ||
  !globalThis.parent ||
  globalThis.parent === globalThis
) {
  settleUnavailable("top-level");
} else {
  globalThis.addEventListener("message", handleConnectMessage);
  const postHello = () => globalThis.parent.postMessage(
    {
      type: HELLO_TYPE,
      protocolVersion: PROTOCOL_VERSION,
      documentId: DOCUMENT_ID,
    },
    globalThis.location.origin,
  );
  connectionRetry = globalThis.setInterval(postHello, CONNECTION_RETRY_MS);
  connectionTimeout = globalThis.setTimeout(() => settleUnavailable("timeout"), CONNECTION_TIMEOUT_MS);
  postHello();
}

export const troy = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  quotaBytes: QUOTA_BYTES,
  ready,
  loading: Object.freeze({
    start() {
      if (loadingState?.state === "playable") return;
      loadingState = { state: "loading", progress: 0 };
      postCapabilities();
    },
    progress(value) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new TroyApiError("INVALID_PROGRESS", "Loading progress must be between 0 and 1.");
      }
      if (loadingState?.state === "playable") return;
      loadingState = { state: "loading", progress: value };
      postCapabilities();
    },
    ready() {
      loadingState = { state: "playable", progress: 1 };
      postCapabilities();
    },
  }),
  lifecycle: Object.freeze({
    subscribe(handler) {
      if (typeof handler !== "function") {
        throw new TroyApiError(
          "INVALID_HANDLER",
          "Lifecycle subscribe requires a function.",
        );
      }

      lifecycleHandlers.add(handler);
      postCapabilities();

      if (latestLifecycleEvent && !lifecycleFaulted) {
        Promise.resolve()
          .then(() => handler(latestLifecycleEvent))
          .catch(() => {
            // The host receives errors for delivered lifecycle events. Replays are local.
          });
      }

      return () => {
        lifecycleHandlers.delete(handler);
        postCapabilities();
      };
    },
  }),
  capture: Object.freeze({
    registerSplashScreen(handler) {
      if (typeof handler !== "function") {
        throw new TroyApiError(
          "INVALID_HANDLER",
          "Capture splash registration requires a function.",
        );
      }

      captureSplashRegistrationSequence += 1;
      const registration = {
        id: captureSplashRegistrationSequence,
        handler,
      };
      captureSplashRegistration = registration;
      postCapabilities();
      announceCaptureSplashAvailability();

      return () => {
        if (captureSplashRegistration?.id !== registration.id) {
          return;
        }

        captureSplashRegistration = null;
        postCapabilities();
        announceCaptureSplashAvailability();
      };
    },
  }),
  storage: Object.freeze({
    async load() {
      const result = await requestStorage("load");

      if (!result || result.payloadJson === undefined) {
        return undefined;
      }

      try {
        return JSON.parse(result.payloadJson);
      } catch {
        throw new TroyApiError(
          "INVALID_STORED_STATE",
          "Stored TROY state is not valid JSON.",
        );
      }
    },
    async save(value) {
      const { payloadJson } = serializeState(value);
      const result = await requestStorage("save", payloadJson);
      return result ?? { persisted: false };
    },
    async clear() {
      const result = await requestStorage("clear");
      return result ?? { persisted: false };
    },
  }),
});

export default troy;
