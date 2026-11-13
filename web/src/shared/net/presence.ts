/**
 * @file presence.ts
 * @brief Reads and watches the browser signals that drive presence.
 * @details Presence is deliberately event based: a tab switch, a window blur or
 * a focus change is announced immediately instead of waiting for the next
 * heartbeat, so the room's online list stays honest.
 */

import type { PresenceState } from "@dyno/shared/protocol";

/**
 * @brief Whether the user is currently looking at the app.
 * @details A visible but unfocused page is "away" too: another window is on top
 * and the user is not reading the room.
 * @return The presence state.
 */
export function readPresenceState(): PresenceState {
  if (typeof document === "undefined") return "active";
  if (document.visibilityState !== "visible") return "away";
  if (typeof document.hasFocus === "function" && !document.hasFocus()) return "away";
  return "active";
}

/**
 * @brief Watches visibility and focus changes.
 * @param onChange Called with the new state on every event.
 * @return Cleanup that removes every listener.
 */
export function watchPresence(onChange: (state: PresenceState) => void): () => void {
  if (typeof document === "undefined") return () => {};

  const report = (): void => onChange(readPresenceState());
  document.addEventListener("visibilitychange", report);

  if (typeof window === "undefined") {
    return () => document.removeEventListener("visibilitychange", report);
  }

  window.addEventListener("focus", report);
  window.addEventListener("blur", report);
  return () => {
    document.removeEventListener("visibilitychange", report);
    window.removeEventListener("focus", report);
    window.removeEventListener("blur", report);
  };
}
