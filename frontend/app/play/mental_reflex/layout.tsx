// mental_reflex/layout.tsx
// Schedule guard — redirects home (in production) when Mental Reflex isn't on
// today's IST lineup. See lib/scheduleGuard.ts.

import type { ReactNode } from "react";
import { assertScheduledToday } from "@/lib/scheduleGuard";

const MentalReflexLayout = async ({ children }: { children: ReactNode }) => {
  await assertScheduledToday("mental_reflex");
  return children;
};

export default MentalReflexLayout;
