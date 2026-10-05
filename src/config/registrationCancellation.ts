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
<p>This cancellation does not by itself confirm a refund. If payment was already made or you have a billing question, please contact us at {{support.email}}.</p>
<p>Thank you,<br>{{support.teamName}}</p>`,
  bodyText: `Hello {{registration.primaryContactFirstName}},

This email confirms that your registration for {{cohort.title}} has been cancelled.

Cancellation details
- Organization: {{organization.name}}
- Registration contact: {{registration.primaryContactName}}
- Participants removed: {{registration.participantCount}}
- Invoice: {{registration.invoiceNumber}}

The participants associated with this registration have been removed from future cohort calendar events and will not receive additional automated cohort messages.

This cancellation does not by itself confirm a refund. If payment was already made or you have a billing question, please contact us at {{support.email}}.

Thank you,
{{support.teamName}}`
};
