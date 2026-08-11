# Staging Environment

Mission Cohort uses Production for the live application and a `staging` Git branch backed by Vercel Preview for pre-production testing.

## Environment Model

- Production URL: the live app for real registrations, emails, calendar events, CRM sync, and QuickBooks data.
- Staging URL: a Vercel Preview deployment from the `staging` branch.
- Staging must use its own database, Supabase storage buckets, Google Calendar, SendGrid/test configuration, CRM endpoint, and QuickBooks sandbox or disabled QuickBooks configuration.

Do not point staging at the production `DATABASE_URL`, Supabase project, Google calendar, SendGrid live sender, CRM production endpoint, or QuickBooks production company.

## Required Vercel Variables

Set these on Production:

- `APP_ENV=production`
- `NEXT_PUBLIC_APP_ENV=production`
- `NEXT_PUBLIC_ENV_LABEL=Production`
- `ALLOW_BACKGROUND_JOBS=true`
- `OUTBOUND_RELEASE_LOCK=locked`
- `OUTBOUND_RELEASE_REASON=Production outbound locked except during intentional release windows.`

Set these on Preview for the `staging` branch:

- `APP_ENV=staging`
- `NEXT_PUBLIC_APP_ENV=staging`
- `NEXT_PUBLIC_ENV_LABEL=Staging`
- `ALLOW_BACKGROUND_JOBS=false`
- `OUTBOUND_RELEASE_LOCK=locked`
- `APP_BASE_URL=<staging deployment URL or staging domain>`

Staging also needs isolated values for:

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLIC_BUCKET`
- `SUPABASE_PRIVATE_BUCKET`
- `INTEGRATION_ENCRYPTION_KEY`
- `AUTH_BOOTSTRAP_SECRET`
- `WEBHOOK_SECRET`
- `CRON_SECRET`

Use `.env.staging.example` as the checklist for branch-specific Preview values.

Integrations should be omitted or pointed at test systems until explicitly approved:

- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `GOOGLE_CALENDAR_*`
- `CRM_*`
- `QUICKBOOKS_*`

## Safety Guardrails

- The app shows an environment badge in the sidebar and top bar.
- Production displays `Production / Live data`.
- When outbound is locked, the top bar displays `Outbound locked`.
- Staging displays `Staging / Jobs off` unless `ALLOW_BACKGROUND_JOBS=true`.
- Background job endpoints refuse to run outside Production unless `ALLOW_BACKGROUND_JOBS=true`.
- Deployment fails fast if `APP_ENV=staging` points at the known Production Supabase project, the Production app URL, or has background jobs enabled.
- Vercel cron jobs are configured at the project level and should only process the Production deployment.
- Production outbound side effects require `OUTBOUND_RELEASE_LOCK=unlocked`.
- The outbound lock blocks SendGrid sends, Google Calendar invite changes/cancellations, CRM webhook sends, QuickBooks sync/create/void actions, and background jobs.

## Production Outbound Release Window

Keep Production locked by default:

```bash
OUTBOUND_RELEASE_LOCK=locked
```

For an intentional send/sync/release window only:

```bash
OUTBOUND_RELEASE_LOCK=unlocked
OUTBOUND_RELEASE_REASON="Publishing PL Fall 2026 after preflight approval"
```

After the approved action finishes, immediately set:

```bash
OUTBOUND_RELEASE_LOCK=locked
OUTBOUND_RELEASE_REASON="Production outbound locked after release."
```

## Recommended Workflow

1. Merge production-ready changes to `main`.
2. Create or update a `staging` branch from `main`.
3. Push `staging` to create a Vercel Preview deployment.
4. Confirm the deployment displays `Staging / Jobs off`.
5. Test using staging-only data and integrations.
6. Merge to `main` only after staging QA passes.
