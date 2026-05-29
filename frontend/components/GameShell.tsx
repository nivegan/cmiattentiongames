import { ArrowLeft } from "lucide-react";

interface GameShellProps {
  title: string;
  onBack: () => void;
  // Slot for the right side of the header (round counter, timer, etc.).
  // When omitted, shows the decorative spinning dashes.
  badge?: React.ReactNode;
  children: React.ReactNode;
}

// Shared card shell used by all retro-mono game pages.
// Renders the fullscreen wrapper, scanline overlay, card border, corner brackets,
// and header. Pass <main> (or AnimatePresence) as children.
export function GameShell({ title, onBack, badge, children }: GameShellProps) {
  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-0 sm:p-4 relative antialiased select-none">
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage: "linear-gradient(#232323 1px, transparent 1px)",
          backgroundSize: "100% 20px",
        }}
      />

      <div className="w-full max-w-md h-screen sm:h-170 bg-[#FAF6F0] sm:border-2 border-[#232323] flex flex-col overflow-hidden relative shadow-[8px_8px_0px_rgba(35,35,35,0.15)]">
        {/* Corner brackets */}
        <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-[#8B2626]/30 pointer-events-none" />

        <header className="px-6 pt-5 pb-3 bg-[#FAF6F0] z-20 shrink-0">
          <div className="flex items-center justify-between">
            <button
              onClick={onBack}
              className="w-9 h-9 flex items-center justify-center bg-[#FAF6F0] border border-[#232323] shadow-[2px_2px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={3} />
            </button>
            <h1 className="text-xs font-black tracking-[0.25em] text-[#8B2626] uppercase">
              {title}
            </h1>
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

        {children}
      </div>
    </div>
  );
}
