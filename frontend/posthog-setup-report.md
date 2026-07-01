<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Kalari Games. The project already had a solid foundation (`instrumentation-client.ts`, `posthogServer.ts`, `SessionTracker.tsx`, `logFunnelEvent.ts`) with `posthog-js` and `posthog-node` installed. The wizard extended this by:

1. **Environment variables** — set `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` (EU) in `.env.local`.
2. **Reverse proxy** — added `/ingest/*` rewrites in `next.config.ts` routing to `eu.i.posthog.com` and `eu-assets.i.posthog.com`, so analytics traffic routes through the app origin (avoids ad-blockers).
3. **Error tracking** — added `capture_exceptions: true` to `instrumentation-client.ts`; PostHog now auto-captures unhandled client-side exceptions.
4. **Corrected API host** — `instrumentation-client.ts` now uses `/ingest` (reverse proxy) and `ui_host: https://eu.posthog.com` instead of a hardcoded US endpoint.
5. **Four new events** — `onboarding_completed`, `feedback_submitted`, `sign_in` (client-side), and `score_saved` (server-side).

| Event name             | Description                                                                                                       | File                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `onboarding_completed` | User finishes the 5-screen onboarding flow and taps BEGIN TRAINING.                                               | `components/OnboardingFlow.tsx`    |
| `feedback_submitted`   | User submits the NPS/improvement feedback form with their ratings (`nps`, `improvement`, `has_comments`).         | `components/SendFeedbackModal.tsx` |
| `sign_in`              | Client-side event fired when a user transitions from guest to signed-in during an active session.                 | `components/SessionTracker.tsx`    |
| `score_saved`          | Server-side event fired after a game score is successfully persisted to the database (`mode`, `score`, `source`). | `utils/saveUserGameStat.ts`        |

## Next steps

We've built a dashboard and five insights to monitor key Kalari Games metrics:

- [Analytics basics (wizard) — Dashboard](https://eu.posthog.com/project/213421/dashboard/785445)
- [Daily Active Users (wizard)](https://eu.posthog.com/project/213421/insights/DbWXED0F)
- [Onboarding Completions (wizard)](https://eu.posthog.com/project/213421/insights/WS5jKL1C)
- [Game Start vs Complete (wizard)](https://eu.posthog.com/project/213421/insights/gymcBLxw)
- [Average Score by Game Mode (wizard)](https://eu.posthog.com/project/213421/insights/tEtmbuXy)
- [Feedback Submissions & Sign-ins (wizard)](https://eu.posthog.com/project/213421/insights/2LpKxp78)

## Verify before merging

- [ ] Run a full production build (`npm run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.example` and any onboarding scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or equivalent) into CI so production stack traces de-minify (required for error tracking to show readable call stacks).
- [ ] Confirm the returning-visitor path also calls `identify` — the `SessionTracker` re-identifies on every load when `userId` is already set, which is correct, but verify this in the browser devtools after signing in.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
