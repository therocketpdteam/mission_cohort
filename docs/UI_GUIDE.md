# Mission Control UI Guide

Mission Control is an internal operations console. Screens should feel compact, clear, and easy to scan. Avoid marketing-style layouts, decorative cards, and raw technical payloads in admin workflows.

## Layout

- Prefer tabs or focused sections when a page contains unrelated admin areas.
- Use cards for repeated objects only when the card adds clarity; prefer compact rows for operational queues.
- Keep default views condensed. Expanded detail should be optional and collapsible.
- Avoid horizontal scrolling in normal desktop workflows. Use wrapping, truncation, row expansion, or detail drawers instead.
- Keep tables and rows dense enough for repeated daily operations.

## Controls

- Use compact buttons in rows and tables: `size="small"`.
- Button groups inside rows should fit the row height and never clip.
- Use icons only when they clarify action intent.
- Use dropdowns for mapping/selection tasks. Do not ask admins to inspect JSON to make decisions.
- Put troubleshooting-only tools in Advanced sections.

## Text And Formatting

- Display names, POCs, and organizations in proper case.
- Do not transform emails, URLs, IDs, or external references.
- Labels should be human-readable: “POC email”, “Organization name”, “Payment status”.
- Avoid unfinished helper chips unless they are actionable or communicate a state.

## Jotform Intake

- The review queue should be an expandable row list, not cards or wide grids.
- The mapping wizard must show incoming fields as dropdown options with sample values.
- Raw payloads should not appear in the admin UI. If developers need payloads, use API/database inspection.
