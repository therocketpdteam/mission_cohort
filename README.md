# Mission Control

Mission Control is an internal cohort operations admin platform. It manages cohorts, registrations, participants, organizations, presenters, communications, calendar invite workflows, payment status, and operational audit history.

This repository is admin-only. It intentionally does not include LaunchPad, a learner/student dashboard, an on-demand course catalog, community features, podcast libraries, or guide libraries.

## Operating Model

Mission Control replaces the former internal operations workflow that depended on separate project boards and spreadsheets for cohort delivery coordination. Cohorts, registrations, participants, payment follow-up, communication readiness, session readiness, resource tracking, and post-session follow-up should be managed in Mission Control as the operational source of truth.

Jotform can still feed registration submissions into Mission Control through the registration webhook bridge. QuickBooks is integrated for financial reporting sync and linked invoice voiding, while Mission Control still does not create invoices. Asana and Google Sheets are not integration targets; the app replaces those tools for cohort operations.

When a registration arrives, Mission Control stores the organization, registration, optional participants, payment record, source, QuickBooks references, supporting document links, and operational follow-up tasks together. Participant details may be added later when only a participant count is available.

## Tech Stack

- Next.js App Router
- TypeScript
- Material UI
- Prisma
- Supabase Postgres
- Supabase Auth-ready architecture
- Zod validation
- Service-layer architecture

## Setup

Prerequisites:

- Node.js 22 LTS or newer
- pnpm

1. Install dependencies:

```bash
pnpm install
```

2. Create `.env` from `.env.example` and fill in the Supabase values:

```bash
cp .env.example .env
```

Required:

