import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const ADMIN_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.OPERATIONS,
  Role.SALES,
  Role.PRESENTER,
  Role.VIEWER
] as const;

export const MUTATION_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.OPERATIONS,
  Role.SALES
] as const;

export type InternalRole = (typeof ADMIN_ROLES)[number];

export async function currentUser() {
  const configuredEmail = process.env.ADMIN_EMAIL;

  if (!configuredEmail) {
    return null;
  }

  return prisma.user.findUnique({
    where: { email: configuredEmail }
  });
}

export async function requireUser() {
  const user = await currentUser();

  if (!user || !user.active) {
    throw Object.assign(new Error("Authentication required"), {
      code: "AUTH_REQUIRED",
      status: 401
    });
  }

  return user;
}

export async function requireRole(roles: readonly Role[]) {
  const user = await requireUser();

  if (!roles.includes(user.role)) {
    throw Object.assign(new Error("Insufficient permissions"), {
      code: "FORBIDDEN",
      status: 403
    });
  }

  return user;
}
