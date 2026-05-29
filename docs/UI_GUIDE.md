# Mission Control UI Guide

This file is the source of truth for Mission Control UI work. Read it before changing any page, component, theme token, table, form, modal, or workflow surface.

Mission Control is an internal RocketPD operations console. It should feel like RocketPD: clean, modern, education-forward, confident, warm, and professional. It is not a generic SaaS dashboard and it is not a marketing landing page. It must stay dense enough for daily operations while carrying the RocketPD visual language through color, spacing, typography, button hierarchy, and page structure.

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
- Operational, confident, and easy to scan.

Avoid:

- Generic gray SaaS look.
- Too many competing blues.
- Flat default buttons.
- Cramped cards.
- Overlapping CTAs.
- Inconsistent button sizes.
- Tiny secondary actions floating beside large primary actions.
- Raw JSON, all-caps enums, or developer-first labels in normal admin flows.

## Color Palette / Design Tokens

Use these tokens throughout the app.

Primary Navy:

- `--color-primary-900: #071D33`
- `--color-primary-800: #0B2A45`
- `--color-primary-700: #123C5A`

Rocket Blue:

- `--color-blue-600: #1479C9`
- `--color-blue-500: #1E9BDE`
- `--color-blue-100: #E8F5FC`

Cyan Accent:

- `--color-cyan-500: #20C7D9`
- `--color-cyan-100: #E6FAFC`

Warm Highlight:

- `--color-orange-500: #F59E0B`
- `--color-orange-100: #FFF3D6`

Success:

- `--color-success-600: #16A34A`
- `--color-success-100: #DCFCE7`

Warning:

- `--color-warning-600: #D97706`
- `--color-warning-100: #FEF3C7`

Danger:

- `--color-danger-600: #DC2626`
- `--color-danger-100: #FEE2E2`

Neutral:

- `--color-white: #FFFFFF`
- `--color-slate-50: #F8FAFC`
- `--color-slate-100: #F1F5F9`
- `--color-slate-200: #E2E8F0`
- `--color-slate-500: #64748B`
- `--color-slate-700: #334155`
- `--color-slate-900: #0F172A`

Background rules:

- Main app background: `#F8FAFC`.
- Main cards: `#FFFFFF`.
- Important header/hero areas: navy gradient from `#071D33` to `#123C5A`.
- Primary CTAs: Rocket Blue.
- Accent highlights: Cyan or Orange, but never both competing in the same component unless one is very subtle.
- Use navy for confidence and hierarchy, blue for action, cyan for light operational emphasis, orange for attention or warm highlights.

## Typography

- Use a clean system/inter-style font stack: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Headings should be dark navy and confident.
- Body text should remain readable, compact, and calm.
- Avoid oversized marketing-style type inside operational tools.
- Preserve `letter-spacing: 0`; do not use negative tracking.
- Use smaller, tighter headings inside cards, tables, dialogs, and dashboards.

## Button System

Use the shared Mission Control button system as the source for these variants.

Primary Button:

- Background: `#1479C9`.
- Text: white.
- Hover: `#0B67AD`.
- Border radius: `12px`.
- Height: `40px` minimum.
- Font weight: `600`.
- Use for the main action on a screen or modal only.

Secondary Button:

- Background: white.
- Text: `#123C5A`.
- Border: `1px solid #CBD5E1`.
- Hover background: `#F1F5F9`.
- Use for supporting actions.

Outline Button:

- Background: transparent or white.
- Text: `#1479C9`.
- Border: `1px solid #1479C9`.
- Hover background: `#E8F5FC`.
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

- Background: white.
- Border: `1px solid #E2E8F0`.
- Border radius: `16px`.
- Shadow: soft, subtle only.
- Padding: `20px` to `24px`.
- Use consistent internal spacing.

Important cards:

- May use a subtle top border or left accent border using Rocket Blue or Cyan.
- Avoid heavy gradients inside dense admin cards.

Dashboard stat cards:

- Use white background.
- Icon circle using `#E8F5FC` or `#E6FAFC`.
- Number in `#071D33`.
- Label in `#64748B`.
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
- Focus ring should use Rocket Blue.
- Error text should use danger red.
- Helper text should use slate-500.
- Form sections should be grouped in cards or clear fieldsets.
- Long forms should use section headings and spacing.
- Creation/edit wizards should reduce decisions where possible and use smart defaults.
- Dropdown options should be human-readable and show sample context when mapping external data.

## Tables and Lists

Rules:

- Table headers should be subtle, not heavy.
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
- Dashboard panel content must never overflow the card. Clamp long titles, truncate long pills with a tooltip where available, and keep row actions/statuses in fixed-width areas.
- Dashboard panels in the same row should use equal height where practical. Priority and agenda panels should be at least four-row panels with independent vertical scrolling so the page itself stays calm.
- Quick actions and view controls belong in a sticky dashboard toolbar at the top of the content area. The toolbar should expose Standard/Compact density controls and normal/night mode icon toggles.
- Use cohort thumbnail imagery as subtle right-side row artwork for cohort, agenda, and registration rows when `thumbnailUrl` is available. The image must fade into the row background and never reduce text contrast.
- Avoid duplicate operational panels. Do not show a generic audit trail or separate "cohorts needing attention" panel on the dashboard when Cohort readiness already covers the action path.

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

Do not invent a totally new design system. Use this RocketPD-inspired admin system consistently.
