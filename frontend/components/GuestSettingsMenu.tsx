"use client";
// GuestSettingsMenu.tsx
// The signed-out counterpart to Clerk's UserButton menu in the HomeGrid header.
//
// About Kalari and Send Feedback live as UserButton.Action items, which only
// render when signed in — so guests had no route to either. This gear sits in
// the same header slot as the signed-in one and opens a two-item panel that
// flips HomeGrid's existing aboutOpen / feedbackOpen state.
//
// Hand-rolled rather than shadcn: components/ui has no dropdown-menu or popover,
// and generating one would add ~250 lines of un-editable code whose rounded,
// blurred defaults fight the retro tokens — for two static items. Styling
// mirrors the userButtonPopover* overrides in lib/clerkAppearance.ts so the
// guest menu and the signed-in menu are indistinguishable.

import { useState, useEffect, useRef } from "react";
import { Settings, Info, MessageSquare } from "lucide-react";

const GuestSettingsMenu = ({
  onAbout,
  onFeedback,
}: {
  onAbout: () => void;
  onFeedback: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Escape closes and returns focus to the gear — the only sensible focus
  // target once the panel is gone.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Close before running the action so the panel is never stranded behind the
  // modal it just opened.
  const runAndClose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="guest-settings-menu"
        className="w-11 h-11 flex items-center justify-center bg-[#FAF6F0] border border-[#232323]/20 shadow-[3px_3px_0px_rgba(35,35,35,0.12)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
      >
        <Settings className="w-5 h-5 text-[#232323]" strokeWidth={2} />
      </button>

      {open && (
        <>
          {/* Invisible click-catcher — same convention as the modals' backdrop,
              and more reliable on touch than a document mousedown listener. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            id="guest-settings-menu"
            role="menu"
            className="absolute right-0 top-full mt-2 z-50 w-52 py-1 bg-[#FAF6F0] border-2 border-[#232323] shadow-[4px_4px_0px_#232323] font-mono animate-in fade-in duration-200"
          >
            <button
              type="button"
              role="menuitem"
              onClick={runAndClose(onAbout)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-[#232323] hover:bg-[#232323]/5 cursor-pointer transition-colors"
            >
              <Info className="w-4 h-4" />
              About Kalari
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={runAndClose(onFeedback)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-[#232323] hover:bg-[#232323]/5 cursor-pointer transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              Send Feedback
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export { GuestSettingsMenu };
