import { prisma } from "@/lib/prisma";
import {
  MergeFieldContext,
  renderMergeFields,
  sendWithSendGrid,
  validateMergeFields as validateTemplateMergeFields
} from "@/modules/email";
import { env, getAppEnvironmentKind } from "@/lib/env";
import { assertOutboundUnlocked } from "@/lib/outboundLock";
import { assertOutboundRecipientsAllowed } from "@/services/integrationSetupService";

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  context?: MergeFieldContext;
  attachments?: Array<{ fileName: string; contentType?: string | null; url?: string | null; content?: string | Buffer | null }>;
  outboundContext?: { communicationId?: string };
}) {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const renderedHtml = renderTemplate(input.bodyHtml, input.context ?? {}).output;
  const renderedText = input.bodyText ? renderTemplate(input.bodyText, input.context ?? {}).output : undefined;
  const attachments = await resolveSendGridAttachments(input.attachments ?? []);
  const renderedSubject = renderTemplate(input.subject, input.context ?? {}).output;
  const delivery = buildEmailDelivery({ recipients, subject: renderedSubject, html: renderedHtml, text: renderedText });

  if (!delivery.captured) {
    await assertOutboundRecipientsAllowed("SENDGRID", recipients);
    await assertOutboundUnlocked({
      channel: "SENDGRID",
      action: "send email",
      metadata: {
        recipientCount: recipients.length,
        subject: input.subject,
        recipients,
        communicationId: input.outboundContext?.communicationId
      }
    });
  }

  const result = await sendWithSendGrid({
    to: delivery.to,
    subject: delivery.subject,
    html: delivery.html,
    text: delivery.text,
    attachments
  });

  return {
    ...result,
    intendedRecipients: recipients,
    captured: delivery.captured,
    renderedSubject,
    renderedBodyHtml: renderedHtml,
    renderedBodyText: renderedText,
    renderedAttachments: attachments.map((attachment) => ({
      fileName: attachment.filename,
      contentType: attachment.type
    }))
  };
}

export function buildEmailDelivery(input: {
  recipients: string[];
  subject: string;
  html: string;
  text?: string;
}, override?: { environment: ReturnType<typeof getAppEnvironmentKind>; captureEmail?: string }) {
  const environment = override?.environment ?? getAppEnvironmentKind();
  const captureEmail = String(override?.captureEmail ?? env.STAGING_OUTBOUND_CAPTURE_EMAIL ?? "").trim().toLowerCase();
  const captured = environment === "staging" && Boolean(captureEmail);

  if (!captured) {
    return { to: input.recipients, subject: input.subject, html: input.html, text: input.text, captured: false };
  }

  const intended = input.recipients.join(", ");
  const banner = `<div style="margin:0 0 20px;padding:12px 16px;border:1px solid #f59e0b;background:#fffbeb;color:#78350f;font-family:Arial,sans-serif;font-size:14px;"><strong>STAGING CAPTURE</strong><br>Originally intended for: ${escapeHtml(intended)}</div>`;
  const textBanner = `STAGING CAPTURE\nOriginally intended for: ${intended}\n\n`;

  return {
    to: captureEmail,
    subject: `[STAGING QA to ${intended}] ${input.subject}`,
    html: `${banner}${input.html}`,
    text: `${textBanner}${input.text ?? input.html.replace(/<[^>]+>/g, " ")}`,
    captured: true
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

async function resolveSendGridAttachments(attachments: Array<{ fileName: string; contentType?: string | null; url?: string | null; content?: string | Buffer | null }>) {
  const resolved = [];

  for (const attachment of attachments) {
    if (attachment.content) {
      const bytes = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content, "utf8");
      if (bytes.byteLength > 20 * 1024 * 1024) {
        throw Object.assign(new Error(`Attachment ${attachment.fileName} is larger than the 20 MB email limit.`), {
          code: "BAD_REQUEST",
          status: 400
        });
      }
      resolved.push({
        content: bytes.toString("base64"),
        filename: attachment.fileName,
        type: attachment.contentType ?? "application/octet-stream",
        disposition: "attachment" as const
      });
      continue;
    }

    if (!attachment.url) {
      continue;
    }

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw Object.assign(new Error(`Attachment ${attachment.fileName} could not be downloaded before sending.`), {
        code: "BAD_REQUEST",
        status: 400
      });
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 20 * 1024 * 1024) {
      throw Object.assign(new Error(`Attachment ${attachment.fileName} is larger than the 20 MB email limit.`), {
        code: "BAD_REQUEST",
        status: 400
      });
    }
    const contentType = attachment.contentType ?? response.headers.get("content-type") ?? "application/octet-stream";
    if (contentType.toLowerCase().includes("pdf") && bytes.subarray(0, 4).toString("utf8") !== "%PDF") {
      throw Object.assign(new Error(`Attachment ${attachment.fileName} must use a direct PDF download URL.`), {
        code: "BAD_REQUEST",
        status: 400
      });
    }

    resolved.push({
      content: bytes.toString("base64"),
      filename: attachment.fileName,
      type: contentType,
      disposition: "attachment" as const
    });
  }

  return resolved;
}

export function renderTemplate(template: string, context: MergeFieldContext) {
  return renderMergeFields(template, context);
}

export function validateMergeFields(template: string) {
  return validateTemplateMergeFields(template);
}

export async function sendRegistrationConfirmation(registrationId: string) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { cohort: { include: { presenter: true } }, organization: true, participants: true, invoiceDrafts: { orderBy: { updatedAt: "desc" } } }
  });

  if (!registration) {
    throw Object.assign(new Error("Registration not found"), { code: "NOT_FOUND", status: 404 });
  }

  return sendEmail({
    to: registration.primaryContactEmail,
    subject: "Registration confirmed for {{cohort.title}}",
    bodyHtml: "<p>Hello {{registration.primaryContactName}}, your registration for {{cohort.title}} is confirmed.</p>",
    bodyText: "Hello {{registration.primaryContactName}}, your registration for {{cohort.title}} is confirmed.",
    context: {
      cohort: {
        ...registration.cohort,
        title: registration.cohort.title,
        description: registration.cohort.description,
        startDate: registration.cohort.startDate,
        presenterName: `${registration.cohort.presenter.firstName} ${registration.cohort.presenter.lastName}`,
        presenterFirstName: registration.cohort.presenter.firstName,
        presenterLastName: registration.cohort.presenter.lastName,
        presenterEmail: registration.cohort.presenter.email
      },
      organization: registration.organization,
      registration
    }
  });
}

export async function sendSessionReminderPlaceholder() {
  return { status: "pending_background_worker" as const };
}
