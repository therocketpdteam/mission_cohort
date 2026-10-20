import { renderMergeFields, type MergeFieldContext } from "../modules/email/mergeFields";
import { escapeHtml, textToEmailHtml } from "../modules/email/templateFormatting";
import { cancellationPaymentMessage } from "./registrationCancellation";

type EmailTemplate = { subject: string; bodyText: string; bodyHtml: string };

// These drafts are for the email-first cohort cancellation flow. They do not
// send messages, change calendar events, cancel records, or issue refunds.
const participantBody = `Hello {{participant.firstName}},

We're sorry to share that we have decided to cancel **{{cohort.title}}**. We apologize for the change and any inconvenience this causes.

**There is nothing you need to do.** We will remove the cohort sessions from your calendar and stop the scheduled reminders.

Thank you for choosing to learn with RocketPD. We appreciate the time you set aside to join us and hope to welcome you to another course or cohort soon.

If you have any questions, please contact us at {{support.email}}.

Warm regards,
{{support.teamName}}`;

export const cohortCancellationParticipantEmail: EmailTemplate = {
  subject: "An update about {{cohort.title}}",
  bodyText: participantBody.replaceAll("**", ""),
  bodyHtml: textToEmailHtml(participantBody)
};

const pocIntroduction = `Hello {{registration.primaryContactFirstName}},

We're sorry to let you know that we have decided to cancel **{{cohort.title}}**. We apologize for the inconvenience this causes you and your team.

We are notifying registered participants directly and will remove the cohort sessions from their calendars. You do not need to forward this notice or arrange their removal.

For your administrative records, the affected registration is:`;

const pocClosing = `Thank you for coordinating this learning opportunity for your team. We appreciate your understanding and hope to welcome your organization to another RocketPD course or cohort.

Please reply to this email with any questions.

Warm regards,
{{support.teamName}}`;

export type CohortCancellationPaymentInput = {
  paymentStatus: string;
  paymentMethod?: string | null;
  // Supply actual receipt methods when known. PO and invoice are billing
  // arrangements; neither establishes how a received payment was made.
  receivedPaymentMethods?: readonly string[];
  receivedAmount?: number | null;
  invoiceStatus?: string | null;
  invoiceNumber?: string | null;
  purchaseOrderNumber?: string | null;
  cancellationDate: string;
};

export function cohortCancellationPaymentMessage(input: CohortCancellationPaymentInput) {
  const statuses = ["PENDING", "INVOICED", "PAID", "PARTIALLY_PAID", "REFUNDED", "CANCELLED", "UNCOLLECTIBLE"];
  if (!statuses.includes(input.paymentStatus)) {
    throw new Error("Review the registration payment status before preparing its cancellation email.");
  }
  if (input.receivedAmount != null && (!Number.isFinite(input.receivedAmount) || input.receivedAmount < 0)) {
    throw new Error("The received payment amount must be a non-negative number.");
  }

  if (input.paymentStatus === "REFUNDED") {
    return { kind: "refunded", text: "Our records show that your payment has already been refunded. No additional payment is due for this registration." };
  }

  const paymentReceived = Number(input.receivedAmount ?? 0) > 0 || ["PAID", "PARTIALLY_PAID"].includes(input.paymentStatus);
  if (input.paymentMethod === "COMPED" && !paymentReceived) {
    return { kind: "complimentary", text: "Your registration was complimentary. No payment or refund is required." };
  }

  if (!paymentReceived) {
    const invoice = input.invoiceNumber?.trim();
    const invoiceText = invoice
      ? ["VOIDED", "CANCELLED"].includes(input.invoiceStatus ?? "")
        ? ` Invoice ${invoice} has been voided.`
        : ` Invoice ${invoice} will be voided.`
      : "";
    return { kind: "unpaid", text: `We have not received payment for this registration. No payment is due, and no further action is required.${invoiceText}` };
  }

  const methods = Array.from(new Set((input.receivedPaymentMethods ?? []).map((method) => method.trim().toUpperCase()).filter(Boolean)));
  const paymentMethod = methods.length === 1 ? methods[0] : methods.length > 1 ? "UNKNOWN" : input.paymentMethod;
  if (paymentMethod === "CREDIT_CARD" && !input.cancellationDate.trim()) {
    throw new Error("A cancellation date is required for the credit card refund timeline.");
  }
  // Preserve the existing registration cancellation refund policy. Do not pass
  // an invoice number: these notices precede invoice/calendar/status changes.
  const message = cancellationPaymentMessage({
    paymentReceived: true,
    paymentMethod,
    receivedAmount: input.receivedAmount,
    cancellationDate: input.cancellationDate
  });
  const remainingBalance = input.paymentStatus === "PARTIALLY_PAID"
    ? " The remaining unpaid balance will be cancelled. No additional payment is required."
    : "";
  return { kind: message.kind, text: `${message.text}${remainingBalance}` };
}

