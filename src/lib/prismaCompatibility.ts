export function isMissingEmailReviewColumn(error: unknown) {
  const code = String((error as { code?: string } | null)?.code ?? "");
  const message = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();

  return (
    code === "P2022" &&
    (message.includes("reviewedat") || message.includes("reviewedbyid") || message.includes("reviewnote"))
  ) || (
    message.includes("emailevent") &&
    (message.includes("reviewedat") || message.includes("reviewedbyid") || message.includes("reviewnote"))
  );
}
