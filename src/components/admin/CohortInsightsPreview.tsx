"use client";
import { type AdminRow } from "./common";
const money = (value: unknown) => `$${Number(value ?? 0).toLocaleString()}`;
export function MarketingAttributionSummary({ summary }: { summary: AdminRow }) {
  return <section className="report-attribution-summary">
    <h2>Marketing attribution</h2>
    <p>{summary.coverage?.tagged ?? 0} of {summary.totals?.registrations ?? 0} registrations have a captured marketing signal; {summary.coverage?.assigned ?? 0} match an ownership rule. {summary.coverage?.missing ?? 0} have no marketing source captured.</p>
    <div className="registration-report-summary-grid">{(summary.owners ?? []).map((owner: AdminRow) => <div className="registration-report-tile" key={owner.owner}><span>{owner.label}</span><strong>{owner.percentage}%</strong><small>{owner.registrations} registrations · {owner.seats} seats · {money(owner.amount)}</small></div>)}</div>
    <div className="registration-report-table-wrap"><table className="registration-report-table"><thead><tr><th>Source</th><th>Medium</th><th>Campaign</th><th>Credit</th><th>Registrations</th><th>Share of all</th><th>Seats</th><th>Evidence</th></tr></thead><tbody>{(summary.sources ?? []).map((row: AdminRow, index: number) => <tr key={index}><td>{row.source || "Unknown"}</td><td>{row.medium || "Unknown"}</td><td>{row.campaign || "Unknown"}</td><td>{row.ownerLabel}</td><td>{row.registrations}</td><td>{row.percentage}%</td><td>{row.seats}</td><td>{row.basis}</td></tr>)}{!summary.sources?.length && <tr><td colSpan={8}>No reportable registrations in this scope.</td></tr>}</tbody></table></div>
    <p className="report-methodology">{summary.methodology}</p>
    {!!summary.coverage?.conflicts && <p>{summary.coverage.conflicts} registrations match conflicting rules and remain unassigned. Review attribution rules to resolve them.</p>}
  </section>;
}
export function CohortInsightsPreview({ report, mode }: { report: AdminRow; mode: string }) {
  return <article className="registration-report-print"><header className="registration-report-print-header"><div><p>Mission Cohort Report</p><h1>{mode === "states" ? "State breakdown" : "Marketing attribution"}</h1><span>{report.scope?.label} · Cohort start years {(report.years ?? []).map((year: AdminRow) => year.year).join(", ")}</span></div></header>
    <p>Active registrations only. Cancelled, refunded, and archived registrations are excluded. Years refer to when the cohort starts.</p>
    {mode === "states" ? (report.years ?? []).map((year: AdminRow) => <section key={year.year} className="report-insight-year"><h2>{year.year} · {year.totals?.registrations ?? 0} registrations · {year.totals?.seats ?? 0} seats</h2><p>{year.totals?.missingStateRegistrations ?? 0} registrations have no state. Ranked by registrations; percentages include those with a missing state.</p><div className="registration-report-table-wrap"><table className="registration-report-table"><thead><tr><th>Rank</th><th>State</th><th>Registrations</th><th>Share of all</th><th>Seats</th><th>Amount</th></tr></thead><tbody>{(year.states ?? []).map((row: AdminRow, index: number) => <tr key={row.state}><td>{index + 1}</td><td>{row.state}</td><td>{row.registrations}</td><td>{row.percentage}%</td><td>{row.seats}</td><td>{money(row.amount)}</td></tr>)}{!year.states?.length && <tr><td colSpan={6}>No state data for this scope and year.</td></tr>}</tbody></table></div></section>) : <><MarketingAttributionSummary summary={report.marketingAttribution ?? {}} />{(report.years ?? []).map((year: AdminRow) => <details className="report-insight-year" key={year.year}><summary>{year.year} · {year.totals?.registrations ?? 0} registrations</summary><MarketingAttributionSummary summary={year.marketingAttribution ?? {}} /></details>)}</>}
  </article>;
}
