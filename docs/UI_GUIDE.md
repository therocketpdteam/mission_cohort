# Mission Control UI Guide

Mission Control is an internal operations console. Screens should feel compact, clear, and easy to scan. Avoid marketing-style layouts, decorative cards, and raw technical payloads in admin workflows.

## Layout

- Use the RocketPD-inspired Modern SaaS Ops direction: dark navy headings, white/off-white operational surfaces, teal primary actions, and gold secondary accents.
- Prefer tabs or focused sections when a page contains unrelated admin areas.
- Use cards for repeated objects only when the card adds clarity; prefer compact rows for operational queues.
- Keep default views condensed. Expanded detail should be optional and collapsible.
- Avoid horizontal scrolling in normal desktop workflows. Use wrapping, truncation, row expansion, or detail drawers instead.
- Keep tables and rows dense enough for repeated daily operations.
- Primary grids should show only decision-making fields; put secondary details in modals or drawers.

## Controls

- Use compact buttons in rows and tables: `size="small"`.
- Button groups inside rows should fit the row height and never clip.
- Prefer a compact `...` row action menu when three or more actions appear in one row.
- Use icons only when they clarify action intent.
- Use dropdowns for mapping/selection tasks. Do not ask admins to inspect JSON to make decisions.
- Put troubleshooting-only tools in Advanced sections.

## Text And Formatting

- Display names, POCs, and organizations in proper case.
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

## Dashboard

- Dashboard should prioritize cohort readiness over raw task lists.
- Group operations tasks by cohort and open details in a modal.
- Sort cohort readiness by nearest upcoming session before open-task count.
- Emphasize upcoming session dates and times visually.
- Use lightweight inline charts for snapshots when they help scanning; donut charts are preferred for payment status summaries.
- Primary dashboard rows must reserve separate space for content, status, and actions so text never overlaps buttons.

## Source And UTM Display

- Registration source should use structured UTM fields when present.
- Show a compact source pill in tables, then expose full UTM/source/referrer detail inside registration detail modals.
- Do not display raw `jotform` as the primary source label when a campaign, source, or landing page is available.
