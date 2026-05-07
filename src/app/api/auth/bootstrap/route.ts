import { z } from "zod";
import { env } from "@/lib/env";
import { fail, handleApiError, ok } from "@/lib/api";
import { safeUser } from "@/lib/auth";
import { createInternalUser } from "@/services/userService";

const bootstrapSchema = z.object({
  secret: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12),
  firstName: z.string().min(1).default("RocketPD"),
  lastName: z.string().min(1).default("Admin")
});

export async function POST(request: Request) {
  try {
    if (!env.AUTH_BOOTSTRAP_SECRET) {
      return fail("Auth bootstrap is not configured", "FORBIDDEN", 403);
    }

    const input = bootstrapSchema.parse(await request.json());

    if (input.secret !== env.AUTH_BOOTSTRAP_SECRET) {
      return fail("Invalid bootstrap secret", "FORBIDDEN", 403);
    }

    const user = await createInternalUser({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      role: "SUPER_ADMIN",
      active: true,
      sendInvite: false
    });

    return ok(safeUser(user), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
