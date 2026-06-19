# Mission Control Development Guide

Read this guide and `docs/UI_GUIDE.md` before making app changes.

## Product Scope

- Mission Control is admin-only.
- Do not add learner dashboards, LaunchPad, learner course catalogs, community features, Asana sync, or Google Sheets sync.
- Mission Control replaces spreadsheet/project-board operations for cohort delivery.

## Engineering Rules

- Keep pages thin. Business logic belongs in services/modules.
- Use validators for incoming data and API mutations.
- Preserve existing service boundaries for Jotform, email, calendar, QuickBooks, CRM, Mux, audit, and operations tasks.
- Prefer structured parsing over ad hoc string handling.
- Do not expose server secrets or service-role credentials to client components.

## Admin UX Rules

- Admin workflows should explain the next action in plain language.
- Avoid raw JSON or provider payloads in visible product UI.
- Use dropdowns, expandable rows, and focused modals for operational tasks.
- Keep rows compact and actions consistent.

## QA Before Commit

Run these before committing or pushing:

```bash
pnpm typecheck
pnpm build
pnpm qa:prepush
```

If schema changes are included, also run:

```bash
pnpm prisma:generate
```

Production schema changes require applying the Prisma schema to Supabase before the deployed code can depend on new columns.

## Production Migration And Deployment Runbook

Use this flow for any feature that adds Prisma tables/columns, storage files, integrations, or production-only behavior.

1. Check local readiness:

```bash
pnpm prisma:generate
pnpm typecheck
pnpm build
pnpm qa:prepush
```

2. Review migration status before deploying:

```bash
pnpm prisma migrate status
```

3. Production deploys run the Vercel build command from `vercel.json`, which applies migrations and prepares Supabase buckets inside Vercel using production environment variables:

```bash
node scripts/apply-production-schema-patches.mjs
node scripts/ensure-storage-buckets.mjs
pnpm build
```

The schema patch script is idempotent and covers the current production backlog because this database was originally created before Prisma Migrate history existed. Do not run migrations from the app UI. For a manual emergency migration with direct database access and a baselined migration history, use:

```bash
pnpm prisma migrate deploy
```

4. Verify storage readiness in Supabase:

- public bucket: `mission-control-public` unless `SUPABASE_PUBLIC_BUCKET` overrides it
- private bucket: `mission-control-private` unless `SUPABASE_PRIVATE_BUCKET` overrides it
- private bucket supports invoices, receipts, materials, and email attachments up to 20MB per file

5. Deploy/push to `main`, then smoke test:

```bash
curl -sS https://mission-cohort-six.vercel.app/api/health
```

Also open these routes as an admin:

- `/dashboard`
- `/settings`
- `/communications`
- `/api/system-health`
- first cohort detail page

6. In **Settings > System Health**, confirm:

- Database is connected.
- Communications issue review is ready.
- Jotform revision history is ready.
- Invoice drafts are ready.
- Distribution ledger is ready.
- Public/private storage buckets are ready.
- SendGrid, Jotform, Supabase, and scheduled jobs show the expected status.

7. In **Settings > Connected Tools**, run the live integration diagnostics when changing email/calendar setup:

- `Send test email` sends a diagnostic email to the logged-in admin and verifies the SendGrid send path.
- `Test ICS fallback` confirms Mission Control can generate calendar invite files even without Google OAuth.
- `Test Google event` creates a diagnostic event on the configured Google Calendar after OAuth is connected.

If a feature shows `Blocked`, keep the UI compatibility fallback in place and do not mark the roadmap item done until production reports ready.
