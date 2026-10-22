#!/usr/bin/env node
/* global Buffer, process, URL */

import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const minimumNodeMajor = 22;
const defaultPort = 4173;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sdkFileName = "troy-game-api-v1.js";
const bundlePolicyFileName = "bundle-policy.json";
const siblingSdkPath = resolve(scriptDirectory, sdkFileName);
const bundlePolicyPaths = [
  resolve(scriptDirectory, bundlePolicyFileName),
  resolve(scriptDirectory, "..", bundlePolicyFileName),
];

function exitWithUsage(message) {
  if (message) {
    process.stderr.write(`${message}\n\n`);
  }

  process.stderr.write(
    "Usage: node troy-dev.mjs <game-directory> [--port 4173] [--game-id local-id] [--strict-upload]\n",
  );
  process.exit(1);
}

function sanitizeGameId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80);
}

function resolveGameMountPath(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return "";
  if (
    !candidate.startsWith("/")
    || candidate.endsWith("/")
    || candidate.includes("\\")
    || candidate.includes("//")
    || candidate.split("/").slice(1).some((segment) => !/^[a-z0-9][a-z0-9._-]*$/i.test(segment))
  ) {
    throw new Error("The configured game mount path is invalid.");
  }
  return candidate;
}

function parseArguments(argv) {
  let gameDirectory = null;
  let port = defaultPort;
  let gameId = null;
  let strictUpload = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--port") {
      port = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--game-id") {
      gameId = sanitizeGameId(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (value === "--strict-upload") {
      strictUpload = true;
      continue;
    }

    if (!value.startsWith("-") && !gameDirectory) {
      gameDirectory = value;
      continue;
    }

    exitWithUsage(`Unknown argument: ${value}`);
  }

  if (!gameDirectory) {
    exitWithUsage("Choose a static game directory.");
  }

  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    exitWithUsage("Port must be an integer between 1024 and 65535.");
  }

  const absoluteGameDirectory = resolve(process.cwd(), gameDirectory);
  const derivedGameId = sanitizeGameId(absoluteGameDirectory.split(/[\\/]/).pop() ?? "");

  return {
    gameDirectory: absoluteGameDirectory,
    port,
    gameId: gameId || derivedGameId || "local-game",
    strictUpload,
    gameMountPath: resolveGameMountPath(process.env.TROY_DEV_GAME_MOUNT_PATH),
  };
}

function isInsideDirectory(root, target) {
  const targetRelative = relative(root, target);
  return (
    targetRelative === "" ||
    (!targetRelative.startsWith(`..${sep}`) &&
      targetRelative !== ".." &&
      !isAbsolute(targetRelative))
  );
}

function getPathExtension(filePath) {
  const basename = filePath.replaceAll("\\", "/").split("/").pop() ?? "";
  const separatorIndex = basename.lastIndexOf(".");
  return separatorIndex === -1 ? "" : basename.slice(separatorIndex + 1).toLowerCase();
}

function contentTypeFor(filePath, bundlePolicy) {
  return bundlePolicy.contentTypes[getPathExtension(filePath)]
    ?? bundlePolicy.fallbackContentType;
}

function isSupportedGameFile(filePath, bundlePolicy) {
  const extension = getPathExtension(filePath);
  return (!extension && bundlePolicy.extensionlessAllowed)
    || Object.hasOwn(bundlePolicy.contentTypes, extension);
}

function uploadedAssetContentSecurityPolicy() {
  return [
    "sandbox allow-scripts allow-same-origin",
    "default-src 'self' data: blob:",
    "script-src 'self' https: http: 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
    "child-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "manifest-src 'self'",
  ].join("; ");
}

