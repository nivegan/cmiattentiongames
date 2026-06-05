// GameLoadingScreen.tsx
// Full-page loading indicator shown while the daily-lock server check is in flight.
// Every game page displays this during the brief moment between mount and the
// server's response telling us whether the user already played today.

const GameLoadingScreen = () => {
  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-4">
      <div className="text-center space-y-3">
        {/* Spinning ring: border-t-transparent creates the visual "gap" that makes
            the ring appear to rotate as it spins */}
        <div className="w-9 h-9 border-2 border-[#8B2626] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[#8B2626] font-black tracking-widest text-xs uppercase animate-pulse">
          LOADING...
        </p>
      </div>
    </div>
  );
};

export { GameLoadingScreen };
