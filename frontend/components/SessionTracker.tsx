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

import { useEffect } from "react";
import { useDeviceId } from "@/hooks/useDeviceId";
import { logFunnelEvent } from "@/utils/logFunnelEvent";

const SessionTracker = () => {
  const deviceIdRef = useDeviceId();

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