function injectDevelopmentDiagnostics(html) {
  const diagnosticScript = `<script>
(() => {
  const pendingAnimationFrames = new Set();
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  window.requestAnimationFrame = (callback) => {
    let frameId = 0;
    frameId = nativeRequestAnimationFrame((timestamp) => {
      pendingAnimationFrames.delete(frameId);
      callback(timestamp);
    });
    pendingAnimationFrames.add(frameId);
    return frameId;
  };

  window.cancelAnimationFrame = (frameId) => {
    pendingAnimationFrames.delete(frameId);
    nativeCancelAnimationFrame(frameId);
  };

  window.addEventListener("error", (event) => {
    window.parent.postMessage({
      type: "troy:dev:game-runtime-error",
      kind: "error",
      message: event.message || "Unknown game runtime error.",
      source: event.filename || "unknown game source",
      line: event.lineno || 0,
      column: event.colno || 0,
    }, location.origin);
  });

  window.addEventListener("unhandledrejection", (event) => {
    window.parent.postMessage({
      type: "troy:dev:game-runtime-error",
      kind: "unhandledrejection",
      message: event.reason?.message || String(event.reason || "Unknown game rejection."),
      source: event.reason?.stack || "unknown game source",
    }, location.origin);
  });

  window.addEventListener("message", (event) => {
    if (
      event.source !== window.parent
      || event.origin !== location.origin
      || event.data?.type !== "troy:dev:discard-animation-frames"
    ) {
      return;
    }

    const count = pendingAnimationFrames.size;
    pendingAnimationFrames.forEach((frameId) => nativeCancelAnimationFrame(frameId));
    pendingAnimationFrames.clear();
    window.parent.postMessage({
      type: "troy:dev:animation-frames-discarded",
      count,
    }, location.origin);
  });
})();
</script>`;
  const headMatch = html.match(/<head(?:\s[^>]*)?>/i);

  if (!headMatch || headMatch.index === undefined) {
    return `${diagnosticScript}${html}`;
  }

  const insertionIndex = headMatch.index + headMatch[0].length;
  return `${html.slice(0, insertionIndex)}${diagnosticScript}${html.slice(insertionIndex)}`;
}

