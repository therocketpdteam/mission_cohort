import { fail, handleApiError, ok } from "@/lib/api";
import { getRegistrationFormBySlug, updateRegistrationForm } from "@/services/registrationFormService";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const form = await getRegistrationFormBySlug(slug);

    if (!form) {
      return fail("Registration form not found", "NOT_FOUND", 404);
    }

    return ok(form);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const form = await getRegistrationFormBySlug(slug);

    if (!form) {
      return fail("Registration form not found", "NOT_FOUND", 404);
    }

    return ok(await updateRegistrationForm(form.id, await request.json()));
  } catch (error) {
    return handleApiError(error);
  }
}
