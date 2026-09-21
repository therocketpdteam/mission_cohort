import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = process.env.MC_ADMIN_EMAIL?.toLowerCase();
  const firstName = process.env.MC_ADMIN_FIRST_NAME ?? "Local";
  const lastName = process.env.MC_ADMIN_LAST_NAME ?? "Admin";
  const role = (process.env.MC_ADMIN_ROLE as Role | undefined) ?? Role.SUPER_ADMIN;

  if (!email) {
    throw new Error("Set MC_ADMIN_EMAIL before running this script.");
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      firstName,
      lastName,
      role,
      active: true
    },
    create: {
      email,
      firstName,
      lastName,
      role,
      active: true
    }
  });

  console.log(`Local Mission Control database user ready: ${user.email} (${user.role})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
