"use client";
// InstallAppButton.tsx
// Slim terminal-style strip under the HomeGrid header prompting installation
// of the PWA. Hidden when already running as an installed app.
//
// Android/desktop Chrome: instrumentation-client.ts stashes the
// beforeinstallprompt event on window (it fires before React mounts) and
// dispatches "kalari:installable"; tapping INSTALL replays the native prompt.
// iOS: no install API exists — the strip opens the Add-to-Home-Screen
// instructions modal (owned by HomeGrid) instead.

import { useState, useEffect } from "react";
import { Download } from "lucide-react";
import posthog from "posthog-js";
import { isIosDevice, isStandaloneDisplay } from "@/utils/pwaEnv";
import type { WindowWithInstallPrompt } from "@/utils/pwaTypes";

type InstallMode = "hidden" | "native" | "ios";

const InstallAppButton = ({ onIosClick }: { onIosClick: () => void }) => {
  const [mode, setMode] = useState<InstallMode>("hidden");

  useEffect(() => {
    if (isStandaloneDisplay()) return; // already installed — nothing to show

    const win = window as unknown as WindowWithInstallPrompt;
    // setState deferred to a microtask (react-hooks/set-state-in-effect).
    Promise.resolve().then(() => {
      if (win.__kalariInstallPrompt) setMode("native");
      else if (isIosDevice()) setMode("ios");
    });

    // beforeinstallprompt may fire after mount (Chrome delays it) — listen for
    // the re-announce from instrumentation-client.ts.
    const onInstallable = () => setMode("native");
    const onInstalled = () => {
      setMode("hidden");
      posthog.capture("pwa_installed");
    };
    window.addEventListener("kalari:installable", onInstallable);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("kalari:installable", onInstallable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleClick = async () => {
    if (mode === "ios") {
      onIosClick();
      return;
    }
    const win = window as unknown as WindowWithInstallPrompt;
    const prompt = win.__kalariInstallPrompt;
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    // The stashed event is single-use; Chrome fires beforeinstallprompt again
    // later if the user dismissed, which re-shows the strip via the listener.
    win.__kalariInstallPrompt = undefined;
    setMode("hidden");
  };

  if (mode === "hidden") return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-5 w-full flex items-center justify-between bg-[#232323] px-4 py-3 shadow-[3px_3px_0px_rgba(35,35,35,0.25)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
    >
      <span className="flex items-center gap-2 text-[#00FF33] text-xs tracking-[0.15em] uppercase">
        <Download className="w-4 h-4" strokeWidth={2} />
        Get Kalari on your device
      </span>
      <span className="text-[#00FF33] text-xs font-bold tracking-[0.15em] uppercase">
        Install →
      </span>
    </button>
  );
};

export { InstallAppButton };
