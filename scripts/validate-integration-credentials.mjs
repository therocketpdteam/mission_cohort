import { createDecipheriv, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function decrypt(value, secret) {
  if (!value) return;
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("credential has an invalid encrypted format");
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
}

async function main() {
  const secret = String(process.env.INTEGRATION_ENCRYPTION_KEY ?? "").trim();
  const environment = String(process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || process.env.VERCEL_ENV || "local").toLowerCase();
  const connections = await prisma.integrationConnection.findMany({
    select: { provider: true, label: true, accessToken: true, refreshToken: true }
  });
  const protectedConnections = connections.filter((row) => row.accessToken || row.refreshToken);

  if (!secret) {
    if (environment === "production" || protectedConnections.length > 0) {
      throw new Error("INTEGRATION_ENCRYPTION_KEY is required and cannot be removed while encrypted integration credentials exist.");
    }
    console.log("Integration credential validation skipped: no encrypted credentials are stored.");
    return;
  }

  const failures = [];
  for (const connection of protectedConnections) {
    try {
      decrypt(connection.accessToken, secret);
      decrypt(connection.refreshToken, secret);
    } catch (error) {
      failures.push(`${connection.provider}/${connection.label}: ${error instanceof Error ? error.message : "decryption failed"}`);
    }
  }

  if (failures.length) {
    throw new Error(`Integration credential continuity validation failed. Restore the previous INTEGRATION_ENCRYPTION_KEY before deploying.\n- ${failures.join("\n- ")}`);
  }

  const fingerprint = createHash("sha256").update(secret).digest("hex").slice(0, 12);
  console.log(`Integration credentials validated: ${protectedConnections.length} connection(s), key fingerprint ${fingerprint}.`);
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
