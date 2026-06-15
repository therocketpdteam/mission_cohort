import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function fillIfBlank(current: unknown, next: unknown) {
  const currentText = text(current);
  const nextText = text(next);
  return !currentText && nextText ? nextText : undefined;
}

let disconnect = async () => {};

async function main() {
  loadLocalEnv();

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required to backfill Jotform addresses. Pull or provide the production database URL, then run this script again.");
  }

  const [{ prisma }, { normalizeJotformRegistrationPayload }, { listActiveJotformFormMappings }] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/modules/jotform"),
    import("../src/services/jotformMappingService")
  ]);
  disconnect = () => prisma.$disconnect();
  const apply = process.env.APPLY === "1";
  const mappings = await listActiveJotformFormMappings();
  const events = await prisma.webhookEvent.findMany({
    where: {
      source: "jotform",
      registrationId: { not: null }
    },
    orderBy: { createdAt: "asc" },
    include: {
      registration: {
        include: { organization: true }
      }
    }
  });
  let checked = 0;
  let candidates = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    checked += 1;

    if (!event.registration?.organization) {
      skipped += 1;
      continue;
    }

    try {
      const normalized = normalizeJotformRegistrationPayload(event.payload as Record<string, unknown>, mappings);
      const organization = event.registration.organization;
      const parsed = normalized.organization ?? {};
      const data = {
        addressLine1: fillIfBlank(organization.addressLine1, parsed.addressLine1),
        addressLine2: fillIfBlank(organization.addressLine2, parsed.addressLine2),
        city: fillIfBlank(organization.city, parsed.city),
        state: fillIfBlank(organization.state, parsed.state),
        zip: fillIfBlank(organization.zip, parsed.zip)
      };
      const update = Object.fromEntries(Object.entries(data).filter(([, value]) => value));

      if (Object.keys(update).length === 0) {
        continue;
      }

      candidates += 1;
      console.log(`${apply ? "Updating" : "Would update"} ${organization.name} (${organization.id}):`, update);

      if (apply) {
        await prisma.organization.update({
          where: { id: organization.id },
          data: update
        });
        updated += 1;
      }
    } catch (error) {
      skipped += 1;
      console.warn(`Skipped event ${event.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  console.log(`Checked ${checked} Jotform events. ${apply ? "Updated" : "Found"} ${apply ? updated : candidates} organizations. Skipped ${skipped}.`);
  if (!apply) {
    console.log("Dry run only. Re-run with APPLY=1 to write missing organization address fields.");
  }
}

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env.vercel.local", ".env"]) {
    const filePath = join(process.cwd(), fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");

      if (key && process.env[key] == null) {
        process.env[key] = value;
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect();
  });
