// GameShell.tsx
// The fullscreen card wrapper shared by every game page.
//
// It provides the visual structure that stays constant across all games:
//   - Retro-mono background (#FAF6F0) with a subtle scanline overlay
//   - The white game card (max-width 448 px, 2 px border, drop shadow)
//   - Four decorative corner brackets (purely visual)
//   - Header bar: ← back button | GAME TITLE | badge slot (right)
//
// Each game page wraps its phase-specific content in <GameShell> and supplies
// it as `children`. The `badge` slot is used for contextual info like the round
// counter ("ROUND 2/3") or a live timer — pass `undefined` to show the default
// decorative spinning-dashes element.

import { ArrowLeft } from "lucide-react";

interface GameShellProps {
  title: string; // centre of the header (e.g. "GUT CHECK")
  onBack: () => void; // called when the ← back button is pressed
  // Right side of the header. Pass a custom element for timers / round counters,
  // or omit to show the decorative animated spinner fallback.
  badge?: React.ReactNode;
  children: React.ReactNode; // the game's content (phases, canvas, forms, etc.)
}

const GameShell = ({ title, onBack, badge, children }: GameShellProps) => {
  return (
    // Outer container: fills the screen, centres the card, positions the scanline
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-0 sm:p-4 relative antialiased select-none">
      {/* Scanline overlay: a subtle horizontal-line texture for the retro CRT look.
          pointer-events-none means it never intercepts mouse/touch events. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage: "linear-gradient(#232323 1px, transparent 1px)",
          backgroundSize: "100% 20px",
        }}
      />

      {/* Game card: constrained width, full height on mobile, fixed height on desktop */}
      <div className="w-full max-w-md h-screen sm:h-170 bg-[#FAF6F0] sm:border-2 border-[#232323] flex flex-col overflow-hidden relative shadow-[8px_8px_0px_rgba(35,35,35,0.15)]">
        {/* Decorative corner brackets — purely visual accents, no interactivity */}
        <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-[#8B2626]/30 pointer-events-none" />

        {/* Header: ← | TITLE | badge-or-spinner */}
        <header className="px-6 pt-5 pb-3 bg-[#FAF6F0] z-20 shrink-0">
          <div className="flex items-center justify-between">
            {/* Back button */}
            <button
              onClick={onBack}
              className="w-9 h-9 flex items-center justify-center bg-[#FAF6F0] border border-[#232323] shadow-[2px_2px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={3} />
            </button>

            {/* Game title */}
            <h1 className="text-xs font-black tracking-[0.25em] text-[#8B2626] uppercase">
              {title}
            </h1>

            {/* badge ?? (...) = "show badge if provided, otherwise show the spinner".
                The ?? operator (nullish coalescing) returns the right side only when
                the left side is null or undefined. */}
            <div>
              {badge ?? (
                <div className="w-8 h-8 flex items-center justify-center opacity-40">
                  <div
                    className="w-6 h-6 rounded-full border-2 border-dashed border-[#8B2626] animate-spin"
                    style={{ animationDuration: "8s" }}
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Game content rendered here — each game passes its own phase components */}
        {children}
      </div>
    </div>
  );
};

export { GameShell };
