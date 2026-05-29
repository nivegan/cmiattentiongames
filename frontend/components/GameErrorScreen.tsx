interface GameErrorScreenProps {
  message?: string;
}

export function GameErrorScreen({
  message = "Telemetry metrics payload failed verification configurations.",
}: GameErrorScreenProps) {
  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-4">
      <div className="bg-[#FAF6F0] border-2 border-[#8B2626] p-6 max-w-sm text-center shadow-[4px_4px_0px_#8B2626]">
        <p className="text-xs font-black text-[#8B2626] uppercase mb-2">
          SYSTEM ERROR
        </p>
        <p className="text-xs leading-relaxed text-[#232323]/80">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 text-xs font-black underline text-[#8B2626] uppercase"
        >
          RETRY
        </button>
      </div>
    </div>
  );
}
