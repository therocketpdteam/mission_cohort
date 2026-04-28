import { prisma } from "@/lib/prisma";
import {
  MergeFieldContext,
  renderMergeFields,
  sendWithSendGrid,
  validateMergeFields as validateTemplateMergeFields
} from "@/modules/email";

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  context?: MergeFieldContext;
}) {
  const html = renderTemplate(input.bodyHtml, input.context ?? {}).output;
  const text = input.bodyText ? renderTemplate(input.bodyText, input.context ?? {}).output : undefined;

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
    include: { cohort: { include: { presenter: true } }, organization: true, participants: true }
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
        title: registration.cohort.title,
        startDate: registration.cohort.startDate,
        presenterName: `${registration.cohort.presenter.firstName} ${registration.cohort.presenter.lastName}`
      },
      organization: { name: registration.organization.name },
      registration
    }
  });
}

export async function sendSessionReminderPlaceholder() {
  return { status: "pending_background_worker" as const };
}
