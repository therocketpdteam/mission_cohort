import { ok } from "@/lib/api";
import { getEnvPresence } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let database = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch (error) {
    console.error("Health check database probe failed", error);
  }

  const env = getEnvPresence();

  return ok({
    database,
    env
  });
}
