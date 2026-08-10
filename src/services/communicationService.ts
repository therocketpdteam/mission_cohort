import { CohortStatus, CommunicationStatus, EmailEventType, OperationsTaskCategory, OperationsTaskStatus, ParticipantStatus, Prisma, RecipientScope, RegistrationStatus, Role, TemplateType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isMissingEmailReviewColumn, migrationRequiredResult } from "@/lib/prismaCompatibility";
import {
  communicationDraftCreateSchema,
  communicationScheduleSchema,
  communicationTemplateCreateSchema,
  communicationTemplateUpdateSchema
} from "@/validators/communication";
import { logAuditEventAsync } from "./auditService";
import { generateSessionReminderSchedule, textToEmailHtml } from "@/modules/email";
import { renderTemplate, sendEmail } from "@/services/emailService";
import { deletePrivateAppFile } from "@/services/storageService";
import { assertCohortDeliveryAllowed, assertOutboundRecipientsAllowed, getSendGridSetup } from "@/services/integrationSetupService";
import { getOrganizationInvoiceProfile } from "./appSettingsService";
import { registrationConfirmationDocumentReadiness } from "./registrationDocumentReadiness";

type DefaultTemplate = {
  type: TemplateType;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
};

export type ManualCustomEmailRecipientMode = "participants" | "pocs" | "participants_and_pocs";

type ManualCustomEmailParticipantInput = {
  id: string;
  cohortId: string;
  email?: string | null;
  registration?: {
    id: string;
    primaryContactEmail?: string | null;
  } | null;
};

type ManualEmailTarget = {
  cohortId: string;
  recipientEmail: string;
  participantId?: string;
  registrationId?: string;
  participant?: Record<string, unknown>;
  registration?: Record<string, unknown> | null;
  organization?: Record<string, unknown> | null;
  cohort?: Record<string, unknown>;
};

export function buildManualCustomEmailRecipientGroups(
  participants: ManualCustomEmailParticipantInput[],
  recipientMode: ManualCustomEmailRecipientMode
) {
  const seen = new Set<string>();
  const groups = new Map<string, { cohortId: string; recipientEmails: string[]; participantIds: string[]; registrationIds: string[] }>();

  function addRecipient(input: { cohortId: string; email?: string | null; participantId?: string; registrationId?: string }) {
    const email = String(input.email ?? "").trim().toLowerCase();

    if (!email || seen.has(email)) {
      return;
    }

    seen.add(email);
    const group = groups.get(input.cohortId) ?? { cohortId: input.cohortId, recipientEmails: [], participantIds: [], registrationIds: [] };
    group.recipientEmails.push(email);
    if (input.participantId && !group.participantIds.includes(input.participantId)) {
      group.participantIds.push(input.participantId);
    }
    if (input.registrationId && !group.registrationIds.includes(input.registrationId)) {
      group.registrationIds.push(input.registrationId);
    }
    groups.set(input.cohortId, group);
  }

  for (const participant of participants) {
    if (recipientMode === "participants" || recipientMode === "participants_and_pocs") {
      addRecipient({ cohortId: participant.cohortId, email: participant.email, participantId: participant.id, registrationId: participant.registration?.id });
    }

    if (recipientMode === "pocs" || recipientMode === "participants_and_pocs") {
      addRecipient({ cohortId: participant.cohortId, email: participant.registration?.primaryContactEmail, registrationId: participant.registration?.id });
    }
  }

  return Array.from(groups.values());
}

function cohortMergeContext(cohort: Record<string, any> | undefined) {
  const presenter = cohort?.presenter ?? {};

  return {
    ...cohort,
    title: cohort?.title,
    description: cohort?.description,
    guideTopic: cohort?.guideTopic,
    guideUrl: cohort?.guideUrl,
    podcastUrl: cohort?.podcastUrl,
    startDate: cohort?.startDate,
    presenterName: [presenter.firstName, presenter.lastName].filter(Boolean).join(" "),
    presenterFirstName: presenter.firstName,
    presenterLastName: presenter.lastName,
    presenterEmail: presenter.email
  };
}

