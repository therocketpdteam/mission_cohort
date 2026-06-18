# Mission Control UI Guide

This file is the source of truth for Mission Control UI work. Read it before changing any page, component, theme token, table, form, modal, or workflow surface.

Mission Control is an internal RocketPD cohort operations console. It should feel like a precise Mission Cohort control surface: modern, calm, dense, professional, and easy to scan for daily internal work. It is not a generic SaaS dashboard and it is not a marketing landing page. It must stay dense enough for operations while carrying the Mission Cohort identity through color, spacing, typography, button hierarchy, and page structure.

## Implementation Rules

Before making UI changes:

1. Read `docs/UI_GUIDE.md`.
2. Identify the component type being changed: page header, card, table, form, modal, row action, dashboard panel, mapping workflow, or navigation.
3. Apply the matching tokens, spacing, and button hierarchy from this guide.
4. Check desktop and wrapped/mobile layout.
5. Verify no overlapping buttons, badges, text, filters, cards, or controls.
6. Verify no more than one primary action per section.
7. Reuse existing shared Mission Control components and app-native UI primitives where possible.

When editing existing screens:

- Do not only update colors. Also update spacing, button hierarchy, card structure, and responsive behavior.
- If a screen has overlapping buttons, refactor the container layout instead of shrinking text or hiding buttons.
- Replace duplicate/custom button styles with the shared button variants.
- Treat the app-native primitives as the underlying engine, not the visible design system. Admin pages should use Mission Control wrappers instead of raw primitives when a wrapper exists.
- Do not add raw `DataGrid`, ad hoc status text, one-off chips, or custom row action groups to screens. Use `AppDataGrid`, `StatusChip`/`StatusBadge`, `RowActionMenu`, `PageHeader`, `SectionCard`, and shared formatting helpers.
- Remove one-off colors unless they map to the approved tokens.
- Do not introduce raw technical payloads into admin-facing workflows.
- Preserve the admin-only scope: no learner dashboard, LaunchPad, course catalog, Asana, or Google Sheets UI.

## Brand Personality

Mission Control should feel:

- Professional but approachable.
- Organized and calm.
- Modern but not flashy.
- Education-centered.
- Action-oriented for internal admin users.
- Operational, minimal, and easy to scan.
- Similar in discipline to Linear/Stripe-style developer tools: quiet surfaces, clear type, exact borders, and purple only where it helps action or orientation.

Avoid:

- Generic gray SaaS look.
- Too many competing blues or leftover Rocket Blue/Cyan dominance.
- Amber/deep-space action styling from older design passes.
- Flat default buttons.
- Cramped cards.
- Overlapping CTAs.
- Inconsistent button sizes.
- Tiny secondary actions floating beside large primary actions.
- Raw JSON, all-caps enums, or developer-first labels in normal admin flows.

## Mission Cohort Console Tokens

Use these tokens throughout the app.

Core Surfaces:

- `--color-surface: #F7F9FB`
- `--color-surface-dim: #D8DADC`
- `--color-surface-bright: #F7F9FB`
- `--color-surface-container-lowest: #FFFFFF`
- `--color-surface-container-low: #F2F4F6`
- `--color-surface-container: #ECEEF0`
- `--color-surface-container-high: #E6E8EA`
- `--color-surface-container-highest: #E0E3E5`

Text And Strokes:

- `--color-on-surface: #191C1E`
- `--color-on-surface-variant: #4A4455`
- `--color-outline: #787680`
- `--color-outline-variant: #CCC3D8`
- `--color-surface-tint: #732EE4`

Primary Purple:

- `--color-primary-900: #25005A`
- `--color-primary-800: #5A00C6`
- `--color-primary-700: #630ED4`
- `--color-blue-600: #7C3AED`
- `--color-blue-500: #8B5CF6`
- `--color-blue-100: #EADDFF`
- `--color-cyan-500: #7C3AED`
- `--color-cyan-100: #EDE0FF`

Secondary And Tertiary:

