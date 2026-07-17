import { fail, handleApiError, ok } from "@/lib/api";
import { getCohortById, moveCohortBackToDraft, publishCohort, updateCohort } from "@/services/cohortService";
import { syncCohortTotalsToCrm } from "@/services/crmRegistrationWebhookService";
import { ensureCohortQuickBooksProject, reconcileCohortQuickBooksProject, syncQuickBooksInvoice } from "@/services/quickBooksService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cohort = await getCohortById(id);

    if (!cohort) {
      return fail("Cohort not found", "NOT_FOUND", 404);
    }

    return ok(cohort);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.action === "publish") {
      return ok(await publishCohort(id));
    }

    if (body.action === "moveToDraft") {
      return ok(await moveCohortBackToDraft(id));
    }

    if (body.action === "syncQuickBooksProject") {
      return ok(await ensureCohortQuickBooksProject(id));
    }

    if (body.action === "reconcileQuickBooks") {
      const project = await reconcileCohortQuickBooksProject(id);
      const invoices = await Promise.all((body.invoiceIds ?? []).map((invoiceId: string) => syncQuickBooksInvoice(invoiceId)));
      return ok({ project, invoices });
    }

    if (body.action === "syncCrm") {
      return ok(await syncCohortTotalsToCrm(id, "manual.cohort_sync"), { status: 202 });
    }

    return ok(await updateCohort(id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
