// gut_check/layout.tsx
// Schedule guard — redirects home (in production) when Gut Check isn't on
// today's IST lineup. See lib/scheduleGuard.ts.

import type { ReactNode } from "react";
import { assertScheduledToday } from "@/lib/scheduleGuard";

const GutCheckLayout = async ({ children }: { children: ReactNode }) => {
  await assertScheduledToday("gut_check");
  return children;
};

export default GutCheckLayout;