- `--color-secondary: #565E74`
- `--color-secondary-container: #DAE2FD`
- `--color-orange-500: #A15100`
- `--color-orange-100: #FFDCC6`

Semantic States:

- `--color-success-600: #16A34A`
- `--color-success-100: #DCFCE7`
- `--color-warning-600: #D97706`
- `--color-warning-100: #FEF3C7`
- `--color-danger-600: #DC2626`
- `--color-danger-100: #FEE2E2`

Legacy Token Mapping:

- Existing `--color-slate-*`, `--color-blue-*`, and `--color-cyan-*` tokens are implementation aliases. They should resolve to the Mission Cohort Console palette above.
- Do not introduce new hard-coded old Rocket Blue/Cyan colors in page CSS. Use semantic tokens.

Background rules:

- Main app background: `#F7F9FB`.
- Main cards: `#FFFFFF` or `--color-surface-container-lowest`.
- Grouped areas: use the surface container scale, not arbitrary grays.
- Navigation/header areas: light surface with purple active states by default; night mode uses dark purple surfaces.
- Primary CTAs and active navigation: Mission Cohort purple with white text.
- Progress, comparison, and specialized data accents: purple first, then muted secondary/tertiary tones.
- Use purple sparingly. It should orient the user, not decorate every surface.

## Typography

- Use Inter for headings, labels, body copy, tables, forms, filters, dropdown menus, dense admin rows, and helper text.
- Expose Inter through `--font-heading` and `--font-body`. Do not make local QA depend on a live font-network fetch; if Google font loading is added later, it must keep `pnpm build` reliable in restricted environments.
- Headings should be confident and compact.
- Body text should remain readable, compact, and calm.
- Avoid oversized marketing-style type inside operational tools.
- Preserve `letter-spacing: 0`; do not use negative tracking.
- Use smaller, tighter headings inside cards, tables, dialogs, and dashboards.

## Button System

Use the shared Mission Control button system as the source for these variants.

Primary Button:

- Background: `#7C3AED` or `#630ED4`.
- Text: `#FFFFFF`.
- Hover: `#5A00C6`.
- Border radius: `8px`.
- Height: `40px` minimum.
- Font family: Inter.
- Font weight: `700`.
- Use for the main action on a screen or modal only.

Secondary Button:

- Background: transparent or white.
- Text: `#191C1E`.
- Border: `1px solid #CCC3D8`.
- Hover background: `#ECEEF0`.
- Use for supporting actions.

Outline Button:

- Background: transparent or white.
- Text: `#4A4455`.
- Border: `1px solid #CCC3D8`.
- Hover background: `#ECEEF0`.
- Use for lower-priority but still visible actions.

Ghost Button:

- Background: transparent.
- Text: `#334155`.
- Hover background: `#F1F5F9`.
- Use only inside tables, cards, dropdowns, or compact action rows.

Danger Button:

- Background: `#DC2626`.
- Text: white.
- Hover: `#B91C1C`.
- Use only for destructive actions.

Disabled Button:

- Background: `#E2E8F0`.
- Text: `#94A3B8`.
- Cursor: not-allowed.
- No hover animation.

Button hierarchy rules:

- Each page should have only one obvious primary button in the main header/action area.
- Do not place two filled primary buttons side by side.
- If there are multiple actions, use one Primary + Secondary/Ghost buttons.
- Destructive actions should never appear directly beside the primary save/submit button unless clearly separated.
- In cards and tables, use Ghost or Outline buttons unless the action is the central page action.
- Table rows should not contain full-size primary buttons.

## Button Layout / Overlap Prevention

Buttons must never overlap text, cards, badges, filters, or each other.

Rules:

