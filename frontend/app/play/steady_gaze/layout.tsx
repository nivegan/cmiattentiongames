// steady_gaze/layout.tsx
// Schedule guard — redirects home (in production) when Steady Gaze isn't on
// today's IST lineup. See lib/scheduleGuard.ts.

import type { ReactNode } from "react";
import { assertScheduledToday } from "@/lib/scheduleGuard";

const SteadyGazeLayout = async ({ children }: { children: ReactNode }) => {
  await assertScheduledToday("steady_gaze");
  return children;
};

export default SteadyGazeLayout;
