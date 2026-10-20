/* global AbortController, setTimeout, clearTimeout */
// Small startup coordinator. The feature module and data are loaded only on demand.
export function createBonusLoader({ isActive, onState, importContent = () => import("./bonus-content.js"), timeoutMs = 10_000 }) {
  let current = null;
  let modulePromise;
  let loaded;

  function cancel() {
    if (!current) return;
    const previous = current;
    current = null;
    previous.controller.abort();
    onState({ status: "paused", message: "Loading paused. Load bonus content when active again." });
  }

  function load() {
    if (!isActive()) return Promise.resolve();
    if (current) return current.promise;
    if (loaded) { onState({ status: "ready", message: loaded.message }); return Promise.resolve(); }
    const operation = { controller: new AbortController(), promise: null };
    current = operation;
    onState({ status: "loading", message: "Loading bonus content… You can keep playing." });
    const { signal } = operation.controller;
    let rejectAbort;
    const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => operation.controller.abort(new Error("Loading timed out.")), timeoutMs);
    // import() cannot be aborted. Race the wait and prevent late results from starting
    // data work or changing the UI. The imported module has no startup side effects.
    modulePromise ??= importContent().catch(error => { modulePromise = null; throw error; });
    const work = modulePromise.then(module => {
      signal.throwIfAborted();
      return module.loadBonusContent(signal);
    });
    operation.promise = Promise.race([work, aborted]).then(value => {
      if (current !== operation || !isActive()) return;
      loaded = value;
      onState({ status: "ready", message: value.message });
    }).catch(error => {
      if (current !== operation || !isActive()) return;
      onState({ status: "failed", message: `${error.message || "Bonus content unavailable."} Retry when ready; if module loading keeps failing, reload the game. Your main game still works.` });
    }).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (current === operation) current = null;
    });
    return operation.promise;
  }
  return { load, cancel };
}
