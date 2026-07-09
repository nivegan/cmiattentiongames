// gameCatalog.ts
// Single source of truth mapping each daily-schedule slug (from
// data/dailySchedule.json) to its game metadata and skill tier. Adding a game
// is one entry here. Slugs intentionally differ from routes/GameMode values, so
// this is also the slug → mode/route lookup.

import type { GameMode } from "@/utils/gameMode";

// The three fixed skill tiers shown on the home page, in display order.
type Tier = "STANCE" | "STAFF" | "BLADE";

interface GameInfo {
  slug: string; // schedule key, e.g. "steady_gaze"
  mode: GameMode; // canonical GameMode enum value
  route: string | null; // /play route; null = not playable yet (COMING SOON)
  label: string; // card title
  tagline: string; // card subtitle
  tier: Tier;
}

interface TierInfo {
  id: Tier;
  title: string; // e.g. "THE STANCE"
  subtitle: string; // e.g. "Build your foundation"
}

// Keyed by schedule slug.
const GAME_CATALOG: Record<string, GameInfo> = {
  steady_gaze: {
    slug: "steady_gaze",
    mode: "STEADY_GAZE",
    route: "/play/steady_gaze",
    label: "Steady Gaze",
    tagline: "Train pure awareness",
    tier: "STANCE",
  },
  clear_air: {
    slug: "clear_air",
    mode: "CLEAR_THE_AIR",
    route: "/play/clear_the_air",
    label: "Clear the Air",
    tagline: "Dissolve distractions",
    tier: "STANCE",
  },
  extract_facts: {
    slug: "extract_facts",
    mode: "EXTRACT_THE_FACTS",
    route: "/play/extract_facts",
    label: "Extract the Facts",
    tagline: "Separate facts from bias",
    tier: "STAFF",
  },
  gut_check: {
    slug: "gut_check",
    mode: "GUT_CHECK",
    route: "/play/gut_check",
    label: "Gut Check",
    tagline: "Calibrate confidence",
    tier: "STAFF",
  },
  read_designs: {
    slug: "read_designs",
    mode: "READ_BETWEEN_DESIGNS",
    route: "/play/read_designs",
    label: "Read Between Designs",
    tagline: "Detect manipulation",
    tier: "BLADE",
  },
  mental_reflex: {
    slug: "mental_reflex",
    mode: "MENTAL_REFLEX",
    route: "/play/mental_reflex",
    label: "Mental Reflex",
    tagline: "Break automatic responses",
    tier: "BLADE",
  },
};

const TIERS: TierInfo[] = [
  { id: "STANCE", title: "THE STANCE", subtitle: "Build your foundation" },
  { id: "STAFF", title: "THE STAFF", subtitle: "Strengthen your core" },
  { id: "BLADE", title: "THE BLADE", subtitle: "Sharpen your edge" },
];

export type { GameInfo, TierInfo, Tier };
export { GAME_CATALOG, TIERS };
