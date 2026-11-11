"use client";

import { useState, type ReactNode } from "react";
import { ExpandMoreOutlined, WarningAmberOutlined } from "@/components/ui/icons";

export function CollapsibleSectionCard({ title, children, action, defaultOpen = false, alertCount = 0, compact = false }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  alertCount?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={`section-card collapsible-section-card ${alertCount ? "has-alert" : ""} ${compact ? "is-compact-card" : ""}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="collapsible-section-summary">
        <div className="collapsible-section-title">
          <h2 className="section-card-title">{title}</h2>
          {alertCount > 0 ? <span className="collapsible-section-alert" aria-label={`${alertCount} ${alertCount === 1 ? "item needs" : "items need"} attention`}><WarningAmberOutlined fontSize="small" aria-hidden="true" />{alertCount}</span> : null}
        </div>
        <div className="collapsible-section-actions" onClick={event => event.stopPropagation()}>
          {action}
          <span className="collapsible-section-caret" aria-hidden="true"><ExpandMoreOutlined fontSize="small" /></span>
        </div>
      </summary>
      <div className="collapsible-section-content">{children}</div>
    </details>
  );
}
