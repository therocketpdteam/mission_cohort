import { handleApiError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getOrganizationInvoiceProfile, saveOrganizationInvoiceProfile } from "@/services/appSettingsService";

export async function GET() {
  try {
    await requireUser();
    return ok({
      organizationInvoiceProfile: await getOrganizationInvoiceProfile()
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireUser();
    const body = await request.json();

    return ok({
      organizationInvoiceProfile: await saveOrganizationInvoiceProfile(body.organizationInvoiceProfile ?? body)
    });
  } catch (error) {
    return handleApiError(error);
  }
}