- Any horizontal action group must use `flex-wrap: wrap`.
- Button groups must have `gap: 8px` minimum.
- Header action areas must use `justify-between` with a wrapping action container.
- On small screens, action groups should stack vertically or wrap cleanly.
- Never use absolute positioning for page-level buttons unless there is a strong reason.
- Avoid fixed-width containers that force buttons to collide.
- Table row actions should collapse into a dropdown or kebab menu when more than 2 actions exist.
- Modal footers should use a consistent layout: Cancel/Secondary on the left or right, Primary on the far right, with `gap: 8px` or `12px`.
- Cards with actions should have actions in a dedicated header or footer area, not floating over card content.

Recommended class/layout pattern:

- Page header: `flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between`.
- Action group: `flex flex-wrap items-center gap-2`.
- Modal footer: `flex flex-wrap justify-end gap-2 border-t pt-4`.
- Card actions: `flex flex-wrap items-center justify-end gap-2 pt-4`.

## Cards and Surfaces

Cards:

- Background: `#FFFFFF` or `--color-surface-container-lowest`.
- Border: `1px solid #CCC3D8` or the shared outline variant.
- Border radius: `12px` for dashboard/module panels and `8px` for compact controls.
- Shadow: minimal. Prefer borders and tonal layering over elevation.
- Padding: `20px` to `24px`.
- Use consistent internal spacing.

Important cards:

- May use a subtle top border or left accent border using Mission Cohort purple when the state is action-oriented.
- Avoid heavy gradients inside dense admin cards.

Dashboard stat cards:

- Use white or `surface-container-lowest` background.
- Icon circle using `#EADDFF` or a very soft purple tint.
- Number in `#191C1E`.
- Label in `#4A4455`.
- Optional trend badge in success/warning colors.
- Cards in the same row should be equal height.

## Page Headers

Page headers should include:

- Clear title.
- Short supporting description.
- One primary action max.
- Secondary actions grouped beside or below the primary action.

Visual style:

- Title color: `#071D33`.
- Description color: `#64748B`.
- Header spacing: generous, never cramped.
- Header actions must wrap. Do not let actions collide with breadcrumbs or page titles.

## Forms

Form rules:

- Inputs must have `40px` minimum height.
- Label above input, not placeholder-only.
- Focus ring should use Mission Cohort purple with a soft translucent halo.
- Error text should use danger red.
- Helper text should use slate-500.
- Form sections should be grouped in cards or clear fieldsets.
- Long forms should use section headings and spacing.
- Creation/edit wizards should reduce decisions where possible and use smart defaults.
- Dropdown options should be human-readable and show sample context when mapping external data.
- Date and datetime fields must use the app-owned US display format, not native browser date rendering. Display dates as `MM/DD/YYYY` and session/date-time values as `MM/DD/YYYY h:mm AM/PM`; submit values may still be normalized to ISO for APIs.

## Tables and Lists

Rules:

- Table headers should be subtle, not heavy.
- Table headers should stay around medium-bold weight, and body cells should use Inter with regular/medium weights unless the value is the row’s primary scan target.
- Column sizing must be semantic, not equal-width by accident. Identity columns such as participant, cohort, organization, or message subject get the most room; status, date, money, and action columns stay compact and stable.
- Prefer identity/context cells over extra columns. For example, show participant name with email/title as subtext, or organization with cohort as subtext, instead of splitting every detail into its own table column.
- Row hover background: `#F8FAFC`.
- Status badges should use token colors.
- Use `AppDataGrid` for admin data tables. Do not import low-level table/grid primitives directly into pages when a shared wrapper exists.
- Row height must be tall enough for all visible content. Do not stack multiple badges/text lines inside a short row.
- Row actions should not crowd the row.
- If more than 2 row actions exist, use a dropdown.
- Avoid placing full-size primary buttons inside table rows.
- Avoid horizontal scrolling in primary workflows. Prefer fewer columns, detail modals, row expansion, or action menus.
- Use proper-case formatting for people, POCs, organizations, and presenters.
- Long pills, sources, URLs, and labels must truncate with a tooltip or move into a detail modal; they must not stretch the table.
- Primary table rows should open the most useful quick view/edit surface when a detail target exists. Keep secondary data, supporting docs, long notes, and audit context out of the primary table and inside the drawer/modal.
- Primary tables should use a small set of high-value columns. If a column repeats the same value on every row, move it into a compact defaults/info panel above the list.

