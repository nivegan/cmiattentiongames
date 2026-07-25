// instrumentation-client.ts
// Next.js client instrumentation (runs after the HTML loads, BEFORE React
// hydration). Used here to initialise posthog-js so analytics are ready for the
// very first render — without touching the off-limits app/layout.tsx.
//
// posthog-js is a singleton: once init'd here, `import posthog from "posthog-js"`
// anywhere in the client tree returns the same instance (see SessionTracker's
// posthog.identify call). No React provider is required.
//
// Scope: pageviews + autocapture + web analytics (via the dated `defaults`).
// Session replay is explicitly disabled (privacy / storage cost).
//
// If NEXT_PUBLIC_POSTHOG_KEY is unset (e.g. local dev without a project), init is
// skipped entirely so nothing errors and every capture becomes a no-op.

import posthog from "posthog-js";
import type {
  BeforeInstallPromptEvent,
  WindowWithInstallPrompt,
} from "@/utils/pwaTypes";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: "/ingest", // reverse proxy (see next.config.ts rewrites)
    ui_host: "https://eu.posthog.com",
    defaults: "2025-05-24", // pageview / pageleave / autocapture / web analytics
    disable_session_recording: true, // no screen recording
    capture_exceptions: true,
  });
}

// --- PWA wiring (also here to avoid touching the off-limits app/layout.tsx) ---

// Register the push-only service worker (public/sw.js) on every page.
// updateViaCache: "none" makes the browser re-fetch sw.js on each check, so a
// deployed SW change propagates without version juggling.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {});
  });
}

// beforeinstallprompt usually fires BEFORE React mounts, so no component could
// catch it. Stash it on window for InstallAppButton and re-announce via a
// custom event for components that mount later.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    (window as unknown as WindowWithInstallPrompt).__kalariInstallPrompt =
      e as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent("kalari:installable"));
  });
}

export {};
