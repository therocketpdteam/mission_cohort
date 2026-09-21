# Local Docker Database

Use this when local pages feel slow because the app is talking to the remote Supabase pooler.

This runs only the Prisma/Postgres app database locally. Supabase Auth and storage can still use the staging Supabase project through `.env.local`, which keeps login behavior close to staging while making page data reads much faster.

## Start Fresh

```bash
pnpm db:local:up
pnpm db:local:push
pnpm db:local:seed
MC_ADMIN_EMAIL='gerardo@rocketpd.com' MC_ADMIN_FIRST_NAME='Gerardo' MC_ADMIN_LAST_NAME='Grosso' pnpm db:local:user
pnpm dev:local-db
```

The local database URL used by the scripts is:

```bash
postgresql://mission_cohort:mission_cohort_local@localhost:54329/mission_cohort?schema=public
```

## Login

The seeded demo admin is `admin.demo@missioncontrol.local` in Postgres only. Browser login still requires a Supabase Auth account.

For your usual staging-auth login, make sure the matching user row exists in the local Docker database:

```bash
MC_ADMIN_EMAIL='gerardo@rocketpd.com' \
MC_ADMIN_FIRST_NAME='Gerardo' \
MC_ADMIN_LAST_NAME='Grosso' \
pnpm db:local:user
```

## Safety

`pnpm dev:local-db` forces:

```bash
ALLOW_BACKGROUND_JOBS=false
OUTBOUND_RELEASE_LOCK=locked
```

So local Docker testing should not send email, calendar invites, CRM pushes, or other outbound work unless you deliberately override the lock for a controlled test.

## Copy Production Data Into Local Docker

This replaces the local Docker database only. It does not write to production.

Start the local database first:

```bash
pnpm db:local:up
```

Then run the sync with only the production database URL in your shell environment:

```bash
PRODUCTION_DATABASE_URL='<production database url>' \
CONFIRM_PROD_TO_LOCAL_SYNC='copy-prod-to-local' \
pnpm db:local:pull-prod
```

The script:

- creates a dump in `.local-db-backups/`
- drops and recreates the local Docker `public` schema
- restores the production dump into the local Docker database
- refuses obvious local or staging database URLs
- does not print the production database URL

After the restore, run local development with outbound locked:

```bash
pnpm dev:local-db
```

If your login uses staging Supabase Auth and the matching user row is not in production yet, add it locally:

```bash
MC_ADMIN_EMAIL='gerardo@rocketpd.com' MC_ADMIN_FIRST_NAME='Gerardo' MC_ADMIN_LAST_NAME='Grosso' pnpm db:local:user
```

## Stop

```bash
pnpm db:local:down
```

## Reset All Local Data

```bash
pnpm db:local:reset
pnpm db:local:push
pnpm db:local:seed
```
