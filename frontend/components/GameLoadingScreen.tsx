export function GameLoadingScreen() {
  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-4">
      <div className="text-center space-y-3">
        <div className="w-9 h-9 border-2 border-[#8B2626] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[#8B2626] font-black tracking-widest text-xs uppercase animate-pulse">
          LOADING...
        </p>
      </div>
    </div>
  );
}
