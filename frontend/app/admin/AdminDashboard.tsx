"use client";
// admin/AdminDashboard.tsx
// Client half of the /admin page (the server half gates with isAdmin()).
// Fetches /api/admin and renders:
//   - header stats (today's date + DAU)
//   - all-time ranking table of every game, sortable by any numeric column
//   - per-IST-day log tables, newest day first
// Plain sortable shadcn tables — no charting library (US 3.5).

import { useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import type { AdminAnalytics, GameDayMetrics, RankingRow } from "./types";

// mode → display label, derived from the catalog (the home grid's source of
// truth) so a new game shows up here without another mapping to maintain.
const GAME_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(GAME_CATALOG).map((g) => [g.mode, g.label]),
);

const labelFor = (game: string): string => GAME_LABELS[game] ?? game;

// ---- formatting (null = no data that window → em dash) ----
const fmtCount = (n: number): string => String(n);
const fmtRate = (r: number | null): string =>
  r === null ? "—" : `${Math.round(r * 100)}%`;
const fmtSec = (s: number | null): string => (s === null ? "—" : `${s}s`);
const fmtScore = (s: number | null): string => (s === null ? "—" : String(s));

// Render an IST date key like "2026-07-07" as "Mon, 07 Jul 2026". Anchor at
// noon IST so the weekday can't slip across a day boundary.
const fmtDay = (dateKey: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00+05:30`));

// ---- ranking sort ----
type SortKey =
  | "plays"
  | "starts"
  | "abandoned"
  | "dropOffRate"
  | "avgCompletionTimeSec"
  | "avgScore";
type SortState = { key: SortKey; dir: "asc" | "desc" };

const RANKING_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "plays", label: "Played" },
  { key: "starts", label: "Started" },
  { key: "abandoned", label: "Abandoned" },
  { key: "dropOffRate", label: "Drop-off Rate" },
  { key: "avgCompletionTimeSec", label: "Avg Completion Time" },
  { key: "avgScore", label: "Avg Score" },
];

const AdminDashboard = () => {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [isError, setIsError] = useState(false);
  // Default: "Most Played" first, per the story's primary ranking.
  const [sort, setSort] = useState<SortState>({ key: "plays", dir: "desc" });

  // Bumping reloadKey re-runs the fetch effect (retry). The async loader is
  // defined *inside* the effect — the project's standard pattern that keeps
  // react-hooks/set-state-in-effect satisfied (see history/page.tsx).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/admin");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as AdminAnalytics;
        setIsError(false);
        setData(json);
      } catch {
        setData(null);
        setIsError(true);
      }
    };
    void load();
  }, [reloadKey]);

  // Retry resets to the loading state (fine here — event handler, not an
  // effect), then triggers a re-fetch via reloadKey.
  const retry = () => {
    setIsError(false);
    setData(null);
    setReloadKey((k) => k + 1);
  };

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );

  const rankingSorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data.ranking];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      // Games with no data sink to the bottom in either direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir === "desc" ? bv - av : av - bv;
    });
    return rows;
  }, [data, sort]);

  if (isError)
    return (
      <div className="min-h-screen bg-[#FAF6F0] flex flex-col items-center justify-center gap-4 font-mono text-[#232323]">
        <p className="text-sm">Failed to load analytics.</p>
        <button
          onClick={retry}
          className="px-6 py-2 bg-[#8B2626] text-white text-xs font-bold tracking-widest uppercase shadow-[4px_4px_0px_#232323] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#232323] transition-all"
        >
          Retry
        </button>
      </div>
    );

  if (!data)
    return (
      <div className="min-h-screen bg-[#FAF6F0] flex items-center justify-center font-mono text-sm text-[#232323]/60">
        Loading analytics…
      </div>
    );

  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold tracking-widest uppercase">
              Admin Dashboard
            </h1>
            <p className="text-xs text-[#232323]/60 mt-1">{data.date} (IST)</p>
          </div>
          <div className="bg-[#232323] text-[#00FF33] px-4 py-2 text-sm">
            DAU: {data.dau}
          </div>
        </header>

        {/* All-time ranking */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold tracking-widest uppercase text-[#8B2626]">
            Game Ranking (all time)
          </h2>
          <div className="border border-[#232323] bg-white overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold text-[#232323]">
                    Game
                  </TableHead>
                  {RANKING_COLUMNS.map((col) => (
                    <TableHead key={col.key} className="text-right">
                      <button
                        onClick={() => toggleSort(col.key)}
                        className="font-bold text-[#232323] hover:text-[#8B2626] whitespace-nowrap"
                      >
                        {col.label}
                        {sort.key === col.key
                          ? sort.dir === "desc"
                            ? " ▼"
                            : " ▲"
                          : ""}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankingSorted.map((row: RankingRow) => (
                  <TableRow key={row.game}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {labelFor(row.game)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtCount(row.plays)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtCount(row.starts)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtCount(row.abandoned)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtRate(row.dropOffRate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtSec(row.avgCompletionTimeSec)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtScore(row.avgScore)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Daily log */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold tracking-widest uppercase text-[#8B2626]">
            Daily Log
          </h2>
          {data.daily.length === 0 && (
            <p className="text-xs text-[#232323]/60">
              No activity recorded yet.
            </p>
          )}
          {data.daily.map((day) => (
            <div key={day.date} className="space-y-1">
              <h3 className="text-xs font-bold tracking-wide">
                {fmtDay(day.date)}
              </h3>
              <div className="border border-[#232323] bg-white overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        "Game",
                        "Played",
                        "Started",
                        "Completed",
                        "Abandoned",
                        "Drop-off Rate",
                        "Avg Completion Time",
                        "Avg Score",
                      ].map((h, i) => (
                        <TableHead
                          key={h}
                          className={`font-bold text-[#232323] whitespace-nowrap ${i > 0 ? "text-right" : ""}`}
                        >
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {day.games.map((g: GameDayMetrics) => (
                      <TableRow key={g.game}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {labelFor(g.game)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtCount(g.played)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtCount(g.starts)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtCount(g.completed)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtCount(g.abandoned)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtRate(g.dropOffRate)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtSec(g.avgTimeSpentSec)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtScore(g.avgScore)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};

export { AdminDashboard };
