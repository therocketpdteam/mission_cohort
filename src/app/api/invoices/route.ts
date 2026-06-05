import { handleApiError, ok } from "@/lib/api";
import { isMissingPrismaSchema, migrationRequiredResult } from "@/lib/prismaCompatibility";
import { createInvoiceDraft, generateInvoicePdf, listInvoiceDrafts, updateInvoiceDraft } from "@/services/invoiceService";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    return ok(await listInvoiceDrafts(searchParams.get("cohortId") ?? undefined));
  } catch (error) {
    if (isMissingPrismaSchema(error)) {
      return ok([]);
    }
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createInvoiceDraft(await request.json()), { status: 201 });
  } catch (error) {
    if (isMissingPrismaSchema(error)) {
      return ok(migrationRequiredResult("Invoice drafts"), { status: 409 });
    }
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (body.action === "generatePdf") {
      return ok(await generateInvoicePdf(body.id, Boolean(body.receipt)));
    }

    return ok(await updateInvoiceDraft(body.id, body));
  } catch (error) {
    if (isMissingPrismaSchema(error)) {
      return ok(migrationRequiredResult("Invoice drafts"), { status: 409 });
    }
    return handleApiError(error);
  }
}
