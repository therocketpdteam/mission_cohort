import { CommunicationStatus, EmailEventType, type CohortCommunication } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cancellationBlocksDelivery } from "@/modules/cohorts/cancellation";
import { parseSupportJourneyKey, renderSupportReminder, supportReminderTime, supportReminderWindow } from "@/modules/email/supportReminders";
import { readCohortSupportTeam } from "./cohortSupportService";
import { sendEmail } from "./emailService";
import { assertCohortDeliveryAllowed } from "./integrationSetupService";

type Dependencies = { client: typeof prisma; send: typeof sendEmail; assertDelivery: typeof assertCohortDeliveryAllowed; now: () => Date };

export async function deliverSupportReminder(communication: CohortCommunication, overrides: Partial<Dependencies> = {}) {
  const { client, send, assertDelivery, now } = { client: prisma, send: sendEmail, assertDelivery: assertCohortDeliveryAllowed, now: () => new Date(), ...overrides };
  const key = parseSupportJourneyKey(communication.journeyKey);
  const badRequest = (message: string) => Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
  if (!key || key.cohortId !== communication.cohortId || key.sessionId !== communication.sessionId) throw badRequest("Invalid support reminder assignment.");
  if (communication.sentAt || communication.status === CommunicationStatus.SENT) return communication;
  if (communication.status !== CommunicationStatus.SCHEDULED) throw badRequest("Only a scheduled support reminder can be delivered. Failed deliveries need review before another message is created.");

  async function preflight() {
    const [team, session, cancellation] = await Promise.all([
      readCohortSupportTeam(communication.cohortId, client),
      client.cohortSession.findUnique({ where: { id: key!.sessionId }, include: { cohort: { include: { presenter: true } } } }),
      client.operationsTask.findUnique({ where: { id: `cohort-cancellation:${communication.cohortId}` }, select: { status: true } })
    ]);
    const member = team?.members.find((person) => person.id === key!.memberId);
    let reason = "";
    if (!member || !session || session.cohortId !== communication.cohortId) reason = "Support person or session is no longer assigned to this cohort.";
    else if (communication.recipientScope !== "CUSTOM" || !Array.isArray(communication.recipientEmails) || communication.recipientEmails.length !== 1 || communication.recipientEmails[0] !== member.email) reason = "Support reminder recipient does not match the current assignment.";
    else if (session.cohort.status !== "PUBLISHED" || cancellationBlocksDelivery(communication.cohortId, communication.journeyKey, cancellation?.status)) reason = "Support reminders are paused because the cohort is not published or cancellation is in progress.";
    else if (supportReminderWindow(session.startTime, key!.kind, now()) === "expired") reason = "This support reminder is no longer timely.";
    else if (communication.scheduledFor?.getTime() !== supportReminderTime(session.startTime, key!.kind).getTime()) reason = "Session schedule changed; this support reminder must be rescheduled.";
    else if (supportReminderWindow(session.startTime, key!.kind, now()) === "early") throw badRequest("This support reminder is not due yet.");
    else if (!/^https?:\/\/\S+$/i.test(session.meetingUrl ?? "")) {
      const message = "Add a Zoom / meeting link to the session before delivering its support reminder.";
      await client.cohortCommunication.updateMany({ where: { id: communication.id, status: CommunicationStatus.SCHEDULED, sentAt: null }, data: { providerError: message } });
      throw badRequest(message);
    }
    return { member, session, reason };
  }

  const prepared = await preflight();
  if (prepared.reason) {
    await client.cohortCommunication.updateMany({ where: { id: communication.id, status: CommunicationStatus.SCHEDULED, sentAt: null }, data: { status: CommunicationStatus.SKIPPED, providerError: prepared.reason } });
    return client.cohortCommunication.findUniqueOrThrow({ where: { id: communication.id } });
  }
  await assertDelivery("SENDGRID", prepared.session!.cohort.status, [prepared.member!.email]);
  // Both Vercel and GitHub run the scheduler. Only one worker can claim a
  // support reminder; retries must not send another copy of the same message.
  const claimed = await client.cohortCommunication.updateMany({
    where: { id: communication.id, status: CommunicationStatus.SCHEDULED, sentAt: null },
    data: { status: CommunicationStatus.SENDING, providerError: null }
  });
  if (claimed.count !== 1) return client.cohortCommunication.findUniqueOrThrow({ where: { id: communication.id } });
  try {
    // Re-check membership and session details after the claim, immediately
    // before sending, so removed support people do not receive queued mail.
    const current = await preflight();
    if (current.reason) return client.cohortCommunication.update({ where: { id: communication.id }, data: { status: CommunicationStatus.SKIPPED, providerError: current.reason } });
    const session = current.session!;
    const member = current.member!;
    const presenter = session.cohort.presenter;
    const result = await send({
      to: member.email,
      outboundContext: { communicationId: communication.id },
      ...renderSupportReminder(key.kind, {
        support: { name: member.name, email: member.email },
        cohort: { ...session.cohort, presenterName: [presenter.firstName, presenter.lastName].filter(Boolean).join(" ") },
        session
      })
    });
    await client.emailEvent.create({ data: {
      communicationId: communication.id, recipientEmail: member.email, provider: "sendgrid", providerMessageId: result.providerMessageId,
      eventType: EmailEventType.SENT,
      eventPayload: { renderedSubject: result.renderedSubject, renderedBodyHtml: result.renderedBodyHtml, renderedBodyText: result.renderedBodyText ?? null, supportReminder: true }
    } });
    return client.cohortCommunication.update({ where: { id: communication.id }, data: { status: CommunicationStatus.SENT, sentAt: now(), providerMessageId: result.providerMessageId, providerError: null } });
  } catch (error) {
    await client.cohortCommunication.update({ where: { id: communication.id }, data: { status: CommunicationStatus.FAILED, providerError: error instanceof Error ? error.message : "Support reminder delivery failed; review before retrying." } });
    throw error;
  }
}
