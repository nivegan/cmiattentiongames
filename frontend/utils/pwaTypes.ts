// utils/pwaTypes.ts
// Shared PWA/push types. These live in a plain module (NOT a "use server"
// file) because "use server" files may export only async functions — a
// locally-declared exported type breaks the server-action transform under
// Turbopack (see the history/types.ts precedent).

// The non-standard Chrome event fired when the app is installable. Not in
// TypeScript's DOM lib (it never got standardized), so declared here.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

// instrumentation-client.ts stashes the beforeinstallprompt event here
// (it usually fires before React mounts, so a component can't catch it) and
// dispatches "kalari:installable" for InstallAppButton to pick up.
interface WindowWithInstallPrompt extends Window {
  __kalariInstallPrompt?: BeforeInstallPromptEvent;
}

// Extracted from PushSubscription.toJSON() on the client; what the
// subscribe server action persists to push_subscriptions.
interface PushSubscriptionPayload {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type {
  BeforeInstallPromptEvent,
  WindowWithInstallPrompt,
  PushSubscriptionPayload,
};
