// GameErrorScreen.tsx
// Full-page error card displayed when a game's server action fails —
// for example: network error, Gemini API timeout, or an unexpected exception.
//
// The RETRY button calls window.location.reload(), which hard-refreshes the page.
// That re-triggers the game page's useEffect mount logic from scratch, which is
// the simplest reliable recovery path.
//
// The optional `message` prop allows future customisation. All current games
// use the default retro-styled message.

interface GameErrorScreenProps {
  message?: string; // custom error text; defaults to the generic retro message below
}

const GameErrorScreen = ({
  message = "Telemetry metrics payload failed verification configurations.",
}: GameErrorScreenProps) => {
  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-4">
      <div className="bg-[#FAF6F0] border-2 border-[#8B2626] p-6 max-w-sm text-center shadow-[4px_4px_0px_#8B2626]">
        <p className="text-xs font-black text-[#8B2626] uppercase mb-2">
          SYSTEM ERROR
        </p>
        <p className="text-xs leading-relaxed text-[#232323]/80">{message}</p>
        {/* window.location.reload() is a browser API that hard-refreshes the page,
            re-running all mount effects and retrying the failed server action */}
        <button
          onClick={() => window.location.reload()}
          className="mt-4 text-xs font-black underline text-[#8B2626] uppercase"
        >
          RETRY
        </button>
      </div>
    </div>
  );
};

export { GameErrorScreen };
