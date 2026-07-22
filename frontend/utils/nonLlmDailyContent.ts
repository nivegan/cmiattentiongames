// nonLlmDailyContent.ts
// Records the three seed-computed (non-Gemini) games' REAL daily parameters
// into kalari_games, so every daily game has a truthful content row there.
// Two writers call this: each game's checkAlreadyPlayed action (on-demand, on
// page load) and the /api/cron/generate-daily mirror. Rows are record-keeping
// only — the game pages never read them; they derive everything client-side.
//
// ⚠️ SYNC WARNING: the per-game builders below MUST stay byte-faithful to the
// module-level computeGameData() in the corresponding
// app/play/<game>/page.tsx. They cannot be imported (unexported, inside
// "use client" pages), so they are re-implemented here. Any drift — a changed
// constant, palette entry, or even the ORDER of rng() calls in mental_reflex —
// silently makes the stored record wrong. Update both places together.

import { prisma } from "@/utils/prismaInit";
import { getDailySeed, mulberry32 } from "@/utils/seedRng";
import type { Prisma } from "@/lib/generated/prisma/client";

// kalari_games.mode strings — MUST match the cron's NON_LLM_SLUGS (the
// dailySchedule.json slugs) so both writers hit the same unique
// (mode, scheduled_for) key.
type NonLlmSlug = "steady_gaze" | "clear_air" | "mental_reflex";

// ── steady_gaze (port of app/play/steady_gaze/page.tsx) ─────────────────────

