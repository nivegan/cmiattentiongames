"use client";
// SessionTracker.tsx
// Invisible client component (returns null) mounted once in the root layout.
// Responsible for two session-boundary funnel events:
//
//   SESSION_START — fired on mount via logFunnelEvent (server action, fire-and-forget)
//   SESSION_END   — fired via sendBeacon on the pagehide event
//
// Why sendBeacon for SESSION_END instead of logFunnelEvent?
//   sendBeacon is the only reliable mechanism for dispatching a request when a
//   tab or browser window is closing. The browser guarantees the payload is
//   delivered even if the JS execution context is being torn down. A normal
//   fetch/server-action call would be cancelled mid-flight on tab close.
//
// Why pagehide instead of beforeunload / unload?
//   pagehide fires on both hard closes AND navigations into the back/forward
//   cache (bfcache). The `e.persisted` flag distinguishes the two: persisted=true
//   means the page entered bfcache (not a real close), persisted=false means the
//   page is actually being destroyed. We only fire SESSION_END on persisted=false.
//   beforeunload/unload are deprecated for bfcache-eligible pages and unreliable
//   on mobile browsers.

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import posthog from "posthog-js";
import { useDeviceId } from "@/hooks/useDeviceId";
import { logFunnelEvent } from "@/utils/logFunnelEvent";

const SessionTracker = () => {
  const deviceIdRef = useDeviceId();
  const { isLoaded, userId } = useAuth();
  // Track previous userId to detect sign-in during an active session
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  // Keep the PostHog person aligned with the server's identity model
  // (userId || deviceId). Runs once Clerk has loaded and re-runs on sign-in so
  // the anonymous deviceId person merges into the Clerk user. Guarded on the env
  // key so it's a no-op when posthog-js was never init'd (see instrumentation-client).
  useEffect(() => {
    if (!isLoaded) return;
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    const id = userId ?? deviceIdRef.current;
    if (id) posthog.identify(id);

    // Fire sign_in when the user transitions from guest to authenticated in-session.
    // prevUserIdRef starts as undefined (uninitialized) so the first load — even
    // when the user is already signed in — doesn't trigger the event.
    if (
      prevUserIdRef.current !== undefined &&
      !prevUserIdRef.current &&
      userId
    ) {
      posthog.capture("sign_in");
    }
    prevUserIdRef.current = userId;
  }, [isLoaded, userId, deviceIdRef]);

  useEffect(() => {
    // Fire-and-forget — no await so the component mount isn't delayed
    logFunnelEvent("SESSION_START", deviceIdRef.current);

    const handlePageHide = (e: PageTransitionEvent) => {
      // persisted=true → page entered bfcache (tab switch / back-forward nav);
      // the session is still alive, so don't fire SESSION_END.
      if (e.persisted) return;

      const payload = JSON.stringify({
        eventType: "SESSION_END",
        deviceId: deviceIdRef.current,
      });

      // sendBeacon POSTs to the plain HTTP route (/api/log-event) rather than
      // calling a server action directly. sendBeacon can only send raw HTTP
      // requests — it has no mechanism to invoke Next.js server actions.
      // Blob with application/json content-type ensures the route can parse the
      // body via req.json(); a plain string would arrive as text/plain.
      navigator.sendBeacon(
        "/api/log-event",
        new Blob([payload], { type: "application/json" }),
      );
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [deviceIdRef]);

  // Returns null — purely behavioral, no UI rendered
  return null;
};

export { SessionTracker };
