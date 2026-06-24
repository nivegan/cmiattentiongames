// app/page.tsx
// The home page. On the user's first visit it shows the one-time onboarding
// flow; once completed, it renders the "Today's Payattu" home grid.
//
// This is a Server Component (no "use client" directive). It hands <HomeGrid /> to
// <OnboardingFlow> as the `home` slot — the client component decides whether to
// show onboarding or the home content.

import { OnboardingFlow } from "@/components/OnboardingFlow";
import { HomeGrid } from "@/components/HomeGrid";

const HomePage = () => {
  return <OnboardingFlow home={<HomeGrid />} />;
};

export default HomePage;
