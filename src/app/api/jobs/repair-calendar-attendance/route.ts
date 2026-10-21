import { z } from "zod";
import { fail, handleApiError, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { recordJobInvocation, validateJobRequest } from "@/lib/jobAuth";
import { repairRegistrationCalendarAttendance } from "@/services/calendarAttendanceRepairService";

export const maxDuration = 300;
const schema = z.object({
  email: z.string().trim().email(),
  referenceInvoiceNumber: z.string().trim().min(1).max(100),
  registrationId: z.string().trim().min(1).optional(),
  mode: z.enum(["preview", "apply"]).default("preview")
}).strict();

export async function POST(request: Request) {
  try {
    // Unlike legacy jobs, repair is never available without a configured secret.
    if (!env.CRON_SECRET) return fail("Production job authentication is not configured.", "FORBIDDEN", 403);
    const blocked = validateJobRequest(request);
    if (blocked) return blocked;
    const input = schema.parse(await request.json());
    await recordJobInvocation(request, "repair-calendar-attendance");
    return ok(await repairRegistrationCalendarAttendance({ ...input, apply: input.mode === "apply" }));
  } catch (error) {
    return handleApiError(error);
  }
}
