export async function verifyWebhookSignaturePlaceholder() {
  return { verified: false, reason: "pending_integration" as const };
}