// Copied from app/play/steady_gaze/page.tsx — standard HSL→hex math.
const hslToHex = (h: number, s: number, l: number): string => {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const buildSteadyGaze = (dateKey: string) => {
  const seedString = dateKey + "steady_gaze";
  const seedInt = getDailySeed(seedString);
  const seed = seedInt / 0x100000000;
  const baseHue = Math.floor(seed * 360);
  return {
    seed_string: seedString,
    seed: seedInt,
    theme_title: `Pure Awareness Run #${baseHue}`,
    speed: parseFloat((0.8 + seed * 1.5).toFixed(2)),
    screen_color: hslToHex(baseHue, 55, 50),
    dot_color: hslToHex(baseHue, 70, 28),
    spawn_pattern_seed: seedInt,
    miss_deceleration_factor: 0.8,
    max_expansion_cap_seconds: 10,
  };
};

// ── clear_air (port of app/play/clear_the_air/page.tsx) ─────────────────────
// The page derives ONLY the raw spawn seed up-front; every bubble attribute is
// drawn from it at runtime (and spawn timing additionally depends on live
// player performance), so the seed IS the daily content.

const buildClearAir = (dateKey: string) => {
  const seedString = dateKey + "clear_air_v2";
  return {
    seed_string: seedString,
    spawn_seed: getDailySeed(seedString),
  };
};

// ── mental_reflex (port of app/play/mental_reflex/page.tsx) ─────────────────
// The four round targets are interleaved with lane-pool generation on ONE
// shared rng with data-dependent per-item consumption, so the full generation
// must be replayed verbatim to reproduce even just the targets. The stored
// record keeps {kind, target, matchesPerLane}; pools stay derivable from the
// seed.

const GAME_COLORS = [
  { key: "RED", hex: "#C62828" },
  { key: "GREEN", hex: "#2E7D32" },
  { key: "BLUE", hex: "#1565C0" },
] as const;
const GAME_SHAPES = ["SQUARE", "CIRCLE", "TRIANGLE", "PENTAGON"] as const;
const LANE_COUNT = 2;
const ITEMS_PER_ROUND = 16;
const MATCH_PROB = 0.55;

type ColorKey = (typeof GAME_COLORS)[number]["key"];
type ShapeKey = (typeof GAME_SHAPES)[number];

interface ItemData {
  shape?: ShapeKey;
  colorKey?: ColorKey;
  word?: ColorKey;
  ink?: ColorKey;
  isMatch: boolean;
  xFrac: number;
}

interface RoundDef {
  kind: "COLOR_MATCH" | "SHAPE_EXCLUDE" | "STROOP_WORD" | "STROOP_INK";
  target: string;
  lanes: ItemData[][];
}

const buildMentalReflexRounds = (seedInt: number): RoundDef[] => {
  const rng = mulberry32(seedInt);

  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const otherColor = (exclude: ColorKey): ColorKey =>
    pick(GAME_COLORS.filter((c) => c.key !== exclude)).key;
  const otherShape = (exclude: ShapeKey): ShapeKey =>
    pick(GAME_SHAPES.filter((s) => s !== exclude));

  const makeLanes = (genOne: () => ItemData): ItemData[][] =>
    Array.from({ length: LANE_COUNT }, () =>
      Array.from({ length: ITEMS_PER_ROUND }, genOne),
    );

  const rounds: RoundDef[] = [];

  {
    const target = pick(GAME_COLORS).key;
    rounds.push({
      kind: "COLOR_MATCH",
      target,
      lanes: makeLanes(() => {
        const wantMatch = rng() < MATCH_PROB;
        const colorKey = wantMatch ? target : otherColor(target);
        return {
          shape: pick(GAME_SHAPES),
          colorKey,
          isMatch: colorKey === target,
          xFrac: rng(),
        };
      }),
    });
  }

  {
    const target = pick(GAME_SHAPES);
    rounds.push({
      kind: "SHAPE_EXCLUDE",
      target,
      lanes: makeLanes(() => {
        const wantMatch = rng() < MATCH_PROB;
        const shape = wantMatch ? otherShape(target) : target;
        return {
          shape,
          colorKey: pick(GAME_COLORS).key,
          isMatch: shape !== target,
          xFrac: rng(),
        };
      }),
    });
  }

  {
    const target = pick(GAME_COLORS).key;
    rounds.push({
      kind: "STROOP_WORD",
      target,
      lanes: makeLanes(() => {
        const wantMatch = rng() < MATCH_PROB;
        const word = wantMatch ? target : otherColor(target);
        return {
          word,
          ink: pick(GAME_COLORS).key,
          isMatch: word === target,
          xFrac: rng(),
        };
      }),
    });
  }

  {
    const target = pick(GAME_COLORS).key;
    rounds.push({
      kind: "STROOP_INK",
      target,
      lanes: makeLanes(() => {
        const wantMatch = rng() < MATCH_PROB;
        const ink = wantMatch ? target : otherColor(target);
        return {
          word: pick(GAME_COLORS).key,
          ink,
          isMatch: ink === target,
          xFrac: rng(),
        };
      }),
    });
  }

  return rounds;
};

const buildMentalReflex = (dateKey: string) => {
  const seedString = dateKey + "mental_reflex";
  const seedInt = getDailySeed(seedString);
  const rounds = buildMentalReflexRounds(seedInt);
  return {
    seed_string: seedString,
    seed: seedInt,
    rounds: rounds.map((r) => ({
      kind: r.kind,
      target: r.target,
      matchesPerLane: r.lanes.map(
        (lane) => lane.filter((item) => item.isMatch).length,
      ),
    })),
  };
};

// ── public API ───────────────────────────────────────────────────────────────

const buildNonLlmContent = (
  slug: NonLlmSlug,
  dateKey: string,
): Prisma.InputJsonObject => {
  switch (slug) {
    case "steady_gaze":
      return buildSteadyGaze(dateKey);
    case "clear_air":
      return buildClearAir(dateKey);
    case "mental_reflex":
      return buildMentalReflex(dateKey);
  }
};

// Idempotent create-if-missing of the day's record row. update: {} means an
// existing row (from the other writer) is left untouched — the content is
// deterministic per date, so overwriting would be a byte-identical no-op.
// Swallows its own errors: a record failure must never break a game page.
const recordNonLlmDaily = async (
  slug: NonLlmSlug,
  dateKey: string,
): Promise<void> => {
  try {
    // scheduled_for is a @db.Date — UTC midnight, same convention as the
    // Gemini generators, so (mode, scheduled_for) stays a stable key.
    const scheduledFor = new Date(`${dateKey}T00:00:00.000Z`);
    await prisma.kalari_games.upsert({
      where: {
        mode_scheduled_for: { mode: slug, scheduled_for: scheduledFor },
      },
      update: {},
      create: {
        mode: slug,
        content: buildNonLlmContent(slug, dateKey),
        scheduled_for: scheduledFor,
      },
    });
  } catch (error) {
    console.error(`recordNonLlmDaily(${slug}, ${dateKey}) failed:`, error);
  }
};

export { buildNonLlmContent, recordNonLlmDaily };
export type { NonLlmSlug };
