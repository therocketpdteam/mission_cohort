import { createHash } from "node:crypto";
import { CommunicationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emailSearchRecipient, normalizedRecipient, sentHistoryAttempts, uniqueHistoryEvents, type HistoricalContent } from "@/lib/communicationHistory";
import { renderMergeFields, type MergeFieldContext } from "@/modules/email/mergeFields";
import { buildRecipientDeliveryRows, emailEventSummary, cohortMergeContext, participantMergeContext, registrationMergeContext } from "./communicationService";

type HistoryInput = { search?: string | null; recipient?: string | null; cohortId?: string | null; status?: string | null; cursor?: string | null; limit?: number; issueOnly?: boolean };
const badRequest = (message: string) => Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });

function explicitRecipientSql(recipient: string) {
  return Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c."recipientEmails") = 'array' THEN c."recipientEmails" ELSE '[]'::jsonb END) r(email) WHERE lower(trim(r.email)) = ${recipient})`;
}

export async function findRecipientCommunicationIds(recipientInput: string) {
  const recipient = normalizedRecipient(recipientInput);
  if (!recipient) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT c.id FROM "CohortCommunication" c WHERE ${explicitRecipientSql(recipient)} OR EXISTS (SELECT 1 FROM "EmailEvent" e WHERE e."communicationId"=c.id AND lower(e."recipientEmail")=${recipient})`);
  return rows.map(row=>row.id);
}

export function historyQuery(input: HistoryInput) {
  const search = String(input.search ?? "").trim();
  const recipient = normalizedRecipient(input.recipient) || emailSearchRecipient(search);
  if (recipient && !emailSearchRecipient(recipient)) throw badRequest("A valid recipient email is required.");
  const status = String(input.status ?? "").toUpperCase();
  if (status && !Object.values(CommunicationStatus).includes(status as CommunicationStatus)) throw badRequest("Invalid communication status.");
  const limit = Math.min(Math.max(Number.isFinite(input.limit) ? Math.trunc(input.limit!) : 25, 1), 100);
  const fingerprint = createHash("sha256").update(JSON.stringify([search.toLowerCase(), recipient, input.cohortId || "", status, !!input.issueOnly])).digest("hex").slice(0, 20);
  let cursor: { id: string; at: string; filter: string } | null = null;
  if (input.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      if (!cursor || typeof cursor.id !== "string" || !cursor.id || !Number.isFinite(new Date(cursor.at).getTime()) || cursor.filter !== fingerprint) throw new Error();
    } catch { throw badRequest("Invalid history cursor. Restart this search."); }
  }
  return { search, recipient, status, limit, fingerprint, cursor };
}

