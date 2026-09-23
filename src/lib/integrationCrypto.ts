import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

export class IntegrationCredentialError extends Error {
  constructor(message = "Stored integration credentials cannot be decrypted with the configured encryption key.") {
    super(message);
    this.name = "IntegrationCredentialError";
  }
}

function encryptionSecret() {
  if (env.INTEGRATION_ENCRYPTION_KEY) {
    return env.INTEGRATION_ENCRYPTION_KEY;
  }

  if (process.env.NODE_ENV === "production") {
    throw new IntegrationCredentialError("INTEGRATION_ENCRYPTION_KEY is required in production.");
  }

  return env.SUPABASE_SERVICE_ROLE_KEY ?? env.WEBHOOK_SECRET ?? "mission-control-local";
}

function getKey() {
  return createHash("sha256")
    .update(encryptionSecret())
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

  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof IntegrationCredentialError) {
      throw error;
    }

    throw new IntegrationCredentialError();
  }
}
