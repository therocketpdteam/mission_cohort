import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { presenterCreateSchema, presenterUpdateSchema } from "@/validators/presenter";

function friendlyPresenterWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(", ") : String(error.meta?.target ?? "");
    const message = target.includes("email")
      ? "A thought leader with this email already exists."
      : "A thought leader with this value already exists.";
    throw Object.assign(new Error(message), { code: "CONFLICT", status: 409 });
  }

  throw error;
}

export async function createPresenter(input: z.input<typeof presenterCreateSchema>) {
  const data = presenterCreateSchema.parse(input);
  try {
    return await prisma.presenter.create({ data });
  } catch (error) {
    friendlyPresenterWriteError(error);
  }
}

export async function updatePresenter(id: string, input: z.input<typeof presenterUpdateSchema>) {
  const data = presenterUpdateSchema.parse(input);
  try {
    return await prisma.presenter.update({ where: { id }, data });
  } catch (error) {
    friendlyPresenterWriteError(error);
  }
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
