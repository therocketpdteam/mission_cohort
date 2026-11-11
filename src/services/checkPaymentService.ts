import { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkPaymentNotes, checkReconciliationPreview, collectedPaymentCents, moneyCents, readCheckPaymentProof } from "@/lib/checkPayment";
import { registrationDocumentSchema } from "@/validators/registrationDocument";

function conflict(message: string) { return Object.assign(new Error(message), { code: "BAD_REQUEST", status: 409 }); }

export async function recordCheckPaymentDocument(id: string, input: unknown) {
  const data = registrationDocumentSchema.parse(input);
  if (data.type !== "checkPayment" || !data.fileKey || !data.checkNumber || !data.checkAmount) throw conflict("Check proof, amount, and check number are required.");
  const { fileKey, checkNumber, checkAmount } = data;
  return prisma.$transaction(async tx => {
    // Serialize uploads and retries for this registration before reading its ledger.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Registration" WHERE "id" = ${id} FOR UPDATE`);
    const registration = await tx.registration.findUniqueOrThrow({ where: { id }, include: { paymentRecords: true, invoiceDrafts: true } });
    if (registration.archivedAt || registration.status === "CANCELLED" || ["REFUNDED", "CANCELLED"].includes(registration.paymentStatus)) throw conflict("Reopen this registration before recording a check payment.");
    if (moneyCents(registration.totalAmount) <= 0 || registration.paymentMethod === "COMPED") throw conflict("This registration has no payable balance to reconcile.");
    const checks = registration.paymentRecords.filter(row => row.method === "CHECK");
    const numbered = checks.find(row => readCheckPaymentProof(row.notes)?.checkNumber.toLowerCase() === checkNumber.toLowerCase());
    const previous = data.checkPaymentRecordId ? checks.find(row => row.id === data.checkPaymentRecordId) : numbered;
    if (data.checkPaymentRecordId && !previous) throw conflict("The selected check payment no longer belongs to this registration. Refresh and try again.");
    if (numbered && previous && numbered.id !== previous.id) throw conflict("That check number is already recorded. Select its payment to replace the proof.");
    if (previous && (["REFUNDED", "CANCELLED"].includes(previous.status) || (previous.quickBooksPaymentRef && moneyCents(previous.amount) !== moneyCents(checkAmount)))) throw conflict("Reconcile this refunded, cancelled, or QuickBooks-linked payment in Payments before changing its amount.");

    // Do not silently add a second copy of money that exists only on an invoice
    // or a legacy paid flag. Those records require explicit ledger reconciliation.
    const recorded = collectedPaymentCents(registration.paymentRecords);
    const invoicePaid = registration.invoiceDrafts.filter(row => !["VOIDED", "CANCELLED"].includes(row.status)).reduce((sum, row) => sum + moneyCents(row.paidAmount), 0);
    if (invoicePaid > recorded || (!previous && registration.paymentStatus === "PAID" && recorded === 0)) throw conflict("Existing paid amounts are not reconciled with the payment ledger. Review them in Payments before recording this check to avoid counting it twice.");

    const reconciliation = checkReconciliationPreview(registration.totalAmount, registration.paymentRecords, checkAmount, previous?.id);
    if (invoicePaid > moneyCents(reconciliation.collected)) throw conflict("The invoice records more money received than this correction. Reconcile its paid amount before reducing the check payment.");
    const paymentData = {
      amount: checkAmount,
      // This receipt's amount is retained even when several receipts together
      // fully settle the registration.
      status: checkAmount >= Number(registration.totalAmount) ? PaymentStatus.PAID : PaymentStatus.PARTIALLY_PAID,
      method: PaymentMethod.CHECK,
      notes: checkPaymentNotes({ checkNumber, fileKey, fileName: data.fileName ?? null, contentType: data.contentType ?? null }, previous?.notes)
    };
    const payment = previous
      ? await tx.paymentRecord.update({ where: { id: previous.id }, data: paymentData })
      : await tx.paymentRecord.create({ data: { ...paymentData, registrationId: id, cohortId: registration.cohortId, organizationId: registration.organizationId, invoiceNumber: registration.invoiceNumber, paymentDate: new Date() } });
    const updated = await tx.registration.update({ where: { id }, data: {
      checkPaymentFileKey: fileKey, checkPaymentFileName: data.fileName ?? null, checkPaymentContentType: data.contentType ?? null,
      paymentStatus: reconciliation.status
    }, include: { paymentRecords: true } });
    await tx.auditLog.create({ data: { entityType: "Registration", entityId: id, action: "CHECK_PAYMENT_RECONCILED", description: previous ? "Check payment and proof updated" : "Check payment and proof recorded", metadata: { paymentRecordId: payment.id, checkNumber, amount: checkAmount, previousAmount: previous ? Number(previous.amount) : null, fileName: data.fileName ?? null, paymentStatus: reconciliation.status } } });
    // Retain prior proof files: other recorded checks/audit history may use them.
    // No delivery journey, receipt email, calendar, or external payment is invoked.
    return updated;
  });
}