function formatMergeDate(value: unknown) {
  if (!value) {
    return "";
  }
  const date = new Date(value as string | Date);
  if (!Number.isFinite(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatMergeMoney(value: unknown) {
  if (typeof value === "string" && value.trim().startsWith("$")) {
    return value;
  }
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return String(value ?? "");
  }

  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function registrationMergeContext(registration: Record<string, any> | undefined) {
  if (!registration) {
    return undefined;
  }
  const invoice = Array.isArray(registration.invoiceDrafts) ? registration.invoiceDrafts[0] : null;
  const primaryContactName = String(registration.primaryContactName ?? "").trim();
  const primaryContactFirstName = primaryContactName.split(/\s+/).filter(Boolean)[0] || primaryContactName;
  const participantCount = Number(registration.participantCount ?? 0);
  const savedParticipantCount = Array.isArray(registration.participants)
    ? registration.participants.length
    : Number(registration._count?.participants ?? 0);
  const rosterStatus = String(registration.participantListStatus ?? "").toUpperCase();
  const rosterComplete = rosterStatus === "COMPLETE" || (participantCount > 0 && savedParticipantCount >= participantCount);
  const participantRosterNextStep = rosterComplete || participantCount <= 1
    ? "We received the participant information we need, so there is nothing else you need to do right now."
    : "We still need participant names and work email addresses. Please reply with each participant on a separate line, or send the roster to info@rocketpd.com, so we can send calendar invitations, meeting links, reminders, and resources.";

  return {
    ...registration,
    primaryContactFirstName,
    totalAmount: formatMergeMoney(registration.totalAmount),
    invoiceSentDate: formatMergeDate(registration.confirmationDocsSentAt ?? invoice?.issueDate ?? registration.createdAt),
    purchaseOrderLine: registration.purchaseOrderNumber ? `Purchase order: ${registration.purchaseOrderNumber}` : "",
    purchaseOrderBullet: registration.purchaseOrderNumber ? `- Purchase order: ${registration.purchaseOrderNumber}` : "",
    participantRosterNextStep
  };
}

function participantMergeContext(participant: Record<string, any> | undefined) {
  if (!participant) {
    return undefined;
  }

  return {
    ...participant,
    fullName: [participant.firstName, participant.lastName].filter(Boolean).join(" ")
  };
}

function buildManualEmailTargets(participants: Array<Record<string, any>>, recipientMode: ManualCustomEmailRecipientMode) {
  const seen = new Set<string>();
  const targets: ManualEmailTarget[] = [];

  function addTarget(target: ManualEmailTarget) {
    const email = String(target.recipientEmail ?? "").trim().toLowerCase();

    if (!email || seen.has(email)) {
      return;
    }

    seen.add(email);
    targets.push({ ...target, recipientEmail: email });
  }

  for (const participant of participants) {
    const registration = participant.registration ?? null;
    const organization = participant.organization ?? registration?.organization ?? null;

    if (recipientMode === "participants" || recipientMode === "participants_and_pocs") {
      addTarget({
        cohortId: participant.cohortId,
        recipientEmail: participant.email,
        participantId: participant.id,
        registrationId: registration?.id,
        participant,
        registration,
        organization,
        cohort: participant.cohort
      });
    }

    if (recipientMode === "pocs" || recipientMode === "participants_and_pocs") {
      addTarget({
        cohortId: participant.cohortId,
        recipientEmail: registration?.primaryContactEmail,
        registrationId: registration?.id,
        registration,
        organization,
        cohort: participant.cohort
      });
    }
  }

  return targets;
}

function manualEmailContext(target: ManualEmailTarget) {
  return {
    cohort: cohortMergeContext(target.cohort),
    participant: participantMergeContext(target.participant),
    organization: target.organization ?? undefined,
    registration: registrationMergeContext(target.registration ?? undefined)
  };
}

function defaultEmailTemplate(template: Omit<DefaultTemplate, "bodyHtml"> & { bodyHtml?: string }): DefaultTemplate {
  return {
    ...template,
    bodyHtml: template.bodyHtml ?? textToEmailHtml(template.bodyText)
  };
}

export const defaultTemplates: DefaultTemplate[] = [
  defaultEmailTemplate({
    type: TemplateType.REGISTRATION_CONFIRMATION,
    name: "Registration Confirmation",
    subject: "Registration confirmation: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

Thank you for signing up for **{{cohort.title}}** with {{cohort.presenterName}}.

This email confirms your initial registration in the live-virtual cohort experience.

If you registered a team or group, someone from RocketPD will reach out shortly to confirm participant names and emails and to make sure calendar invitations and session links are set up correctly.

If you requested a purchase order, a RocketPD team member will help make sure you have the information and forms needed for purchase and accounting.

As we get closer to launch, you and any registered team members can expect:

- Calendar invites to the sessions, including sign-in links
- A kickoff email at least one week before the first session
- Reminder emails before each session
- Periodic thought-leader resources, recordings, and next steps
- A post-event email with follow-up information and a survey
- Certificates of completion when requested by your school or district in advance

Thank you again for registering. We can’t wait to get started.

Questions at any time? Reply to this message or contact info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.WEEK_BEFORE_REMINDER,
    name: "1 Week Before Session",
    subject: "One week reminder: {{cohort.title}}",
    bodyText: `Hello {{participant.firstName}},

You’re receiving this because you are registered for RocketPD’s **{{cohort.title}}** cohort with {{cohort.presenterName}}.

Your next live session is **{{session.title}}**, and it is coming up on {{session.startTime}}.

[Join the session]({{session.meetingUrl}})

A few important notes:

- Please use the Zoom link in this email or in your calendar invitation.
- The meeting room will open about 10 minutes before the session begins.
- Live attendance is encouraged, and recordings/resources will be shared when available.
- If you have questions about the portal, recordings, certificates, or the cohort experience, email info@rocketpd.com.

We look forward to learning alongside you.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.DAY_BEFORE_REMINDER,
    name: "24 Hours Before Session",
    subject: "Reminder: {{cohort.title}} session is live tomorrow",
    bodyText: `Hello {{participant.firstName}},

This is a quick reminder that tomorrow’s **{{cohort.title}}** cohort session with {{cohort.presenterName}} is **{{session.title}}**.

The session begins at {{session.startTime}}.

Please see your calendar invitation or use the link below to sign in. The meeting room will be open 10 minutes before the session begins.

[Join the session]({{session.meetingUrl}})

Questions or trouble signing in? Email info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.HOUR_BEFORE_REMINDER,
    name: "60 Minutes Before Session",
    subject: "60 minutes away: {{cohort.title}}",
    bodyText: `Hi {{participant.firstName}},

{{cohort.presenterName}} is excited to begin **{{session.title}}** in about one hour.

Please use the link below or the one in your calendar invitation to join.

[Join the session]({{session.meetingUrl}})

If you have questions or run into any issues, contact us at (855) 757-6253 or info@rocketpd.com.

{{cohort.presenterName}} is looking forward to seeing you there.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.FOLLOW_UP,
    name: "24 Hours Post Session",
    subject: "Follow-up: {{session.title}}",
    bodyText: `Hi {{participant.firstName}},

What a great session yesterday.

As promised, we’re sharing resources for **{{session.title}}** in **{{cohort.title}}**.

[Access the cohort resources]({{session.resourcesUrl}})

Recordings are typically uploaded to the RocketPD Learning Portal within 24 hours after each scheduled session and remain available for up to 30 days after the final session.

If this is your first time logging in, you may be asked to create a password. Your username is the email address used for your registration.

Your experience is everything to us. If you have questions about resources, recordings, the learning community, or anything inside your RocketPD portal, please reach out to info@rocketpd.com.

Thank you,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.PAYMENT_REMINDER,
    name: "Payment Reminder",
    subject: "Invoice reminder for {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactFirstName}},

I hope you are doing well.

I'm reaching out with a quick payment reminder for **{{cohort.title}}**. We are excited to have your team learning with us, and we would appreciate your help getting the invoice wrapped up.

Invoice number: {{registration.invoiceNumber}}
Invoice sent: {{registration.invoiceSentDate}}
Amount: **{{registration.totalAmount}}**
{{registration.purchaseOrderLine}}

I've attached the invoice and RocketPD W-9 to make this easy to forward to your business office.

If a purchase order, updated invoice detail, or anything else is needed before payment can be processed, just reply here and we'll take care of it quickly.

Thank you for helping us keep everything on track,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Participant List Request",
    subject: "Participant list needed: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactFirstName}},

Hope you are well.

We are excited to have {{organization.name}} as part of **{{cohort.title}}**.

You registered more than one person for this cohort, and we still need participant names, work email addresses, and titles if available so every participant receives calendar invitations, meeting links, reminders, and resources.

Please reply with each participant on a separate line, like this:

- First Last, Title, email@school.org
- First Last, Title, email@school.org

You can also reply with an Excel file if that is easier.

We will not share these names or email addresses outside RocketPD without permission.

Questions? Reply here or contact info@rocketpd.com.

Kind regards,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Supporting Documents Request",
    subject: "Supporting documents needed: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactFirstName}},

We are preparing **{{cohort.title}}** for {{organization.name}} and want to make sure your purchasing/accounting team has everything it needs.

Available documents:

The invoice and RocketPD W-9 are attached to this email for your convenience.

If you need a PO number added, a revised invoice date, an updated participant count, or any other adjustment, reply directly to this message and we’ll take care of it.

Thank you,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Registration Cancellation",
    subject: "Registration update: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

This is to confirm that the registration for **{{organization.name}}** in **{{cohort.title}}** has been removed.

If this was unexpected or you need help moving the registration to a different cohort, please reply to this message and the RocketPD team will help.

Thank you,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Cohort Cancellation",
    subject: "Cancelled: {{cohort.title}}",
    bodyText: `Hello,

The remaining sessions for **{{cohort.title}}** have been cancelled.

Google Calendar invitations have been removed. Please contact the RocketPD team at info@rocketpd.com if you have any questions or need support.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Session Cancellation",
    subject: "Cancelled: {{session.title}} | {{cohort.title}}",
    bodyText: `Hello,

**{{session.title}}** for **{{cohort.title}}** has been cancelled.

The Google Calendar invitation has been removed. Please contact the RocketPD team at info@rocketpd.com if you have any questions.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Session Updated",
    subject: "Updated: {{session.title}} | {{cohort.title}}",
    bodyText: `Hello,

**{{session.title}}** for **{{cohort.title}}** has been updated.

The session is now scheduled for {{session.startTime}}. Your Google Calendar invitation has also been updated.

Please contact the RocketPD team at info@rocketpd.com if you have any questions.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "POC Registration Confirmation",
    subject: "Registration received: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactFirstName}},

Hope you are well.

We received the registration for **{{organization.name}}** in **{{cohort.title}}** with {{cohort.presenterName}}.

Registration summary:

- Participants registered: {{registration.participantCount}}
- Invoice number: {{registration.invoiceNumber}}
{{registration.purchaseOrderBullet}}

Available documents:

Your invoice and RocketPD W-9 are attached to this email for your convenience.

{{registration.participantRosterNextStep}}

Thank you again for signing up for this cohort. We’re looking forward to a great experience.

Kind regards,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Participant Registration Confirmation",
    subject: "You're registered: {{cohort.title}}",
    bodyText: `Hello {{participant.firstName}},

You’re receiving this because you, or someone on your team, registered you to participate in RocketPD’s **{{cohort.title}}** cohort with {{cohort.presenterName}}.

We couldn’t be more excited to start this journey with you.

You will receive calendar invitations and meeting links at this email address, plus reminder emails as each session approaches.

What to expect:

- Calendar invitations for each live session
- A kickoff email before the first session
- Reminder emails before each session
- Resources and recordings when available
- A feedback survey and certificate information after the cohort

Questions? Email info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Three Weeks Before Cohort",
    subject: "Getting ready for {{cohort.title}} with {{cohort.presenterName}}",
    bodyText: `Hello {{participant.firstName}},

Thank you again for registering for **{{cohort.title}}** with {{cohort.presenterName}}.

As a reminder, your first session starts on {{session.startTime}}.

You will receive a calendar invitation with a link to access the session and reminder email at least one week prior to the event. You will receive additional calendar invitations and reminder emails for each subsequent session.

Want to start your learning early?

Here are three steps you can take to prepare for your cohort experience:

1. [Download our free guide on {{cohort.guideTopic}}]({{cohort.guideUrl}}).
2. [{{cohort.presenterName}} on The RocketPD Podcast]({{cohort.podcastUrl}}).
3. Set up your profile on the RocketPD Learning Portal - this is where you’ll access related recordings and resources during the cohort.

Expect more information and resources from us one week prior to the first live cohort session.

In the meantime, should you have any questions about your registration, billing, the schedule, or anything else regarding the content, or your learning experience, don’t hesitate to reach us at info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "One Week Before Cohort",
    subject: "Kick-off: {{cohort.title}}",
    bodyText: `Hello {{participant.firstName}},

You’re receiving this because you, or someone on your team, registered you for RocketPD’s **{{cohort.title}}** cohort with {{cohort.presenterName}}.

We couldn’t be more excited to start this journey with you.

As a reminder, the first session kicks off on {{session.startTime}}.

[Here is your sign-in link]({{session.meetingUrl}})

How to prepare:

- Review your calendar invitation and make sure the session link is available.
- Join a few minutes early so we can help with any access issues.
- Watch for portal/resource information from RocketPD as the cohort begins.

Recordings:

Live attendance is encouraged. When recordings are available, they are typically posted within 24 hours after the live session and remain available for a limited time after the cohort concludes.

Certificates:

If certificates are part of your cohort experience, you will receive survey/certificate instructions after completion.

Questions about the portal, recordings, certificates, or the cohort experience? Email info@rocketpd.com.

Can’t wait to learn alongside you.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Registration Changes Summary",
    subject: "Registration updates: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

The requested registration updates have been applied for **{{cohort.title}}**.

If this update affected participants, calendar invitations and participant communications will reflect the updated roster.

If this update affected billing, your invoice/receipt information will be updated as needed.

Questions? Reply to this message or contact info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Post Cohort Feedback",
    subject: "{{participant.firstName}}, share your feedback and receive your certificate",
    bodyText: `Hello {{participant.firstName}},

This is Corey, one of the co-founders at RocketPD.

Recently, you participated in **{{cohort.title}}** with {{cohort.presenterName}}. As a condition of your participation, you may be eligible for a custom certificate of completion that you can share with your administration for professional development hours or units.

To obtain your certificate, please complete the brief learning survey linked below. Once complete, your certificate will be sent to the email address we have on file.

[Yes, take the survey](https://rocketpd.com/survey)

Why a survey?

We have one goal at RocketPD: to support educators everywhere through high-quality professional learning. Your voice is one of the most important ways we improve the experience for educators like you.

As a reminder, cohort recordings and resources are available for a limited time after the final session.

If you do not receive your certificate, cannot find it, or need support, email info@rocketpd.com and someone will help.

Thank you,
The RocketPD Team`
  })
];

const legacyDefaultBodyTextByName: Record<string, string> = {
  "Registration Confirmation": "Hello {{registration.primaryContactName}}, your registration for {{cohort.title}} has been received.",
  "1 Week Before Session": "Hello {{participant.firstName}}, {{session.title}} for {{cohort.title}} is coming up in one week.",
  "24 Hours Before Session": "Hello {{participant.firstName}}, this is your 24-hour reminder for {{session.title}}.",
  "60 Minutes Before Session": "Hello {{participant.firstName}}, {{session.title}} starts in about 60 minutes.",
  "24 Hours Post Session": "Hello {{participant.firstName}}, thank you for attending {{session.title}}. Resources and next steps will be shared here.",
  "Payment Reminder": "Hello {{registration.primaryContactName}}, this is a friendly reminder about payment status for {{cohort.title}}.",
  "Participant List Request": "Hello {{registration.primaryContactName}}, we are preparing {{cohort.title}} and still need the participant roster for {{organization.name}}. Please reply with the participant names and emails when ready.",
  "Supporting Documents Request": "Hello {{registration.primaryContactName}}, we are preparing {{cohort.title}} and need the remaining supporting documents for {{organization.name}}. Please reply with the needed documentation when available.",
  "Registration Cancellation": "Hello {{registration.primaryContactName}}, this is to confirm that the registration for {{organization.name}} in {{cohort.title}} has been removed.",
  "Cohort Cancellation": "The remaining sessions for {{cohort.title}} have been cancelled. Google Calendar invitations have been removed. Please contact the RocketPD team if you have any questions.",
  "Session Cancellation": "{{session.title}} for {{cohort.title}} has been cancelled. The Google Calendar invitation has been removed. Please contact the RocketPD team if you have any questions.",
  "Session Updated": "{{session.title}} for {{cohort.title}} has been updated. The session is now scheduled for {{session.startTime}}. Your Google Calendar invitation has also been updated. Please contact the RocketPD team if you have any questions.",
  "POC Registration Confirmation": "Hello {{registration.primaryContactName}}, we received the registration for {{organization.name}} in {{cohort.title}}. Available registration documents are attached below.",
  "Participant Registration Confirmation": "Hello {{participant.firstName}}, you are registered for {{cohort.title}}. You will receive calendar invitations and future session reminders at this email address.",
  "Three Weeks Before Cohort": "Hello {{participant.firstName}}, {{cohort.title}} begins in about three weeks. Prepare with {{cohort.guideTopic}}, {{cohort.guideUrl}}, and {{cohort.podcastUrl}}.",
  "One Month Before Cohort": "Hello {{participant.firstName}}, {{cohort.title}} begins in about one month. Your calendar invitations contain the latest session details.",
  "One Week Before Cohort": "Hello {{participant.firstName}}, {{cohort.title}} begins in one week. Please review your calendar invitations for the latest session details.",
  "Registration Changes Summary": "Hello {{registration.primaryContactName}}, the requested registration updates have been applied for {{cohort.title}}."
};

const defaultCopyRefreshMatchers: Record<string, (bodyText: string) => boolean> = {
  "1 Week Before Session": (bodyText) =>
    bodyText.includes("You’re receiving this because you are registered for **{{session.title}}** in RocketPD’s **{{cohort.title}}** cohort"),
  "24 Hours Before Session": (bodyText) =>
    bodyText.includes("This is a quick reminder that **{{session.title}}** for **{{cohort.title}}**, with {{cohort.presenterName}}, is tomorrow"),
  "POC Registration Confirmation": (bodyText) =>
    bodyText.includes("- Payment status: {{registration.paymentStatus}}") ||
    bodyText.includes("- Payment status: **{{registration.paymentStatus}}**") ||
    bodyText.includes("If you registered a team and already shared participant information"),
  "Participant List Request": (bodyText) =>
    bodyText.includes("Hello {{registration.primaryContactName}}") ||
    bodyText.includes("participant names and work email addresses so every participant receives"),
  "Supporting Documents Request": (bodyText) =>
    bodyText.includes("Hello {{registration.primaryContactName}}") ||
    bodyText.includes("{{registration.w9Url}}") ||
    bodyText.includes("{{registration.invoiceUrl}}"),
  "Payment Reminder": (bodyText) =>
    bodyText.includes("Hello {{registration.primaryContactName}}") ||
    bodyText.includes("This is a friendly reminder about payment for **{{cohort.title}}**.") ||
    bodyText.includes("Your invoice and RocketPD W-9 are attached to this email for your convenience.") ||
    bodyText.includes("Payment status: **{{registration.paymentStatus}}**") ||
    bodyText.includes("Amount: **{{registration.totalAmount}}**\n\nI've attached")
};

const sessionTemplateTypes = [
  TemplateType.WEEK_BEFORE_REMINDER,
  TemplateType.DAY_BEFORE_REMINDER,
  TemplateType.HOUR_BEFORE_REMINDER,
  TemplateType.FOLLOW_UP
] as const;

export function sessionTemplateTypesForSession(sessionNumber?: number | null) {
  const normalizedSessionNumber = Number(sessionNumber ?? 1);
  return normalizedSessionNumber <= 1
    ? [...sessionTemplateTypes]
    : sessionTemplateTypes.filter((type) => type !== TemplateType.WEEK_BEFORE_REMINDER);
}

export async function getSystemUserId() {
  const user = await prisma.user.upsert({
    where: { email: "system@mission-control.local" },
    update: { active: true },
    create: {
      email: "system@mission-control.local",
      firstName: "Mission",
      lastName: "Control",
      role: Role.SUPER_ADMIN,
      active: true
    }
  });

  return user.id;
}

export async function ensureDefaultCommunicationTemplates() {
  const templates = [];

  for (const template of defaultTemplates) {
    const existing = await prisma.communicationTemplate.findFirst({ where: { type: template.type, name: template.name } });
    const shouldRefreshLegacyDefault = Boolean(existing && legacyDefaultBodyTextByName[template.name]?.trim() === existing.bodyText?.trim());
    const shouldRefreshDefaultCopy = Boolean(existing && defaultCopyRefreshMatchers[template.name]?.(existing.bodyText?.trim() ?? ""));
    const shouldRefreshPocAttachmentCopy = Boolean(
      existing?.name === "POC Registration Confirmation" &&
      (existing.bodyText?.includes("{{registration.w9Url}}") || existing.bodyText?.includes("{{registration.invoiceUrl}}"))
    );
    const shouldRefreshPaymentReminderAttachmentCopy = Boolean(
      existing?.name === "Payment Reminder" &&
      (existing.bodyText?.includes("{{registration.w9Url}}") || existing.bodyText?.includes("{{registration.invoiceUrl}}"))
    );
    const shouldRefreshExisting = shouldRefreshLegacyDefault || shouldRefreshDefaultCopy || shouldRefreshPocAttachmentCopy || shouldRefreshPaymentReminderAttachmentCopy;

    if (existing) {
      const updated = await prisma.communicationTemplate.update({
        where: { id: existing.id },
        data: {
          active: existing.active,
          subject: shouldRefreshExisting || !existing.subject ? template.subject : existing.subject,
          bodyHtml: shouldRefreshExisting || !existing.bodyHtml ? template.bodyHtml : existing.bodyHtml,
          bodyText: shouldRefreshExisting || !existing.bodyText ? template.bodyText : existing.bodyText
        }
      });

      if (shouldRefreshExisting && existing.bodyText) {
        await prisma.cohortCommunication.updateMany({
          where: {
            templateId: existing.id,
            sentAt: null,
            status: { in: [CommunicationStatus.DRAFT, CommunicationStatus.SCHEDULED, CommunicationStatus.FAILED] },
            bodyText: existing.bodyText
          },
          data: {
            subject: template.subject,
            bodyHtml: template.bodyHtml,
            bodyText: template.bodyText,
            providerError: null
          }
        });
      }

      templates.push(updated);
      continue;
    }

    templates.push(await prisma.communicationTemplate.create({ data: { ...template, active: true } }));
  }

  return templates;
}

const recipientIssueTypes = new Set<EmailEventType>([EmailEventType.BOUNCED, EmailEventType.FAILED]);

type EventSummaryInput = {
  id?: string;
  eventType: EmailEventType;
  recipientEmail?: string;
  createdAt: Date;
  reviewedAt?: Date | null;
  reviewedById?: string | null;
  reviewNote?: string | null;
};

type LegacyEmailEventRow = EventSummaryInput & {
  communicationId: string | null;
  provider: string;
  providerMessageId: string | null;
  eventPayload: Prisma.JsonValue | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function recordFailedEmailEvents(communicationId: string, recipients: string[], error: unknown) {
  const recipientEmails = Array.from(new Set(recipients.map((email) => normalizeEmail(email)).filter(Boolean)));

  if (recipientEmails.length === 0) {
    return;
  }

  await prisma.emailEvent.createMany({
    data: recipientEmails.map((recipientEmail) => ({
      communicationId,
      recipientEmail,
      provider: "sendgrid",
      eventType: EmailEventType.FAILED,
      eventPayload: {
        error: error instanceof Error ? error.message : "Unknown SendGrid error"
      }
    }))
  });
}

export function emailEventSummary(events: EventSummaryInput[]) {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] ?? 0) + 1;
    return acc;
  }, {});
  const latest = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const issueEvents = events.filter((event) => recipientIssueTypes.has(event.eventType));
  const unreviewedIssueEvents = issueEvents.filter((event) => !event.reviewedAt);

  return {
    lastEmailEvent: latest?.eventType ?? null,
    lastEmailEventAt: latest?.createdAt ?? null,
    sentCount: counts.SENT ?? 0,
    deliveredCount: counts.DELIVERED ?? 0,
    openedCount: counts.OPENED ?? 0,
    clickedCount: counts.CLICKED ?? 0,
    bouncedCount: counts.BOUNCED ?? 0,
    failedCount: counts.FAILED ?? 0,
    unsubscribedCount: counts.UNSUBSCRIBED ?? 0,
    issueCount: issueEvents.length,
    unreviewedIssueCount: unreviewedIssueEvents.length,
    reviewedIssueCount: issueEvents.length - unreviewedIssueEvents.length
  };
}

