// public/sw.js
// Kalari Games service worker — push notifications only.
//
// Deliberately NO fetch handler / offline caching: this is a daily-content app
// (stale-cache = wrong day's games) and Chrome installability no longer
// requires one. Vercel serves public/ files with max-age=0 and registration
// uses updateViaCache: "none", so updates to this file propagate on next load.
//
// Plain JS (not TS): served verbatim as a static file, never bundled.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON payload (e.g. DevTools "Push" test button) — fall back to text.
    data = { body: event.data && event.data.text() };
  }
  // ALWAYS show a notification — iOS revokes the push subscription if a push
  // arrives without a user-visible notification.
  event.waitUntil(
    self.registration.showNotification(data.title || "KALARI GAMES", {
      body: data.body || "Today's missions are live.",
      icon: "/icon-192x192.png",
      badge: "/icon-192x192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const existing = windowClients.find((c) => "focus" in c);
        return existing ? existing.focus() : clients.openWindow(url);
      }),
  );
});
