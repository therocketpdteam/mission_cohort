export type RegistrationDocumentReadinessInput = {
  paymentMethod?: string | null;
  totalAmount?: unknown;
  w9Url?: string | null;
  invoiceUrl?: string | null;
  invoiceDrafts?: Array<{ pdfUrl?: string | null }>;
};

export function registrationConfirmationDocumentReadiness(
  registration: RegistrationDocumentReadinessInput,
  fallbackW9Url?: string | null
) {
  const requiresInvoice = registration.paymentMethod !== "COMPED" && Number(registration.totalAmount ?? 0) > 0;
  const invoiceUrl = registration.invoiceUrl || registration.invoiceDrafts?.find((invoice) => invoice.pdfUrl)?.pdfUrl || null;
  const w9Url = registration.w9Url || fallbackW9Url || null;
  const missing = [
    !w9Url ? "RocketPD W-9 URL" : null,
    requiresInvoice && !invoiceUrl ? "invoice PDF/link" : null
  ].filter((item): item is string => Boolean(item));

  return {
    ready: missing.length === 0,
    requiresInvoice,
    invoiceUrl,
    w9Url,
    missing,
    reason: missing.length ? `POC confirmation held until ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} ready.` : null
  };
}
