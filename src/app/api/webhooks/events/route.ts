import { handleApiError, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    return ok(await prisma.webhookEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
