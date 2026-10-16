export const registrationCancellationEmail = {
  subject: "Registration cancelled: {{cohort.title}}",
  bodyHtml: `<p>Hello {{registration.primaryContactFirstName}},</p>
<p>This email confirms that your registration for <strong>{{cohort.title}}</strong> has been cancelled.</p>
<p><strong>Cancellation details</strong></p>
<ul>
  <li>Organization: {{organization.name}}</li>
  <li>Registration contact: {{registration.primaryContactName}}</li>
  <li>Participants removed: {{registration.participantCount}}</li>
  <li>Invoice: {{registration.invoiceNumber}}</li>
</ul>
<p>The participants associated with this registration have been removed from future cohort calendar events and will not receive additional automated cohort messages.</p>
<p>Thank you,<br>{{support.teamName}}</p>`,
  bodyText: `Hello {{registration.primaryContactFirstName}},

This email confirms that your registration for {{cohort.title}} has been cancelled.

Cancellation details
- Organization: {{organization.name}}
- Registration contact: {{registration.primaryContactName}}
- Participants removed: {{registration.participantCount}}
- Invoice: {{registration.invoiceNumber}}

The participants associated with this registration have been removed from future cohort calendar events and will not receive additional automated cohort messages.

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