export async function listCommunicationHistory(input: HistoryInput = {}) {
  const q = historyQuery(input);
  const scopedEvents = q.recipient ? Prisma.sql`AND lower(e."recipientEmail") = ${q.recipient}` : Prisma.empty;
  const explicitRecipient = q.recipient ? explicitRecipientSql(q.recipient) : Prisma.sql`false`;
  const textSearch = `%${q.search.replace(/[\\%_]/g, "\\$&")}%`;
  const searchFilter = q.recipient ? Prisma.sql`AND (ev."eventCount" > 0 OR ${explicitRecipient})` : q.search ? Prisma.sql`AND (c.subject ILIKE ${textSearch} OR co.title ILIKE ${textSearch} OR co."shortName" ILIKE ${textSearch} OR s.title ILIKE ${textSearch} OR t.name ILIKE ${textSearch} OR EXISTS (SELECT 1 FROM "EmailEvent" se WHERE se."communicationId"=c.id AND se."recipientEmail" ILIKE ${textSearch}) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c."recipientEmails")='array' THEN c."recipientEmails" ELSE '[]'::jsonb END) r(email) WHERE r.email ILIKE ${textSearch}))` : Prisma.empty;
  const statusFilter = q.status ? Prisma.sql`AND h.status = ${q.status}` : Prisma.empty;
  const issueFilter = input.issueOnly ? Prisma.sql`AND h."issueCount" > 0` : Prisma.empty;
  const cursorFilter = q.cursor ? Prisma.sql`AND (h."sortAt", h.id) < (${new Date(q.cursor.at)}::timestamptz, ${q.cursor.id})` : Prisma.empty;
  const [result] = await prisma.$queryRaw<Array<{ rows: Array<Record<string, any>>; total: number; summary: { sent: number; scheduled: number; issues: number } }>>(Prisma.sql`
    WITH history AS (
      SELECT c.id, c."cohortId", c."sessionId", c."templateId", c."recipientScope", c."createdAt" AT TIME ZONE 'UTC' AS "createdAt", c."updatedAt" AT TIME ZONE 'UTC' AS "updatedAt", c."scheduledFor" AT TIME ZONE 'UTC' AS "scheduledFor",
        c.status::text AS "campaignStatus",
        CASE WHEN ${!!q.recipient} AND ev."sentAt" IS NOT NULL THEN 'SENT'
             WHEN ${!!q.recipient} AND ev."eventCount" > 0 AND ev."sentAt" IS NULL AND ev.failures > 0 THEN 'FAILED'
             ELSE c.status::text END AS status,
        CASE WHEN ${!!q.recipient} THEN COALESCE(ev."sentAt", CASE WHEN ev."eventCount"=0 AND ${explicitRecipient} THEN c."sentAt" END) ELSE COALESCE(ev."sentAt",c."sentAt") END AT TIME ZONE 'UTC' AS "sentAt",
        COALESCE(ev."sentAt",CASE WHEN NOT ${!!q.recipient} OR ev."eventCount"=0 THEN c."sentAt" END,ev."latestEventAt",c."scheduledFor",c."createdAt") AT TIME ZONE 'UTC' AS "sortAt",
        COALESCE(CASE WHEN ${!!q.recipient} THEN snap.subject END,c.subject) AS subject,
        (${!!q.recipient} AND snap.subject IS NOT NULL) AS "subjectIsSnapshot",
        ev."issueCount", ${q.recipient || null}::text AS "recipientEmail",
        jsonb_build_object('id',co.id,'title',co.title,'shortName',co."shortName",'defaultTimezone',co."defaultTimezone") AS cohort,
        CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'title',s.title,'timezone',s.timezone) END AS session,
        CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id',t.id,'name',t.name,'type',t.type) END AS template
      FROM "CohortCommunication" c JOIN "Cohort" co ON co.id=c."cohortId"
      LEFT JOIN "CohortSession" s ON s.id=c."sessionId" LEFT JOIN "CommunicationTemplate" t ON t.id=c."templateId"
      LEFT JOIN LATERAL (
        SELECT count(*) AS "eventCount", max(e."createdAt") AS "latestEventAt", max(e."createdAt") FILTER (WHERE e."eventType"='SENT') AS "sentAt",
          count(*) FILTER (WHERE e."eventType" IN ('FAILED','BOUNCED')) AS failures,
          count(DISTINCT lower(e."recipientEmail")) FILTER (WHERE e."eventType" IN ('FAILED','BOUNCED') AND e."reviewedAt" IS NULL AND NOT EXISTS (
            SELECT 1 FROM "EmailEvent" recovery WHERE recovery."communicationId"=c.id AND lower(recovery."recipientEmail")=lower(e."recipientEmail") AND recovery."createdAt">e."createdAt" AND recovery."eventType" IN ('SENT','DELIVERED','OPENED','CLICKED')
          ))::int AS "issueCount"
        FROM "EmailEvent" e WHERE e."communicationId"=c.id ${scopedEvents}
      ) ev ON true
      LEFT JOIN LATERAL (
        SELECT e.id,e."providerMessageId" FROM "EmailEvent" e
        WHERE ${!!q.recipient} AND e."communicationId"=c.id AND e."eventType"='SENT' AND lower(e."recipientEmail")=${q.recipient}
        ORDER BY e."createdAt" DESC,e.id DESC LIMIT 1
      ) latest_send ON true
      LEFT JOIN LATERAL (
        SELECT e."eventPayload"->>'renderedSubject' AS subject FROM "EmailEvent" e
        WHERE ${!!q.recipient} AND e."communicationId"=c.id AND e."eventType"='SENT' AND lower(e."recipientEmail")=${q.recipient}
          AND e."eventPayload"->>'renderedSubject' IS NOT NULL
          AND (e.id=latest_send.id OR (latest_send."providerMessageId" IS NOT NULL AND split_part(e."providerMessageId",'.',1)=split_part(latest_send."providerMessageId",'.',1)))
        ORDER BY e."createdAt" DESC,e.id DESC LIMIT 1
      ) snap ON true
      WHERE true ${input.cohortId ? Prisma.sql`AND c."cohortId"=${input.cohortId}` : Prisma.empty} ${searchFilter}
    ), filtered AS (SELECT * FROM history h WHERE true ${statusFilter} ${issueFilter}),
    page AS (SELECT * FROM filtered h WHERE true ${cursorFilter} ORDER BY h."sortAt" DESC,h.id DESC LIMIT ${q.limit + 1})
    SELECT COALESCE((SELECT jsonb_agg(p ORDER BY p."sortAt" DESC,p.id DESC) FROM page p),'[]'::jsonb) AS rows,
      (SELECT count(*)::int FROM filtered) AS total,
      jsonb_build_object('sent',(SELECT count(*) FROM history WHERE status='SENT'),'scheduled',(SELECT count(*) FROM history WHERE status='SCHEDULED'),'issues',(SELECT COALESCE(sum("issueCount"),0) FROM history)) AS summary
  `);
  const page = result.rows.slice(0, q.limit);
  const issueEvents = input.issueOnly && page.length ? await prisma.emailEvent.findMany({
    where:{communicationId:{in:page.map(row=>row.id)},...(q.recipient?{recipientEmail:{equals:q.recipient,mode:"insensitive" as const}}:{})},
    select:{id:true,communicationId:true,recipientEmail:true,eventType:true,createdAt:true,reviewedAt:true}
  }) : [];
  for (const row of page) {
    row.subject = displayHistorySubject(row);
    if (input.issueOnly) row.issueRows = buildRecipientDeliveryRows(issueEvents.filter(e=>e.communicationId===row.id)).filter(r=>r.needsReview).map(r=>({
      ...r,id:`${row.id}:${r.recipientEmail}`,communicationId:row.id,subject:row.subject,cohort:row.cohort,session:row.session
    }));
  }
  const last = page.at(-1);
  return { rows: page, total: result.total, summary: result.summary, recipient: q.recipient || null,
    nextCursor: result.rows.length > q.limit && last ? Buffer.from(JSON.stringify({ id: last.id, at: last.sortAt, filter: q.fingerprint })).toString("base64url") : null };
}

