"use client";

import { useMemo, useState } from "react";
import { WarningAmberOutlined } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { AdminRow, DateBadge, EmptyState, StatusChip, useNotifier } from "./common";

type JourneyGroupKey = "needs_attention" | "scheduled" | "sent" | "reviewed" | "skipped" | "planned";

type MessageGroup = {
  id: string;
  key: JourneyGroupKey;
  title: string;
  subject: string;
  rows: AdminRow[];
  recipients: string[];
  issueRecipients: string[];
  attachments: AdminRow[];
  timing: string | null;
  status: string;
  recipientTypes: string[];
  preview: string;
  containsMergeFields: boolean;
};

const journeyGroups: Array<{ key: JourneyGroupKey; title: string; description: string }> = [
  { key: "needs_attention", title: "Needs attention", description: "Failed, bounced, or blocked messages." },
  { key: "scheduled", title: "Scheduled", description: "Queued message groups. Expand to see recipients." },
  { key: "sent", title: "Sent", description: "Sent message groups. Expand to see who received them." },
  { key: "reviewed", title: "Reviewed", description: "Delivery issues that were checked and kept for history." },
  { key: "skipped", title: "Skipped", description: "Milestones intentionally not sent." },
  { key: "planned", title: "Planned", description: "Messages that will be scheduled once the journey is ready." }
];

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function emailsForCommunication(communication: AdminRow, fallbackEmail?: string | null) {
  const participantEmail = communication.participant?.email ? [String(communication.participant.email)] : [];
  const eventEmails = ((communication.emailEvents ?? []) as AdminRow[]).map((event) => event.recipientEmail as string | undefined);
  const recipients = Array.isArray(communication.recipientEmails)
    ? communication.recipientEmails.map((email) => typeof email === "string" ? email : "").filter(Boolean)
    : [];
  const fallback = fallbackEmail ? [fallbackEmail] : [];

  return uniqueStrings([...participantEmail, ...eventEmails, ...recipients, ...fallback]);
}

function participantDisplayName(participant?: AdminRow | null) {
  if (!participant) return "";
  return formatProperDisplay(`${participant.firstName ?? ""} ${participant.lastName ?? ""}`.trim());
}

function recipientContactCountFor(groups: MessageGroup[]) {
  return uniqueStrings(groups.flatMap((group) => group.recipients.map((email) => email.toLowerCase()))).length;
}

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

function payloadFor(communication: AdminRow) {
  const sentEvent = ((communication.emailEvents ?? []) as AdminRow[]).find((event) => {
    const payload = event.eventPayload as AdminRow | undefined;
    return payload?.renderedBodyText || payload?.renderedBodyHtml || payload?.renderedSubject;
  });

  return (sentEvent?.eventPayload ?? null) as AdminRow | null;
}