function controlPage(gameId, strictUpload, gameMountPath) {
  const safeGameId = JSON.stringify(gameId);
  const safeStrictUpload = JSON.stringify(strictUpload);
  const safeGamePath = JSON.stringify(
    gameMountPath ? gameMountPath + "/index.html" : "/index.html",
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>TROY API local host</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #07111f; color: #e8f2ff; }
    main { display: grid; grid-template-columns: minmax(280px, 430px) minmax(260px, 1fr); gap: 18px; min-height: 100vh; padding: 18px; }
    body.preview-landscape main { grid-template-columns: minmax(520px, 860px) minmax(260px, 1fr); }
    .phone { position: relative; align-self: start; height: min(880px, calc(100vh - 36px)); min-height: min(880px, calc(100vh - 36px)); overflow: hidden; border: 1px solid #2c4058; border-radius: 32px; background: #fff; box-shadow: 0 28px 80px #0008; }
    body.preview-landscape .phone { height: min(430px, calc(100vh - 36px)); min-height: min(430px, calc(100vh - 36px)); border-radius: 26px; }
    iframe { width: 100%; height: 100%; min-height: inherit; border: 0; background: #fff; }
    aside { display: flex; min-width: 0; flex-direction: column; gap: 14px; }
    section { border: 1px solid #263c55; border-radius: 20px; background: #0d1b2ccc; padding: 16px; }
    h1 { margin: 0; font-size: 20px; } h2 { margin: 0 0 10px; font-size: 13px; color: #90b4d9; text-transform: uppercase; letter-spacing: .12em; }
    p, small { color: #9db3c9; line-height: 1.5; }
    a { color: #b9d9f7; }
    .controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    button, input, select { min-height: 42px; border: 1px solid #36516f; border-radius: 12px; background: #132941; color: #f2f7ff; padding: 9px 12px; font: inherit; }
    button { cursor: pointer; font-weight: 700; } button:hover { background: #1b3858; }
    label { display: grid; gap: 6px; color: #9db3c9; font-size: 12px; }
    .player-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
    .status { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill { border-radius: 999px; background: #17324e; padding: 6px 10px; color: #b9d9f7; font-size: 12px; }
    pre { flex: 1; min-height: 220px; max-height: 45vh; overflow: auto; margin: 0; white-space: pre-wrap; color: #b7cde4; font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
    @media (max-width: 760px) { main { grid-template-columns: 1fr; } .phone { min-height: 70vh; } }
  </style>
</head>
<body>
  <main>
    <div class="phone"><iframe id="game" title="Local TROY game"></iframe></div>
    <aside>
      <section>
        <h1>TROY API v1 local host</h1>
        <p>Static game <strong id="game-id"></strong>. Storage is local to this browser.</p>
        <p><a href="/" target="_blank" rel="noreferrer">Open the game directly</a> to test top-level unavailable mode.</p>
        <div class="status">
          <span class="pill" id="connection">Waiting for SDK</span>
          <span class="pill" id="surface">onscreen</span>
          <span class="pill" id="quota">0 / 65,536 bytes</span>
          <span class="pill" id="strict-mode"></span>
          <span class="pill" id="viewport-mode">portrait viewport</span>
        </div>
      </section>
      <section>
        <h2>Player and lifecycle</h2>
        <label>
          Preview orientation
          <select id="preview-orientation">
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
          <small>Changes only the developer viewport; set the game's upload metadata separately.</small>
        </label>
        <label>
          Fake player ID
          <span class="player-row">
            <input id="player" value="developer">
            <button id="apply-player" type="button">Apply player</button>
          </span>
          <small>Press Enter or apply to reload the iframe with isolated state.</small>
        </label>
        <div class="controls" style="margin-top:10px">
          <button id="active">Set active</button>
          <button id="inactive">Set off-screen</button>
          <button id="initial-offscreen">Reload off-screen</button>
          <button id="rapid">Simulate rapid swipes</button>
          <button id="reload">Reload / restore game</button>
          <button id="evict">Evict then restore</button>
          <button id="capture-splash">Request capture splash</button>
          <button id="discard-frames">Discard pending frame</button>
          <button id="clear">Clear state</button>
          <button id="clear-log">Clear log</button>
        </div>
        <label style="margin-top:10px">
          Default storage response
          <select id="storage-latency">
            <option value="0">Immediate</option>
            <option value="500">500 ms</option>
            <option value="1500">1.5 seconds</option>
            <option value="2500">2.5 seconds (past lifecycle deadline)</option>
            <option value="reject">Reject request</option>
            <option value="never">Never resolve</option>
          </select>
        </label>
        ${["load", "save", "clear"].map((operation) => `<label style="margin-top:10px">
          ${operation[0].toUpperCase() + operation.slice(1)} response override
          <select id="storage-${operation}">
            <option value="inherit">Use default</option>
            <option value="0">Immediate</option>
            <option value="500">500 ms</option>
            <option value="1500">1.5 seconds</option>
            <option value="2500">2.5 seconds (past lifecycle deadline)</option>
            <option value="reject">Reject request</option>
            <option value="never">Never resolve</option>
          </select>
        </label>`).join("")}
        <small>Each request keeps the setting selected when it starts. Restore the default or override to Immediate before retrying a pending or rejected operation.</small>
        <small>Capture splash requests intentionally leave the representative view visible for inspection. Use Reload / restore game to return to normal play.</small>
      </section>
      <section style="display:flex; min-height:0; flex:1; flex-direction:column">
        <h2>Protocol log</h2>
        <small>Control and iframe errors include their source when the browser exposes it. An empty protocol log does not prove gameplay booted successfully.</small>
        <pre id="log"></pre>
      </section>
    </aside>
  </main>
  <script type="module">
    const gameId = ${safeGameId};
    const strictUpload = ${safeStrictUpload};
    const gamePath = ${safeGamePath};
    const quotaBytes = 64 * 1024;
    const frame = document.querySelector("#game");
    const logNode = document.querySelector("#log");
    const playerInput = document.querySelector("#player");
    const connectionNode = document.querySelector("#connection");
    const surfaceNode = document.querySelector("#surface");
    const quotaNode = document.querySelector("#quota");
    const strictModeNode = document.querySelector("#strict-mode");
    const viewportModeNode = document.querySelector("#viewport-mode");
    const previewOrientationNode = document.querySelector("#preview-orientation");
    const storageLatencyNode = document.querySelector("#storage-latency");
    const encoder = new TextEncoder();
    const lifecycleTimeoutMs = 2000;
    const pendingLifecycleAcks = new Map();
    const recentLifecycleEvents = new Map();
    const pendingCaptureSplashes = new Map();
    let port = null;
    let lifecycleRetentionState = "legacy";
    let lifecycleSequence = 0;
    let eventSequence = 0;
    let captureSplashSequence = 0;
    let desiredState = "active";
    let desiredSurface = "onscreen";
    let latestEvent = null;
    let activationTimer = 0;
    let activePlayerId = "developer";
    let storageRequestSequence = 0;
    // Fault injection may settle requests out of order. A superseded write must
    // never roll back a newer committed checkpoint or explicit clear.
    const committedStorageWrites = new Map();

    document.querySelector("#game-id").textContent = gameId;
    strictModeNode.textContent = strictUpload ? "strict upload mode" : "ordinary mode";

    function log(message, detail) {
      const suffix = detail === undefined ? "" : " " + JSON.stringify(detail);
      logNode.textContent += "[" + new Date().toLocaleTimeString() + "] " + message + suffix + "\\n";
      logNode.scrollTop = logNode.scrollHeight;
    }

    function applyPreviewOrientation() {
      const orientation = previewOrientationNode.value === "landscape" ? "landscape" : "portrait";
      document.body.classList.toggle("preview-landscape", orientation === "landscape");
      viewportModeNode.textContent = orientation + " viewport";
      window.requestAnimationFrame(() => {
        frame.contentWindow?.dispatchEvent(new Event("resize"));
      });
      log("preview orientation changed", { orientation });
    }

    function updateConnectionStatus() {
      connectionNode.textContent =
        lifecycleRetentionState === "managed"
          ? "Lifecycle managed · retention protected"
          : lifecycleRetentionState === "faulted"
            ? "Lifecycle faulted · legacy reload"
            : port
              ? "SDK connected · legacy reload"
              : "Waiting for SDK";
    }

    function clearPendingLifecycleAcks() {
      for (const pending of pendingLifecycleAcks.values()) {
        window.clearTimeout(pending.timeoutId);
      }
      pendingLifecycleAcks.clear();
    }

    function clearPendingCaptureSplashes() {
      for (const pending of pendingCaptureSplashes.values()) {
        window.clearTimeout(pending.timeoutId);
      }
      pendingCaptureSplashes.clear();
    }

    function replyToCaptureContractCheck(replyRequestId, result) {
      if (!replyRequestId) {
        return;
      }

      frame.contentWindow?.postMessage(
        {
          type: "troy:dev:capture-test-result",
          requestId: replyRequestId,
          ...result,
        },
        location.origin,
      );
    }

    function finishCaptureSplashRequest(requestId, result) {
      const pending = pendingCaptureSplashes.get(requestId);
      if (!pending) {
        return;
      }

      window.clearTimeout(pending.timeoutId);
      pendingCaptureSplashes.delete(requestId);
      replyToCaptureContractCheck(pending.replyRequestId, result);
      log(result.ok === true ? "capture splash ready" : "capture splash failed", {
        requestId,
        error: result.error,
        ...(result.ok === true && !pending.replyRequestId
          ? { restore: "Use Reload / restore game to return to normal play." }
          : {}),
      });
    }

    function requestCaptureSplash(replyRequestId) {
      if (!port) {
        const error = {
          code: "CAPTURE_SPLASH_UNAVAILABLE",
          message: "The SDK is not connected to the local development host.",
        };
        replyToCaptureContractCheck(replyRequestId, { ok: false, error });
        log("capture splash unavailable", { reason: "SDK not connected" });
        return;
      }

      captureSplashSequence += 1;
      const requestId = "dev-capture-" + captureSplashSequence;
      const timeoutId = window.setTimeout(() => {
        finishCaptureSplashRequest(requestId, {
          ok: false,
          error: {
            code: "CAPTURE_SPLASH_TIMEOUT",
            message: "The capture splash handler did not finish within five seconds.",
          },
        });
      }, 5000);
      pendingCaptureSplashes.set(requestId, { timeoutId, replyRequestId });
      port.postMessage({ kind: "capture-splash-request", requestId });
      log("capture splash requested", { requestId, contractCheck: Boolean(replyRequestId) });
    }

    function quietFrame() {
      try {
        frame.contentWindow?.postMessage(
          { type: "troy:surface-visibility", visible: false },
          location.origin,
        );
        frame.contentDocument
          ?.querySelectorAll("audio, video")
          .forEach((element) => element.pause());
      } catch {
        // Best effort only; the frame may be navigating.
      }
    }

    function faultLifecycle(code, message) {
      if (lifecycleRetentionState === "faulted") {
        return;
      }

      clearPendingLifecycleAcks();
      lifecycleRetentionState = "faulted";
      updateConnectionStatus();
      quietFrame();
      log("lifecycle retention faulted", {
        code,
        message,
        fallback: "legacy reload",
      });
    }

    function deliverLifecycle(event) {
      if (!port || lifecycleRetentionState !== "managed") {
        log("lifecycle queued", event);
        return;
      }

      eventSequence += 1;
      const eventId = "dev-" + eventSequence;
      const sentAt = performance.now();
      recentLifecycleEvents.set(eventId, { sequence: event.sequence, sentAt });
      if (recentLifecycleEvents.size > 100) recentLifecycleEvents.delete(recentLifecycleEvents.keys().next().value);
      const timeoutId = window.setTimeout(() => {
        pendingLifecycleAcks.delete(eventId);
        log("lifecycle deadline exceeded", { eventId, sequence: event.sequence, elapsedMs: Math.round(performance.now() - sentAt) });
        faultLifecycle(
          "LIFECYCLE_TIMEOUT",
          "The game lifecycle handler did not finish within two seconds.",
        );
      }, lifecycleTimeoutMs);
      pendingLifecycleAcks.set(eventId, { timeoutId });
      port.postMessage({ kind: "lifecycle", eventId, event });
      log("lifecycle sent", { eventId, ...event });
    }

    window.addEventListener("error", (event) => {
      log("control-page runtime error", {
        message: event.message || "Unknown runtime error.",
        source: event.filename || "unknown or injected source",
        line: event.lineno || 0,
        column: event.colno || 0,
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      log("control-page unhandled rejection", {
        message: event.reason?.message || String(event.reason || "Unknown rejection."),
        source: event.reason?.stack || "unknown or injected source",
      });
    });

    function storageKey() {
      return "troy-dev-api:v1:" + encodeURIComponent(activePlayerId) + ":" + encodeURIComponent(gameId);
    }

    function updateQuota() {
      const payload = localStorage.getItem(storageKey());
      quotaNode.textContent = (payload ? encoder.encode(payload).byteLength : 0).toLocaleString() + " / " + quotaBytes.toLocaleString() + " bytes";
    }

    function loadFrame(initialState = "active") {
      desiredState = initialState;
      desiredSurface = initialState === "active" ? "onscreen" : "offscreen";
      port?.close();
      port = null;
      clearPendingLifecycleAcks();
      clearPendingCaptureSplashes();
      lifecycleRetentionState = "legacy";
      latestEvent = null;
      updateConnectionStatus();
      surfaceNode.textContent = desiredSurface;
      frame.src = gamePath + "?__troy_reload=" + Date.now();
      log("iframe loaded", { initialState, player: activePlayerId });
    }

    function applyPlayer() {
      activePlayerId = playerInput.value.trim() || "developer";
      playerInput.value = activePlayerId;
      updateQuota();
      loadFrame(desiredState);
    }

    function sendLifecycle(state, surface, reason) {
      desiredState = state;
      desiredSurface = surface;
      surfaceNode.textContent = surface;
      window.clearTimeout(activationTimer);

      const deliver = () => {
        lifecycleSequence += 1;
        latestEvent = { state, surface, reason, sequence: lifecycleSequence };
        deliverLifecycle(latestEvent);
      };

      if (state === "active" || !latestEvent) {
        activationTimer = window.setTimeout(deliver, 250);
      } else {
        deliver();
      }
    }

    async function applyStorageLatency(setting) {
      if (setting === "reject") {
        throw Object.assign(new Error("Simulated storage failure."), { code: "REQUEST_FAILED" });
      }
      if (setting === "never") {
        await new Promise(() => {});
        return;
      }

      const latencyMs = Number(setting);
      if (latencyMs > 0) {
        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, latencyMs));
      }
    }

    async function handleStorage(message) {
      // Delayed work belongs to its original frame/player, even after a reload.
      const requestPort = port;
      const requestKey = storageKey();
      const writeSequence = ++storageRequestSequence;
      const override = ["load", "save", "clear"].includes(message.operation)
        ? document.querySelector("#storage-" + message.operation).value : undefined;
      const setting = !override || override === "inherit" ? storageLatencyNode.value : override;
      const startedAt = performance.now();
      log("storage requested", { requestId: message.requestId, operation: message.operation, response: setting });
      const respond = (ok, result, error) => requestPort?.postMessage({
        kind: "storage-response",
        requestId: message.requestId,
        ok,
        ...(result === undefined ? {} : { result }),
        ...(error === undefined ? {} : { error }),
      });

      try {
        await applyStorageLatency(setting);
        if (message.operation === "load") {
          const payloadJson = localStorage.getItem(requestKey);
          respond(true, payloadJson === null ? {} : { payloadJson });
          log("storage loaded", { requestId: message.requestId, found: payloadJson !== null, elapsedMs: Math.round(performance.now() - startedAt) });
          return;
        }
        if (message.operation === "save" && typeof message.payloadJson === "string") {
          JSON.parse(message.payloadJson);
          const sizeBytes = encoder.encode(message.payloadJson).byteLength;
          if (sizeBytes > quotaBytes) {
            throw Object.assign(new Error("State exceeds the " + quotaBytes.toLocaleString() + "-byte limit."), { code: "QUOTA_EXCEEDED" });
          }
          if (writeSequence > (committedStorageWrites.get(requestKey) ?? 0)) {
            localStorage.setItem(requestKey, message.payloadJson);
            committedStorageWrites.set(requestKey, writeSequence);
          }
          updateQuota();
          respond(true, { persisted: true });
          log("storage saved", { requestId: message.requestId, sizeBytes, elapsedMs: Math.round(performance.now() - startedAt) });
          return;
        }
        if (message.operation === "clear") {
          if (writeSequence > (committedStorageWrites.get(requestKey) ?? 0)) {
            localStorage.removeItem(requestKey);
            committedStorageWrites.set(requestKey, writeSequence);
          }
          updateQuota();
          respond(true, { persisted: true });
          log("storage cleared", { requestId: message.requestId, elapsedMs: Math.round(performance.now() - startedAt) });
          return;
        }
        throw Object.assign(new Error("Unsupported storage request."), { code: "INVALID_REQUEST" });
      } catch (error) {
        log("storage rejected", { requestId: message.requestId, operation: message.operation, code: error?.code || "REQUEST_FAILED", elapsedMs: Math.round(performance.now() - startedAt) });
        respond(false, undefined, {
          code: error?.code || "REQUEST_FAILED",
          message: error?.message || "Storage request failed.",
        });
      }
    }

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (
        event.origin !== location.origin ||
        event.source !== frame.contentWindow
      ) {
        return;
      }

      if (message?.type === "troy:dev:game-runtime-error") {
        log(message.kind === "unhandledrejection" ? "game unhandled rejection" : "game runtime error", {
          message: message.message,
          source: message.source || "unknown game source",
          line: message.line || 0,
          column: message.column || 0,
        });
        return;
      }

      if (message?.type === "troy:dev:animation-frames-discarded") {
        log("game animation frames discarded", { count: message.count || 0 });
        return;
      }

      if (
        message?.type === "troy:dev:capture-test-request" &&
        typeof message.requestId === "string" &&
        message.requestId.length > 0 &&
        message.requestId.length <= 128
      ) {
        requestCaptureSplash(message.requestId);
        return;
      }

      if (
        message?.type !== "troy:game-api:hello" ||
        message.protocolVersion !== 1
      ) {
        return;
      }

      port?.close();
      clearPendingLifecycleAcks();
      clearPendingCaptureSplashes();
      if (lifecycleRetentionState !== "faulted") {
        lifecycleRetentionState = "legacy";
      }
      const channel = new MessageChannel();
      port = channel.port1;
      port.addEventListener("message", (portEvent) => {
        const next = portEvent.data;
        if (next?.kind === "capabilities") {
          const requestedLifecycle = next.lifecycle === true;
          const wasManaged = lifecycleRetentionState === "managed";

          if (lifecycleRetentionState !== "faulted") {
            lifecycleRetentionState = requestedLifecycle ? "managed" : "legacy";
          }

          if (lifecycleRetentionState !== "managed") {
            clearPendingLifecycleAcks();
          }

          updateConnectionStatus();
          log("capabilities", {
            lifecycle: requestedLifecycle,
            captureSplash: next.captureSplash === true,
            retention: lifecycleRetentionState,
            ignoredAfterFault:
              requestedLifecycle && lifecycleRetentionState === "faulted",
          });

          if (lifecycleRetentionState === "managed" && !wasManaged && latestEvent) {
            deliverLifecycle(latestEvent);
          } else if (lifecycleRetentionState === "managed" && !wasManaged) {
            sendLifecycle(desiredState, desiredSurface, "initial");
          }
        } else if (next?.kind === "lifecycle-ack") {
          const pending = pendingLifecycleAcks.get(next.eventId);
          const sent = recentLifecycleEvents.get(next.eventId);

          if (pending) {
            window.clearTimeout(pending.timeoutId);
            pendingLifecycleAcks.delete(next.eventId);
          }

          log("lifecycle acknowledged", {
            eventId: next.eventId,
            sequence: sent?.sequence,
            elapsedMs: sent ? Math.round(performance.now() - sent.sentAt) : undefined,
            pending: Boolean(pending),
            ok: next.ok,
            error: next.error,
          });

          if (pending && next.ok !== true) {
            faultLifecycle(
              next.error?.code || "LIFECYCLE_HANDLER_FAILED",
              next.error?.message || "The lifecycle handler rejected.",
            );
          }
        } else if (next?.kind === "storage-request") {
          void handleStorage(next);
        } else if (next?.kind === "capture-splash-result") {
          finishCaptureSplashRequest(next.requestId, {
            ok: next.ok === true,
            ...(next.error === undefined ? {} : { error: next.error }),
          });
        }
      });
      port.start();
      frame.contentWindow.postMessage(
        { type: "troy:game-api:connect", protocolVersion: 1, mode: "development" },
        location.origin,
        [channel.port2],
      );
      updateConnectionStatus();
      log("SDK connected");
    });

    document.querySelector("#active").onclick = () => sendLifecycle("active", "onscreen", "navigation");
    document.querySelector("#inactive").onclick = () => sendLifecycle("inactive", "offscreen", "navigation");
    document.querySelector("#initial-offscreen").onclick = () => loadFrame("inactive");
    document.querySelector("#rapid").onclick = () => {
      sendLifecycle("inactive", "offscreen", "navigation");
      log("three transient activations suppressed");
      window.setTimeout(() => sendLifecycle("active", "onscreen", "navigation"), 120);
    };
    document.querySelector("#reload").onclick = () => loadFrame(desiredState);
    document.querySelector("#evict").onclick = () => {
      sendLifecycle("inactive", "offscreen", "navigation");
      window.setTimeout(() => {
        frame.src = "about:blank";
        port?.close();
        port = null;
        clearPendingLifecycleAcks();
        clearPendingCaptureSplashes();
        log("iframe evicted");
      }, 50);
      window.setTimeout(() => loadFrame("active"), 700);
    };
    document.querySelector("#capture-splash").onclick = () => requestCaptureSplash();
    document.querySelector("#discard-frames").onclick = () => {
      frame.contentWindow?.postMessage(
        { type: "troy:dev:discard-animation-frames" },
        location.origin,
      );
    };
    document.querySelector("#clear").onclick = () => {
      const key = storageKey();
      localStorage.removeItem(key);
      committedStorageWrites.set(key, ++storageRequestSequence);
      updateQuota();
      log("state cleared from control panel");
    };
    document.querySelector("#clear-log").onclick = () => { logNode.textContent = ""; };
    document.querySelector("#apply-player").onclick = applyPlayer;
    previewOrientationNode.onchange = applyPreviewOrientation;
    playerInput.onchange = applyPlayer;
    playerInput.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyPlayer();
      }
    };

    updateQuota();
    applyPreviewOrientation();
    loadFrame("active");
  </script>
</body>
</html>`;
}

async function chooseSdkPath() {
  await stat(siblingSdkPath);
  return siblingSdkPath;
}

async function loadBundlePolicy() {
  for (const policyPath of bundlePolicyPaths) {
    try {
      const policy = JSON.parse(await readFile(policyPath, "utf8"));

      if (
        policy?.entryFile === "index.html"
        && typeof policy?.fallbackContentType === "string"
        && Number.isFinite(policy?.maxFileBytesExclusive)
        && policy.maxFileBytesExclusive > 0
        && policy?.contentTypes
        && typeof policy.contentTypes === "object"
      ) {
        return policy;
      }
    } catch {
      // Try the next location used by the public source or extracted kit.
    }
  }

  throw new Error(
    `Place ${bundlePolicyFileName} beside troy-dev.mjs or at the root of the extracted kit.`,
  );
}

const nodeMajor = Number(process.versions.node.split(".")[0]);

if (nodeMajor < minimumNodeMajor) {
  throw new Error(`TROY API local development requires Node ${minimumNodeMajor} or newer.`);
}

const options = parseArguments(process.argv.slice(2));
options.gameDirectory = await realpath(options.gameDirectory);
const indexPath = join(options.gameDirectory, "index.html");
await stat(indexPath).catch(() => {
  throw new Error(`No index.html was found in ${options.gameDirectory}.`);
});
const sdkPath = await chooseSdkPath();
const bundlePolicy = await loadBundlePolicy();

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed.");
      return;
    }

    if (requestUrl.pathname === "/favicon.ico") {
      response.writeHead(204, {
        "Cache-Control": "public, max-age=86400",
      });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/__troy" || requestUrl.pathname === "/__troy/") {
      const body = controlPage(options.gameId, options.strictUpload, options.gameMountPath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    let filePath;

    if (requestUrl.pathname === `/shared/${sdkFileName}`) {
      filePath = sdkPath;
    } else {
      const gameMountPath = options.gameMountPath;
      if (gameMountPath && requestUrl.pathname !== gameMountPath && !requestUrl.pathname.startsWith(gameMountPath + "/")) {
        response.writeHead(404);
        response.end("File not found.");
        return;
      }
      const servedPath = gameMountPath ? requestUrl.pathname.slice(gameMountPath.length) || "/" : requestUrl.pathname;
      const decodedPath = decodeURIComponent(servedPath);
      filePath = resolve(options.gameDirectory, `.${decodedPath === "/" ? "/index.html" : decodedPath}`);

      if (!isInsideDirectory(options.gameDirectory, filePath)) {
        response.writeHead(403);
        response.end("Path is outside the selected game directory.");
        return;
      }

      if (options.strictUpload && !isSupportedGameFile(filePath, bundlePolicy)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("File type is not accepted by the TROY upload policy.");
        return;
      }
      filePath = await realpath(filePath);
      if (!isInsideDirectory(options.gameDirectory, filePath)) {
        response.writeHead(403);
        response.end("Path is outside the selected game directory.");
        return;
      }
    }

    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      response.writeHead(404);
      response.end("File not found.");
      return;
    }

    if (
      options.strictUpload
      && requestUrl.pathname !== `/shared/${sdkFileName}`
      && fileStats.size >= bundlePolicy.maxFileBytesExclusive
    ) {
      response.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("File is too large for the TROY upload policy.");
      return;
    }

    const contentType = contentTypeFor(filePath, bundlePolicy);
    let body = await readFile(filePath);

    if (contentType.startsWith("text/html")) {
      body = Buffer.from(injectDevelopmentDiagnostics(body.toString("utf8")), "utf8");
    }

    const headers = {
      "Cache-Control": "no-store",
      "Content-Length": body.byteLength,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    };

    if (
      options.strictUpload
      && (contentType.startsWith("text/html") || contentType.startsWith("image/svg+xml"))
    ) {
      headers["Content-Security-Policy"] = uploadedAssetContentSecurityPolicy();
    }

    response.writeHead(200, headers);
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(error?.code === "ENOENT" ? "File not found." : "Local host request failed.");
  }
});

server.listen(options.port, "127.0.0.1", () => {
  process.stdout.write(
    `TROY API local host: http://127.0.0.1:${options.port}/__troy/\n` +
    `Game directory: ${options.gameDirectory}\n` +
    `Game id: ${options.gameId}\n` +
    `Upload contract: ${options.strictUpload ? "strict" : "ordinary"}\n`,
  );
});

function closeServer() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
