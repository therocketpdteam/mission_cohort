# Financial / roster reconciliation

## Investigation and root cause

`Registration.totalAmount` stores registration contract value; `participantCount` is the stored expected-seat count, not independently verified purchased seats. `PaymentRecord.amount/status` and `InvoiceDraft.paidAmount` represent payment information separately. Partial receipts and overpayments must never become the contract value used for seat inference.

`deriveParticipantListStatus` in `src/lib/rosterStatus.ts`, its synchronization in `participantService`, and the original registration preflight compare saved rows only with that stored count. Matching 1/1 therefore produced Complete. Participant delivery originally said Ready when any roster email existed. `planRegistrationJourneys` queries REGISTERED saved participants; session communication and calendar audience resolution similarly depend on saved participant identities. People who have no saved participant record cannot receive participant invitations and reminders. The POC is an administrative recipient, not automatically an attendee.

Invoice quantities are not inherently independent: `createInvoiceDraft` and `prepareRegistrationInvoice` often copy `participantCount` and divide `totalAmount` by it. Registration changes and cohort moves can rebuild those same lines. Jotform's legacy `inferParticipantCountFromTotal` divides by the flat current matrix; it does not establish the historical volume tier. These paths explain the vulnerability, but the exact intake/edit history of live PL-2026-395 has not been audited in this local-only task.

Pricing has no versioned registration snapshot. `cohortPricing` has current configured/fallback prices and the five-session 495/485/465/455/445/425 volume tiers; its other fallback prices differ from the supplied 2025 reference. Registration dates do not establish a pricing year. Invoice tax exists; no structured historical pricing, discount/coupon, complimentary-seat adjustment or independent order-quantity/provenance model was found. Credits/refunds, revised invoices, custom rates, moves and manual totals therefore require explicit review.

## Implementation

`financialRosterReconciliation.ts` is shared by list/detail reads, UI, and audit. It normalizes and deduplicates active roster email addresses and compares all three counts: saved, stored expected, and independently verified purchased seats. It calculates in integer cents, considers every tier's valid quantity interval and supports uncapped integer quantities without dividing by the one-person rate. It never assigns a historical schedule from the current cohort price or date.

Source hierarchy: reviewed independent purchased/contracted quantity (including verified invoice-line evidence), then reviewed applicability of the supplied 2025 pricing with explicitly declared net adjustments, then unverified reference candidates for review. Generated invoice quantities alone cannot prove an independent purchase. Unknown taxes, multiple invoice revisions, conflicting totals and refunds suppress a precise default candidate. Other historical schedules/custom contracts use verified quantity evidence rather than an invented rate table.

Statuses: Verified, Missing Participants, Excess Participants, Needs Review, Not Applicable. A non-seat-based classification needs reviewed evidence. Cancelled/archived records are excluded from active attention filters and the default audit. Duplicate/invalid identities, pending changes and expected-seat conflicts block an overall Complete/Verified state. A financial match with an incorrect stored expected count remains Needs Review.

Review evidence is an append-only `FINANCIAL_ROSTER_REVIEWED` AuditLog record with authenticated reviewer, timestamp, independent source reference, explanation and confirmation. A serializable transaction rejects stale financial snapshots. A deterministic, non-identifying financial signature ties evidence to current session count, cohort, configured price, contract total, stored seats, method, active invoice quantities/amounts/taxes and recorded refunds. Relevant edits invalidate prior evidence automatically on the next calculation; participant-only edits recalculate against the existing reviewed contract. No reconciliation status is persisted or backfilled.

Registration list/detail reads attach evidence and freshly calculated results. The list adds a Financial / roster filter with active status counts and warns instead of saying Roster complete when financial evidence is unresolved. Preflight shows purchased seats, stored seats, distinct saved roster, confirmed or potential gap, contract total, pricing basis and explanation; Participant delivery now explicitly means Saved recipients only. A review dialog records evidence without changing operational financial/roster records. The raw stored participant-list status remains separate and is labeled Stored roster in the editor/filter. Existing billing, delivery and expected-seat calculation workflows are unchanged.

## Local read-only audit

Run sanitized examples without any database access:

```sh
APP_ENV=local OUTBOUND_RELEASE_LOCK=locked ALLOW_BACKGROUND_JOBS=false node --import tsx scripts/audit-financial-roster.ts --fixtures --output /private/tmp/financial-roster-example.json
```

For an approved local snapshot, omit `--fixtures` and set a local DATABASE_URL. Remote hosts are rejected. The database transaction is explicitly READ ONLY with RepeatableRead isolation. It queries metadata directly, never the existing registration-detail getter (which performs an unrelated legacy follow-up repair). It does not update expected seats, invoices, payment status, roster, follow-ups or integrations. Identifying reports are written exclusively to a new 0600 output file; console output is aggregate counts only. It refuses to overwrite an existing file.

Sanitized result: six cases, three Needs Review, two Missing Participants, one Verified. The unverified $10,010/one-person case suggests 22 seats and 21 potentially missing; verified 2025 evidence confirms 21 missing. The $990/one-person verified case confirms one missing. A $10,010/22-person case is Verified only when evidence and the stored expected count also agree. These are test examples, not actual customer audit results. No live customer audit was executed; the affected production population and White River's exact history remain unverified.

## Validation and scope

366 unit/database tests passed, including 17 new calculation/review tests and the existing registration, billing, notification and cancellation suites. Four new mocked browser checks and eight existing billing/registration browser regressions passed. TypeScript and the build passed. ESLint uses the existing dependencies instead of removed `next lint`; zero errors, 32 existing warnings. Tests cover all pricing boundaries across 3/4/5/8 sessions, historical-vs-current pricing, adjusted/custom/nonstandard and comped contracts, partial receipts, overpayments, excess/missing/empty/duplicate rosters, no financial amount, ambiguous rate matches, generated invoice circularity, refunds/taxes/multiple invoices, stale reviews and pending changes.

No migrations, dependencies, production queries/writes, processor calls, customer notifications or calendar invitations. No deployment or remote push. Review writes were exercised with mocks only. Historical evidence must be verified by an administrator before uncertain reference matches can become confirmed seat discrepancies. No actual customer registration was repaired.

## Changed files

- New calculation: `src/lib/financialRosterReconciliation.ts`
- New evidence/read service: `src/services/financialRosterReconciliationService.ts`
- Existing reads: `src/services/registrationService.ts`
- New authenticated review route: `src/app/api/registrations/[id]/financial-reconciliation/route.ts`
- New evidence panel: `src/components/admin/FinancialRosterReconciliation.tsx`
- Existing UI: `RegistrationDeliveryPreflight.tsx`, `RegistrationsClient.tsx`, `CohortDetailClient.tsx`
- Audit: `scripts/audit-financial-roster.ts`
- Tests: `tests/unit/financial-roster-reconciliation.test.ts`, `financial-roster-review.test.ts`, existing `payment-follow-ups.test.ts` mock updated for the new read; `tests/ui/financial-roster.spec.ts` and config
- Tooling/docs: `package.json`, `eslint.config.mjs`, this document
