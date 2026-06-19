import { ParticipantListStatus, PaymentMethod, PaymentStatus, QuickBooksInvoiceStatus, RegistrationStatus, SupportingDocumentStatus, SyncStatus } from "@prisma/client";
import { z } from "zod";
import { moneyInput, nonNegativeIntInput, optionalDateInput, optionalEmail, optionalString, optionalUrl } from "@/lib/validators";

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

export const registrationCreateSchema = z.object({
  cohortId: z.string().min(1, "Registration requires a cohort"),
  organizationId: z.string().min(1, "Registration requires an organization"),
  formId: optionalString,
  primaryContactName: z.string().min(1),
  primaryContactEmail: z.string().email(),
  primaryContactPhone: optionalString,
  primaryContactTitle: optionalString,
  billingContactName: optionalString,
  billingContactEmail: optionalEmail,
  billingAddress: optionalString,
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.UNKNOWN),
  paymentStatus: z.nativeEnum(PaymentStatus).default(PaymentStatus.PENDING),
  invoiceNumber: optionalString,
  purchaseOrderNumber: optionalString,
  participantListStatus: z.nativeEnum(ParticipantListStatus).default(ParticipantListStatus.NEEDED),
  supportingDocumentStatus: z.nativeEnum(SupportingDocumentStatus).default(SupportingDocumentStatus.NOT_READY),
  w9Url: optionalUrl,
  invoiceUrl: optionalUrl,
  confirmationDocsSentAt: optionalDateInput,
  quickBooksCustomerRef: optionalString,
  quickBooksInvoiceRef: optionalString,
  quickBooksRealmId: optionalString,
  quickBooksInvoiceStatus: z.preprocess(emptyToUndefined, z.nativeEnum(QuickBooksInvoiceStatus).optional()),
  quickBooksSyncStatus: z.preprocess(emptyToUndefined, z.nativeEnum(SyncStatus).optional()),
  quickBooksSyncError: optionalString,
  quickBooksLastSyncedAt: optionalDateInput,
  totalAmount: moneyInput.default(0),
  participantCount: nonNegativeIntInput.default(0),
  status: z.nativeEnum(RegistrationStatus).default(RegistrationStatus.NEW),
  source: optionalString,
  utmSource: optionalString,
  utmMedium: optionalString,
  utmCampaign: optionalString,
  utmContent: optionalString,
  utmTerm: optionalString,
  landingPageUrl: optionalString,
  referrerUrl: optionalString,
  externalSource: optionalString,
  externalSubmissionId: optionalString,
  notes: optionalString
});

export const registrationUpdateSchema = registrationCreateSchema.partial();
