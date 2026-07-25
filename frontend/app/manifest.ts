// app/manifest.ts
// Web app manifest via the Next metadata file convention — Next auto-injects
// <link rel="manifest"> on every route (no app/layout.tsx edit needed) and
// serves this at /manifest.webmanifest. Metadata-route files REQUIRE a default
// export — same carve-out as page.tsx in this codebase's conventions.
//
// The maskable icon keeps the glyph inside the central safe zone so Android
// launchers can crop it into any shape without clipping the "K".

import type { MetadataRoute } from "next";

const manifest = (): MetadataRoute.Manifest => ({
  id: "/",
  name: "Kalari Games",
  short_name: "Kalari",
  description: "Daily cognitive training missions.",
  start_url: "/?source=pwa",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#FAF6F0",
  theme_color: "#FAF6F0",
  icons: [
    { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    {
      src: "/icon-maskable-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
});

export default manifest;
