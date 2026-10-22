"use client";

import { useState, type PointerEvent } from "react";
import type { RegistrationActivity } from "@/lib/registrationActivity";
import { registrationLinePoints } from "@/lib/dashboardPresentation";

const weekDate = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));

export function RegistrationActivityChart({ activity }: { activity: RegistrationActivity }) {
  const [active, setActive] = useState<number | null>(null);
  const points = registrationLinePoints(activity.buckets.map((bucket) => bucket.count));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const selected = active === null ? null : activity.buckets[active];
  const previous = active && active > 0 ? activity.buckets[active - 1] : null;
  const change = selected && previous ? selected.count - previous.count : null;
  function hover(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width) * 100;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round((x - 5) / 90 * (points.length - 1)))));
  }
  return (
    <>
      <div className="registration-line-plot" onPointerDown={hover} onPointerMove={hover} onPointerLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) setActive(null); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setActive(null); }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {[20, 55, 90].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="registration-line-grid" />)}
          <path d={`${path} L95,90 L5,90 Z`} className="registration-line-area" />
          <path d={path} className="registration-line-path" vectorEffect="non-scaling-stroke" />
          {active !== null && <line x1={points[active].x} x2={points[active].x} y1="10" y2="95" className="registration-line-guide" />}
        </svg>
        <div role="list" aria-label="New registrations by week for the last 10 weeks, Eastern time">
          {activity.buckets.map((bucket, index) => (
            <div role="listitem" key={bucket.weekStart}>
              <button type="button" className={`registration-line-point${active === index ? " is-active" : ""}`} style={{ left: `${points[index].x}%`, top: `${points[index].y}%` }}
                aria-label={`Week of ${bucket.label}: ${bucket.count} registration${bucket.count === 1 ? "" : "s"}${bucket.currentWeek ? " (current week, in progress)" : ""}`}
                aria-describedby={active === index ? "registration-week-tooltip" : undefined}
                onFocus={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) return;
                  event.preventDefault();
                  if (event.key === "Escape") { setActive(null); return; }
                  const next = Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
                  event.currentTarget.closest(".registration-line-plot")?.querySelectorAll<HTMLButtonElement>(".registration-line-point")[next]?.focus();
                }} />
            </div>
          ))}
        </div>
        {selected && active !== null && (
          <div role="tooltip" id="registration-week-tooltip" className="registration-line-tooltip" style={{ left: `clamp(8px, calc(${points[active].x}% - 100px), calc(100% - 208px))` }}>
            <strong>{weekDate(selected.weekStart)} – {weekDate(selected.weekEnd)}</strong>
            <span>{selected.count} new registration{selected.count === 1 ? "" : "s"}</span>
            {change !== null && <small>{change > 0 ? "+" : ""}{change} compared with the previous week</small>}
            <small>{selected.currentWeek ? "Current week · still in progress" : "Completed week"} · Eastern time</small>
          </div>
        )}
      </div>
      <div className="registration-line-week-labels" aria-hidden="true">{activity.buckets.map((bucket) => <small key={bucket.weekStart}>{bucket.label}</small>)}</div>
      <div className="dashboard-chart-legend"><i /><strong>{activity.total} registration{activity.total === 1 ? "" : "s"}</strong><span>Hover, tap, or focus a point for weekly details</span></div>
      {activity.total === 0 && <p className="dashboard-chart-empty">No registrations in this period.</p>}
    </>
  );
}