function plainPreview(communication: AdminRow) {
  const payload = payloadFor(communication);
  const text = String(payload?.renderedBodyText ?? communication.bodyText ?? "").trim();
  if (text) return text;

  return String(payload?.renderedBodyHtml ?? communication.bodyHtml ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function hasMergeFields(value: string) {
  return /{{\s*[^}]+\s*}}/.test(value);
}

function journeyGroupFor(communication: AdminRow): JourneyGroupKey {
  const status = String(communication.status ?? "").toUpperCase();
  const issueEvents = ((communication.emailEvents ?? []) as AdminRow[]).filter((event) => {
    const eventType = String(event.eventType ?? "").toUpperCase();
    return eventType === "FAILED" || eventType === "BOUNCED";
  });
  const unreviewedIssueEvents = issueEvents.filter((event) => !event.reviewedAt);

  if (unreviewedIssueEvents.length > 0 || status === "FAILED") return "needs_attention";
  if (issueEvents.length > 0) return "reviewed";
  if (status === "SCHEDULED" || status === "SENDING") return "scheduled";
  if (status === "SENT") return "sent";
  if (status === "SKIPPED" || status === "CANCELLED") return "skipped";
  return "planned";
}

function recipientContext(communication: AdminRow, fallbackEmail?: string | null) {
  const emails = emailsForCommunication(communication, fallbackEmail);

  if (communication.participant) {
    const name = participantDisplayName(communication.participant);
    const detailParts = uniqueStrings([
      emails.join(", "),
      communication.participant.title ? formatProperDisplay(String(communication.participant.title)) : "",
      formatStatusLabel(communication.participant.status)
    ]);

    return {
      type: "Participant",
      label: name || emails[0] || "Participant not assigned",
      detail: detailParts.join(" · ") || "No participant contact details recorded",
      emails
    };
  }

  const scope = String(communication.recipientScope ?? "").toUpperCase();
  const type = scope === "PARTICIPANTS" ? "Participant" : scope === "CUSTOM" ? "Custom" : "POC";

  return {
    type,
    label: emails[0] || "Recipient not assigned",
    detail: emails.length > 1 ? emails.slice(1).join(", ") : type,
    emails
  };
}

function timingFor(communication: AdminRow) {
  return communication.sentAt ?? communication.scheduledFor ?? communication.createdAt ?? null;
}

function minuteBucket(value: string | null) {
  if (!value) return "unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  date.setSeconds(0, 0);
  return date.toISOString();
}

function attachmentKey(attachment: AdminRow) {
  return String(attachment.id ?? attachment.fileKey ?? attachment.url ?? attachment.fileName ?? "attachment");
}

function messageGroupKey(communication: AdminRow, groupKey: JourneyGroupKey) {
  const title = communication.template?.name ?? communication.subject ?? "Registration message";
  return [
    groupKey,
    communication.templateId ?? communication.template?.id ?? title,
    communication.sessionId ?? "no-session",
    String(communication.recipientScope ?? ""),
    minuteBucket(timingFor(communication)),
    String(communication.status ?? "")
  ].join("|");
}

function aggregateMessages(rows: AdminRow[], pocEmail?: string | null) {
  const groups = new Map<string, MessageGroup>();

  for (const communication of rows) {
    const key = journeyGroupFor(communication);
    const recipient = recipientContext(communication, pocEmail);

    if (key === "sent" && recipient.type === "POC") {
      continue;
    }

    const groupId = messageGroupKey(communication, key);
    const title = communication.template?.name ?? communication.subject ?? "Registration message";
    const payload = payloadFor(communication);
    const subject = String(payload?.renderedSubject ?? communication.subject ?? title);
    const preview = plainPreview(communication);
    const issueEmails = ((communication.emailEvents ?? []) as AdminRow[])
      .filter((event) => {
        const eventType = String(event.eventType ?? "").toUpperCase();
        return (eventType === "FAILED" || eventType === "BOUNCED") && !event.reviewedAt;
      })
      .map((event) => event.recipientEmail as string | undefined);
    const attachments = (communication.attachments ?? []) as AdminRow[];
    const existing = groups.get(groupId);

    if (existing) {
      existing.rows.push(communication);
      existing.recipients = uniqueStrings([...existing.recipients, ...recipient.emails]);
      existing.issueRecipients = uniqueStrings([...existing.issueRecipients, ...issueEmails]);
      existing.recipientTypes = uniqueStrings([...existing.recipientTypes, recipient.type]);
      existing.attachments = Array.from(new Map([...existing.attachments, ...attachments].map((item) => [attachmentKey(item), item])).values());
      existing.containsMergeFields = existing.containsMergeFields || hasMergeFields(subject) || hasMergeFields(preview);
      if (!existing.preview && preview) existing.preview = preview;
    } else {
      groups.set(groupId, {
        id: groupId,
        key,
        title,
        subject,
        rows: [communication],
        recipients: recipient.emails,
        issueRecipients: uniqueStrings(issueEmails),
        attachments,
        timing: timingFor(communication),
        status: String(communication.status ?? key),
        recipientTypes: [recipient.type],
        preview,
        containsMergeFields: hasMergeFields(subject) || hasMergeFields(preview)
      });
    }
  }

  return [...groups.values()].sort((a, b) => new Date(b.timing ?? 0).getTime() - new Date(a.timing ?? 0).getTime());
}

export function RegistrationCommunicationJourney({
  communications,
  pocEmail,
  onChanged
}: {
  communications?: AdminRow[] | null;
  pocEmail?: string | null;
  onChanged?: () => Promise<void> | void;
}) {
  const { notifySuccess, notifyError } = useNotifier();
  const [busyId, setBusyId] = useState("");
  const messageGroups = useMemo(() => aggregateMessages((communications ?? []) as AdminRow[], pocEmail), [communications, pocEmail]);

  async function runAction(communication: AdminRow, action: "cancel" | "review", recipientEmail?: string) {
    setBusyId(`${communication.id}:${action}:${recipientEmail ?? "all"}`);

    try {
      if (action === "cancel") {
        await adminApi("/api/communications", { method: "PATCH", body: { id: communication.id, action: "cancel" } });
        notifySuccess("Scheduled communication cancelled.");
      } else if (recipientEmail) {
        const result = await adminApi<AdminRow>("/api/communications", {
          method: "PATCH",
          body: {
            action: "reviewRecipientIssue",
            communicationId: communication.id,
            recipientEmail,
            reviewNote: "Reviewed from registration communication journey."
          }
        });
        if (result?.migrationRequired) {
          notifyError(result.message ?? "Production migration is required before issues can be reviewed.");
          return;
        }
        notifySuccess("Issue marked reviewed.");
      }

      await onChanged?.();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setBusyId("");
    }
  }

  async function resendToRecipient(communication: AdminRow, recipientEmail: string) {
    setBusyId(`${communication.id}:resend:${recipientEmail}`);

    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendToRecipient", communicationId: communication.id, recipientEmail }
      });
      notifySuccess(`Message sent to ${recipientEmail}.`);
      await onChanged?.();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setBusyId("");
    }
  }

  if (messageGroups.length === 0) {
    return <EmptyState title="No communication journey yet" description="Scheduled, sent, skipped, and failed registration emails will appear here once this registration has a communication plan." />;
  }

  const grouped = messageGroups.reduce<Record<JourneyGroupKey, MessageGroup[]>>((acc, group) => {
    acc[group.key].push(group);
    return acc;
  }, {
    needs_attention: [],
    scheduled: [],
    sent: [],
    reviewed: [],
    skipped: [],
    planned: []
  });
  const counts = Object.fromEntries(journeyGroups.map((group) => [group.key, recipientContactCountFor(grouped[group.key])])) as Record<JourneyGroupKey, number>;
  const issueRecipientCount = uniqueStrings(grouped.needs_attention.flatMap((item) => (item.issueRecipients.length ? item.issueRecipients : item.recipients).map((email) => email.toLowerCase()))).length;
  const issueCount = issueRecipientCount || grouped.needs_attention.length;

  return (
    <div className="registration-journey">
      <div className="registration-journey-summary" aria-label="Registration communication journey summary">
        <div className="registration-journey-stat">
          <span>Scheduled contacts</span>
          <strong>{counts.scheduled}</strong>
        </div>
        <div className="registration-journey-stat">
          <span>Sent contacts</span>
          <strong>{counts.sent}</strong>
        </div>
        <div className="registration-journey-stat">
          <span>Reviewed</span>
          <strong>{counts.reviewed}</strong>
        </div>
        <div className={`registration-journey-stat ${issueCount ? "is-alert" : ""}`}>
          <span>Needs attention</span>
          <strong>{issueCount}</strong>
        </div>
        <div className="registration-journey-stat">
          <span>Planned</span>
          <strong>{counts.planned}</strong>
        </div>
      </div>

      <div className="registration-journey-groups">
        {journeyGroups.map((group) => {
          const groupRows = grouped[group.key];
          if (groupRows.length === 0) return null;
          const groupContactCount = recipientContactCountFor(groupRows);
          const hasIssues = groupRows.some((item) => item.issueRecipients.length > 0 || item.key === "needs_attention");

          return (
            <details className={`registration-journey-group is-${group.key}`} key={group.key}>
              <summary className="registration-journey-group-header">
                <div>
                  <h4>{hasIssues ? <WarningAmberOutlined fontSize="small" /> : null}<span>{group.title}</span></h4>
                  <p>{group.description}</p>
                </div>
                <span>{groupRows.length} message{groupRows.length === 1 ? "" : "s"} · {groupContactCount} contact{groupContactCount === 1 ? "" : "s"}</span>
              </summary>
              <div className="registration-journey-group-rows">
                {groupRows.map((message) => (
                  <details className={`registration-journey-message ${message.issueRecipients.length ? "is-alert" : ""}`} key={message.id}>
                    <summary className="registration-journey-row">
                      <div className="registration-journey-main">
                        <strong title={message.title}>{message.title}</strong>
                        <span title={message.subject}>{message.subject}</span>
                        {message.containsMergeFields ? <em>Stored copy still contains merge fields</em> : null}
                      </div>
                      <div className="registration-journey-meta">
                        <span className="registration-recipient-pill">{message.recipientTypes.join(" + ")}</span>
                        <span className="registration-recipient-pill">{message.recipients.length} contact{message.recipients.length === 1 ? "" : "s"}</span>
                        <StatusChip value={message.status} />
                        <DateBadge value={message.timing} />
                      </div>
                      <div className="registration-journey-chips">
                        {uniqueStrings(message.rows.flatMap(deliverySummary)).map((chip) => <span key={chip}>{chip}</span>)}
                        {message.attachments.length ? <span>{message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}</span> : null}
                        {message.issueRecipients.length ? <span className="is-alert-chip">{message.issueRecipients.length} issue contact{message.issueRecipients.length === 1 ? "" : "s"}</span> : null}
                      </div>
                    </summary>
                    <div className="registration-journey-detail">
                      <div className="registration-journey-preview">
                        <strong>Email body</strong>
                        <p>{message.preview || "No message body has been saved for this communication yet."}</p>
                      </div>
                      {message.attachments.length ? (
                        <div className="registration-journey-attachments">
                          <strong>Attachments</strong>
                          {message.attachments.map((attachment) => (
                            <span key={attachmentKey(attachment)}>
                              {attachment.url ? <a href={String(attachment.url)} target="_blank" rel="noreferrer">{attachment.fileName ?? "Attachment"}</a> : attachment.fileName ?? "Attachment"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="registration-recipient-list">
                        {message.rows.map((communication) => {
                          const recipient = recipientContext(communication, pocEmail);
                          const groupKey = journeyGroupFor(communication);
                          const firstRecipient = recipient.emails[0] ?? "";
                          const canResend = Boolean(firstRecipient) && ["needs_attention", "sent"].includes(groupKey);
                          const canCancel = ["DRAFT", "SCHEDULED", "FAILED"].includes(String(communication.status ?? "").toUpperCase()) && !communication.sentAt;
                          const canReview = groupKey === "needs_attention" && Boolean(firstRecipient);
                          const openHref = firstRecipient
                            ? `/communications?search=${encodeURIComponent(firstRecipient)}`
                            : `/communications?search=${encodeURIComponent(message.title)}`;

                          return (
                            <div className="registration-recipient-row" key={communication.id}>
                              <div>
                                <strong title={recipient.label}>{recipient.label}</strong>
                                <span title={[recipient.detail, communication.providerError].filter(Boolean).join(" · ") || undefined}>
                                  {[recipient.detail, communication.providerError].filter(Boolean).join(" · ") || "No recipient details recorded"}
                                </span>
                              </div>
                              <div className="registration-journey-actions">
                                {canResend ? (
                                  <Button variant="outlined" size="small" disabled={Boolean(busyId)} onClick={() => resendToRecipient(communication, firstRecipient)}>
                                    {busyId === `${communication.id}:resend:${firstRecipient}` ? "Sending" : "Resend"}
                                  </Button>
                                ) : null}
                                {canReview ? (
                                  <Button variant="outlined" size="small" disabled={Boolean(busyId)} onClick={() => runAction(communication, "review", firstRecipient)}>
                                    {busyId === `${communication.id}:review:${firstRecipient}` ? "Saving" : "Mark reviewed"}
                                  </Button>
                                ) : null}
                                {canCancel ? (
                                  <Button variant="text" size="small" color="error" disabled={Boolean(busyId)} onClick={() => runAction(communication, "cancel")}>
                                    {busyId === `${communication.id}:cancel:all` ? "Cancelling" : "Cancel"}
                                  </Button>
                                ) : null}
                                <Button href={openHref} variant="text" size="small">Open</Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
