# Replit UI parity audit

Reference: `https://mission-cohort-tool--grossogerardo.replit.app/`

Captured at 1440 x 1000 on October 12, 2026. The reference uses sample data; Mission Cohort must preserve its real data, permissions, safety controls, and operational actions while matching the reference information hierarchy and presentation.

## Shared shell

- 236px dark operations sidebar with compact brand mark, environment strip, section label, eight navigation rows, and a quiet two-line footer.
- 62px white top bar with breadcrumb, global search, density control, theme button, and user avatar.
- Content uses a pale gray workspace, 30px desktop gutters, 7px radii, one-pixel blue-gray borders, no decorative shadows, and compact type.
- Page headers use a small uppercase context line, literal page title, one sentence description, and one primary action.
- Tables place search and filters inside the table frame and use restrained status chips.

## Dashboard

- Five equal summary metrics.
- Two-column registration activity and revenue row.
- Two-column recent registrations and upcoming agenda row.
- Compact operational tasks panel followed by a full-width system health strip.
- No decorative cards, oversized headings, or exposed dashboard filter panel.

## Cohorts

- Three lifecycle sections: Current cohorts, Ended with outstanding balances, and Completed cohorts.
- Compact rows include portrait, short name, presenter, dates, sessions, registrations, participants, paid percentage, revenue, status, and Open action.
- Chevron expands a three-cell summary for open balance, roster readiness, and upcoming session.

## Registrations

- Search, payment, roster, and sort controls live in the table toolbar.
- Primary contact is a two-line cell with email; operational status is conveyed with small chips.
- Row actions are icon controls; pagination is part of the table footer.
- Preserve Mission Cohort bulk operations and the full registration detail drawer.

## Participants

- One roster table with an embedded search row and count.
- Participant name/title is a two-line cell; delivery state is visible without opening the record.
- Registration and edit controls remain directly available per row.

## Payments

- Four compact finance metrics before the payment table.
- Search and status filter are embedded in the table frame.
- Invoice/contact uses a two-line cell; balance is emphasized; Open and download actions remain explicit.

## Communications

- Three delivery metrics only: sent, scheduled, and needs attention.
- One communication history table with subject, cohort, audience, date, recipients, status, and Preview/Retry actions.
- Mission Cohort's Issues and Templates workflows remain available as tabs, but should inherit this visual hierarchy.

## Reports

- Six compact operational metrics in a two-row grid.
- Registration evolution chart and cohort performance table share a two-column row.
- Existing report builder remains available below this overview because it is a production capability absent from the prototype.

## Settings

- Appearance and environment/runtime state are concise panels.
- Operational configuration remains tabbed because Mission Cohort contains real integrations, users, presenters, and intake controls absent from the prototype.
- Safety and outbound-lock information must not be hidden to achieve visual parity.

## Detail surfaces

- Cohort detail and registration detail were not linked from the reference navigation inventory and require separate interaction captures.
- Their implementation should use the same compact panel headers, embedded controls, status chips, and spacing tokens established above.

