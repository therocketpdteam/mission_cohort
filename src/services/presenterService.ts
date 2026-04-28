import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { presenterCreateSchema, presenterUpdateSchema } from "@/validators/presenter";

export async function createPresenter(input: z.input<typeof presenterCreateSchema>) {
  const data = presenterCreateSchema.parse(input);
  return prisma.presenter.create({ data });
}

export async function updatePresenter(id: string, input: z.input<typeof presenterUpdateSchema>) {
  const data = presenterUpdateSchema.parse(input);
  return prisma.presenter.update({ where: { id }, data });
}

export async function listPresenters() {
  return prisma.presenter.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { _count: { select: { cohorts: true } } }
  });
}

export async function getPresenterById(id: string) {
  return prisma.presenter.findUnique({
    where: { id },
    include: { cohorts: true }
  });
}
