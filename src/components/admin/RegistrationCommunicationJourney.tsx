"use client";

import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { AdminRow, DateBadge, EmptyState, StatusChip } from "./common";

type JourneyGroupKey = "needs_attention" | "scheduled" | "sent" | "skipped" | "planned";

const journeyGroups: Array<{ key: JourneyGroupKey; title: string; description: string }> = [
  { key: "needs_attention", title: "Needs attention", description: "Failed, bounced, or blocked messages." },
  { key: "scheduled", title: "Scheduled", description: "Messages queued for future delivery." },
  { key: "sent", title: "Sent", description: "Messages that already went out." },
  { key: "skipped", title: "Skipped", description: "Milestones intentionally not sent." },
  { key: "planned", title: "Planned", description: "Draft or pending journey records." }
];

function deliverySummary(communication: AdminRow) {
  const events = ((communication.emailEvents ?? []) as AdminRow[]).map((event) => String(event.eventType ?? "").toUpperCase());
  const opened = events.filter((event) => event === "OPENED").length;
  const clicked = events.filter((event) => event === "CLICKED").length;
  const delivered = events.includes("DELIVERED");
  const failed = events.find((event) => event === "FAILED" || event === "BOUNCED");
  const attachments = Number(communication.attachments?.length ?? 0);

  return [
    failed ? formatStatusLabel(failed) : "",
    delivered ? "Delivered" : "",
    opened ? `${opened} open${opened === 1 ? "" : "s"}` : "",
    clicked ? `${clicked} click${clicked === 1 ? "" : "s"}` : "",
    attachments ? `${attachments} attachment${attachments === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
}

function journeyGroupFor(communication: AdminRow): JourneyGroupKey {
  const status = String(communication.status ?? "").toUpperCase();
  const hasIssue = Boolean(communication.providerError) || ((communication.emailEvents ?? []) as AdminRow[]).some((event) => {
    const eventType = String(event.eventType ?? "").toUpperCase();
    return eventType === "FAILED" || eventType === "BOUNCED";
  });

  if (hasIssue || status === "FAILED") return "needs_attention";
  if (status === "SCHEDULED" || status === "SENDING") return "scheduled";
  if (status === "SENT") return "sent";
  if (status === "SKIPPED" || status === "CANCELLED") return "skipped";
  return "planned";
}

function recipientContext(communication: AdminRow, fallbackEmail?: string | null) {
  if (communication.participant) {
    const name = formatProperDisplay(`${communication.participant.firstName ?? ""} ${communication.participant.lastName ?? ""}`.trim());
    return {
      type: "Participant",
      label: [name, communication.participant.email].filter(Boolean).join(" · ")
    };
  }

  const recipients = Array.isArray(communication.recipientEmails) ? communication.recipientEmails.filter(Boolean) : [];
  const fallback = fallbackEmail ? [fallbackEmail] : [];
  const emails = recipients.length ? recipients : fallback;
  const scope = String(communication.recipientScope ?? "").toUpperCase();

  return {
    type: scope === "PARTICIPANTS" ? "Participant" : scope === "CUSTOM" ? "Custom" : "POC",
    label: emails.join(", ") || "Recipient not assigned"
  };
}

function timingFor(communication: AdminRow) {
  return communication.sentAt ?? communication.scheduledFor ?? communication.createdAt ?? null;
}

export function RegistrationCommunicationJourney({
  communications,
  pocEmail
}: {
  communications?: AdminRow[] | null;
  pocEmail?: string | null;
}) {
  const rows = (communications ?? []) as AdminRow[];

  if (rows.length === 0) {
    return <EmptyState title="No communication journey yet" description="Scheduled, sent, skipped, and failed registration emails will appear here once this registration has a communication plan." />;
  }

  const grouped = rows.reduce<Record<JourneyGroupKey, AdminRow[]>>((acc, communication) => {
    acc[journeyGroupFor(communication)].push(communication);
    return acc;
  }, {
    needs_attention: [],
    scheduled: [],
    sent: [],
    skipped: [],
    planned: []
  });

  const scheduledCount = grouped.scheduled.length;
  const sentCount = grouped.sent.length;
  const issueCount = grouped.needs_attention.length;
  const skippedCount = grouped.skipped.length;

  return (
    <div className="registration-journey">
      <div className="registration-journey-summary" aria-label="Registration communication journey summary">
        <div className="registration-journey-stat">
          <span>Scheduled</span>
          <strong>{scheduledCount}</strong>
        </div>
        <div className="registration-journey-stat">
          <span>Sent</span>
          <strong>{sentCount}</strong>
        </div>
        <div className={`registration-journey-stat ${issueCount ? "is-alert" : ""}`}>
          <span>Needs attention</span>
          <strong>{issueCount}</strong>
        </div>
        <div className="registration-journey-stat">
          <span>Skipped</span>
          <strong>{skippedCount}</strong>
        </div>
      </div>

      <div className="registration-journey-groups">
        {journeyGroups.map((group) => {
          const groupRows = grouped[group.key];
          if (groupRows.length === 0) return null;

          return (
            <section className={`registration-journey-group is-${group.key}`} key={group.key}>
              <div className="registration-journey-group-header">
                <div>
                  <h4>{group.title}</h4>
                  <p>{group.description}</p>
                </div>
                <span>{groupRows.length}</span>
              </div>
              <div className="registration-journey-group-rows">
                {groupRows.map((communication) => {
                  const recipient = recipientContext(communication, pocEmail);
                  const chips = deliverySummary(communication);
                  const title = communication.template?.name ?? communication.subject ?? "Registration message";

                  return (
                    <div className="registration-journey-row" key={communication.id}>
                      <div className="registration-journey-main">
                        <strong title={title}>{title}</strong>
                        <span title={recipient.label}>{recipient.label}</span>
                        {communication.providerError ? <em title={communication.providerError}>{communication.providerError}</em> : null}
                      </div>
                      <div className="registration-journey-meta">
                        <span className="registration-recipient-pill">{recipient.type}</span>
                        <StatusChip value={communication.status ?? group.title} />
                        <DateBadge value={timingFor(communication)} />
                      </div>
                      {chips.length ? (
                        <div className="registration-journey-chips">
                          {chips.map((chip) => <span key={chip}>{chip}</span>)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
