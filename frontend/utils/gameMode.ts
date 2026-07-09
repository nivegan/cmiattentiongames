// gameMode.ts
// The canonical identifier for every game mode. Must exactly match the Prisma
// GameType enum in prisma/schema.prisma. Use SCREAMING_SNAKE_CASE.
type GameMode =
  | "GUT_CHECK"
  | "EXTRACT_THE_FACTS"
  | "STEADY_GAZE"
  | "CLEAR_THE_AIR"
  | "READ_BETWEEN_DESIGNS"
  | "MENTAL_REFLEX";

export type { GameMode };
