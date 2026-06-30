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
  attachments?: Array<{ fileName: string; url?: string | null }>;
}) {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  await assertOutboundRecipientsAllowed("SENDGRID", recipients);
  const renderedHtml = renderTemplate(input.bodyHtml, input.context ?? {}).output;
  const renderedText = input.bodyText ? renderTemplate(input.bodyText, input.context ?? {}).output : undefined;
  const attachmentLinks = (input.attachments ?? []).filter((attachment) => attachment.url);
  const html = attachmentLinks.length > 0
    ? `${renderedHtml}<hr><p><strong>Attachments</strong></p><ul>${attachmentLinks.map((attachment) => `<li><a href="${attachment.url}">${attachment.fileName}</a></li>`).join("")}</ul>`
    : renderedHtml;
  const text = attachmentLinks.length > 0
    ? `${renderedText ?? renderedHtml.replace(/<[^>]+>/g, " ")}\n\nAttachments:\n${attachmentLinks.map((attachment) => `${attachment.fileName}: ${attachment.url}`).join("\n")}`
    : renderedText;

  return sendWithSendGrid({
    to: input.to,
    subject: renderTemplate(input.subject, input.context ?? {}).output,
    html,
    text
  });
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
