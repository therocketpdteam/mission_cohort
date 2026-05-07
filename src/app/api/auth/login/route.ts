import { cookies } from "next/headers";
import { z } from "zod";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, safeUser } from "@/lib/auth";
import { handleApiError, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient, createSupabaseBrowserClient } from "@/lib/supabase";

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
});

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge
  };
}

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signInWithPassword(input);

    if (error || !data.session || !data.user.email) {
      throw Object.assign(new Error(error?.message ?? "Invalid email or password"), {
        code: "AUTH_REQUIRED",
        status: 401
      });
    }

    const user = await prisma.user.findUnique({ where: { email: data.user.email.toLowerCase() } });

    if (!user?.active) {
      throw Object.assign(new Error("This account is not authorized for Mission Control."), {
        code: "FORBIDDEN",
        status: 403
      });
    }

    await createSupabaseAdminClient().auth.admin.updateUserById(data.user.id, {
      app_metadata: {
        mission_control: true,
        mission_control_role: user.role
      }
    });

    const cookieStore = await cookies();
    cookieStore.set(ACCESS_TOKEN_COOKIE, data.session.access_token, cookieOptions(data.session.expires_in));
    cookieStore.set(REFRESH_TOKEN_COOKIE, data.session.refresh_token, cookieOptions(60 * 60 * 24 * 30));

    return ok(safeUser(user));
  } catch (error) {
    return handleApiError(error);
  }
}
