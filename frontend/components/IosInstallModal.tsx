"use client";
// IosInstallModal.tsx
// Retro modal (AboutKalariModal pattern) with iOS Add-to-Home-Screen steps —
// iOS has no install prompt API, and web push there requires iOS 16.4+ AND the
// installed (standalone) app. Opened from InstallAppButton or the bell's
// ios-hint mode on the home grid.

import { X, Share, SquarePlus, Bell } from "lucide-react";

const STEPS = [
  {
    icon: Share,
    text: "Open this page in Safari and tap the Share button.",
  },
  {
    icon: SquarePlus,
    text: 'Scroll down and tap "Add to Home Screen", then ADD.',
  },
  {
    icon: Bell,
    text: "Open Kalari from your home screen and tap the bell to turn on daily reminders.",
  },
];

const IosInstallModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#232323]/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative bg-[#FAF6F0] border border-[#232323] shadow-[4px_4px_0px_#232323] font-mono w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#232323]/20 px-5 py-4">
          <h2 className="text-lg font-bold tracking-[0.15em] uppercase text-[#232323]">
            Install Kalari
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#232323] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Steps */}
        <div className="px-5 py-4 space-y-4">
          {STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-8 h-8 shrink-0 flex items-center justify-center bg-[#8B2626] text-[#FAF6F0]">
                <step.icon className="w-4 h-4" strokeWidth={2} />
              </span>
              <p className="text-sm text-[#232323]/80 leading-relaxed pt-1">
                <span className="text-[#8B2626] font-bold">{i + 1}.</span>{" "}
                {step.text}
              </p>
            </div>
          ))}
        </div>

        {/* Footnote */}
        <div className="px-5 py-3 border-t border-[#232323]/15">
          <p className="text-xs text-[#232323]/55 leading-relaxed">
            Daily reminders need iOS 16.4 or later and only work from the
            installed app — not from a Safari tab.
          </p>
        </div>
      </div>
    </div>
  );
};

export { IosInstallModal };
