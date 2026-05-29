"use client";

import { useAuth, SignUpButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchHistory, HistoryResult } from "./actions";
import type { GameMode } from "@/utils/generate_game";

const GAME_LABELS: Partial<Record<GameMode, string>> = {
  GUT_CHECK: "Gut Check",
  EXTRACT_THE_FACTS: "Extract Facts",
  STEADY_GAZE: "Steady Gaze",
  CLEAR_THE_AIR: "Clear the Air",
  READ_BETWEEN_DESIGNS: "Read Between Designs",
  MENTAL_REFLEX: "Mental Reflex",
};

const HistoryPage = () => {
  const { isSignedIn, isLoaded } = useAuth();
  const [data, setData] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    async function load() {
      try {
        const deviceId =
          localStorage.getItem("meta_mind_global_device_id") ?? "";
        const result = await fetchHistory(deviceId);
        setData(result);
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isLoaded]);

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] font-mono flex items-center justify-center">
        <p className="text-[#232323]">Loading...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] font-mono flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <p className="text-xs font-bold tracking-widest text-[#8B2626] uppercase">
            Failed to load history
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs font-bold underline text-[#232323]"
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  const entries = data?.entries ?? [];
  const streak = data?.streak ?? 0;

  return (
    <div className="min-h-screen bg-[#FAF6F0] font-mono p-8">
      {/* Persistent conversion banner — anonymous users with history */}
      {!isSignedIn && entries.length > 0 && (
        <div className="mb-6 border-2 border-[#8B2626] shadow-[4px_4px_0px_#8B2626] bg-white p-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-[#232323] text-sm">
            {streak > 0 && (
              <span className="font-bold">
                You&apos;re on a {streak}-day streak!{" "}
              </span>
            )}
            Create an account to make sure your Kalari history is saved across
            devices.
          </p>
          <SignUpButton mode="modal">
            <button className="bg-[#8B2626] text-white px-4 py-1.5 shadow-[2px_2px_0px_#232323] border-2 border-[#232323] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_#232323] transition-all font-mono uppercase tracking-wider text-xs whitespace-nowrap cursor-pointer">
              Save Progress
            </button>
          </SignUpButton>
        </div>
      )}

      <h1 className="text-2xl font-bold text-[#232323] mb-6 tracking-widest uppercase border-b-2 border-[#232323] pb-2">
        History
      </h1>

      {entries.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#232323] opacity-60 mb-6 text-sm">
            No games played yet.
          </p>
          <Link
            href="/"
            className="inline-block bg-[#8B2626] text-white px-6 py-2 shadow-[4px_4px_0px_#232323] border-2 border-[#232323] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#232323] transition-all uppercase tracking-wider text-sm"
          >
            Play a Game
          </Link>
          {!isSignedIn && (
            <div className="mt-8 border-2 border-[#232323] shadow-[4px_4px_0px_#232323] bg-white p-4 max-w-sm mx-auto text-center">
              <p className="text-[#232323] text-sm mb-3">
                Create an account to save your progress across devices.
              </p>
              <SignUpButton mode="modal">
                <button className="bg-[#8B2626] text-white px-4 py-1.5 shadow-[2px_2px_0px_#232323] border-2 border-[#232323] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_#232323] transition-all font-mono uppercase tracking-wider text-xs cursor-pointer">
                  Create Account
                </button>
              </SignUpButton>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="border-2 border-[#232323] shadow-[4px_4px_0px_#232323] bg-white p-4 flex items-center justify-between"
            >
              <div>
                <p className="text-[#232323] font-bold uppercase tracking-wider text-sm">
                  {(entry.game_type_id && GAME_LABELS[entry.game_type_id]) ??
                    entry.game_type_id ??
                    "Unknown"}
                </p>
                <p className="text-[#232323] opacity-60 text-xs mt-0.5">
                  {new Date(entry.created_at).toLocaleDateString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="bg-[#232323] px-3 py-1 text-[#00FF33] font-mono text-sm shadow-[2px_2px_0px_#8B2626]">
                  {entry.score} pts
                </div>
                <span
                  className={`text-xs uppercase tracking-wider font-bold ${
                    entry.is_success
                      ? "text-[#8B2626]"
                      : "text-[#232323] opacity-40"
                  }`}
                >
                  {entry.is_success ? "WIN" : "LOSS"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
