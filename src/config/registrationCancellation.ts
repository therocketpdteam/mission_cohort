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
<p>If we have already received your payment, we will issue a refund to the mailing address provided with your registration. If payment has not been sent or processed, no further action is needed and you may disregard the invoice we previously sent.</p>
<p>Thank you,<br>{{support.teamName}}</p>`,
  bodyText: `Hello {{registration.primaryContactFirstName}},

This email confirms that your registration for {{cohort.title}} has been cancelled.

Cancellation details
- Organization: {{organization.name}}
- Registration contact: {{registration.primaryContactName}}
- Participants removed: {{registration.participantCount}}
- Invoice: {{registration.invoiceNumber}}

The participants associated with this registration have been removed from future cohort calendar events and will not receive additional automated cohort messages.

If we have already received your payment, we will issue a refund to the mailing address provided with your registration. If payment has not been sent or processed, no further action is needed and you may disregard the invoice we previously sent.

Thank you,
{{support.teamName}}`
};
