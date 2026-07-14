import { handleApiError, ok } from "@/lib/api";
import { MUTATION_ROLES, requireRole, requireUser } from "@/lib/auth";
import { importHistoricalCsv, listHistoricalImports } from "@/services/historicalImportService";

export const maxDuration = 60;

async function readImportBody(request: Request) {
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
      mapping: typeof mappingValue === "string" && mappingValue ? JSON.parse(mappingValue) : undefined,
      cohort: typeof form.get("cohort") === "string" && form.get("cohort") ? JSON.parse(String(form.get("cohort"))) : undefined
    };
  }

  const body = await request.json();
  return {
    fileName: body.fileName,
    csvText: body.csvText,
    mapping: body.mapping,
    cohort: body.cohort
  };
}

export async function GET() {
  try {
    await requireUser();
    return ok(await listHistoricalImports());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRole(MUTATION_ROLES);
    const body = await readImportBody(request);

    if (!body.csvText || typeof body.csvText !== "string") {
      throw Object.assign(new Error("CSV text is required."), { code: "BAD_REQUEST", status: 400 });
    }

    return ok(await importHistoricalCsv({
      csvText: body.csvText,
      fileName: body.fileName || "historical-import.csv",
      mapping: body.mapping,
      cohort: body.cohort,
      createdById: user.id
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
