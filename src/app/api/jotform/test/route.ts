import { handleApiError, ok } from "@/lib/api";
import { normalizeJotformRegistrationPayload } from "@/modules/jotform";
import { prisma } from "@/lib/prisma";
import { listActiveJotformFormMappings } from "@/services/jotformMappingService";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const normalized = normalizeJotformRegistrationPayload(payload, await listActiveJotformFormMappings());
    const existing = normalized.externalSubmissionId
      ? await prisma.registration.findFirst({
          where: { externalSource: normalized.source, externalSubmissionId: normalized.externalSubmissionId },
          select: { id: true, primaryContactEmail: true }
        })
      : null;

    return ok({
      normalized,
      wouldCreate: !existing,
      wouldUpdate: Boolean(existing),
      existingRegistration: existing
    });
  } catch (error) {
    return handleApiError(error);
  }
}
