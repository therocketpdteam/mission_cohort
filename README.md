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

Missing optional integration variables do not crash the app. Integration calls fail gracefully until Prompt 2 or later implementation fills them in.

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
```

Run static checks:

```bash
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
- Rich tables, filters, forms, and admin workflow screens
- Background job scheduling for communications

## Admin Routes

- `/dashboard`
- `/cohorts`
- `/cohorts/[id]`
- `/registrations`
- `/participants`
- `/organizations`
- `/presenters`
- `/communications`
- `/payments`
- `/forms`
- `/settings`

There are no learner-facing routes.
