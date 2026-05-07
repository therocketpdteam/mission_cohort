import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const ACCESS_TOKEN_COOKIE = "mc-access-token";
export const REFRESH_TOKEN_COOKIE = "mc-refresh-token";

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

export const USER_MANAGEMENT_ROLES = [Role.SUPER_ADMIN, Role.ADMIN] as const;

export type InternalRole = (typeof ADMIN_ROLES)[number];

export function safeUser<T extends object>(user: T) {
  const { supabaseUserId: _supabaseUserId, ...safe } = user as T & { supabaseUserId?: string | null };
  return safe;
}

export async function currentUser() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user?.email) {
    return null;
  }

  const email = data.user.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user?.active) {
    return null;
  }

  return user;
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