export function displayHistorySubject(row: Record<string, any>) {
  if (row.subjectIsSnapshot) return String(row.subject);
  const rendered = renderMergeFields(String(row.subject ?? ""), { cohort: row.cohort, session: row.session });
  return rendered.warnings.length ? `${row.template?.name ?? "Personalized message"} · ${row.cohort?.title ?? ""}` : rendered.output || "Untitled message";
}

function mergeContext(message: any, participant: any, registration: any): MergeFieldContext {
  return {
    cohort: cohortMergeContext(message.cohort),
    session: message.session ?? undefined,
    participant: participantMergeContext(participant ?? undefined),
    registration: registrationMergeContext(registration ?? undefined),
    organization: participant?.organization ?? registration?.organization ?? undefined
  };
}

export function reconstructHistoryContent(message: any, context: MergeFieldContext): HistoricalContent {
  const subject = renderMergeFields(String(message.subject ?? ""), context);
  const html = renderMergeFields(String(message.bodyHtml ?? ""), context);
  const text = renderMergeFields(String(message.bodyText ?? ""), context);
  return { provenance: message.bodyHtml || message.bodyText ? "reconstructed" : "unavailable", subject: subject.output,
    bodyHtml: html.output, bodyText: text.output, warnings: [...new Set([...subject.warnings,...html.warnings,...text.warnings])], attachments: [] };
}