List Console Pattern:

- Primary operational list pages should use the Mission Cohort console pattern when possible: page title/actions, one subtle filter rail, then one bordered table surface.
- Filter rails should start with a small `Filters` label, then pill controls for high-value statuses or segments, then a fixed-width app-styled search control aligned to the right.
- Filter pills may show compact counts in a small inset badge. Active pills use the primary purple border/background; risk/destructive pills may use the danger tone.
- The main table surface should be a single white/container panel with a 12px radius, outline-variant border, subtle table header, and clear row dividers.
- Row identity columns get the most width. Rows may include a small chevron affordance on the left when clicking opens the record.
- Footer copy should read like `Showing 1-10 of 43 records`, with pagination controls kept compact and aligned right.

## Filters And Dropdowns

- Filters are controls, not the page content. Use `CompactFilterBar` for normal admin screens instead of a bulky standalone `Filters` card.
- The first row should hold search first, then the highest-value filters. Lower-frequency filters belong behind the subtle `More filters` disclosure.
- Desktop filters should fit in one row whenever practical and wrap only when needed. Do not give filters more vertical weight than the list they control.
- Show an understated result count in the filter bar when available.
- All dropdowns, selects, autocomplete controls, table page-size controls, modal selects, bulk action selects, dashboard controls, and settings controls must use the app-styled select/menu UI. Do not use browser/system select styling in Mission Control screens.
- Dropdown labels and options must be human-readable, proper-case where appropriate, and never raw enum/status strings.
- Dropdown triggers and menus must use stable widths in filter rows and dashboard panels. Selected text and options truncate with a tooltip/title instead of resizing the control.
- Long selected values must never push adjacent dropdowns, buttons, or status controls underneath each other. Use fixed widths such as compact status selects, medium preset selects, and wider entity selects rather than content-driven sizing.
- Dropdown menus should align to the trigger width unless a deliberately wider searchable picker is being used; menus must not bleed into neighboring controls.

## Cohort Detail Pattern

- The breadcrumb must read like a product path: `Mission Control / Cohorts / {Cohort title}`. Never expose raw cohort IDs in the visible path.
- Cohort status is operational, not manually decorative: `Draft` while readiness is incomplete, `Published` when systems are ready before delivery, `Active` from first session start through final session end, `Completed` after the final session, and `Cancelled` only as a manual override.
- Cohort detail uses a focused tab set: `Overview`, `Registrations`, `Participants`, `Communications`, and `Distribution`. Do not reintroduce separate Basics, Operations, Payments, or Activity tabs into the primary workflow.
- Overview is the command surface. It should contain compact icon metric tiles, the priority revenue snapshot, cohort basics, thumbnail editing, publish readiness, session defaults, sessions checklist, and materials.
- Operations is a readiness concept, not a standalone page. Publish readiness must show the blocking items that keep a cohort in Draft plus compact actions to prepare calendar invites, create required session emails, add materials/tasks, and publish when ready.
- Publish blockers are system-readiness items only: sessions exist, calendar invites are ready, required session communications are created/scheduled, and open session-readiness tasks are cleared. Registration, roster, payment, and document follow-ups remain operational work but must not block a cohort from becoming Published.
- The revenue snapshot must be compact and premium. Total revenue, paid amount, pending amount, open amount, collected percentage, and project return context belong together in one polished finance card with a lightweight progress/ring visual, not a bulky table or oversized chart.
- Registration evolution charts should be quiet and lightweight. They need metric filters (`Registrants`, `Revenue`) and an optional comparison cohort, defaulting to the current cohort only.
- Sessions should render as a checklist, not a wide status spreadsheet. Use green check/red X affordances for reminder/template readiness and keep per-session actions in a row menu.
- Repeated session defaults such as meeting URL, location, and timezone should live in a small defaults card above the checklist.
- Registrations should remove unclear primary-table columns such as `Docs`; supporting document status belongs in quick view/edit.
- Participants should prioritize contact, organization, status, send-message action, bulk status/message controls, and a quick-view drawer with contact, payment, email activity, and participation history matched by email.
- Distribution is the cohort finance home. It should combine incoming payments, outgoing TL payouts, project return, pending payout, invoice drafts, and payment detail access in one ledger-style experience.

