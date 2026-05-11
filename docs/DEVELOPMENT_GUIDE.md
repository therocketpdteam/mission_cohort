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