```bash
DATABASE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

The Supabase project URL is already reflected in `.env.example`:

```bash
https://upmmeahfxgynykubdxmi.supabase.co
```

Optional integration placeholders:

```bash
SENDGRID_API_KEY
SENDGRID_FROM_EMAIL
SENDGRID_WEBHOOK_PUBLIC_KEY
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
GOOGLE_CALENDAR_ID
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
QUICKBOOKS_REDIRECT_URI
QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN
QUICKBOOKS_ENVIRONMENT
CRM_WEBHOOK_URL
CRM_WEBHOOK_SECRET
MUX_TOKEN_ID
MUX_TOKEN_SECRET
MUX_WEBHOOK_SECRET
INTEGRATION_ENCRYPTION_KEY
WEBHOOK_SECRET
CRON_SECRET
APP_BASE_URL
```

Missing optional integration variables do not crash the app. Integration calls fail gracefully until the matching integration is configured.

## Production Readiness

The app is code-ready only after the deployment, database schema, env vars, and first live workflow are verified together.

Minimum Vercel env values:

```bash
DATABASE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_BASE_URL=https://mission-cohort-six.vercel.app
WEBHOOK_SECRET
CRON_SECRET
```

Recommended go-live order:

1. Confirm Vercel builds the latest `main` commit.
2. Apply the Prisma schema to Supabase:

```bash
pnpm prisma:generate
pnpm prisma:push
```

3. Open `/api/health` and confirm `database: true`.
4. Create Jotform mappings in `/settings`.
5. Send one real Jotform test submission and verify registration, optional participants, payment record, operations tasks, and webhook event logging.
6. Configure SendGrid, then Google Calendar, then QuickBooks, then CRM, then Mux.

Readiness helper:

```bash
APP_BASE_URL=https://mission-cohort-six.vercel.app pnpm readiness
```

Pre-push QA now requires Prisma client generation, TypeScript, and production build to pass locally:

```bash
pnpm qa:prepush
```

## Integrations

### SendGrid

Set these values to enable outbound email:

```bash
SENDGRID_API_KEY
SENDGRID_FROM_EMAIL
SENDGRID_WEBHOOK_PUBLIC_KEY
```

Without these values, email service calls return a useful configuration error instead of crashing the app. Template rendering and merge-field preview still work without SendGrid. SendGrid Event Webhooks are accepted at `POST /api/webhooks/sendgrid`.

### Calendar

ICS generation is available as the fallback calendar mode. Google Calendar uses a shared RocketPD operations calendar and requires:

```bash
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
GOOGLE_CALENDAR_ID
```

Without Google env vars, calendar workflows should use the ICS fallback.

### QuickBooks

QuickBooks is used for financial reporting sync, not Mission Control invoice creation. Configure:

```bash
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
QUICKBOOKS_REDIRECT_URI
QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN
QUICKBOOKS_ENVIRONMENT
```

QuickBooks webhooks are accepted at `POST /api/webhooks/quickbooks`. Paid or voided invoices sync into Mission Control. If a registration is cancelled and has a linked QuickBooks invoice reference, Mission Control attempts to void the invoice, never delete it.

### CRM + Mux

CRM outbound sync uses:

```bash
CRM_WEBHOOK_URL
CRM_WEBHOOK_SECRET
```

Mux video resource metadata uses:

```bash
MUX_TOKEN_ID
MUX_TOKEN_SECRET
MUX_WEBHOOK_SECRET
```

### Webhooks

Registration webhooks are accepted at:

```bash
POST /api/webhooks/registrations
```

If `WEBHOOK_SECRET` is configured, pass it in `x-webhook-secret`, `Authorization: Bearer ...`, or the `?secret=` query parameter. The query parameter option is available for Jotform webhook setup.

Scheduled job endpoints accept POST requests. If `CRON_SECRET` is configured, pass it in `x-cron-secret`, `Authorization: Bearer ...`, or `?secret=`.

Payloads may use the normalized Mission Control shape below or a Jotform-style submission shape. Jotform payloads are normalized server-side before records are created. Every inbound payload is stored in `WebhookEvent`; failed processing attempts keep an actionable error message.

### Jotform Routing

Jotform mappings are configured in `/settings` under "Jotform Form Mappings".

Use the mappings this way:

- 3-session form: set its Jotform form ID and default cohort.
- 8-session form: set its Jotform form ID and default cohort.
- 5-session shared form: set its Jotform form ID, enable "Require cohortSlug", and leave default cohort blank.

Routing order:

1. `cohortSlug` from the Jotform Get URL or payload wins.
2. If no `cohortSlug` is present, an active form mapping default cohort is used.
3. If a shared form requires `cohortSlug` and none is present, the webhook fails clearly and the failed event is visible in the database.

For the shared 5-session form, append the cohort slug when copying the Jotform Get URL:

```bash
https://form.jotform.com/FORM_ID?cohortSlug=example-cohort-slug
```

Participant paste format:

```text
Jane Doe, jane@example.com
Jordan Smith, jordan@example.com
```

Blank lines are ignored. Lines without a valid email are rejected with the line number. If only `participantCount` is provided, Mission Control creates no placeholder participants and opens operations tasks for roster follow-up.

Sample payload:

```json
{
  "source": "jotform",
  "eventType": "registration.submitted",
  "organization": {
    "id": "sample-district",
    "name": "Sample District",
    "type": "DISTRICT",
    "city": "Austin",
    "state": "TX"
  },
  "registration": {
    "cohortId": "REPLACE_WITH_COHORT_ID",
    "primaryContactName": "Avery Brooks",
    "primaryContactEmail": "avery@example.com",
    "paymentMethod": "INVOICE",
    "paymentStatus": "PENDING",
    "invoiceNumber": "INV-1001",
    "quickBooksCustomerRef": "QB-CUST-123",
    "quickBooksInvoiceRef": "QB-INV-456",
    "w9Url": "https://example.com/w9.pdf",
    "invoiceUrl": "https://example.com/invoice.pdf",
    "totalAmount": 250,
    "participantCount": 2
  },
  "participants": [
    {
      "firstName": "Jordan",
      "lastName": "Kim",
      "email": "jordan@example.com"
    },
    {
      "firstName": "Taylor",
      "lastName": "Nguyen",
      "email": "taylor@example.com"
    }
  ],
  "payment": {
    "amount": 250,
    "method": "INVOICE",
    "status": "PENDING",
    "invoiceNumber": "INV-1001",
    "quickBooksPaymentRef": "QB-PAY-789"
  }
}
```

Jotform-style payload example:

```json
{
  "formID": "REPLACE_WITH_JOTFORM_FORM_ID",
  "submissionID": "1234567890",
  "cohortSlug": "example-cohort-slug",
  "organizationName": "Sample District",
  "primaryContactName": "Avery Brooks",
  "primaryContactEmail": "avery@example.com",
  "participantCount": 2,
  "participantCsv": "Jane Doe, jane@example.com\nJordan Smith, jordan@example.com",
  "paymentMethod": "Invoice",
  "paymentStatus": "Pending",
  "totalAmount": 250
}
```

Repeat submissions with the same Jotform `submissionID` update the existing registration/payment data and replace that registration's participant roster with the latest parsed participant list.

Sample curl:

```bash
curl -X POST "$APP_BASE_URL/api/webhooks/registrations" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d @scripts/webhook-sample.json
```

Jotform-compatible curl using query-string secret:

```bash
curl -X POST "$APP_BASE_URL/api/webhooks/registrations?secret=$WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d @scripts/jotform-webhook-sample.json
```

## Database

Generate the Prisma client:

```bash
pnpm prisma:generate
```

Create and apply a local development migration:

```bash
pnpm prisma migrate dev --name init_admin_ops
```

For deployed environments:

```bash
pnpm prisma:deploy
```

If you are managing the Supabase schema directly from the current Prisma schema instead of committed migration files, push the schema changes:

```bash
pnpm prisma:push
```

Seed demo admin data:

```bash
pnpm db:seed
```

## Development

Start the dev server:

```bash
pnpm dev
```

Open:

```bash
http://localhost:3000/dashboard
```

Health check:

```bash
curl http://localhost:3000/api/health
```

Run sanity checks:

```bash
pnpm smoke
pnpm qa:smoke
pnpm qa:prepush
pnpm readiness
```

Run static checks:

```bash
pnpm qa:prepush
pnpm typecheck
pnpm build
```

## Architecture

Pages under `src/app` are intentionally thin. Business logic lives in `src/services`, domain entry points live in `src/modules`, validation lives in `src/validators`, and shared platform utilities live in `src/lib`.

Integration boundaries are isolated:

- `src/modules/calendar`
- `src/modules/email`
- `src/modules/webhooks`
- `src/modules/jotform`
- `src/modules/operations`
- `src/services/calendarService.ts`
- `src/services/emailService.ts`
- `src/services/webhookService.ts`

API responses use a consistent envelope:

```json
{
  "success": true,
  "data": {}
}
```

Errors use:

```json
{
  "success": false,
  "error": {
    "message": "Safe error message",
    "code": "BAD_REQUEST"
  }
}
```

## Implemented In This Pass

- Admin-only Next.js app skeleton
- Prisma schema for cohort operations
- Service layer for cohorts, sessions, registration forms, registrations, participants, organizations, presenters, communications, payments, webhooks, calendar, email, and audit
- Zod validators for core create/update workflows
- API route skeletons for admin operations
- Non-blocking audit logging for key mutations
- Health check endpoint
- Demo seed data
- Smoke script for database and core service sanity checks
- MUI admin shell with sidebar, header, breadcrumbs, user menu, tables, modals, alerts, and operational dashboard
- Cohort detail workspace with sessions, registrations, participants, communications, payments, resources, and activity tabs
- SendGrid sending boundary, merge-field renderer, reminder schedule helper, ICS generator, Google Calendar provider, and registration webhook processor
- Google Calendar OAuth connection, shared-calendar event create/update, and ICS fallback
- QuickBooks OAuth/webhook boundaries for paid/voided invoice sync and app-triggered invoice voiding
- CRM outbound sync outbox with retry processing
- Mux-backed resource metadata for recordings plus slides/docs links
- No-PII reporting and secure thought leader share links
- Internal operations tasks that replace project-board/spreadsheet tracking for participant lists, payment follow-up, supporting documents, calendar invites, resources, recordings, and post-session work
- Jotform registration bridge with form mappings, shared-form `cohortSlug` routing, participant paste parsing, idempotent submission updates, optional participant-list handling, and default operations task creation

## Intentional Remaining Stubs

- Supabase Auth session integration
- Production background scheduler configuration in Vercel cron or another scheduler
- Advanced QuickBooks reconciliation UI
- Direct Mux upload UI
- Report PDF generation

## Internal QA Checklist

- Dashboard loads metrics, upcoming sessions, recent registrations, open operations tasks, scheduled communications, pending payments, and cohorts needing attention.
- Cohorts list supports search, status filter, presenter filter, view, edit, and archive.
- Cohort detail tabs load without crashes: Overview, Operations, Sessions, Registrations, Participants, Communications, Resources, Payments, Activity.
- Manual registration creation, edit, confirm, cancel, participant add, and payment status updates return API envelopes and show UI alerts.
- Registration webhook creates/fetches organization, registration, optional participants, payment record, webhook event, and default operations tasks.
- Registrations can track participant-list status, supporting-document status, W-9 URL, invoice URL, and QuickBooks customer/invoice references.
- Communication template preview renders known merge fields and warns on unknown fields.
- Reminder schedule creates 7-day, 24-hour, and 1-hour `CohortCommunication` records.
- ICS generation includes session title, description, start/end, timezone, meeting URL, and location.
- Participants remains a global roster/reporting page across all cohorts and registrations.
- Organizations, presenters, payments, and registration forms are supporting data managed through cohort/registration workflows instead of standalone admin pages.
- Communications shows active/inactive templates, preview, outbox, scheduled sends, and resend actions.
- Settings shows database/env/integration configuration status.
- Settings includes integration status, OAuth connect links, Jotform dry-run normalization, and webhook replay.
- Reports can generate no-PII secure share links for thought leaders.

## Security Notes

- `.env` files are ignored by git.
- `SUPABASE_SERVICE_ROLE_KEY`, `SENDGRID_API_KEY`, `QUICKBOOKS_CLIENT_SECRET`, `CRM_WEBHOOK_SECRET`, `MUX_TOKEN_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, `CRON_SECRET`, and webhook verifier secrets are server-only values and must not be exposed in browser code.
- Public browser code only references `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Webhook secret validation is enforced when `WEBHOOK_SECRET` is configured.
- Scheduled job secret validation is enforced when `CRON_SECRET` is configured.
- Supabase RLS policies should be reviewed before production use. Prisma server routes currently act as trusted server-side admin operations.
- Auth helpers exist in `src/lib/auth.ts`; full route enforcement is reserved for the Supabase Auth pass.

## Known Limitations

- Supabase login/session enforcement is not active yet.
- Google Calendar OAuth is implemented as a provider boundary; token refresh hardening is still needed.
- SendGrid sends are implemented; Vercel cron or another scheduler should call job endpoints for production scheduled delivery.
- Resource upload/storage management is link/Mux metadata based for now.
- Advanced reporting, CSV export, bulk edits, and webhook replay are roadmap items.
- QuickBooks can fetch linked invoices, process paid/voided webhook events, and void linked invoices. It does not create invoices, perform full reconciliation, or replace QuickBooks reporting.

## Roadmap

- Activate Supabase Auth and role-based route/API protection.
- Add background jobs for scheduled communications and delivery status updates.
- Add Google Calendar OAuth connection and provider sync.
- Add resource upload support backed by Supabase Storage.
- Add audit/replay tooling for webhook events.
- Add export/import tools for registration operations.

## Admin Routes

- `/dashboard`
- `/cohorts`
- `/cohorts/[id]`
- `/registrations`
- `/participants`
- `/communications`
- `/reports`
- `/settings`

There are no learner-facing routes.
