import { fail, handleApiError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  addCommunicationAttachment,
  attachResourceToCommunication,
  createCommunicationDraft,
  createDefaultSessionCommunications,
  createPlannedSessionReminders,
  listCommunications,
  listCommunicationsByCohort,
  removeCommunicationAttachment,
  reviewRecipientIssue,
  processScheduledCommunications,
  scheduleCommunicationPlaceholder,
  sendCommunicationToRecipient,
  sendCommunicationPlaceholder,
  sendTemplateToParticipant,
  sendTemplateToRegistrations
} from "@/services/communicationService";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const cohortId = params.get("cohortId");
    const limit = Number(params.get("limit") ?? 100);
    const issueOnly = params.get("issueOnly") === "1" || params.get("issueOnly") === "true";

    if (cohortId) {
      return ok(await listCommunicationsByCohort(cohortId));
    }

    return ok(await listCommunications({ limit, issueOnly }));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createCommunicationDraft(await request.json()), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (body.action === "attachFile") {
      return ok(await addCommunicationAttachment(body));
    }

    if (body.action === "attachResource") {
      if (!body.communicationId || !body.resourceId) {
        return fail("communicationId and resourceId are required", "BAD_REQUEST", 400);
      }

      return ok(await attachResourceToCommunication(body));
    }

    if (body.action === "removeAttachment") {
      if (!body.attachmentId) {
        return fail("attachmentId is required", "BAD_REQUEST", 400);
      }

      return ok(await removeCommunicationAttachment(body.attachmentId));
    }

    if (body.action === "schedule") {
      return ok(await scheduleCommunicationPlaceholder(body));
    }

    if (body.action === "scheduleSessionReminders") {
      return ok(await createPlannedSessionReminders(body.sessionId, body.createdById));
    }

    if (body.action === "createDefaultSessionCommunications") {
      if (!body.sessionId) {
        return fail("sessionId is required", "BAD_REQUEST", 400);
      }

      return ok(await createDefaultSessionCommunications(body.sessionId));
    }

    if (body.action === "sendTemplateToParticipant") {
      if (!body.templateId || !body.participantId) {
        return fail("templateId and participantId are required", "BAD_REQUEST", 400);
      }

      return ok(await sendTemplateToParticipant(body));
    }

    if (body.action === "sendTemplateToRegistrations") {
      if (!body.templateId || !Array.isArray(body.registrationIds)) {
        return fail("templateId and registrationIds are required", "BAD_REQUEST", 400);
      }

      return ok(await sendTemplateToRegistrations(body));
    }

    if (body.action === "send" || body.action === "resend") {
      if (!body.id) {
        return fail("id is required", "BAD_REQUEST", 400);
      }

      return ok(await sendCommunicationPlaceholder(body.id));
    }

    if (body.action === "sendToRecipient") {
      if (!body.communicationId || !body.recipientEmail) {
        return fail("communicationId and recipientEmail are required", "BAD_REQUEST", 400);
      }

      return ok(await sendCommunicationToRecipient(body));
    }

    if (body.action === "reviewRecipientIssue") {
      if (!body.communicationId || !body.recipientEmail) {
        return fail("communicationId and recipientEmail are required", "BAD_REQUEST", 400);
      }
      const user = await requireUser();

      return ok(await reviewRecipientIssue({
        communicationId: body.communicationId,
        recipientEmail: body.recipientEmail,
        reviewNote: body.reviewNote,
        reviewedById: user.id
      }));
    }

    if (body.action === "processScheduled") {
      return ok(await processScheduledCommunications(body.limit));
    }

    return fail("Unsupported communication action", "BAD_REQUEST", 400);
  } catch (error) {
    return handleApiError(error);
  }
}
