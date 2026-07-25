"use client";
// PushBellButton.tsx
// Header bell that opts the device in/out of the daily 8:00 AM IST push
// reminder. Renders as a fourth 44px retro box in the HomeGrid header.
//
// Modes:
//  - hidden   — browser has no push support at all (and isn't iOS)
//  - ios-hint — iOS Safari tab: Notification/PushManager don't exist until the
//               app is installed to the home screen (16.4+), so the bell opens
//               the install-instructions modal instead of prompting
//  - ready    — full support; tap toggles the subscription
//
// The subscribe server-action call IS awaited (unlike fire-and-forget funnel
// events) so the bell state and toast always reflect what the DB actually has.

import { useState, useEffect } from "react";
import type { RefObject } from "react";
import { Bell, BellRing } from "lucide-react";
import { toast } from "sonner";
import { subscribeToPush, unsubscribeFromPush } from "@/app/push-actions";
import { urlBase64ToUint8Array } from "@/utils/urlBase64ToUint8Array";
import { isIosDevice, isStandaloneDisplay } from "@/utils/pwaEnv";

type BellMode = "hidden" | "ready" | "ios-hint";

const PushBellButton = ({
  deviceIdRef,
  onIosHint,
}: {
  deviceIdRef: RefObject<string>;
  onIosHint: () => void;
}) => {
  const [mode, setMode] = useState<BellMode>("hidden");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Feature-detect Notification before ANY access — it is undefined in iOS
    // Safari tabs and touching it there throws.
    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    if (supported) {
      // setState lives in .then callbacks (not the sync effect body) per the
      // react-hooks/set-state-in-effect rule — same pattern as HomeGrid.
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          setMode("ready");
          setSubscribed(Boolean(sub));
        })
        .catch(() => setMode("ready"));
    } else if (isIosDevice() && !isStandaloneDisplay()) {
      Promise.resolve().then(() => setMode("ios-hint"));
    }
  }, []);

  const handleClick = async () => {
    if (mode === "ios-hint") {
      onIosHint();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;

      if (subscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          void unsubscribeFromPush(deviceIdRef.current, endpoint);
        }
        setSubscribed(false);
        toast("Daily reminders off.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error(
          "Notifications are blocked — enable them in your browser settings to get reminders.",
        );
        return;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        toast.error("Reminders aren't configured on this deployment.");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const json = sub.toJSON();
      const { success } = await subscribeToPush(deviceIdRef.current, {
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });

      if (success) {
        setSubscribed(true);
        toast.success("Daily reminder on — 8:00 AM IST.");
      } else {
        // Keep browser and DB consistent: a sub the server never stored would
        // look "on" here but never receive anything.
        await sub.unsubscribe();
        toast.error("Couldn't save the reminder — try again.");
      }
    } catch (error) {
      console.error("PushBellButton error:", error);
      toast.error("Couldn't set up reminders — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "hidden") return null;

  const label = subscribed
    ? "Turn off daily reminders"
    : "Turn on daily reminders";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
      disabled={busy}
      className="w-11 h-11 flex items-center justify-center bg-[#FAF6F0] border border-[#232323]/20 shadow-[3px_3px_0px_rgba(35,35,35,0.12)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer disabled:opacity-50"
    >
      {subscribed ? (
        <BellRing className="w-5 h-5 text-[#8B2626]" strokeWidth={2} />
      ) : (
        <Bell className="w-5 h-5 text-[#232323]" strokeWidth={2} />
      )}
    </button>
  );
};

export { PushBellButton };
