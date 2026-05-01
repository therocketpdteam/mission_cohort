import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

function getKey() {
  return createHash("sha256")
    .update(env.INTEGRATION_ENCRYPTION_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? env.WEBHOOK_SECRET ?? "mission-control-local")
    .digest();
}

export function encryptSecret(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const [iv, tag, encrypted] = value.split(".");

  if (!iv || !tag || !encrypted) {
    return undefined;
  }

  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}
