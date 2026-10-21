export const registrationCancellationEmail = {
  subject: "Registration cancelled: {{cohort.title}}",
  bodyHtml: `<p>Hello {{registration.primaryContactFirstName}},</p>
<p>This email confirms that the registration detailed below for <strong>{{cohort.title}}</strong> has been cancelled.</p>
<p><strong>Cancellation details</strong></p>
<ul>
  <li>Organization: {{organization.name}}</li>
  <li>Registration contact: {{registration.primaryContactName}}</li>
  <li>Seats on cancelled registration: {{registration.participantCount}}</li>
  <li>Invoice: {{registration.invoiceNumber}}</li>
</ul>
<p>This cancellation applies only to this registration. Any separate active registrations remain in place.</p>
<p>Thank you,<br>{{support.teamName}}</p>`,
  bodyText: `Hello {{registration.primaryContactFirstName}},

This email confirms that the registration detailed below for {{cohort.title}} has been cancelled.

Cancellation details
- Organization: {{organization.name}}
- Registration contact: {{registration.primaryContactName}}
- Seats on cancelled registration: {{registration.participantCount}}
- Invoice: {{registration.invoiceNumber}}

This cancellation applies only to this registration. Any separate active registrations remain in place.

Thank you,
{{support.teamName}}`
};

export function cancellationPaymentMessage(input: {
  paymentReceived: boolean;
  paymentMethod?: string | null;
  invoiceNumber?: string | null;
  receivedAmount?: number | null;
  cancellationDate: string;
}) {
  const invoice = input.invoiceNumber ? ` Invoice ${input.invoiceNumber} has been voided.` : "";
  if (!input.paymentReceived) {
    const text = `We have not received payment for this registration. No balance is due, and no further action is required.${invoice}`;
    return { kind: "unpaid" as const, text, html: `<p>${text}</p>` };
  }

  if (input.paymentMethod === "CREDIT_CARD") {
    const text = `We received your credit card payment. We will issue the refund to the original method of payment. Please allow up to 10 days from ${input.cancellationDate} for the refund to appear on your account.`;
    return { kind: "credit_card" as const, text, html: `<p>${text}</p>` };
  }

  if (input.paymentMethod === "CHECK") {
    const text = "We received your payment by check. Please reply to confirm the refund recipient's name, mailing address, and whether you prefer the refund by check or ACH. If you prefer ACH, please do not email banking information; we will provide a secure way to share the required details.";
    return { kind: "check" as const, text, html: `<p>${text}</p>` };
  }

  if (input.paymentMethod === "ACH") {
    const text = "We received your payment by ACH. Please reply to confirm whether you prefer the refund by ACH to the original account or by check. If you prefer a check, include the refund recipient's name and mailing address. Please do not email banking information; we will provide a secure way to confirm any required ACH details.";
    return { kind: "ach" as const, text, html: `<p>${text}</p>` };
  }

  const text = "We received payment for this registration. Please reply to confirm whether you prefer the refund by check or ACH. For a check, include the refund recipient's name and mailing address. Please do not email banking information; we will provide a secure way to share any required ACH details.";
  return { kind: "confirmation_required" as const, text, html: `<p>${text}</p>` };
}

export function cancellationInvoiceDisposition(input: {
  hasInvoice: boolean;
  invoiceStatus?: string | null;
  paidAmount?: number | null;
  paymentStatus?: string | null;
}) {
  if (!input.hasInvoice) return "none" as const;
  if (input.invoiceStatus === "PAID" || Number(input.paidAmount ?? 0) > 0 || input.paymentStatus === "PAID") {
    return "refund_required" as const;
  }
  if (input.invoiceStatus === "VOIDED" || input.invoiceStatus === "CANCELLED") return "already_voided" as const;
  return "void_and_attach" as const;
}


export function registrationCancellationAttendanceMessage(input: {
  participants: Array<{ name: string; email: string }>;
  requestedEmails: string[];
  emailsKeptForActiveEnrollment: string[];
  primaryContactEmail: string;
}) {
  const normalize = (email: string) => email.trim().toLowerCase();
  const kept = new Set(input.emailsKeptForActiveEnrollment.map(normalize));
  const names = new Map(input.participants.map((participant) => [normalize(participant.email), participant.name]));
  const candidates = Array.from(new Set(input.requestedEmails.map(normalize)));
  const removed = candidates.filter((email) => !kept.has(email));
  const retained = candidates.filter((email) => kept.has(email));
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
  const label = (email: string) => names.get(email) ? `${names.get(email)} - ${email}` : email;
  const html: string[] = [];
  const text: string[] = [];

  if (retained.length > 0) {
    const explanation = kept.has(normalize(input.primaryContactEmail))
      ? "Your separate active enrollment in this cohort remains in place. You can continue attending and receiving participant communications through that registration."
      : "The following participants remain enrolled through another active registration. Their calendar attendance and automated participant communications remain active.";
    html.push(`<p>${explanation}</p><p><strong>Participants remaining enrolled</strong></p><ul>${retained.map((email) => `<li>${escape(label(email))}</li>`).join("")}</ul>`);
    text.push(explanation, "Participants remaining enrolled", ...retained.map((email) => `- ${label(email)}`));
  }
  if (removed.length > 0) {
    html.push(`<p><strong>Participants leaving this cohort</strong></p><ul>${removed.map((email) => `<li>${escape(label(email))}</li>`).join("")}</ul><p>These participants have no other active enrollment in this cohort. Their attendance on future linked calendar events and automated participant messages will stop.</p>`);
    text.push("Participants leaving this cohort", ...removed.map((email) => `- ${label(email)}`), "These participants have no other active enrollment in this cohort. Their attendance on future linked calendar events and automated participant messages will stop.");
  }
  if (candidates.length === 0) {
    const explanation = "No participant calendar attendance is affected. Automated messages associated with this cancelled registration will stop.";
    html.push(`<p>${explanation}</p>`);
    text.push(explanation);
  }
  return { html: html.join(""), text: text.join("\n\n") };
}