export async function getCommunicationHistoryDetail(id: string, recipientInput?: string | null) {
  const recipient = normalizedRecipient(recipientInput);
  if (recipient && !emailSearchRecipient(recipient)) throw badRequest("A valid recipient email is required.");
  const message = await prisma.cohortCommunication.findUnique({ where: { id }, include: {
    cohort: { include: { presenter: true } }, session: true, template: true, attachments: true,
    participant: { include: { organization: true, registration: { include: { organization: true } } } },
    registration: { include: { organization: true } }
  } });
  if (!message) throw Object.assign(new Error("Communication not found"), { status:404,code:"NOT_FOUND" });
  const eventMetadata = await prisma.emailEvent.findMany({ where: { communicationId: id }, orderBy: [{createdAt:"desc"},{id:"desc"}],
    select: { id:true,communicationId:true,recipientEmail:true,eventType:true,createdAt:true,reviewedAt:true,providerMessageId:true } });
  const recipients = [...new Set([...eventMetadata.map(e=>normalizedRecipient(e.recipientEmail)), ...(Array.isArray(message.recipientEmails) ? message.recipientEmails.map(normalizedRecipient) : [])].filter(Boolean))].sort();
  if (recipient && !recipients.includes(recipient)) throw Object.assign(new Error("No recorded history for this recipient on this message."), { status:404,code:"NOT_FOUND" });
  const recipientRows = buildRecipientDeliveryRows(eventMetadata);
  let content: HistoricalContent | null = null;
  let attempts: Array<Record<string, any>> = [];
  const selectedEvents = eventMetadata.filter(e=>!recipient || normalizedRecipient(e.recipientEmail)===recipient);
  if (recipient) {
    const sends = await prisma.emailEvent.findMany({ where: { communicationId:id,recipientEmail:{equals:recipient,mode:"insensitive"},eventType:"SENT" }, orderBy:[{createdAt:"desc"},{id:"desc"}] });
    attempts = sentHistoryAttempts(sends, recipient);
    let fallback: HistoricalContent | null = null;
    if (!attempts.length || attempts.some(a=>!a.content)) {
      const linkedParticipant = message.participant && normalizedRecipient(message.participant.email) === recipient ? message.participant : null;
      const candidates = linkedParticipant ? [] : await prisma.participant.findMany({
        where: { cohortId:message.cohortId, email:{equals:recipient,mode:"insensitive"}, ...(message.registrationId ? {registrationId:message.registrationId} : {}) },
        include:{organization:true,registration:{include:{organization:true}}}, take:2
      });
      const participant = linkedParticipant ?? (candidates.length === 1 ? candidates[0] : null);
      let registration = message.registration ?? participant?.registration ?? null;
      if (!registration && candidates.length === 0) {
        const contacts = await prisma.registration.findMany({
          where:{cohortId:message.cohortId,OR:[{primaryContactEmail:{equals:recipient,mode:"insensitive"}},{billingContactEmail:{equals:recipient,mode:"insensitive"}}]},
          include:{organization:true},take:2
        });
        if (contacts.length === 1) registration = contacts[0];
      }
      fallback = reconstructHistoryContent(message, mergeContext(message,participant,registration));
      attempts = attempts.map(attempt => ({...attempt,content:attempt.content ?? {...fallback,subject:attempt.savedSubject ?? fallback!.subject}}));
      if (!attempts.length && message.sentAt && !selectedEvents.length && Array.isArray(message.recipientEmails) && message.recipientEmails.some(e=>normalizedRecipient(e)===recipient)) {
        attempts.push({id:`legacy:${id}`,sentAt:message.sentAt,content:fallback});
      }
    }
    content = attempts[0]?.content ?? fallback;
  }
  // Keep template source separate from historical subject/content for editing.
  const recipientStatus = recipient && attempts.length ? "SENT" : recipient && selectedEvents.some(event=>["FAILED","BOUNCED"].includes(event.eventType)) ? "FAILED" : message.status;
  return { ...message, status:recipientStatus, campaignStatus:message.status, subject: content?.subject || displayHistorySubject(message), templateSubject: message.subject,
    bodyHtml: message.status === "DRAFT" ? message.bodyHtml : undefined,bodyText: message.status === "DRAFT" ? message.bodyText : undefined, emailEvents:uniqueHistoryEvents(selectedEvents), recipientRows, recipients, recipientEmail:recipient||null,
    sentAt: attempts[0]?.sentAt ?? (recipient ? null : message.sentAt), attempts, content, emailSummary:emailEventSummary(selectedEvents) };
}
