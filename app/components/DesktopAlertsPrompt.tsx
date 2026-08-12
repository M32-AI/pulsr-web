"use client";

import { useSyncExternalStore } from "react";
import { usePushNotifications } from "../hooks/usePushNotifications";

const DISMISS_KEY = "pulsr.desktopAlertsPrompt.dismissed";

// localStorage is an external store, so it is read through
// useSyncExternalStore rather than mirrored into state from an effect (which
// cascades renders — the same rule the hour-block lightbox works around).
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab dismissing the banner should settle this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** During SSR there is no localStorage; treat the banner as dismissed so it never flashes in. */
function isDismissedOnServer(): boolean {
  return true;
}

function setDismissedInStorage(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // A blocked localStorage only means the nudge returns next session.
  }
  listeners.forEach((l) => l());
}

/**
 * One-time nudge to turn on desktop alerts (PRODUCT-24383).
 *
 * The push subscription itself has existed for a while, but the only way to opt
 * in was a small "Off" text toggle inside the Alerts dropdown — so in prod there
 * were two subscriptions, both belonging to a test account, and severe alerts
 * (poaching included) popped up on nobody's desktop. The capability was never
 * the missing piece; discoverability was.
 *
 * Shown once per browser: dismissing it, or enabling alerts, hides it for good.
 */
export default function DesktopAlertsPrompt() {
  const { state, toggle } = usePushNotifications();
  const dismissed = useSyncExternalStore(subscribe, isDismissed, isDismissedOnServer);

  if (dismissed || state !== "unsubscribed") return null;

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex items-center justify-between gap-3">
      <p className="text-xs text-blue-800">
        <span className="font-semibold">Turn on desktop alerts</span> to be notified the moment a
        severe alert fires — including poaching risk — even when this tab is in the background.
      </p>
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={async () => {
            await toggle();
            // Don't ask again either way: if the browser prompt was denied,
            // re-nudging cannot help — the toggle in the Alerts panel remains.
            setDismissedInStorage();
          }}
          className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
        >
          Enable
        </button>
        <button
          type="button"
          onClick={setDismissedInStorage}
          className="text-xs font-medium text-blue-500 hover:text-blue-700"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
