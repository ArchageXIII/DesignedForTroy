/* global AudioContext, document, navigator, performance, requestAnimationFrame, cancelAnimationFrame, window */

import { TroyApiError, troy } from "/shared/troy-game-api-v1.js";
import { createBonusLoader } from "./bonus-loader.js";

const connectionNode = document.querySelector("#connection");
const lifecycleNode = document.querySelector("#lifecycle");
const surfaceNode = document.querySelector("#surface");
const audioNode = document.querySelector("#audio");
const saveStatusNode = document.querySelector("#save-status");
const scoreNode = document.querySelector("#score");
const framesNode = document.querySelector("#frames");
const orbNode = document.querySelector("#orb");
const incrementButton = document.querySelector("#increment");
const soundButton = document.querySelector("#sound");
const quotaTestButton = document.querySelector("#quota-test");
const apiTestButton = document.querySelector("#api-test");

let score = 0;
let frameCount = 0;
let animationFrame = 0;
let animationGeneration = 0;
let animationStartedAt = performance.now();
let audioContext;
let audioEnabled = false;
let desiredActive = true;

const bonusButton = document.querySelector("#bonus-load");
const bonusStatus = document.querySelector("#bonus-status");
const bonus = createBonusLoader({
  isActive: () => desiredActive && !document.hidden && document.body.dataset.captureSplash !== "true",
  onState: ({ status, message }) => {
    bonusStatus.textContent = message;
    bonusButton.disabled = status === "loading" || status === "ready";
    bonusButton.textContent = status === "failed" ? "Retry bonus content" : status === "ready" ? "Bonus content loaded" : "Load bonus content";
  },
});
bonusButton.addEventListener("click", () => { void bonus.load(); });

function renderScore() {
  scoreNode.textContent = String(score);
}

function animate(now, generation) {
  if (!desiredActive || generation !== animationGeneration) {
    return;
  }

  animationFrame = 0;
  frameCount += 1;
  // Local measurement for this starter: input is wired and the opening scene has
  // crossed a frame boundary. This is not a TROY API or generic engine-ready signal.
  if (frameCount === 2) performance.mark("troy-starter-first-usable");
  framesNode.textContent = String(frameCount);
  const progress = ((now - animationStartedAt) % 1800) / 1800;
  const travel = Math.max(0, orbNode.parentElement.clientWidth - 72);
  orbNode.style.transform = `translateX(${Math.round(progress * travel)}px)`;
  animationFrame = requestAnimationFrame((nextNow) => animate(nextNow, generation));
}

function resumeAnimation() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  animationGeneration += 1;
  const generation = animationGeneration;
  animationStartedAt = performance.now();
  animationFrame = requestAnimationFrame((now) => animate(now, generation));
}

