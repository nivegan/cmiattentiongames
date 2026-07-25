// utils/pwaEnv.ts
// Client-only environment sniffing shared by the PWA install/push components.
// Call these only in the browser (inside effects/handlers — never during SSR).

// iPadOS 13+ reports a Mac user agent; the maxTouchPoints check catches it.
const isIosDevice = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);

// True when running as an installed PWA (home-screen launch), not a browser tab.
// navigator.standalone is the legacy iOS Safari flag.
const isStandaloneDisplay = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator &&
    (navigator as { standalone?: boolean }).standalone === true);

export { isIosDevice, isStandaloneDisplay };
