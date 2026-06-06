import { createClient } from "@supabase/supabase-js";

const publicBucket = process.env.SUPABASE_PUBLIC_BUCKET || "mission-control-public";
const privateBucket = process.env.SUPABASE_PRIVATE_BUCKET || "mission-control-private";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const buckets = [
  {
    name: publicBucket,
    public: true,
    fileSizeLimit: 5 * 1024 * 1024
  },
  {
    name: privateBucket,
    public: false,
    fileSizeLimit: 20 * 1024 * 1024
  }
];

function isMissingBucket(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return message.includes("bucket not found") || message.includes("not found");
}

async function ensureBucket(supabase, bucket) {
  const existing = await supabase.storage.getBucket(bucket.name);

  if (!existing.error) {
    const updated = await supabase.storage.updateBucket(bucket.name, {
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit
    });

    if (updated.error) {
      throw new Error(`Could not update ${bucket.name}: ${updated.error.message}`);
    }

    console.log(`Storage bucket ready: ${bucket.name}`);
    return;
  }

  if (!isMissingBucket(existing.error)) {
    throw new Error(`Could not inspect ${bucket.name}: ${existing.error.message}`);
  }

  const created = await supabase.storage.createBucket(bucket.name, {
    public: bucket.public,
    fileSizeLimit: bucket.fileSizeLimit
  });

  if (created.error && !created.error.message.toLowerCase().includes("already exists")) {
    throw new Error(`Could not create ${bucket.name}: ${created.error.message}`);
  }

  console.log(`Storage bucket created: ${bucket.name}`);
}

async function main() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to prepare storage buckets.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  for (const bucket of buckets) {
    await ensureBucket(supabase, bucket);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