function pauseAnimation() {
  animationGeneration += 1;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function resetTransientInput() {
  navigator.vibrate?.(0);
}

function refreshLayout() {
  // A real canvas game should resize its backing buffer and safe-area layout here.
  animationStartedAt = performance.now();
}

async function resumeAudio() {
  if (audioEnabled && audioContext?.state === "suspended") {
    await audioContext.resume();
  }

  if (audioEnabled) {
    audioNode.textContent = `audio ${audioContext.state}`;
  }
}

async function pauseAudio() {
  if (audioEnabled && audioContext?.state === "running") {
    await audioContext.suspend();
  }

  if (audioEnabled) {
    audioNode.textContent = `audio ${audioContext.state}`;
  }
}

function playTapSound() {
  if (!audioEnabled || audioContext?.state !== "running") {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  oscillator.frequency.setValueAtTime(330, now);
  gain.gain.setValueAtTime(0.035, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.1);
}

function captureSnapshot() {
  return { schemaVersion: 1, score };
}

function queueSnapshotSave(snapshot) {
  void troy.storage.save(snapshot)
    .then((result) => {
      saveStatusNode.textContent = result.persisted
        ? `Saved score ${snapshot.score}.`
        : "Host unavailable; state was not persisted.";
    })
    .catch((error) => {
      saveStatusNode.textContent = `${error.code ?? "SAVE_FAILED"}: ${error.message}`;
    });
}

async function renderCaptureSplash() {
  pauseAnimation();
  document.body.dataset.captureSplash = "true";
  scoreNode.textContent = "12";
  framesNode.textContent = "842";
  orbNode.style.transform = "translateX(218px)";
  await document.fonts?.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

let unregisterCaptureSplash = troy.capture.registerSplashScreen(renderCaptureSplash);

function restoreCaptureSplashRegistration() {
  unregisterCaptureSplash?.();
  unregisterCaptureSplash = troy.capture.registerSplashScreen(renderCaptureSplash);
}

void unregisterCaptureSplash;

const connection = await troy.ready;
desiredActive = !connection.available;
connectionNode.textContent = connection.available
  ? `${connection.mode} / available`
  : "standalone / unavailable";

try {
  const saved = await troy.storage.load();

  if (
    saved &&
    typeof saved === "object" &&
    saved.schemaVersion === 1 &&
    typeof saved.score === "number"
  ) {
    score = saved.score;
    renderScore();
    saveStatusNode.textContent = `Restored score ${score}.`;
  }
} catch (error) {
  saveStatusNode.textContent = `${error.code ?? "LOAD_FAILED"}: ${error.message}`;
}

// Optional content cannot start before the core saved state has been restored.
bonusButton.disabled = false;
incrementButton.addEventListener("click", () => {
  score += 1;
  renderScore();
  playTapSound();
});

soundButton.addEventListener("click", async () => {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  audioEnabled = true;
  audioNode.textContent = `audio ${audioContext.state}`;
  soundButton.textContent = "Sound enabled";
  soundButton.disabled = true;
  playTapSound();
});

quotaTestButton.addEventListener("click", async () => {
  try {
    await troy.storage.save({ oversized: "x".repeat(troy.quotaBytes) });
    saveStatusNode.textContent = "Unexpectedly accepted oversized state.";
  } catch (error) {
    saveStatusNode.textContent = `${error.code ?? "SAVE_FAILED"}: ${error.message}`;
  }
});

function assertApiCheck(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

let captureContractRequestSequence = 0;

function requestDevelopmentCaptureSplash() {
  captureContractRequestSequence += 1;
  const requestId = `starter-capture-check-${captureContractRequestSequence}`;

  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      globalThis.removeEventListener("message", handleResult);
      reject(new Error("The local host did not return a capture contract result."));
    }, 6500);

    function handleResult(event) {
      const message = event.data;
      if (
        event.source !== globalThis.parent ||
        event.origin !== globalThis.location.origin ||
        message?.type !== "troy:dev:capture-test-result" ||
        message.requestId !== requestId
      ) {
        return;
      }

      globalThis.clearTimeout(timeoutId);
      globalThis.removeEventListener("message", handleResult);
      resolve(message);
    }

    globalThis.addEventListener("message", handleResult);
    globalThis.parent.postMessage(
      { type: "troy:dev:capture-test-request", requestId },
      globalThis.location.origin,
    );
  });
}

async function runCaptureContractChecks() {
  let invalidHandlerPassed = false;

  try {
    troy.capture.registerSplashScreen(null);
  } catch (error) {
    invalidHandlerPassed =
      error instanceof TroyApiError && error.code === "INVALID_HANDLER";
  }

  assertApiCheck(
    invalidHandlerPassed,
    "Capture registration did not reject an invalid handler.",
  );

  if (connection.mode !== "development") {
    return false;
  }

  let firstCalls = 0;
  let secondCalls = 0;
  let unregisterFirst;
  let unregisterSecond;
  let unregisterFailure;
  let unregisterTimeout;

  try {
    unregisterFirst = troy.capture.registerSplashScreen(() => {
      firstCalls += 1;
    });
    unregisterSecond = troy.capture.registerSplashScreen(() => {
      secondCalls += 1;
    });

    let result = await requestDevelopmentCaptureSplash();
    assertApiCheck(result.ok === true, "The replacement capture handler did not succeed.");
    assertApiCheck(
      firstCalls === 0 && secondCalls === 1,
      "A newer capture registration did not replace the previous handler.",
    );

    unregisterFirst();
    result = await requestDevelopmentCaptureSplash();
    assertApiCheck(result.ok === true, "The active capture handler was removed by a stale unregister.");
    assertApiCheck(secondCalls === 2, "The active replacement handler was not invoked again.");

    unregisterSecond();
    unregisterSecond = undefined;
    result = await requestDevelopmentCaptureSplash();
    assertApiCheck(
      result.ok === false && result.error?.code === "CAPTURE_SPLASH_UNAVAILABLE",
      "Unregistering the active capture handler did not report it unavailable.",
    );

    unregisterFailure = troy.capture.registerSplashScreen(() => {
      throw new Error("Intentional capture contract rejection.");
    });
    result = await requestDevelopmentCaptureSplash();
    assertApiCheck(
      result.ok === false && result.error?.code === "CAPTURE_SPLASH_HANDLER_FAILED",
      "A rejected capture handler did not return CAPTURE_SPLASH_HANDLER_FAILED.",
    );
    unregisterFailure();
    unregisterFailure = undefined;

    saveStatusNode.textContent = "Running capture timeout check (up to five seconds)…";
    unregisterTimeout = troy.capture.registerSplashScreen(() => new Promise(() => {}));
    result = await requestDevelopmentCaptureSplash();
    assertApiCheck(
      result.ok === false && result.error?.code === "CAPTURE_SPLASH_TIMEOUT",
      "A hanging capture handler did not return CAPTURE_SPLASH_TIMEOUT.",
    );

    return true;
  } finally {
    unregisterFirst?.();
    unregisterSecond?.();
    unregisterFailure?.();
    unregisterTimeout?.();
    restoreCaptureSplashRegistration();
  }
}

