// extract_facts/layout.tsx
// Schedule guard — redirects home (in production) when Extract the Facts isn't
// on today's IST lineup. See lib/scheduleGuard.ts.

import type { ReactNode } from "react";
import { assertScheduledToday } from "@/lib/scheduleGuard";

const ExtractFactsLayout = async ({ children }: { children: ReactNode }) => {
  await assertScheduledToday("extract_facts");
  return children;
};

export default ExtractFactsLayout;
