// Versioned metadata lives with the payment, using the existing notes field.
// The readable first line keeps the check number useful in payment exports.
const marker = "[mission-cohort-check:v1]";
export type CheckPaymentProof = { checkNumber: string; fileKey: string; fileName: string | null; contentType: string | null };

export function readCheckPaymentProof(notes: unknown): CheckPaymentProof | null {
  if (typeof notes !== "string") return null;
  const line = notes.split("\n").find(line => line.startsWith(marker));
  if (!line) return null;
  try {
    const value = JSON.parse(line.slice(marker.length));
    return typeof value.checkNumber === "string" && typeof value.fileKey === "string" && value.fileKey.startsWith("check-payment/")
      ? { checkNumber: value.checkNumber, fileKey: value.fileKey, fileName: value.fileName ?? null, contentType: value.contentType ?? null }
      : null;
  } catch { return null; }
}

export function checkPaymentNotes(proof: CheckPaymentProof, previousNotes?: string | null) {
  const retained = previousNotes?.split("\n").filter(line => !line.startsWith(marker) && !line.startsWith("Check payment proof: #")) ?? [];
  return [`Check payment proof: #${proof.checkNumber}`, ...retained.filter(Boolean), marker + JSON.stringify(proof)].join("\n");
}

export function moneyCents(value: unknown) {
  return Math.round(Number(value ?? 0) * 100);
}

export function collectedPaymentCents(records: Array<{ amount: unknown; status: string }>) {
  return records.filter(row => ["PAID", "PARTIALLY_PAID"].includes(row.status)).reduce((sum, row) => sum + moneyCents(row.amount), 0);
}

export function checkReconciliationPreview(total: unknown, records: Array<{ id?: string; amount: unknown; status: string }>, amount: unknown, replacingId?: string) {
  const collected = collectedPaymentCents(records.filter(row => row.id !== replacingId)) + moneyCents(amount);
  return { collected: collected / 100, balance: Math.max(0, moneyCents(total) - collected) / 100, status: collected >= moneyCents(total) ? "PAID" as const : "PARTIALLY_PAID" as const };
}
