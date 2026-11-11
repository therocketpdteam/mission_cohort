import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createPrivateAppFileUrl } from "@/services/storageService";
import { readCheckPaymentProof } from "@/lib/checkPayment";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const registrationId = params.get("registrationId");
    const type = params.get("type");

    if (!registrationId || !["purchaseOrder", "checkPayment"].includes(String(type))) {
      throw Object.assign(new Error("Registration and document type are required."), { code: "BAD_REQUEST", status: 400 });
    }

    const registration = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } });
    const paymentRecordId = params.get("paymentRecordId");
    const payment = type === "checkPayment" && paymentRecordId
      ? await prisma.paymentRecord.findFirst({ where: { id: paymentRecordId, registrationId, method: "CHECK" } })
      : null;
    const fileKey = type === "purchaseOrder" ? registration.purchaseOrderFileKey
      : paymentRecordId ? readCheckPaymentProof(payment?.notes)?.fileKey : registration.checkPaymentFileKey;

    if (!fileKey) {
      throw Object.assign(new Error("Document not found."), { code: "NOT_FOUND", status: 404 });
    }

    return Response.redirect(await createPrivateAppFileUrl(fileKey), 302);
  } catch (error) {
    return handleApiError(error);
  }
}
