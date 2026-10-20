/* global fetch, URL */
// No top-level fetches, timers, rendering or audio: importing this module is inert.
export async function loadBonusContent(signal) {
  const response = await fetch(new URL("./bonus-content.json", import.meta.url), { signal });
  if (!response.ok) throw new Error(`Bonus content returned HTTP ${response.status}.`);
  const value = await response.json();
  if (typeof value?.message !== "string" || value.message.length > 200) throw new Error("Bonus content is invalid.");
  return { message: value.message };
}
