import { handleApiError, ok } from "@/lib/api";
import { validateJobRequest } from "@/lib/jobAuth";
import { processAllIntegrationWork } from "@/services/integrationJobProcessor";

async function processRequest(request: Request) {
  try {
    const blockedResponse = validateJobRequest(request);
    if (blockedResponse) return blockedResponse;

    return ok(await processAllIntegrationWork(), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  return processRequest(request);
}
