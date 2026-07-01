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

export {};
