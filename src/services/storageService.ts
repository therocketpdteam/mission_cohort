import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { randomUUID } from "node:crypto";

export type UploadPurpose = "cohort-thumbnail" | "invoice" | "receipt" | "material" | "email-attachment";

const publicPurposes = new Set<UploadPurpose>(["cohort-thumbnail"]);

const acceptedTypes: Record<UploadPurpose, RegExp> = {
  "cohort-thumbnail": /^image\/(png|jpe?g|webp|gif)$/i,
  invoice: /^application\/pdf$/i,
  receipt: /^application\/pdf$/i,
  material: /^(application\/pdf|image\/|video\/|text\/|application\/vnd\.openxmlformats-officedocument|application\/msword)/i,
  "email-attachment": /^(application\/pdf|image\/|text\/|application\/vnd\.openxmlformats-officedocument|application\/msword)/i
};

const maxBytes: Record<UploadPurpose, number> = {
  "cohort-thumbnail": 5 * 1024 * 1024,
  invoice: 10 * 1024 * 1024,
  receipt: 10 * 1024 * 1024,
  material: 250 * 1024 * 1024,
  "email-attachment": 20 * 1024 * 1024
};

const bucketLimits = {
  public: maxBytes["cohort-thumbnail"],
  private: maxBytes.material
};

function isMissingBucket(error: unknown) {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
  return message.includes("bucket not found") || message.includes("not found");
}

async function ensureBucket(input: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  bucket: string;
  isPublic: boolean;
}) {
  const fileSizeLimit = input.isPublic ? bucketLimits.public : bucketLimits.private;
  const existing = await input.supabase.storage.getBucket(input.bucket);

  if (!existing.error) {
    const updated = await input.supabase.storage.updateBucket(input.bucket, {
      public: input.isPublic,
      fileSizeLimit
    });

    if (updated.error) {
      throw Object.assign(new Error(updated.error.message), { code: "BAD_REQUEST", status: 400 });
    }

    return;
  }

  if (!isMissingBucket(existing.error)) {
    throw Object.assign(new Error(existing.error.message), { code: "BAD_REQUEST", status: 400 });
  }

  const created = await input.supabase.storage.createBucket(input.bucket, {
    public: input.isPublic,
    fileSizeLimit
  });

  if (created.error && !isMissingBucket(created.error) && !created.error.message.toLowerCase().includes("already exists")) {
    throw Object.assign(new Error(created.error.message), { code: "BAD_REQUEST", status: 400 });
  }
}

export async function uploadAppFile(input: {
  purpose: UploadPurpose;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}) {
  const pattern = acceptedTypes[input.purpose];
  const limit = maxBytes[input.purpose];

  if (!pattern.test(input.contentType)) {
    throw Object.assign(new Error("File type is not supported for this upload."), { code: "BAD_REQUEST", status: 400 });
  }

  if (input.bytes.byteLength > limit) {
    throw Object.assign(new Error("File is too large for this upload."), { code: "BAD_REQUEST", status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const isPublic = publicPurposes.has(input.purpose);
  const bucket = isPublic
    ? env.SUPABASE_PUBLIC_BUCKET ?? "mission-control-public"
    : env.SUPABASE_PRIVATE_BUCKET ?? "mission-control-private";
  const cleanName = input.fileName.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || "upload";
  const fileKey = `${input.purpose}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${cleanName}`;

  await ensureBucket({ supabase, bucket, isPublic });

  const { error } = await supabase.storage.from(bucket).upload(fileKey, input.bytes, {
    contentType: input.contentType,
    upsert: false
  });

  if (error) {
    throw Object.assign(new Error(error.message), { code: "BAD_REQUEST", status: 400 });
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(fileKey);
  const signed = isPublic ? null : await supabase.storage.from(bucket).createSignedUrl(fileKey, 60 * 60 * 24 * 30);

  return {
    provider: "supabase",
    bucket,
    fileKey,
    url: isPublic ? data.publicUrl : signed?.data?.signedUrl
  };
}
