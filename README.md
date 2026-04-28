# Mission Control

Mission Control is an internal cohort operations admin platform. It manages cohorts, registrations, participants, organizations, presenters, communications, calendar invite workflows, payment status, and operational audit history.

This repository is admin-only. It intentionally does not include LaunchPad, a learner/student dashboard, an on-demand course catalog, community features, podcast libraries, or guide libraries.

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
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
WEBHOOK_SECRET
APP_BASE_URL
```

Missing optional integration variables do not crash the app. Integration calls fail gracefully until the matching integration is configured.

## Integrations

### SendGrid

Set these values to enable outbound email:

```bash
SENDGRID_API_KEY
SENDGRID_FROM_EMAIL
```

Without these values, email service calls return a useful configuration error instead of crashing the app. Template rendering and merge-field preview still work without SendGrid.

### Calendar

ICS generation is available as the fallback calendar mode. Google Calendar is architected behind a provider boundary and requires:

```bash
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
```

Without Google env vars, calendar workflows should use the ICS fallback.

### Webhooks

Registration webhooks are accepted at:

```bash
POST /api/webhooks/registrations
```

If `WEBHOOK_SECRET` is configured, pass it in either `x-webhook-secret` or `Authorization: Bearer ...`.

Sample payload:

```json
{
  "source": "registration_form",
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
    "invoiceNumber": "INV-1001"
  }
}
```

Sample curl:

```bash
curl -X POST "$APP_BASE_URL/api/webhooks/registrations" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d @scripts/webhook-sample.json
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
- SendGrid boundary, merge-field renderer, reminder schedule helper, ICS generator, Google Calendar placeholder, and registration webhook processor

## Intentional Prompt 3 Stubs

- Supabase Auth session integration
- Production SendGrid send jobs and delivery event handling
- Google Calendar OAuth connection flow
- Webhook replay tooling and advanced field mapping
- Background job scheduling for communications

## Internal QA Checklist

- Dashboard loads metrics, upcoming sessions, recent registrations, scheduled communications, pending payments, and cohorts needing attention.
- Cohorts list supports search, status filter, presenter filter, view, edit, and archive.
- Cohort detail tabs load without crashes: Overview, Sessions, Registrations, Participants, Communications, Resources, Payments, Activity.
- Manual registration creation, edit, confirm, cancel, participant add, and payment status updates return API envelopes and show UI alerts.
- Registration webhook creates/fetches organization, registration, participants, payment record, and webhook event.
- Communication template preview renders known merge fields and warns on unknown fields.
- Reminder schedule creates 7-day, 24-hour, and 1-hour `CohortCommunication` records.
- ICS generation includes session title, description, start/end, timezone, meeting URL, and location.
- Organization detail shows organization info, registrations, participants, payment records, and activity placeholder.
- Settings shows database/env/integration configuration status.

## Security Notes

- `.env` files are ignored by git.
- `SUPABASE_SERVICE_ROLE_KEY`, `SENDGRID_API_KEY`, and `WEBHOOK_SECRET` are server-only values and must not be exposed in browser code.
- Public browser code only references `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Webhook secret validation is enforced when `WEBHOOK_SECRET` is configured.
- Supabase RLS policies should be reviewed before production use. Prisma server routes currently act as trusted server-side admin operations.
- Auth helpers exist in `src/lib/auth.ts`; full route enforcement is reserved for the Supabase Auth pass.

## Known Limitations

- Supabase login/session enforcement is not active yet.
- Google Calendar OAuth is stubbed; ICS fallback is the working calendar path.
- SendGrid template rendering is implemented, but production email sending should be connected to a background worker before scheduled sends are enabled.
- Resource upload/storage management is still a placeholder.
- Advanced reporting, CSV export, bulk edits, and webhook replay are roadmap items.

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
- `/organizations`
- `/organizations/[id]`
- `/presenters`
- `/communications`
- `/payments`
- `/forms`
- `/settings`

There are no learner-facing routes.
