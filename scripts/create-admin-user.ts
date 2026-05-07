import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { createInternalUser } from "../src/services/userService";

async function main() {
  const email = process.env.MC_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.MC_ADMIN_PASSWORD;
  const firstName = process.env.MC_ADMIN_FIRST_NAME ?? "RocketPD";
  const lastName = process.env.MC_ADMIN_LAST_NAME ?? "Admin";
  const role = (process.env.MC_ADMIN_ROLE as Role | undefined) ?? Role.SUPER_ADMIN;

  if (!email || !password) {
    throw new Error("Set MC_ADMIN_EMAIL and MC_ADMIN_PASSWORD before running this script.");
  }

  const user = await createInternalUser({
    email,
    password,
    firstName,
    lastName,
    role,
    active: true,
    sendInvite: false
  });

  console.log(`Mission Control admin ready: ${user.email} (${user.role})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
