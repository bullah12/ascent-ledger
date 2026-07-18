"use client";

import { useEffect } from "react";

// Registers the offline service worker (public/sw.js). Dev builds skip it
// so stale caches never mask local changes.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is progressive enhancement — never break the app.
    });
  }, []);

  return null;
}
