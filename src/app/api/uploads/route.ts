import { handleApiError, ok } from "@/lib/api";
import { uploadAppFile, type UploadPurpose } from "@/services/storageService";

const purposes = new Set<UploadPurpose>(["cohort-thumbnail", "organization-logo", "invoice", "receipt", "material", "email-attachment", "payout-proof"]);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const purpose = String(formData.get("purpose") ?? "") as UploadPurpose;
    const file = formData.get("file");

    if (!purposes.has(purpose)) {
      throw Object.assign(new Error("Upload purpose is required."), { code: "BAD_REQUEST", status: 400 });
    }

    if (!(file instanceof File)) {
      throw Object.assign(new Error("Upload file is required."), { code: "BAD_REQUEST", status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    return ok(await uploadAppFile({
      purpose,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      bytes
    }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
