/**
 * vowShell.ts — Tauri shell helpers for Vow Mode
 *
 * All four exports are safe to call in a plain browser: they check for the
 * Tauri runtime at call-time and silently no-op (with a console.warn) when
 * it isn't present.  The Tauri-specific imports are dynamic so they are
 * never bundled into the browser-facing JS.
 */

/** Returns true when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // __TAURI_INTERNALS__ is injected by the Tauri runtime
    typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== "undefined"
  );
}

/**
 * Sets the macOS menu-bar tray title to "⛓ <title>" (truncated to ~40 chars).
 * No-op outside Tauri; never throws.
 */
export async function setTrayVow(title: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("vow_tray_set", { text: title });
  } catch (err) {
    console.warn("[vowShell] setTrayVow failed:", err);
  }
}

/**
 * Clears the tray title, restoring the default (icon-only) appearance.
 * No-op outside Tauri; never throws.
 */
export async function clearTrayVow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("vow_tray_clear");
  } catch (err) {
    console.warn("[vowShell] clearTrayVow failed:", err);
  }
}

/**
 * Sends a system notification titled "Vow Mode" with the given body.
 * Requests permission if it hasn't been granted yet.
 * No-op outside Tauri; never throws.
 */
export async function notifyVow(body: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const {
      isPermissionGranted,
      requestPermission,
      sendNotification,
    } = await import("@tauri-apps/plugin-notification");

    let permitted = await isPermissionGranted();
    if (!permitted) {
      const result = await requestPermission();
      permitted = result === "granted";
    }
    if (!permitted) {
      console.warn("[vowShell] notifyVow: notification permission denied");
      return;
    }
    sendNotification({ title: "Vow Mode", body });
  } catch (err) {
    console.warn("[vowShell] notifyVow failed:", err);
  }
}
