import { Role } from "@prisma/client";
import { handleApiError, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { listRegistrationDeliveryJobs, processRegistrationDeliveryJob } from "@/services/registrationDeliveryJobService";

const allowedRoles = [Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATIONS];

export async function GET(request: Request) {
  try {
    await requireRole(allowedRoles);
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 20);
    return ok(await listRegistrationDeliveryJobs(ids));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(allowedRoles);
    const body = await request.json();
    return ok(await processRegistrationDeliveryJob(String(body.id ?? "")), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
