# Cohort Overview UX — local review

## Findings and layout

The original Overview placed information/readiness, support and analytics above daily session management. The session table mixed calendar readiness, default email setup counts, materials, long provider errors and actions in a single row. Backend FAILED can include a pre-provider configuration error; it does not necessarily establish that delivery was attempted. Readiness has a single `ready` boolean for each requirement, and overall publication requires all of them to be ready. There is no independent nonblocking readiness category.

The UI now orders summary metrics, session cards, compact expandable Publish Readiness, cohort information/preparation, support team, Revenue Snapshot and Registration Evolution. Sections were moved using their existing JSX/action handlers rather than rewriting business workflows. Cohort status remains visible at the top. Mobile metrics use two columns so session management appears sooner.

Session cards show number/title, full date/time/timezone, Upcoming/In Progress/Completed, concise post-session email state and contextual actions. Calendar/default-email/material details expand on demand; existing editing, material, ICS, preview, Google sync and cancellation actions remain accessible. Bulk calendar cancellation is under Calendar actions. Session action menus opt into viewport fitting; other existing menus keep their behavior.

Publish Readiness starts collapsed with readiness state and outstanding/publish-blocking counts. Both counts use the existing not-ready requirements: every outstanding requirement blocks publishing under the unchanged backend rule. All existing checks, explanations, create-missing-email action, publish/draft/cancel controls remain available when expanded. Pending setup uses amber rather than red.

## Email status presentation

Existing API status, providerError, session time and original postSessionWindow eligibility are reused. SENT is green with its recorded timestamp. SCHEDULED is neutral before session end; eligible early sending is Ready to Send. Expired schedules, missing recording links and uncertain errors are Needs Attention with an in-page Review Email dialog. Known missing configuration/safety errors are amber configuration blockers, not asserted delivery failures. Explicit provider rejection/failure messages use Delivery Failed/red. Unknown errors remain Needs Attention because the available metadata does not prove a provider attempt.

Raw errors, recipient count, cohort/session context and schedule live in the review dialog. Eligible retries still open the original confirmation and use exactly the same message ID/API request. Recording issues can open the existing session editor; configuration issues link to existing Settings. No new late-send or uncertain-outcome retry bypass exists. The existing send function, polling cadence, window guard, scheduler, recipient selection and durable duplicate checkpoints are unchanged.

## Validation

384 unit/database tests passed, including the existing Send Now/scheduler/financial suites and three presentation tests. 29 mocked browser checks passed: four full Overview checks, seven Send Now, four financial reconciliation, eight billing/registration and six history. Full-page desktop and 390px mobile screenshots were inspected; no horizontal overflow; menu editing, readiness expansion and context review work without mutations. TypeScript, lint (0 errors, 32 existing warnings), and production build pass.

Only components, presentation CSS/helper and tests change. No service, API route, shared business lib, config, Prisma schema, dependency or lockfile changes. No database, payment, registration or participant records were touched. No real emails, calendar invitations or external notifications were sent. No push, merge or deployment was performed. Existing staging/production remain unchanged.

## Files

- `src/components/admin/CohortDetailClient.tsx` — existing section order and session card presentation.
- `src/components/admin/SessionPostSessionEmail.tsx` — concise statuses and in-page review, unchanged send action.
- `src/components/admin/cohortOverviewPresentation.ts` — pure visual labels/tones, no persisted state transitions.
- `src/components/admin/common.tsx` — optional viewport-fit behavior for session menus.
- `src/app/globals.css` — scoped session/readiness/mobile styles.
- `tests/unit/cohort-overview-presentation.test.ts`, `tests/ui/cohort-overview.spec.ts` and config; existing Send Now browser expectations updated for review-first failure details.

Remaining limit: historical FAILED records do not all preserve provider-attempt provenance. The UI deliberately treats uncertain cases as Needs Attention instead of inventing a confirmed failure. Detailed provider outcomes remain subject to existing operational review.
