// read_designs/layout.tsx
// Schedule guard — redirects home (in production) when Read Between Designs
// isn't on today's IST lineup. See lib/scheduleGuard.ts.

import type { ReactNode } from "react";
import { assertScheduledToday } from "@/lib/scheduleGuard";

const ReadDesignsLayout = async ({ children }: { children: ReactNode }) => {
  await assertScheduledToday("read_designs");
  return children;
};

export default ReadDesignsLayout;
