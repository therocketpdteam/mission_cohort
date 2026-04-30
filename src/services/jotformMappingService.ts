import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jotformFormMappingCreateSchema, jotformFormMappingUpdateSchema } from "@/validators/jotform";

export async function createJotformFormMapping(input: z.input<typeof jotformFormMappingCreateSchema>) {
  const data = jotformFormMappingCreateSchema.parse(input);
  return prisma.jotformFormMapping.create({
    data,
    include: { defaultCohort: true }
  });
}

export async function updateJotformFormMapping(id: string, input: z.input<typeof jotformFormMappingUpdateSchema>) {
  const data = jotformFormMappingUpdateSchema.parse(input);
  return prisma.jotformFormMapping.update({
    where: { id },
    data,
    include: { defaultCohort: true }
  });
}

export async function listJotformFormMappings() {
  return prisma.jotformFormMapping.findMany({
    orderBy: [{ active: "desc" }, { sessionCount: "asc" }, { label: "asc" }],
    include: { defaultCohort: true }
  });
}

export async function listActiveJotformFormMappings() {
  return prisma.jotformFormMapping.findMany({
    where: { active: true },
    include: { defaultCohort: true }
  });
}