export function buildRecipientDeliveryRows(events: EventSummaryInput[], relatedByEmail: Map<string, unknown> = new Map()) {
  const grouped = new Map<string, EventSummaryInput[]>();

  for (const event of events) {
    const key = normalizeEmail(event.recipientEmail ?? "");
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return Array.from(grouped.entries())
    .map(([email, recipientEvents]) => {
      const sortedEvents = [...recipientEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const issueEvents = sortedEvents.filter((event) => recipientIssueTypes.has(event.eventType));
      const unreviewedIssueEvents = issueEvents.filter((event) => !event.reviewedAt);
      return {
        id: email,
        recipientEmail: email,
        events: sortedEvents,
        latestEvent: sortedEvents[0]?.eventType ?? null,
        latestEventAt: sortedEvents[0]?.createdAt ?? null,
        issueEvents,
        unreviewedIssueEvents,
        needsReview: unreviewedIssueEvents.length > 0,
        emailSummary: emailEventSummary(sortedEvents),
        related: relatedByEmail.get(email) ?? null
      };
    })
    .sort((a, b) => {
      if (a.needsReview !== b.needsReview) {
        return a.needsReview ? -1 : 1;
      }
      return new Date(b.latestEventAt ?? 0).getTime() - new Date(a.latestEventAt ?? 0).getTime();
    });
}

export async function createTemplate(input: z.input<typeof communicationTemplateCreateSchema>) {
  const data = communicationTemplateCreateSchema.parse(input);
  return prisma.communicationTemplate.create({ data });
}

export async function updateTemplate(id: string, input: z.input<typeof communicationTemplateUpdateSchema>) {
  const data = communicationTemplateUpdateSchema.parse(input);
  return prisma.communicationTemplate.update({ where: { id }, data });
}

export async function createCommunicationDraft(input: z.input<typeof communicationDraftCreateSchema>) {
  const data = communicationDraftCreateSchema.parse(input);
  return prisma.cohortCommunication.create({ data });
}

export async function addCommunicationAttachment(input: {
  communicationId?: string;
  templateId?: string;
  fileName: string;
  contentType?: string;
  fileSize?: number;
  provider?: string;
  fileKey: string;
  url?: string;
}) {
  return prisma.communicationAttachment.create({
    data: {
      communicationId: input.communicationId,
      templateId: input.templateId,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSize: input.fileSize,
      provider: input.provider,
      fileKey: input.fileKey,
      url: input.url
    }
  });
}

function resourceAttachmentUrl(resource: { url?: string | null; muxPlaybackId?: string | null }) {
  if (resource.url) {
    return resource.url;
  }

  if (resource.muxPlaybackId) {
    return `https://stream.mux.com/${resource.muxPlaybackId}`;
  }

  return null;
}

export async function attachResourceToCommunication(input: { communicationId: string; resourceId: string }) {
  const [communication, resource] = await Promise.all([
    prisma.cohortCommunication.findUnique({ where: { id: input.communicationId } }),
    prisma.cohortResource.findUnique({ where: { id: input.resourceId }, include: { session: true } })
  ]);

  if (!communication) {
    throw Object.assign(new Error("Communication not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (!resource) {
    throw Object.assign(new Error("Material not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (resource.cohortId !== communication.cohortId) {
    throw Object.assign(new Error("Material must belong to the same cohort as this communication."), { code: "BAD_REQUEST", status: 400 });
  }

  if (communication.sessionId && resource.sessionId && resource.sessionId !== communication.sessionId) {
    throw Object.assign(new Error("Session material must belong to this communication's session."), { code: "BAD_REQUEST", status: 400 });
  }

  const fileKey = resource.fileKey || `resource:${resource.id}`;
  const existing = await prisma.communicationAttachment.findFirst({
    where: {
      communicationId: input.communicationId,
      fileKey
    }
  });

  if (existing) {
    return existing;
  }

  return addCommunicationAttachment({
    communicationId: input.communicationId,
    fileName: resource.session ? `${resource.session.sessionNumber}. ${resource.title}` : resource.title,
    contentType: resource.type,
    provider: resource.provider || "resource",
    fileKey,
    url: resourceAttachmentUrl(resource) ?? undefined
  });
}

export async function removeCommunicationAttachment(id: string) {
  const attachment = await prisma.communicationAttachment.findUnique({ where: { id } });

  if (!attachment) {
    throw Object.assign(new Error("Attachment not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (attachment.fileKey && attachment.provider === "supabase" && !attachment.fileKey.startsWith("resource:")) {
    await deletePrivateAppFile(attachment.fileKey).catch(() => null);
  }

  return prisma.communicationAttachment.delete({ where: { id } });
}

export async function scheduleCommunicationPlaceholder(input: z.input<typeof communicationScheduleSchema>) {
  const data = communicationScheduleSchema.parse(input);
  const communication = await prisma.cohortCommunication.update({
    where: { id: data.communicationId },
    data: {
      scheduledFor: data.scheduledFor,
      status: CommunicationStatus.SCHEDULED
    }
  });
  logAuditEventAsync({
    entityType: "CohortCommunication",
    entityId: communication.id,
    action: "SCHEDULED",
    description: "Communication scheduled",
    metadata: { cohortId: communication.cohortId, scheduledFor: communication.scheduledFor?.toISOString() ?? null }
  });
  return communication;
}

async function buildRelatedRecipientMap(emails: string[]) {
  const normalizedEmails = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
  const map = new Map<string, unknown>();

  if (normalizedEmails.length === 0) {
    return map;
  }

  const emailOr = normalizedEmails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } }));
  const registrationOr = normalizedEmails.flatMap((email) => [
    { primaryContactEmail: { equals: email, mode: "insensitive" as const } },
    { billingContactEmail: { equals: email, mode: "insensitive" as const } }
  ]);

  const [participants, registrations] = await Promise.all([
    prisma.participant.findMany({
      where: { OR: emailOr },
      include: { cohort: true, organization: true, registration: true }
    }),
    prisma.registration.findMany({
      where: { OR: registrationOr },
      include: { cohort: true, organization: true }
    })
  ]);

  for (const registration of registrations) {
    for (const email of [registration.primaryContactEmail, registration.billingContactEmail].map((value) => normalizeEmail(value ?? ""))) {
      if (!email || map.has(email)) {
        continue;
      }
      map.set(email, {
        kind: "registration",
        registrationId: registration.id,
        registrationHref: `/registrations?search=${encodeURIComponent(email)}`,
        participantHref: null,
        displayName: registration.primaryContactName,
        organizationName: registration.organization?.name,
        cohortTitle: registration.cohort?.title
      });
    }
  }

  for (const participant of participants) {
    const email = normalizeEmail(participant.email);
    map.set(email, {
      kind: "participant",
      participantId: participant.id,
      registrationId: participant.registrationId,
      participantHref: `/participants?search=${encodeURIComponent(email)}`,
      registrationHref: `/registrations?search=${encodeURIComponent(email)}`,
      displayName: `${participant.firstName} ${participant.lastName}`.trim(),
      organizationName: participant.organization?.name,
      cohortTitle: participant.cohort?.title
    });
  }

  return map;
}

async function enrichCommunications(communications: Array<any>) {
  const emails = communications.flatMap((communication) => communication.emailEvents.map((event: EventSummaryInput) => event.recipientEmail ?? ""));
  const relatedByEmail = await buildRelatedRecipientMap(emails);

  return communications.map((communication) => {
    const recipientRows = buildRecipientDeliveryRows(communication.emailEvents, relatedByEmail);
    const issueRows = recipientRows
      .filter((recipient) => recipient.needsReview)
      .map((recipient) => ({
        id: `${communication.id}:${recipient.recipientEmail}`,
        communicationId: communication.id,
        subject: communication.subject,
        status: communication.status,
        cohort: communication.cohort,
        session: communication.session,
        template: communication.template,
        attachments: communication.attachments,
        recipientEmail: recipient.recipientEmail,
        latestEvent: recipient.latestEvent,
        latestEventAt: recipient.latestEventAt,
        issueEvents: recipient.unreviewedIssueEvents,
        emailSummary: recipient.emailSummary,
        related: recipient.related
      }));

    return {
      ...communication,
      recipientRows,
      issueRows,
      emailSummary: emailEventSummary(communication.emailEvents)
    };
  });
}

async function legacyEmailEventsForCommunicationIds(communicationIds: string[]) {
  if (communicationIds.length === 0) {
    return [];
  }

  return prisma.$queryRaw<LegacyEmailEventRow[]>`
    SELECT id, "communicationId", "recipientEmail", provider, "providerMessageId", "eventType", "eventPayload", "createdAt"
    FROM "EmailEvent"
    WHERE "communicationId" IN (${Prisma.join(communicationIds)})
    ORDER BY "createdAt" DESC
  `;
}

async function legacyEmailEventsForRecipient(email: string) {
  return prisma.$queryRaw<LegacyEmailEventRow[]>`
    SELECT id, "communicationId", "recipientEmail", provider, "providerMessageId", "eventType", "eventPayload", "createdAt"
    FROM "EmailEvent"
    WHERE lower("recipientEmail") = lower(${email})
    ORDER BY "createdAt" DESC
  `;
}

async function listCommunicationsLegacy(input: { cohortId?: string | null; limit?: number; issueOnly?: boolean } = {}) {
  const take = Math.min(Math.max(Number(input.limit ?? 100), 1), 1000);
  const communications = await prisma.cohortCommunication.findMany({
    where: input.cohortId ? { cohortId: input.cohortId } : {},
    orderBy: { createdAt: "desc" },
    take,
    include: { cohort: true, template: true, session: true, createdBy: true, attachments: true }
  });
  const events = await legacyEmailEventsForCommunicationIds(communications.map((communication) => communication.id));
  const eventsByCommunication = new Map<string, LegacyEmailEventRow[]>();

  for (const event of events) {
    if (!event.communicationId) {
      continue;
    }
    eventsByCommunication.set(event.communicationId, [...(eventsByCommunication.get(event.communicationId) ?? []), event]);
  }

  const enriched = await enrichCommunications(communications.map((communication) => ({
    ...communication,
    emailEvents: eventsByCommunication.get(communication.id) ?? []
  })));

  return input.issueOnly ? enriched.filter((communication) => communication.issueRows.length > 0) : enriched;
}

export async function listCommunications(input: { cohortId?: string | null; limit?: number; issueOnly?: boolean } = {}) {
  const take = Math.min(Math.max(Number(input.limit ?? 100), 1), 1000);
  try {
    const communications = await prisma.cohortCommunication.findMany({
      where: {
        ...(input.cohortId ? { cohortId: input.cohortId } : {}),
        ...(input.issueOnly
          ? { emailEvents: { some: { eventType: { in: [EmailEventType.BOUNCED, EmailEventType.FAILED] }, reviewedAt: null } } }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take,
      include: { cohort: true, template: true, session: true, createdBy: true, emailEvents: { include: { reviewedBy: true }, orderBy: { createdAt: "desc" } }, attachments: true }
    });

    return enrichCommunications(communications);
  } catch (error) {
    if (!isMissingEmailReviewColumn(error)) {
      throw error;
    }

    return listCommunicationsLegacy(input);
  }
}

export async function listCommunicationsByCohort(cohortId: string, limit?: number) {
  return listCommunications({ cohortId, limit });
}

export async function listUnreviewedCommunicationIssues(input: { cohortId?: string | null; limit?: number } = {}) {
  const communications = await listCommunications({ ...input, issueOnly: true });
  return communications.flatMap((communication) => communication.issueRows).slice(0, input.limit ?? 100);
}

function emailValues(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value?.trim()));
}

async function resolveCommunicationRecipients(communication: {
  cohortId: string;
  recipientScope: RecipientScope;
  recipientEmails: Prisma.JsonValue | null;
}): Promise<string[]> {
  const cohort = await prisma.cohort.findUnique({
    where: { id: communication.cohortId },
    include: {
      registrations: { where: { archivedAt: null }, include: { participants: true } },
      participants: {
        where: {
          status: ParticipantStatus.REGISTERED,
          registration: { archivedAt: null, status: { not: RegistrationStatus.CANCELLED } }
        }
      }
    }
  });

  if (!cohort) {
    return [];
  }

  if (communication.recipientScope === RecipientScope.PRIMARY_CONTACTS) {
    return emailValues(cohort.registrations.map((registration) => registration.primaryContactEmail));
  }

  if (communication.recipientScope === RecipientScope.BILLING_CONTACTS) {
    return emailValues(cohort.registrations.map((registration) => registration.billingContactEmail));
  }

  if (communication.recipientScope === RecipientScope.CUSTOM) {
    return Array.isArray(communication.recipientEmails)
      ? emailValues(communication.recipientEmails.map((email) => typeof email === "string" ? email : ""))
      : [];
  }

  return emailValues(cohort.participants.map((participant) => participant.email));
}

async function resolveParticipantCommunicationTargets(cohortId: string) {
  const participants = await prisma.participant.findMany({
    where: {
      status: ParticipantStatus.REGISTERED,
      registration: { archivedAt: null, status: { not: RegistrationStatus.CANCELLED } },
      cohortId
    },
    include: {
      organization: true,
      registration: {
        include: {
          organization: true,
          invoiceDrafts: { orderBy: { updatedAt: "desc" } }
        }
      }
    }
  });
  const seen = new Set<string>();
  const targets = [];

  for (const participant of participants) {
    const recipientEmail = String(participant.email ?? "").trim().toLowerCase();
    if (!recipientEmail || seen.has(recipientEmail)) {
      continue;
    }

    seen.add(recipientEmail);
    targets.push({ recipientEmail, participant });
  }

  return targets;
}

async function preflightPocRegistrationConfirmation(communication: {
  id: string;
  template: { name: string } | null;
  registration: any;
}) {
  if (communication.template?.name !== "POC Registration Confirmation" || !communication.registration) {
    return null;
  }

  const invoiceProfile = await getOrganizationInvoiceProfile();
  const readiness = registrationConfirmationDocumentReadiness(communication.registration, invoiceProfile.w9Url);

  if (!readiness.ready) {
    await prisma.cohortCommunication.update({
      where: { id: communication.id },
      data: {
        status: CommunicationStatus.DRAFT,
        providerError: readiness.reason
      }
    });
    throw Object.assign(new Error(readiness.reason ?? "POC confirmation documents are not ready."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  if ((!communication.registration.w9Url && readiness.w9Url) || (!communication.registration.invoiceUrl && readiness.invoiceUrl)) {
    await prisma.registration.update({
      where: { id: communication.registration.id },
      data: {
        w9Url: communication.registration.w9Url || readiness.w9Url || undefined,
        invoiceUrl: communication.registration.invoiceUrl || readiness.invoiceUrl || undefined
      }
    });
  }

  return {
    ...communication.registration,
    w9Url: communication.registration.w9Url || readiness.w9Url,
    invoiceUrl: communication.registration.invoiceUrl || readiness.invoiceUrl
  };
}

async function attachRegistrationBillingDocuments(communicationId: string, registration: {
  id: string;
  w9Url: string | null;
  invoiceUrl: string | null;
  invoiceDrafts?: Array<{
    invoiceNumber?: string | null;
    pdfFileKey?: string | null;
    pdfUrl?: string | null;
  }>;
}, fallbackW9Url?: string | null) {
  const invoice = registration.invoiceDrafts?.find((item) => item.pdfFileKey && item.pdfUrl);
  const w9Url = registration.w9Url || fallbackW9Url || null;
  const documents = [
    invoice
      ? {
          fileName: `Invoice ${invoice.invoiceNumber ?? registration.id}.pdf`,
          contentType: "application/pdf",
          provider: "supabase",
          fileKey: invoice.pdfFileKey!,
          url: invoice.pdfUrl!
        }
      : registration.invoiceUrl
        ? {
            fileName: "Registration invoice.pdf",
            contentType: "application/pdf",
            provider: "external",
            fileKey: `registration/${registration.id}/invoice`,
            url: registration.invoiceUrl
          }
        : null,
    w9Url
      ? {
          fileName: "RocketPD W-9.pdf",
          contentType: "application/pdf",
          provider: "external",
          fileKey: `registration/${registration.id}/w9`,
          url: w9Url
        }
      : null
  ].filter((document): document is { fileName: string; contentType: string; provider: string; fileKey: string; url: string } => Boolean(document));

  for (const document of documents) {
    const existing = await prisma.communicationAttachment.findFirst({
      where: { communicationId, fileKey: document.fileKey }
    });
    if (!existing) {
      await addCommunicationAttachment({ communicationId, ...document });
    }
  }

  return documents.length;
}

async function preflightPaymentReminder(communication: {
  id: string;
  template: { name: string } | null;
  registration: any;
}) {
  if (communication.template?.name !== "Payment Reminder" || !communication.registration) {
    return null;
  }

  const invoiceProfile = await getOrganizationInvoiceProfile();
  const readiness = registrationConfirmationDocumentReadiness(communication.registration, invoiceProfile.w9Url);
  if (!readiness.ready) {
    await prisma.cohortCommunication.update({
      where: { id: communication.id },
      data: {
        status: CommunicationStatus.DRAFT,
        providerError: readiness.reason
      }
    });
    throw Object.assign(new Error(readiness.reason ?? "Payment reminder documents are not ready."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  await attachRegistrationBillingDocuments(communication.id, communication.registration, invoiceProfile.w9Url);

  return {
    ...communication.registration,
    w9Url: communication.registration.w9Url || readiness.w9Url,
    invoiceUrl: communication.registration.invoiceUrl || readiness.invoiceUrl
  };
}

export async function sendCommunication(id: string, options?: { recipients?: string[]; context?: Parameters<typeof sendEmail>[0]["context"]; bypassCohortStatus?: boolean }) {
  const communication = await prisma.cohortCommunication.findUnique({
    where: { id },
    include: {
      cohort: { include: { presenter: true } },
      session: true,
      registration: {
        include: {
          organization: true,
          participants: { where: { status: ParticipantStatus.REGISTERED } },
          invoiceDrafts: { orderBy: { updatedAt: "desc" } }
        }
      },
      participant: true,
      template: true,
      createdBy: true,
      attachments: true
    }
  });

  if (!communication) {
    throw Object.assign(new Error("Communication not found"), { code: "NOT_FOUND", status: 404 });
  }

  const registrationContext = await preflightPocRegistrationConfirmation(communication);
  const paymentReminderRegistrationContext = registrationContext ?? await preflightPaymentReminder(communication);
  const refreshedAttachments = paymentReminderRegistrationContext
    ? await prisma.communicationAttachment.findMany({ where: { communicationId: id } })
    : communication.attachments;

  await prisma.cohortCommunication.update({
    where: { id },
    data: { status: CommunicationStatus.SENDING, providerError: null }
  });

  let attemptedRecipients: string[] = [];

  try {
    const recipients = options?.recipients ?? await resolveCommunicationRecipients(communication);
    attemptedRecipients = recipients;

    if (recipients.length === 0) {
      throw Object.assign(new Error("No recipients were resolved for this communication."), {
        code: "BAD_REQUEST",
        status: 400
      });
    }

    if (options?.bypassCohortStatus) {
      await assertOutboundRecipientsAllowed("SENDGRID", recipients);
    } else {
      await assertCohortDeliveryAllowed("SENDGRID", communication.cohort.status, recipients);
    }
    const baseContext = {
      cohort: cohortMergeContext(communication.cohort),
      session: communication.session ?? undefined,
      participant: communication.participant ?? undefined,
      registration: registrationMergeContext(paymentReminderRegistrationContext ?? communication.registration ?? undefined),
      organization: paymentReminderRegistrationContext?.organization ?? communication.registration?.organization ?? undefined
    };

    if (!options?.recipients && !options?.context && communication.recipientScope === RecipientScope.ALL_PARTICIPANTS) {
      const targets = await resolveParticipantCommunicationTargets(communication.cohortId);
      const targetRecipients = targets.map((target) => target.recipientEmail);

      if (targetRecipients.length === 0) {
        throw Object.assign(new Error("No participant recipients were resolved for this communication."), {
          code: "BAD_REQUEST",
          status: 400
        });
      }

      if (options?.bypassCohortStatus) {
        await assertOutboundRecipientsAllowed("SENDGRID", targetRecipients);
      } else {
        await assertCohortDeliveryAllowed("SENDGRID", communication.cohort.status, targetRecipients);
      }
      const providerMessageIds: string[] = [];
      attemptedRecipients = targetRecipients;

      for (const target of targets) {
        attemptedRecipients = [target.recipientEmail];
        const result = await sendEmail({
          to: target.recipientEmail,
          subject: communication.subject,
          bodyHtml: communication.bodyHtml,
          bodyText: communication.bodyText ?? undefined,
          attachments: refreshedAttachments,
          context: {
            ...baseContext,
            participant: participantMergeContext(target.participant),
            registration: registrationMergeContext(target.participant.registration),
            organization: target.participant.organization ?? target.participant.registration?.organization ?? undefined
          }
        });
        if (result.providerMessageId) {
          providerMessageIds.push(result.providerMessageId);
        }
        await prisma.emailEvent.create({
          data: {
            communicationId: id,
            recipientEmail: target.recipientEmail,
            provider: "sendgrid",
            providerMessageId: result.providerMessageId,
            eventType: EmailEventType.SENT
          }
        });
      }

      return prisma.cohortCommunication.update({
        where: { id },
        data: {
          status: CommunicationStatus.SENT,
          sentAt: new Date(),
          providerMessageId: providerMessageIds[0] ?? undefined,
          providerError: null
        }
      });
    }

    const result = await sendEmail({
      to: recipients,
      subject: communication.subject,
      bodyHtml: communication.bodyHtml,
      bodyText: communication.bodyText ?? undefined,
      attachments: refreshedAttachments,
      context: options?.context ?? baseContext
    });

    await prisma.emailEvent.createMany({
      data: recipients.map((recipientEmail) => ({
        communicationId: id,
        recipientEmail,
        provider: "sendgrid",
        providerMessageId: result.providerMessageId,
        eventType: EmailEventType.SENT
      }))
    });

    return prisma.cohortCommunication.update({
      where: { id },
      data: {
        status: CommunicationStatus.SENT,
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        providerError: null
      }
    });
  } catch (error) {
    await recordFailedEmailEvents(id, attemptedRecipients, error);
    await prisma.cohortCommunication.update({
      where: { id },
      data: {
        status: CommunicationStatus.FAILED,
        providerError: error instanceof Error ? error.message : "Unknown SendGrid error"
      }
    });
    throw error;
  }
}

export async function sendCommunicationToRecipient(input: { communicationId: string; recipientEmail: string }) {
  const recipientEmail = input.recipientEmail.trim();

  if (!recipientEmail) {
    throw Object.assign(new Error("recipientEmail is required"), { code: "BAD_REQUEST", status: 400 });
  }

  return sendCommunication(input.communicationId, { recipients: [recipientEmail] });
}

export async function cancelCommunication(input: { id: string }) {
  const communication = await prisma.cohortCommunication.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, sentAt: true }
  });

  if (!communication) {
    throw Object.assign(new Error("Communication not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (communication.sentAt || communication.status === CommunicationStatus.SENT || communication.status === CommunicationStatus.SENDING) {
    throw Object.assign(new Error("Sent or sending communications cannot be cancelled from the journey."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return prisma.cohortCommunication.update({
    where: { id: input.id },
    data: {
      status: CommunicationStatus.CANCELLED,
      scheduledFor: null,
      providerError: null
    }
  });
}

export async function sendCalendarCancellationNotice(input: { cohortId: string; sessionId?: string }) {
  await ensureDefaultCommunicationTemplates();
  const templateName = input.sessionId ? "Session Cancellation" : "Cohort Cancellation";
  const template = await prisma.communicationTemplate.findFirst({
    where: { name: templateName, type: TemplateType.CUSTOM, active: true }
  });

  if (!template) {
    throw Object.assign(new Error(`${templateName} template is unavailable.`), { code: "NOT_FOUND", status: 404 });
  }

  const communication = await createCommunicationFromTemplate({
    templateId: template.id,
    cohortId: input.cohortId,
    sessionId: input.sessionId,
    recipientScope: RecipientScope.ALL_PARTICIPANTS
  });

  return sendCommunication(communication.id);
}

export async function sendCalendarUpdateNotice(input: { cohortId: string; sessionId: string }) {
  await ensureDefaultCommunicationTemplates();
  const template = await prisma.communicationTemplate.findFirst({
    where: { name: "Session Updated", type: TemplateType.CUSTOM, active: true }
  });

  if (!template) {
    throw Object.assign(new Error("Session Updated template is unavailable."), { code: "NOT_FOUND", status: 404 });
  }

  const communication = await createCommunicationFromTemplate({
    templateId: template.id,
    cohortId: input.cohortId,
    sessionId: input.sessionId,
    recipientScope: RecipientScope.ALL_PARTICIPANTS
  });

  return sendCommunication(communication.id);
}

type SessionScheduleChange = {
  sessionId: string;
  sessionNumber?: number | null;
  title: string;
  timezone: string;
  previousStartTime: Date | string;
  nextStartTime: Date | string;
  previousEndTime: Date | string;
  nextEndTime: Date | string;
};

function escapeEmailHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatScheduleTime(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

export async function sendCohortScheduleChangeNotice(input: { cohortId: string; changes: SessionScheduleChange[] }) {
  if (input.changes.length === 0) {
    return null;
  }

  const cohort = await prisma.cohort.findUnique({ where: { id: input.cohortId } });
  if (!cohort) {
    throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  const rows = input.changes.map((change) => {
    const label = `${change.sessionNumber ? `Session ${change.sessionNumber}: ` : ""}${change.title}`;
    const previous = `${formatScheduleTime(change.previousStartTime, change.timezone)} - ${formatScheduleTime(change.previousEndTime, change.timezone)}`;
    const next = `${formatScheduleTime(change.nextStartTime, change.timezone)} - ${formatScheduleTime(change.nextEndTime, change.timezone)}`;
    const scheduleChanged = new Date(change.previousStartTime).getTime() !== new Date(change.nextStartTime).getTime() ||
      new Date(change.previousEndTime).getTime() !== new Date(change.nextEndTime).getTime();
    return { label, previous, next, scheduleChanged };
  });
  const bodyHtml = [
    `<p>The schedule for <strong>${escapeEmailHtml(cohort.title)}</strong> has been updated.</p>`,
    "<p>Your calendar invitations have been updated. The affected sessions are:</p>",
    `<ul>${rows.map((row) => row.scheduleChanged
      ? `<li><strong>${escapeEmailHtml(row.label)}</strong><br>Previous: ${escapeEmailHtml(row.previous)}<br>New: ${escapeEmailHtml(row.next)}</li>`
      : `<li><strong>${escapeEmailHtml(row.label)}</strong><br>Session details were updated in the calendar invitation.</li>`).join("")}</ul>`,
    "<p>Please contact the RocketPD team if you have any questions.</p>"
  ].join("");
  const bodyText = [
    `The schedule for ${cohort.title} has been updated.`,
    "Your calendar invitations have been updated.",
    ...rows.map((row) => row.scheduleChanged
      ? `${row.label}\nPrevious: ${row.previous}\nNew: ${row.next}`
      : `${row.label}\nSession details were updated in the calendar invitation.`),
    "Please contact the RocketPD team if you have any questions."
  ].join("\n\n");
  const createdById = await getSystemUserId();
  const communication = await prisma.cohortCommunication.create({
    data: {
      cohortId: input.cohortId,
      subject: `Schedule updated: ${cohort.title}`,
      bodyHtml,
      bodyText,
      status: CommunicationStatus.DRAFT,
      recipientScope: RecipientScope.ALL_PARTICIPANTS,
      createdById
    }
  });

  return sendCommunication(communication.id);
}

export async function reviewRecipientIssue(input: { communicationId: string; recipientEmail: string; reviewedById: string; reviewNote?: string }) {
  const recipientEmail = input.recipientEmail.trim();

  if (!recipientEmail) {
    throw Object.assign(new Error("recipientEmail is required"), { code: "BAD_REQUEST", status: 400 });
  }

  try {
    const updated = await prisma.emailEvent.updateMany({
      where: {
        communicationId: input.communicationId,
        recipientEmail: { equals: recipientEmail, mode: "insensitive" },
        eventType: { in: [EmailEventType.BOUNCED, EmailEventType.FAILED] },
        reviewedAt: null
      },
      data: {
        reviewedAt: new Date(),
        reviewedById: input.reviewedById,
        reviewNote: input.reviewNote
      }
    });

    if (updated.count === 0) {
      const existingIssue = await prisma.emailEvent.findFirst({
        where: {
          communicationId: input.communicationId,
          recipientEmail: { equals: recipientEmail, mode: "insensitive" },
          eventType: { in: [EmailEventType.BOUNCED, EmailEventType.FAILED] }
        }
      });
      const communication = await prisma.cohortCommunication.findUnique({
        where: { id: input.communicationId },
        select: { id: true, status: true, providerError: true }
      });
      const hasProviderIssue = Boolean(communication?.providerError) || communication?.status === CommunicationStatus.FAILED;

      if (!existingIssue && hasProviderIssue) {
        await prisma.emailEvent.create({
          data: {
            communicationId: input.communicationId,
            recipientEmail,
            provider: "mission-control",
            eventType: EmailEventType.FAILED,
            eventPayload: {
              error: communication?.providerError ?? "Communication failed before a provider event was recorded."
            },
            reviewedAt: new Date(),
            reviewedById: input.reviewedById,
            reviewNote: input.reviewNote
          }
        });

        return { reviewed: 1 };
      }
    }

    return { reviewed: updated.count };
  } catch (error) {
    if (!isMissingEmailReviewColumn(error)) {
      throw error;
    }

    return migrationRequiredResult("Communications issue review");
  }
}

async function createCommunicationFromTemplate(input: {
  templateId: string;
  cohortId: string;
  sessionId?: string;
  recipientScope: RecipientScope;
  recipientEmails?: string[];
  scheduledFor?: Date;
}) {
  const template = await prisma.communicationTemplate.findUnique({ where: { id: input.templateId } });

  if (!template) {
    throw Object.assign(new Error("Communication template not found"), { code: "NOT_FOUND", status: 404 });
  }

  const createdById = await getSystemUserId();

  return prisma.cohortCommunication.create({
    data: {
      cohortId: input.cohortId,
      sessionId: input.sessionId,
      templateId: template.id,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText,
      scheduledFor: input.scheduledFor,
      status: input.scheduledFor ? CommunicationStatus.SCHEDULED : CommunicationStatus.DRAFT,
      recipientScope: input.recipientScope,
      recipientEmails: input.recipientEmails,
      createdById
    }
  });
}

export async function sendTemplateToParticipant(input: { templateId: string; participantId: string }) {
  const participant = await prisma.participant.findUnique({
    where: { id: input.participantId },
    include: {
      cohort: { include: { presenter: true } },
      organization: true,
      registration: {
        include: {
          organization: true,
          participants: { where: { status: ParticipantStatus.REGISTERED } },
          invoiceDrafts: { orderBy: { updatedAt: "desc" } }
        }
      }
    }
  });

  if (!participant) {
    throw Object.assign(new Error("Participant not found"), { code: "NOT_FOUND", status: 404 });
  }

  const communication = await createCommunicationFromTemplate({
    templateId: input.templateId,
    cohortId: participant.cohortId,
    recipientScope: RecipientScope.CUSTOM,
    recipientEmails: [participant.email]
  });

  return sendCommunication(communication.id, {
    recipients: [participant.email],
    context: {
      cohort: cohortMergeContext(participant.cohort),
      participant: participantMergeContext(participant),
      organization: participant.organization,
      registration: registrationMergeContext(participant.registration)
    }
  });
}

export async function sendManualTemplateToParticipants(input: { templateId: string; participantIds: string[]; createdById: string }) {
  const participantIds = Array.from(new Set((input.participantIds ?? []).filter(Boolean)));

  if (!input.templateId || participantIds.length === 0) {
    throw Object.assign(new Error("templateId and participantIds are required."), { code: "BAD_REQUEST", status: 400 });
  }

  const [template, participants] = await Promise.all([
    prisma.communicationTemplate.findUnique({ where: { id: input.templateId } }),
    prisma.participant.findMany({
      where: { id: { in: participantIds } },
      include: {
        cohort: { include: { presenter: true } },
        organization: true,
        registration: {
          include: {
            organization: true,
            participants: { where: { status: ParticipantStatus.REGISTERED } },
            invoiceDrafts: { orderBy: { updatedAt: "desc" } }
          }
        }
      }
    })
  ]);

  if (!template) {
    throw Object.assign(new Error("Communication template not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (participants.length === 0) {
    throw Object.assign(new Error("No selected participants were found."), { code: "NOT_FOUND", status: 404 });
  }

  const targets = buildManualEmailTargets(participants, "participants");

  if (targets.length === 0) {
    throw Object.assign(new Error("No participant email recipients were found."), { code: "BAD_REQUEST", status: 400 });
  }

  const subject = template.subject;
  const bodyText = template.bodyText ?? "";
  const bodyHtml = template.bodyHtml ?? textToEmailHtml(bodyText);
  const results = [];

  for (const target of targets) {
    const communication = await prisma.cohortCommunication.create({
      data: {
        cohortId: target.cohortId,
        registrationId: target.registrationId,
        participantId: target.participantId,
        templateId: template.id,
        subject,
        bodyHtml,
        bodyText,
        recipientScope: RecipientScope.CUSTOM,
        recipientEmails: [target.recipientEmail],
        createdById: input.createdById,
        status: CommunicationStatus.SENDING
      }
    });

    try {
      const sendResult = await sendEmail({
        to: target.recipientEmail,
        subject,
        bodyHtml,
        bodyText,
        context: manualEmailContext(target)
      });

      await prisma.emailEvent.create({
        data: {
          communicationId: communication.id,
          recipientEmail: target.recipientEmail,
          provider: "sendgrid",
          providerMessageId: sendResult.providerMessageId,
          eventType: EmailEventType.SENT
        }
      });

      const sent = await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.SENT,
          sentAt: new Date(),
          providerMessageId: sendResult.providerMessageId,
          providerError: null
        }
      });
      results.push({ ...sent, recipientCount: 1 });
    } catch (error) {
      await recordFailedEmailEvents(communication.id, [target.recipientEmail], error);
      const failed = await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.FAILED,
          providerError: error instanceof Error ? error.message : "Unknown SendGrid error"
        }
      });
      results.push({ ...failed, recipientCount: 1, error: failed.providerError });
    }
  }

  logAuditEventAsync({
    entityType: "CohortCommunication",
    entityId: results.map((result) => result.id).join(","),
    action: "MANUAL_TEMPLATE_SEND",
    description: `Manual template email sent to ${targets.length} participant recipient(s).`,
    metadata: {
      templateId: template.id,
      participantIds,
      communicationIds: results.map((result) => result.id)
    }
  });

  return {
    communications: results,
    recipientCount: targets.length,
    cohortCount: new Set(targets.map((target) => target.cohortId)).size
  };
}

export async function sendTemplateToRegistrations(input: { templateId: string; registrationIds: string[] }) {
  const registrations = await prisma.registration.findMany({
    where: { id: { in: input.registrationIds }, archivedAt: null },
    include: {
      cohort: { include: { presenter: true } },
      organization: true,
      participants: { where: { status: ParticipantStatus.REGISTERED } },
      invoiceDrafts: { orderBy: { updatedAt: "desc" } }
    }
  });
  const results = [];

  for (const registration of registrations) {
    const communication = await createCommunicationFromTemplate({
      templateId: input.templateId,
      cohortId: registration.cohortId,
      recipientScope: RecipientScope.CUSTOM,
      recipientEmails: [registration.primaryContactEmail]
    });
    results.push(await sendCommunication(communication.id, {
      recipients: [registration.primaryContactEmail],
      context: {
        cohort: cohortMergeContext(registration.cohort),
        organization: registration.organization,
        registration: registrationMergeContext(registration)
      }
    }));
  }

  return results;
}

export async function sendManualCustomEmail(input: {
  participantIds: string[];
  recipientMode: ManualCustomEmailRecipientMode;
  subject: string;
  bodyText: string;
  createdById: string;
}) {
  const participantIds = Array.from(new Set(input.participantIds.filter(Boolean)));
  const subject = String(input.subject ?? "").trim();
  const bodyText = String(input.bodyText ?? "").trim();
  const recipientMode = input.recipientMode || "participants_and_pocs";

  if (participantIds.length === 0) {
    throw Object.assign(new Error("Select at least one participant."), { code: "BAD_REQUEST", status: 400 });
  }

  if (!subject || !bodyText) {
    throw Object.assign(new Error("Subject and message body are required."), { code: "BAD_REQUEST", status: 400 });
  }

  if (!["participants", "pocs", "participants_and_pocs"].includes(recipientMode)) {
    throw Object.assign(new Error("Unsupported recipient mode."), { code: "BAD_REQUEST", status: 400 });
  }

  const participants = await prisma.participant.findMany({
    where: { id: { in: participantIds } },
    include: {
      cohort: { include: { presenter: true } },
      organization: true,
      registration: {
        include: {
          organization: true,
          participants: { where: { status: ParticipantStatus.REGISTERED } },
          invoiceDrafts: { orderBy: { updatedAt: "desc" } }
        }
      }
    }
  });

  if (participants.length === 0) {
    throw Object.assign(new Error("No selected participants were found."), { code: "NOT_FOUND", status: 404 });
  }

  const targets = buildManualEmailTargets(participants, recipientMode);

  if (targets.length === 0) {
    throw Object.assign(new Error("No recipients were resolved for the selected mode."), { code: "BAD_REQUEST", status: 400 });
  }

  const bodyHtml = textToEmailHtml(bodyText);
  const results = [];

  for (const target of targets) {
    const communication = await prisma.cohortCommunication.create({
      data: {
        cohortId: target.cohortId,
        registrationId: target.registrationId,
        participantId: target.participantId,
        subject,
        bodyHtml,
        bodyText,
        recipientScope: RecipientScope.CUSTOM,
        recipientEmails: [target.recipientEmail],
        createdById: input.createdById,
        status: CommunicationStatus.SENDING
      }
    });

    try {
      const sendResult = await sendEmail({
        to: target.recipientEmail,
        subject,
        bodyHtml,
        bodyText,
        context: manualEmailContext(target)
      });

      await prisma.emailEvent.create({
        data: {
          communicationId: communication.id,
          recipientEmail: target.recipientEmail,
          provider: "sendgrid",
          providerMessageId: sendResult.providerMessageId,
          eventType: EmailEventType.SENT
        }
      });

      const sent = await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.SENT,
          sentAt: new Date(),
          providerMessageId: sendResult.providerMessageId,
          providerError: null
        }
      });
      results.push({ ...sent, recipientCount: 1 });
    } catch (error) {
      await recordFailedEmailEvents(communication.id, [target.recipientEmail], error);
      const failed = await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.FAILED,
          providerError: error instanceof Error ? error.message : "Unknown SendGrid error"
        }
      });
      results.push({ ...failed, recipientCount: 1, error: failed.providerError });
    }
  }

  logAuditEventAsync({
    entityType: "CohortCommunication",
    entityId: results.map((result) => result.id).join(","),
    action: "MANUAL_CUSTOM_SEND",
    description: `Manual custom email sent to ${targets.length} recipient(s).`,
    metadata: {
      recipientMode,
      participantIds,
      cohortIds: Array.from(new Set(targets.map((target) => target.cohortId))),
      communicationIds: results.map((result) => result.id)
    }
  });

  return {
    communications: results,
    recipientCount: targets.length,
    cohortCount: new Set(targets.map((target) => target.cohortId)).size
  };
}

function publishExperienceTestContext(input: {
  cohort: Record<string, any>;
  session?: Record<string, any>;
  recipientEmail: string;
}) {
  return {
    cohort: cohortMergeContext(input.cohort),
    session: input.session,
    participant: {
      firstName: "Gerardo",
      lastName: "Grosso",
      fullName: "Gerardo Grosso",
      email: input.recipientEmail
    },
    registration: {
      primaryContactFirstName: "Gerardo",
      primaryContactName: "Gerardo Grosso",
      primaryContactEmail: input.recipientEmail,
      participantCount: 1,
      paymentStatus: "Test",
      invoiceNumber: "TEST",
      purchaseOrderBullet: "",
      participantRosterNextStep: "We received the participant information we need, so there is nothing else you need to do right now.",
      totalAmount: "$0"
    },
    organization: {
      name: "RocketPD"
    }
  };
}

export async function sendCohortPublishExperienceTest(input: { cohortId: string; recipientEmail: string; createdById: string }) {
  const cohortId = String(input.cohortId ?? "").trim();
  const recipientEmail = normalizeEmail(String(input.recipientEmail ?? ""));

  if (!cohortId || !recipientEmail) {
    throw Object.assign(new Error("cohortId and recipientEmail are required."), { code: "BAD_REQUEST", status: 400 });
  }

  await assertOutboundRecipientsAllowed("SENDGRID", [recipientEmail]);

  const [cohort, templates] = await Promise.all([
    prisma.cohort.findUnique({
      where: { id: cohortId },
      include: {
        presenter: true,
        sessions: { orderBy: { sessionNumber: "asc" } }
      }
    }),
    ensureDefaultCommunicationTemplates()
  ]);

  if (!cohort) {
    throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  const templatesByType = new Map(templates.map((template) => [template.type, template]));
  const templatesByName = new Map(templates.map((template) => [template.name, template]));
  const firstSession = cohort.sessions[0];
  type PublishExperienceTestSession = { id: string; sessionNumber: number } & Record<string, any>;
  const messages: Array<{ template: typeof templates[number]; session?: PublishExperienceTestSession; label: string }> = [];

  function addNamedTemplate(name: string, label: string, session?: PublishExperienceTestSession) {
    const template = templatesByName.get(name);
    if (template?.active) {
      messages.push({ template, session, label });
    }
  }

  addNamedTemplate("Participant Registration Confirmation", "Participant registration confirmation");
  addNamedTemplate("Three Weeks Before Cohort", "Three weeks before cohort", firstSession);
  addNamedTemplate("One Week Before Cohort", "One week before cohort", firstSession);

  for (const session of cohort.sessions) {
    for (const templateType of sessionTemplateTypesForSession(session.sessionNumber)) {
      const template = templatesByType.get(templateType);
      if (template?.active) {
        messages.push({
          template,
          session,
          label: `Session ${session.sessionNumber} ${template.name}`
        });
      }
    }
  }

  if (messages.length === 0) {
    throw Object.assign(new Error("No active participant-facing templates were found for this cohort."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const results = [];

  for (const message of messages) {
    const context = publishExperienceTestContext({ cohort, session: message.session, recipientEmail });
    const communication = await prisma.cohortCommunication.create({
      data: {
        cohortId: cohort.id,
        sessionId: message.session?.id,
        templateId: message.template.id,
        subject: message.template.subject,
        bodyHtml: message.template.bodyHtml,
        bodyText: message.template.bodyText,
        recipientScope: RecipientScope.CUSTOM,
        recipientEmails: [recipientEmail],
        createdById: input.createdById,
        status: CommunicationStatus.SENDING,
        providerError: "Publish experience test send."
      }
    });

    try {
      const sendResult = await sendEmail({
        to: recipientEmail,
        subject: message.template.subject,
        bodyHtml: message.template.bodyHtml,
        bodyText: message.template.bodyText ?? undefined,
        context
      });

      await prisma.emailEvent.create({
        data: {
          communicationId: communication.id,
          recipientEmail,
          provider: "sendgrid",
          providerMessageId: sendResult.providerMessageId,
          eventType: EmailEventType.SENT,
          eventPayload: {
            testSend: "publish_experience",
            label: message.label
          }
        }
      });

      const sent = await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.SENT,
          sentAt: new Date(),
          providerMessageId: sendResult.providerMessageId,
          providerError: null
        }
      });

      results.push({
        id: sent.id,
        label: message.label,
        templateName: message.template.name,
        templateType: message.template.type,
        sessionNumber: message.session?.sessionNumber ?? null,
        status: sent.status,
        subject: renderTemplate(message.template.subject, context).output,
        providerMessageId: sendResult.providerMessageId,
        providerError: null
      });
    } catch (error) {
      await recordFailedEmailEvents(communication.id, [recipientEmail], error);
      const failed = await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.FAILED,
          providerError: error instanceof Error ? error.message : "Unknown SendGrid error"
        }
      });

      results.push({
        id: failed.id,
        label: message.label,
        templateName: message.template.name,
        templateType: message.template.type,
        sessionNumber: message.session?.sessionNumber ?? null,
        status: failed.status,
        subject: renderTemplate(message.template.subject, context).output,
        providerMessageId: null,
        providerError: failed.providerError
      });
    }
  }

  logAuditEventAsync({
    entityType: "CohortCommunication",
    entityId: results.map((result) => result.id).join(","),
    action: "PUBLISH_EXPERIENCE_TEST_SEND",
    description: `Publish experience test sent to ${recipientEmail} for ${cohort.title}.`,
    metadata: {
      cohortId: cohort.id,
      recipientEmail,
      communicationIds: results.map((result) => result.id),
      messageCount: results.length
    }
  });

  return {
    cohortId: cohort.id,
    cohortTitle: cohort.title,
    recipientEmail,
    messageCount: results.length,
    sentCount: results.filter((result) => result.status === CommunicationStatus.SENT).length,
    failedCount: results.filter((result) => result.status === CommunicationStatus.FAILED).length,
    messages: results
  };
}

export async function createDefaultSessionCommunications(sessionId: string) {
  const session = await prisma.cohortSession.findUnique({ where: { id: sessionId }, include: { cohort: true } });

  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND", status: 404 });
  }

  const templates = await ensureDefaultCommunicationTemplates();
  const createdById = await getSystemUserId();
  const existing = await prisma.cohortCommunication.findMany({
    where: {
      sessionId,
      template: { type: { in: [...sessionTemplateTypes] } }
    },
    include: { template: true },
    orderBy: { createdAt: "desc" }
  });
  const existingByType = new Map(existing
    .filter((communication) => communication.template?.type)
    .map((communication) => [communication.template!.type, communication]));
  const records = [];
  const activeTemplateTypes = sessionTemplateTypesForSession(session.sessionNumber);
  const disabledWeekBefore = activeTemplateTypes.includes(TemplateType.WEEK_BEFORE_REMINDER)
    ? null
    : existingByType.get(TemplateType.WEEK_BEFORE_REMINDER);
  const settledStatuses: CommunicationStatus[] = [
    CommunicationStatus.SENT,
    CommunicationStatus.CANCELLED,
    CommunicationStatus.SKIPPED
  ];

  if (disabledWeekBefore && !settledStatuses.includes(disabledWeekBefore.status)) {
    records.push(await prisma.cohortCommunication.update({
      where: { id: disabledWeekBefore.id },
      data: {
        status: CommunicationStatus.SKIPPED,
        providerError: "Skipped because one-week session reminders are only sent before Session 1."
      }
    }));
  }

  for (const template of templates.filter((item) => activeTemplateTypes.includes(item.type as (typeof sessionTemplateTypes)[number]))) {
    const start = new Date(session.startTime);
    const scheduledFor =
      template.type === TemplateType.WEEK_BEFORE_REMINDER
        ? new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000)
        : template.type === TemplateType.DAY_BEFORE_REMINDER
          ? new Date(start.getTime() - 24 * 60 * 60 * 1000)
          : template.type === TemplateType.HOUR_BEFORE_REMINDER
            ? new Date(start.getTime() - 60 * 60 * 1000)
            : template.type === TemplateType.FOLLOW_UP
              ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
              : undefined;
    const existingCommunication = existingByType.get(template.type);

    if (existingCommunication) {
      if (existingCommunication.status === CommunicationStatus.SENT) {
        continue;
      }

      if (existingCommunication.status !== CommunicationStatus.CANCELLED && existingCommunication.status !== CommunicationStatus.SKIPPED) {
        records.push(await prisma.cohortCommunication.update({
          where: { id: existingCommunication.id },
          data: {
            subject: template.subject,
            bodyHtml: template.bodyHtml,
            bodyText: template.bodyText,
            scheduledFor,
            status: scheduledFor ? CommunicationStatus.SCHEDULED : CommunicationStatus.DRAFT,
            providerError: null,
            recipientScope: template.type === TemplateType.REGISTRATION_CONFIRMATION ? RecipientScope.PRIMARY_CONTACTS : RecipientScope.ALL_PARTICIPANTS
          }
        }));
        continue;
      }
    }

    records.push(await prisma.cohortCommunication.create({
      data: {
        cohortId: session.cohortId,
        sessionId,
        templateId: template.id,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        bodyText: template.bodyText,
        scheduledFor,
        status: scheduledFor ? CommunicationStatus.SCHEDULED : CommunicationStatus.DRAFT,
        recipientScope: template.type === TemplateType.REGISTRATION_CONFIRMATION ? RecipientScope.PRIMARY_CONTACTS : RecipientScope.ALL_PARTICIPANTS,
        createdById
      }
    }));
  }

  await prisma.operationsTask.updateMany({
    where: {
      sessionId,
      category: OperationsTaskCategory.REMINDER_EMAILS,
      status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
    },
    data: { status: OperationsTaskStatus.COMPLETED, completedAt: new Date() }
  });

  return records;
}

