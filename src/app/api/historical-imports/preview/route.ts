import { handleApiError, ok } from "@/lib/api";
import { MUTATION_ROLES, requireRole } from "@/lib/auth";
import { previewHistoricalImport } from "@/services/historicalImportService";

async function readPreviewBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const mappingValue = form.get("mapping");

    if (!(file instanceof File)) {
      throw Object.assign(new Error("CSV file is required."), { code: "BAD_REQUEST", status: 400 });
    }

    return {
      fileName: file.name,
      csvText: await file.text(),
      mapping: typeof mappingValue === "string" && mappingValue ? JSON.parse(mappingValue) : undefined
    };
  }

  const body = await request.json();
  return {
    fileName: body.fileName,
    csvText: body.csvText,
    mapping: body.mapping
  };
}

export async function POST(request: Request) {
  try {
    await requireRole(MUTATION_ROLES);
    const body = await readPreviewBody(request);

    if (!body.csvText || typeof body.csvText !== "string") {
      throw Object.assign(new Error("CSV text is required."), { code: "BAD_REQUEST", status: 400 });
    }

    return ok({
      fileName: body.fileName,
      ...(await previewHistoricalImport({ csvText: body.csvText, mapping: body.mapping }))
    });
  } catch (error) {
    return handleApiError(error);
  }
}
