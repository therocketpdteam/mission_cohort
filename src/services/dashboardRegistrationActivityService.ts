import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildRegistrationActivity, registrationActivityWindow } from "@/lib/registrationActivity";

export async function getDashboardRegistrationActivity(scope: Prisma.RegistrationWhereInput = {}, now = new Date(), client = prisma) {
  const { start, end } = registrationActivityWindow(now);
  // The recent-registration table is capped at six rows. Chart history must be
  // queried independently over the full window, with no pagination limit.
  const rows = await client.registration.findMany({
    where: { ...scope, archivedAt: null, createdAt: { gte: start, lt: end } },
    select: { createdAt: true }
  });
  return buildRegistrationActivity(rows, now);
}