function scheduledTimeForSessionTemplate(type: TemplateType, startTime: Date) {
  if (type === TemplateType.WEEK_BEFORE_REMINDER) {
    return new Date(startTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (type === TemplateType.DAY_BEFORE_REMINDER) {
    return new Date(startTime.getTime() - 24 * 60 * 60 * 1000);
  }
  if (type === TemplateType.HOUR_BEFORE_REMINDER) {
    return new Date(startTime.getTime() - 60 * 60 * 1000);
  }
  if (type === TemplateType.FOLLOW_UP) {
    return new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
  }
  return null;
}

export async function rescheduleUnsentSessionCommunications(sessionId: string, startTime: Date) {
  const communications = await prisma.cohortCommunication.findMany({
    where: {
      sessionId,
      status: CommunicationStatus.SCHEDULED,
      sentAt: null,
      template: {
        type: {
          in: [
            TemplateType.WEEK_BEFORE_REMINDER,
            TemplateType.DAY_BEFORE_REMINDER,
            TemplateType.HOUR_BEFORE_REMINDER,
            TemplateType.FOLLOW_UP
          ]
        }
      }
    },
    include: { template: true }
  });

  const updates = communications.flatMap((communication) => {
    const scheduledFor = communication.template ? scheduledTimeForSessionTemplate(communication.template.type, startTime) : null;
    return scheduledFor ? [{ id: communication.id, scheduledFor }] : [];
  });

  await prisma.$transaction(
    updates.map((update) => prisma.cohortCommunication.update({
      where: { id: update.id },
      data: { scheduledFor: update.scheduledFor }
    }))
  );

  return { updated: updates.length };
}

export async function createDefaultCohortSessionCommunications(cohortId: string) {
  const sessions = await prisma.cohortSession.findMany({
    where: { cohortId },
    orderBy: { sessionNumber: "asc" }
  });
  const results = [];

  for (const session of sessions) {
    const created = await createDefaultSessionCommunications(session.id);
    results.push({
      sessionId: session.id,
      sessionTitle: session.title,
      created: created.length
    });
  }

  return {
    cohortId,
    total: sessions.length,
    created: results.reduce((sum, result) => sum + result.created, 0),
    results
  };
}

export async function getRecipientCommunicationSummary(emails: string[]) {
  const normalizedEmails = emails.map((email) => email.toLowerCase()).filter(Boolean);
  const events = await prisma.emailEvent.findMany({
    where: { recipientEmail: { in: normalizedEmails } },
    orderBy: { createdAt: "desc" }
  });
  const grouped = new Map<string, typeof events>();

  for (const event of events) {
    const key = event.recipientEmail.toLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return Object.fromEntries(normalizedEmails.map((email) => [email, emailEventSummary(grouped.get(email) ?? [])]));
}

export async function getRecipientCommunicationThread(email: string) {
  const normalized = email.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  let events: any[];
  let communications: any[];

  try {
    [events, communications] = await Promise.all([
      prisma.emailEvent.findMany({
        where: { recipientEmail: { equals: normalized, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        include: { reviewedBy: true, communication: { include: { cohort: true, session: true, template: true, attachments: true } } }
      }),
      prisma.cohortCommunication.findMany({
        where: {
          OR: [
            { recipientEmails: { array_contains: [email] } },
            { recipientEmails: { array_contains: [normalized] } }
          ]
        },
        orderBy: { createdAt: "desc" },
        include: { cohort: true, session: true, template: true, emailEvents: { include: { reviewedBy: true } }, attachments: true }
      })
    ]);
  } catch (error) {
    if (!isMissingEmailReviewColumn(error)) {
      throw error;
    }

    const legacyEvents = await legacyEmailEventsForRecipient(normalized);
    communications = await prisma.cohortCommunication.findMany({
      where: {
        OR: [
          { recipientEmails: { array_contains: [email] } },
          { recipientEmails: { array_contains: [normalized] } },
          { id: { in: legacyEvents.map((event) => event.communicationId).filter((id): id is string => Boolean(id)) } }
        ]
      },
      orderBy: { createdAt: "desc" },
      include: { cohort: true, session: true, template: true, attachments: true }
    });
    events = legacyEvents.map((event) => ({
      ...event,
      communication: communications.find((communication) => communication.id === event.communicationId) ?? null
    }));
    communications = communications.map((communication) => ({
      ...communication,
      emailEvents: legacyEvents.filter((event) => event.communicationId === communication.id)
    }));
  }

  const byCommunication = new Map<string, any>();

  for (const communication of communications) {
    byCommunication.set(communication.id, {
      ...communication,
      recipientEmail: normalized,
      events: communication.emailEvents.filter((event: EventSummaryInput) => normalizeEmail(event.recipientEmail ?? "") === normalized),
      emailSummary: emailEventSummary(communication.emailEvents.filter((event: EventSummaryInput) => normalizeEmail(event.recipientEmail ?? "") === normalized))
    });
  }

  for (const event of events) {
    if (event.communication) {
      const existing = byCommunication.get(event.communication.id);
      const nextEvents = [...(existing?.events ?? []), event];
      byCommunication.set(event.communication.id, {
        ...event.communication,
        recipientEmail: normalized,
        events: nextEvents,
        emailSummary: emailEventSummary(nextEvents)
      });
    } else {
      const eventId = event.id ?? `${normalized}-${event.createdAt?.toISOString?.() ?? "event"}`;
      byCommunication.set(eventId, {
        id: eventId,
        subject: "Provider event",
        status: event.eventType,
        recipientEmail: normalized,
        createdAt: event.createdAt,
        events: [event],
        attachments: [],
        emailSummary: emailEventSummary([event])
      });
    }
  }

  return Array.from(byCommunication.values()).sort((a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime());
}

export async function processScheduledCommunications(limit = 25) {
  const setup = await getSendGridSetup();
  const communications = await prisma.cohortCommunication.findMany({
    where: {
      status: CommunicationStatus.SCHEDULED,
      scheduledFor: { lte: new Date() },
      ...(setup.liveSendingEnabled ? { cohort: { status: { in: [CohortStatus.PUBLISHED, CohortStatus.ACTIVE] } } } : {})
    },
    include: { template: true, session: true },
    orderBy: { scheduledFor: "asc" },
    take: limit
  });
  const results = [];

  for (const communication of communications) {
    if (communication.template?.type === TemplateType.WEEK_BEFORE_REMINDER && Number(communication.session?.sessionNumber ?? 1) > 1) {
      results.push(await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.SKIPPED,
          providerError: "Skipped because one-week session reminders are only sent before Session 1."
        }
      }));
      continue;
    }

    try {
      results.push(await sendCommunication(communication.id));
    } catch (error) {
      results.push({ id: communication.id, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return results;
}

export async function recordSendGridEvents(events: Array<Record<string, unknown>>) {
  const records = await Promise.all(
    events.map(async (event) => {
      const providerMessageId = String(event.sg_message_id ?? event["smtp-id"] ?? "");
      const recipientEmail = String(event.email ?? "");
      const eventName = String(event.event ?? "sent").toLowerCase();
      const communication = providerMessageId
        ? await prisma.cohortCommunication.findFirst({ where: { providerMessageId } })
        : null;
      const eventTypeMap: Record<string, EmailEventType> = {
        processed: EmailEventType.SENT,
        sent: EmailEventType.SENT,
        delivered: EmailEventType.DELIVERED,
        open: EmailEventType.OPENED,
        opened: EmailEventType.OPENED,
        click: EmailEventType.CLICKED,
        clicked: EmailEventType.CLICKED,
        bounce: EmailEventType.BOUNCED,
        bounced: EmailEventType.BOUNCED,
        dropped: EmailEventType.FAILED,
        failed: EmailEventType.FAILED,
        unsubscribe: EmailEventType.UNSUBSCRIBED,
        unsubscribed: EmailEventType.UNSUBSCRIBED
      };
      const eventType = eventTypeMap[eventName] ?? EmailEventType.SENT;

      return prisma.emailEvent.create({
        data: {
          communicationId: communication?.id,
          recipientEmail,
          provider: "sendgrid",
          providerMessageId,
          eventType,
          eventPayload: event as Prisma.InputJsonValue
        }
      });
    })
  );

  return { processed: records.length };
}

export async function sendCommunicationPlaceholder(id: string) {
  return sendCommunication(id);
}

export async function markCommunicationScheduled(id: string, scheduledFor: Date) {
  return prisma.cohortCommunication.update({
    where: { id },
    data: {
      scheduledFor,
      status: CommunicationStatus.SCHEDULED
    }
  });
}

export async function listTemplates() {
  await ensureDefaultCommunicationTemplates();

  return prisma.communicationTemplate.findMany({
    orderBy: { name: "asc" }
  });
}

export async function createPlannedSessionReminders(sessionId: string, createdById: string) {
  const session = await prisma.cohortSession.findUnique({
    where: { id: sessionId },
    include: { cohort: true }
  });

  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND", status: 404 });
  }

  const schedule = generateSessionReminderSchedule(session);
  const resolvedCreatedById = createdById || (await getSystemUserId());
  const records = await Promise.all(
    schedule.map((item) =>
      prisma.cohortCommunication.create({
        data: {
          cohortId: session.cohortId,
          sessionId: session.id,
          subject: `${session.title} reminder`,
          bodyHtml: `<p>Reminder for {{session.title}} in ${session.cohort.title}.</p>`,
          bodyText: `Reminder for {{session.title}} in ${session.cohort.title}.`,
          scheduledFor: item.scheduledFor,
          status: CommunicationStatus.SCHEDULED,
          recipientScope: RecipientScope.ALL_PARTICIPANTS,
          createdById: resolvedCreatedById
        }
      })
    )
  );

  for (const record of records) {
    logAuditEventAsync({
      entityType: "CohortCommunication",
      entityId: record.id,
      action: "SCHEDULED",
      description: "Session reminder scheduled",
      metadata: { sessionId, scheduledFor: record.scheduledFor?.toISOString() ?? null }
    });
  }

  return records;
}
