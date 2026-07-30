import { prisma } from "@/lib/prisma";
import {
  MergeFieldContext,
  renderMergeFields,
  sendWithSendGrid,
  validateMergeFields as validateTemplateMergeFields
} from "@/modules/email";
import { assertOutboundRecipientsAllowed } from "@/services/integrationSetupService";

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  context?: MergeFieldContext;
  attachments?: Array<{ fileName: string; contentType?: string | null; url?: string | null; content?: string | Buffer | null }>;
}) {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  await assertOutboundRecipientsAllowed("SENDGRID", recipients);
  const renderedHtml = renderTemplate(input.bodyHtml, input.context ?? {}).output;
  const renderedText = input.bodyText ? renderTemplate(input.bodyText, input.context ?? {}).output : undefined;
  const attachments = await resolveSendGridAttachments(input.attachments ?? []);

  return sendWithSendGrid({
    to: input.to,
    subject: renderTemplate(input.subject, input.context ?? {}).output,
    html: renderedHtml,
    text: renderedText,
    attachments
  });
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
