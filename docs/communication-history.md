# Communication history reads

Existing `GET /api/communications` callers keep the array response. The workspace opts into pagination with `history=1`.

- `search`: trimmed, case-insensitive text; a complete email selects recorded recipient history.
- `recipient`: optional explicit email. Membership comes from stored recipient lists or events, including historical registrations; it is not inferred from today's cohort roster.
- `cohortId`, `status`, `issueOnly=1`: optional filters. A complete-email query defaults to `SENT` unless `status` is explicitly supplied; `status=` means all activity. Issues queries do not default to sent-only.
- `limit`: 1–100, default 25. `cursor` is returned by the preceding page and is bound to the filters. Changed filters require restarting pagination.
- Response data: `{ rows, total, summary: { sent, scheduled, issues }, recipient, nextCursor }`. `total` includes status/issue filters. Summary cards cover the search and cohort across statuses. List rows contain no email bodies or snapshot payloads.

`GET /api/communications?id=<id>&recipient=<email>` returns detail metadata, recipient options, deduplicated send attempts and content provenance. Without a recipient, the response has no selected personalized content. A selected recipient must have recorded membership on that communication. Draft detail retains its original source fields for editing.

Saved copies are read from the recipient's own SENT event payload, grouped by provider message ID to avoid treating processed webhooks as additional sends. An older snapshot is never used for a newer, different attempt. Missing snapshots use the stored message source and unambiguous linked recipient context, labeled reconstructed; missing/ambiguous values produce explicit warnings. Historical rows are never rewritten by reads. The provider may have transformed links after acceptance; snapshots represent the content submitted by the application.

HTML previews run in sandboxed frames with a restrictive CSP. Remote images, scripts, CSS requests, frames and forms are blocked; previews do not trigger tracking pixels. Manual resend controls still send the current message version, not an archived attempt selected for viewing.

The Participants summary query reads event metadata only. Participant rows render independently of registrations, templates and cohort option requests. Existing list contracts, exports and bulk selection are preserved.

Validation: `pnpm test:unit`, `pnpm qa:prepush`, and `pnpm test:ui:history` (install Playwright Chromium first, or use `HISTORY_BROWSER_CHANNEL=chrome` for an installed Chrome). History SQL tests run against an in-memory PostgreSQL engine; browser tests mount the actual client components with mocked APIs. No production access is used. No database migration is required.
