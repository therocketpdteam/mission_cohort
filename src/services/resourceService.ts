import { ResourceType, ResourceVisibility } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const resourceSchema = z.object({
  cohortId: z.string().min(1),
  sessionId: z.string().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.nativeEnum(ResourceType).default(ResourceType.LINK),
  url: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  fileKey: z.string().optional(),
  provider: z.string().optional(),
  muxAssetId: z.string().optional(),
  muxPlaybackId: z.string().optional(),
  muxStatus: z.string().optional(),
  durationSeconds: z.coerce.number().int().nonnegative().optional(),
  visibility: z.nativeEnum(ResourceVisibility).default(ResourceVisibility.ADMIN_ONLY)
});

export async function createResource(input: z.input<typeof resourceSchema>) {
  const data = resourceSchema.parse(input);
  return prisma.cohortResource.create({ data });
}

export async function updateResource(id: string, input: Partial<z.input<typeof resourceSchema>>) {
  const data = resourceSchema.partial().parse(input);
  return prisma.cohortResource.update({ where: { id }, data });
}

export async function listResources(cohortId?: string) {
  return prisma.cohortResource.findMany({
    where: cohortId ? { cohortId } : undefined,
    orderBy: [{ createdAt: "desc" }],
    include: { cohort: true, session: true }
  });
}