export function buildCohortCancellationPocEmail(input: CohortCancellationPaymentInput): EmailTemplate {
  const payment = cohortCancellationPaymentMessage(input);
  const details = [
    ["Organization", "{{organization.name}}"],
    ["Registration contact", "{{registration.primaryContactName}}"],
    ["Registered seats", "{{registration.participantCount}}"],
    ...(input.invoiceNumber?.trim() ? [["Invoice", "{{registration.invoiceNumber}}"]] : []),
    ...(input.purchaseOrderNumber?.trim() ? [["Purchase order", "{{registration.purchaseOrderNumber}}"]] : [])
  ];
  const table = `<table style="border-collapse:collapse;width:100%;max-width:600px;margin:16px 0"><tbody>${details.map(([label, value]) =>
    `<tr><th scope="row" style="text-align:left;vertical-align:top;border:1px solid #ddd;padding:8px;width:35%">${label}</th><td style="border:1px solid #ddd;padding:8px;overflow-wrap:anywhere">${value}</td></tr>`
  ).join("")}</tbody></table>`;

  return {
    subject: "Cohort cancellation and registration details: {{cohort.title}}",
    bodyText: [
      pocIntroduction.replaceAll("**", ""),
      details.map(([label, value]) => `${label}: ${value}`).join("\n"),
      `Payment and refund information\n${payment.text}`,
      pocClosing
    ].join("\n\n"),
    bodyHtml: [
      textToEmailHtml(pocIntroduction),
      table,
      "<p><strong>Payment and refund information</strong></p>",
      `<p>${escapeHtml(payment.text)}</p>`,
      textToEmailHtml(pocClosing)
    ].join("\n")
  };
}

export function renderCohortCancellationEmail(template: EmailTemplate, context: MergeFieldContext) {
  if (!String(context.cohort?.title ?? "").trim()) {
    throw new Error("A cohort title is required for the cancellation email.");
  }
  const contactName = String(context.registration?.primaryContactName ?? "").trim();
  const normalizedContext: MergeFieldContext = {
    ...context,
    participant: { ...context.participant, firstName: String(context.participant?.firstName ?? "").trim() || "there" },
    registration: {
      ...context.registration,
      primaryContactFirstName: String(context.registration?.primaryContactFirstName ?? "").trim() || contactName.split(/\s+/)[0] || "there"
    }
  };
  const htmlContext = Object.fromEntries(Object.entries(normalizedContext).map(([scope, values]) => [
    scope,
    Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, typeof value === "string" ? escapeHtml(value) : value]))
  ])) as MergeFieldContext;
  const subject = renderMergeFields(template.subject, normalizedContext);
  const bodyText = renderMergeFields(template.bodyText, normalizedContext);
  const bodyHtml = renderMergeFields(template.bodyHtml, htmlContext);
  return {
    subject: subject.output.replace(/[\r\n]+/g, " "),
    bodyText: bodyText.output,
    bodyHtml: bodyHtml.output,
    warnings: Array.from(new Set([...subject.warnings, ...bodyText.warnings, ...bodyHtml.warnings]))
  };
}