## Badges / Status Pills

Use rounded-full badges with small text and clear color meaning.

Examples:

- Paid: success.
- Invoiced: blue.
- PO Outstanding: warning.
- Overdue: danger.
- Draft: slate.
- Published: success.
- Pending: orange/warning.

Status rules:

- Never show raw all-caps enum strings in user-facing UI.
- Use approved token backgrounds and text colors.
- Keep badges compact enough to fit rows without clipping.
- Select menus, filters, table cells, dashboard panels, modals, and snackbars all use the same human status labels.

## Navigation

Navigation should feel branded:

- Use a dark navy sidebar or top nav foundation.
- Active item should use blue/cyan highlight.
- Avoid plain gray-only navigation.
- Icons should be consistent size.
- Active state must be obvious.
- Sidebar labels and icons must always be readable on navy. Explicitly set child text/icon colors; do not rely on inherited component color alone.
- The RocketPD/Mission Control brand block should feel intentional and not like placeholder text.
- Global view controls live in the top bar: Standard/Compact density and normal/night mode. These controls apply across admin pages, not only the dashboard.
- Night mode must be a complete dark palette: app background, sidebar, top bar, cards, tables, modals, filters, inputs, menus, and row hovers all move dark while preserving readable contrast.
- Compact mode should reduce spacing and control height by roughly 25-35% without shrinking text into illegibility or breaking row/action hit targets.

## Text And Formatting

- Display names, POCs, presenters, and organizations in proper case.
- Any table, card, modal, filter menu, or autocomplete that displays a person or organization must use the shared proper-case display helper.
- Display enum/status values as human labels, for example `Pending`, `Complete`, and `Partially Paid`, never raw all-caps enum strings.
- Do not transform emails, URLs, IDs, or external references.
- Labels should be human-readable: “POC email”, “Organization name”, “Payment status”.
- Avoid unfinished helper chips unless they are actionable or communicate a state.

## Jotform Intake

- The review queue should be an expandable row list, not cards or wide grids.
- The mapping wizard should use the Review Exceptions pattern: auto-map confident fields, show confirmed mappings read-only, and ask admins only for missing or ambiguous fields.
- Keep full manual mapping inside a collapsed Advanced field mapping accordion.
- Incoming Jotform fields should display as a rounded field-name pill next to the response value.
- Raw payloads should not appear in the admin UI. If developers need payloads, use API/database inspection.
- Filter noisy Jotform internals such as raw request payloads, execution trackers, and JSON payment summaries out of normal admin mapping choices.
- Deduplicate repeated Jotform fields when label and value are equivalent; prefer human-readable pretty labels over raw q-number keys.
- Shared Jotform forms may route by landing page URL rules, `cohortSlug`, or default cohort. The UI should make the routing mode obvious.

## Dashboard

