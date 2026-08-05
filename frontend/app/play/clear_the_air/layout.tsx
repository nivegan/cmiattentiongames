// clear_the_air/layout.tsx
// Schedule guard — redirects home (in production) when Clear the Air isn't on
// today's IST lineup. Note the schedule slug ("clear_air") differs from the
// route folder. See lib/scheduleGuard.ts.

import type { ReactNode } from "react";
import { assertScheduledToday } from "@/lib/scheduleGuard";

const ClearTheAirLayout = async ({ children }: { children: ReactNode }) => {
  await assertScheduledToday("clear_air");
  return children;
};

export default ClearTheAirLayout;