apiTestButton.addEventListener("click", async () => {
  const restoreSnapshot = { schemaVersion: 1, score };
  let restoreNeeded = false;
  let unsubscribeSecondary;

  apiTestButton.disabled = true;
  quotaTestButton.disabled = true;
  saveStatusNode.textContent = "Running all public API checks…";

  try {
    assertApiCheck(troy.protocolVersion === 1, "Unexpected protocol version.");
    assertApiCheck(troy.quotaBytes === 65_536, "Unexpected storage quota.");
    assertApiCheck(
      connection.available || connection.mode === "unavailable",
      "Ready returned an invalid mode.",
    );

    unsubscribeSecondary = troy.lifecycle.subscribe(() => {});
    assertApiCheck(
      typeof unsubscribeSecondary === "function",
      "Lifecycle subscribe did not return an unsubscribe function.",
    );
    unsubscribeSecondary();
    unsubscribeSecondary = undefined;

    if (connection.available) {
      const probe = { schemaVersion: 1, apiSelfTest: true, score };
      const saveResult = await troy.storage.save(probe);
      restoreNeeded = true;
      assertApiCheck(saveResult.persisted, "Hosted save was not persisted.");

      const loadedProbe = await troy.storage.load();
      assertApiCheck(
        JSON.stringify(loadedProbe) === JSON.stringify(probe),
        "Save/load round trip did not match.",
      );

      const clearResult = await troy.storage.clear();
      assertApiCheck(clearResult.persisted, "Hosted clear was not persisted.");
      const loadedAfterClear = await troy.storage.load();
      assertApiCheck(
        loadedAfterClear === undefined,
        "Load after clear did not return undefined.",
      );
    } else {
      assertApiCheck(
        (await troy.storage.load()) === undefined,
        "Standalone load did not return undefined.",
      );
      assertApiCheck(
        !(await troy.storage.save(restoreSnapshot)).persisted,
        "Standalone save unexpectedly persisted.",
      );
      assertApiCheck(
        !(await troy.storage.clear()).persisted,
        "Standalone clear unexpectedly persisted.",
      );
    }

    let quotaErrorPassed = false;

    try {
      await troy.storage.save({ oversized: "x".repeat(troy.quotaBytes) });
    } catch (error) {
      quotaErrorPassed =
        error instanceof TroyApiError && error.code === "QUOTA_EXCEEDED";
    }

    assertApiCheck(
      quotaErrorPassed,
      "Quota check did not reject with TroyApiError / QUOTA_EXCEEDED.",
    );

    const captureContractChecked = await runCaptureContractChecks();

    if (restoreNeeded) {
      await troy.storage.save(restoreSnapshot);
      restoreNeeded = false;
    }

    saveStatusNode.textContent = captureContractChecked
      ? "All public API and local capture contract checks passed; score restored."
      : connection.available
        ? "All public API checks passed; capture host checks require the local development runner."
        : "All public API checks passed in standalone mode.";
  } catch (error) {
    saveStatusNode.textContent = `API CHECK FAILED: ${error.message}`;
  } finally {
    unsubscribeSecondary?.();

    if (restoreNeeded) {
      try {
        await troy.storage.save(restoreSnapshot);
      } catch (restoreError) {
        saveStatusNode.textContent += ` Restore failed: ${restoreError.message}`;
      }
    }

    apiTestButton.disabled = false;
    quotaTestButton.disabled = false;
  }
});

const unsubscribeLifecycle = troy.lifecycle.subscribe((event) => {
  lifecycleNode.textContent = event.state;
  surfaceNode.textContent = `${event.surface} / ${event.reason}`;
  desiredActive = event.state === "active";
  resetTransientInput();

  if (desiredActive) {
    refreshLayout();
    resumeAnimation();
    void resumeAudio().catch(() => {});
    return;
  }

  pauseAnimation();
  bonus.cancel();
  void pauseAudio().catch(() => {});
  queueSnapshotSave(captureSnapshot());
});

void unsubscribeLifecycle;

window.addEventListener("blur", resetTransientInput);
window.addEventListener("pageshow", () => {
  if (desiredActive) {
    refreshLayout();
    resumeAnimation();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    bonus.cancel();
    resetTransientInput();
  } else if (desiredActive) {
    refreshLayout();
    resumeAnimation();
  }
});

if (!connection.available) {
  desiredActive = true;
  lifecycleNode.textContent = "standalone active";
  surfaceNode.textContent = "top-level page";
  resumeAnimation();
}