- Dashboard is the command center. It should answer three questions in the first viewport: what is healthy, what needs attention, and what is coming next.
- Start with a strong operational hero/status band, not a generic page header followed by equal-weight cards. The hero may summarize active cohorts, upcoming sessions, pending payments, and open tasks using existing dashboard data.
- KPI cards must be compact, stable, and scannable. On wide desktop dashboard pages, it is acceptable to keep the full snapshot set in one row when each card remains readable; wrap down to 4/2/1 before the row becomes cramped.
- Distinguish snapshots from work queues. Snapshot cards show one focused number/chart and a short helper line. Work queues use structured rows with reserved zones for date/icon, content, status, and action.
- Prioritize cohort readiness/open operations above secondary activity. Group operations tasks by cohort and open details in a modal.
- Cohort readiness detail modals should show the actual action items with organization, POC, due date/status, and a direct send action when a pre-made communication template exists.
- Sort cohort readiness by nearest upcoming session before open-task count.
- Emphasize upcoming session dates and times visually, and render sessions as an agenda by default. Avoid mode toggles unless both modes are equally polished and useful.
- Use lightweight inline charts for snapshots when they help scanning; donut charts are preferred for payment status summaries and should show both amount/count and percentage context.
- Dashboard date filters control the snapshot layer only: hero counts, KPI snippets, and revenue/payment snapshots. Readiness queues, agenda rows, and recent work panels remain current so operational work does not disappear when a date range is selected.
- Dashboard date presets should persist locally in the browser when the preference is only about the current workstation. Custom date inputs use inclusive visible dates while API requests use inclusive start and exclusive end timestamps.
- Dashboard panel content must never overflow the card. Clamp long titles, truncate long pills with a tooltip where available, and keep row actions/statuses in fixed-width areas.
- Dashboard panels in the same row should use equal height where practical. Priority and agenda panels should be at least four-row panels with independent vertical scrolling so the page itself stays calm.
- Quick actions belong in a sticky dashboard toolbar at the top of the content area. Standard/Compact density controls and normal/night mode icon toggles belong in the global top bar so every admin page follows the same view state.
- Use cohort thumbnail imagery as subtle right-side row artwork for cohort, agenda, and registration rows when `thumbnailUrl` is available. The image must fade into the row background and never reduce text contrast.
- Avoid duplicate operational panels. Do not show a generic audit trail or separate "cohorts needing attention" panel on the dashboard when Cohort readiness already covers the action path.

## Cohort Imagery

- Cohorts should support a thumbnail image because dashboard rows, agenda rows, registration rows, and cohort lists can use that image as lightweight visual identity.
- The cohort create/edit flow should expose thumbnail URL plus upload/preview behavior where storage supports it.
- Thumbnail imagery should be decorative in list rows: right-side faded background or compact thumbnail, never required to understand the row.
- If no thumbnail exists, layouts must remain stable and readable.

## Source And UTM Display

- Registration source should use structured UTM fields when present.
- Show a compact source pill in tables, then expose full UTM/source/referrer detail inside registration detail modals.
- Do not display raw `jotform` as the primary source label when a campaign, source, or landing page is available.

## Acceptance Criteria For UI Work

After updating this guide, UI implementation work should also:

1. Identify the shared Button system and update it to match this guide if needed.
2. Identify pages with overlapping or cramped action buttons.
3. Refactor those layouts using flex-wrap and gap rules.
4. Replace inconsistent button styles with documented variants.
5. Apply the system broadly to main admin screens, not only one or two isolated areas.
6. Run `pnpm typecheck`, `pnpm build`, and `pnpm qa:prepush` before pushing.

Visual QA must verify:

- Sidebar labels are readable in active, inactive, hover, and selected states.
- No raw all-caps statuses appear on Cohorts, Registrations, Participants, Settings, Reports, or Communications.
- Registration rows do not clip roster, payment, source, or action controls.
- Table action controls use compact menus and never overlap row text.
- Names and organizations display in proper case everywhere user-facing.
- Primary workflows avoid horizontal scrolling on a desktop viewport.
- Playwright should cover the public login shell on every run and authenticated admin layouts when `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` or `E2E_STORAGE_STATE` are available.
- For local visual audits, prefer a saved Playwright storage state in `playwright/.auth/admin.json`; it avoids sharing admin passwords and keeps the audit repeatable.
- Playwright UI checks should assert no horizontal page overflow, no native browser selects, stable section/filter/table surfaces, compact/night mode readability, app-styled dropdown menus, and cohort detail checklist/drawer behavior.
- `pnpm test:e2e:audit` should collect all route findings into the Playwright report before failing so UI cleanup can be batched by route and severity.

Do not invent a totally new design system. Use this RocketPD-inspired admin system consistently.
