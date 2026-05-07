import { Role } from "@prisma/client";
import { z } from "zod";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase";

const roleSchema = z.nativeEnum(Role);
const optionalPassword = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(12).optional()
);

const userCreateSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: roleSchema.default(Role.VIEWER),
  active: z.boolean().default(true),
  password: optionalPassword,
  sendInvite: z.boolean().default(false)
}).refine((value) => value.sendInvite || Boolean(value.password), {
  message: "Password is required unless Send Invite is enabled",
  path: ["password"]
});

const userUpdateSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().transform((value) => value.toLowerCase()).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  password: optionalPassword
});

export async function listInternalUsers() {
  return prisma.user.findMany({
    where: { email: { not: "system@mission-control.local" } },
    orderBy: [{ active: "desc" }, { lastName: "asc" }, { firstName: "asc" }]
  });
}

async function stampSupabaseMetadata(supabaseUserId: string, role: Role) {
  const supabase = createSupabaseAdminClient();
  await supabase.auth.admin.updateUserById(supabaseUserId, {
    app_metadata: {
      mission_control: true,
      mission_control_role: role
    }
  });
}

export async function createInternalUser(input: z.input<typeof userCreateSchema>) {
  const data = userCreateSchema.parse(input);
  const supabase = createSupabaseAdminClient();
  const redirectTo = env.APP_BASE_URL ? `${env.APP_BASE_URL}/login` : undefined;
  const authResult = data.sendInvite
    ? await supabase.auth.admin.inviteUserByEmail(data.email, {
        redirectTo,
        data: {
          firstName: data.firstName,
          lastName: data.lastName
        }
      })
    : await supabase.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: {
          firstName: data.firstName,
          lastName: data.lastName
        },
        app_metadata: {
          mission_control: true,
          mission_control_role: data.role
        }
      });

  if (authResult.error || !authResult.data.user) {
    throw Object.assign(new Error(authResult.error?.message ?? "Unable to create Supabase Auth user"), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  await stampSupabaseMetadata(authResult.data.user.id, data.role);

  return prisma.user.upsert({
    where: { email: data.email },
    update: {
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      active: data.active
    },
    create: {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      active: data.active
    }
  });
}

export async function updateInternalUser(input: z.input<typeof userUpdateSchema>) {
  const data = userUpdateSchema.parse(input);
  const existing = await prisma.user.findUnique({ where: { id: data.id } });

  if (!existing) {
    throw Object.assign(new Error("User not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (existing.email === "system@mission-control.local") {
    throw Object.assign(new Error("System user cannot be edited"), { code: "FORBIDDEN", status: 403 });
  }

  const updated = await prisma.user.update({
    where: { id: data.id },
    data: {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      active: data.active
    }
  });

  const authUsers = await createSupabaseAdminClient().auth.admin.listUsers();
  const authUser = authUsers.data.users.find((user) => user.email?.toLowerCase() === existing.email.toLowerCase());

  if (authUser) {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
      email: data.email,
      password: data.password,
      user_metadata: {
        firstName: updated.firstName,
        lastName: updated.lastName
      },
      app_metadata: {
        mission_control: true,
        mission_control_role: updated.role
      },
      ban_duration: updated.active ? "none" : "876000h"
    });

    if (error) {
      throw Object.assign(new Error(error.message), { code: "BAD_REQUEST", status: 400 });
    }
  }

  return updated;
}
