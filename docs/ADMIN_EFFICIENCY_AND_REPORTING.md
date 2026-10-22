# Admin saves, dashboard checks, and attribution

Routine participant, registration, cohort, session, task, material, organization,
and Thought Leader changes project into the UI while their request is pending.
The shared notification center distinguishes pending requests, confirmed saves,
and follow-up work requiring attention. Failed requests roll back their projected
row; routine form values remain available for correction from the notification.

Pending routine saves and failed drafts are retained in session storage using an
explicit field allowlist. Integration credentials and send/cancellation actions
are excluded. Ambiguous create failures require checking for an existing record
before creating a copy. Duplicate pending submissions share one request; edits
to the same record run in order. New drafts are preserved when earlier saves
finish, and stale refreshes cannot undo newer confirmed edits or deletions. Financial, cancellation, and send confirmation flows remain in place.
Support team assignments persist before calendar sync runs after the response;
the existing calendar reconciliation job also retries persisted assignments.

Dashboard operational headers and cohort rows use the same actual open task set,
including calendar tasks. Reviewed/recovered delivery failures are excluded, and
repeated failures for the same communication/recipient are counted once. Health
checks report measured scheduler contact, overdue email queues, failed background
jobs, and calendar failures. A scheduler heartbeat proves contact, not job success;
unavailable checks are shown as unknown. Registration activity is a ten-week line
chart with pointer, tap, and keyboard details.

## Reports

Reports offers Registration list, State breakdown, and Marketing attribution.
State and marketing views accept any cohort, all cohorts, an optional Thought
Leader, and cohort start years. State rankings include missing-state counts and
use all reportable registrations as their percentage denominator. Cancelled,
refunded, and archived registrations are excluded from these aggregate views.

Marketing source, medium, and campaign are separate from the intake provider.
Jotform alone and an untagged RocketPD landing page do not prove marketing
ownership. Explicit source/medium/campaign tags match configurable exact,
case-insensitive ownership rules. Conflicting rules remain unassigned. The initial
rules credit only the explicit source tags `rocketpd`, `rocket_pd`, and `rocket-pd`
to RocketPD. Generic newsletter/email tags need ownership rules from an admin.
Rules are revision-checked and changes are audited.

Ownership shares use every reportable registration, including unassigned and
unknown sources; seats and registration counts remain separate. These are
recorded attribution shares, not causal lift measurements. Reports display the
number of registrations with captured signals and the number matching a rule.

Stored fields take precedence over URL tags. Reports can read missing attribution
from linked original Jotform submissions without changing records or resending
messages. Jotform normalization retains nested registration UTM fields and handles
HTML-escaped tagged URLs. Missing original tags cannot be reconstructed. External
registration forms must forward UTM fields or the tagged landing-page URL; this
release does not edit external forms.

## Verification

- 284 unit tests, Prisma generation, TypeScript checks, and production build.
- Real-browser checks with intercepted synthetic APIs at 1600, 1024, 390, and
  320 pixels: delayed saves, rollback, recovery, preserving newer drafts, chart
  keyboard details, empty periods, task counts, health severity, generic reports,
  attribution ownership editing, and mobile overflow.
- No database schema changes or live customer communications used for QA.
