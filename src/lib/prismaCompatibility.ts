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

export function isMissingPrismaSchema(error: unknown) {
  const code = String((error as { code?: string } | null)?.code ?? "");
  const message = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();

  return (
    code === "P2021" ||
    code === "P2022" ||
    message.includes("does not exist") ||
    (message.includes("column") && message.includes("does not exist")) ||
    (message.includes("table") && message.includes("does not exist"))
  );
}

export function migrationRequiredResult(feature: string, detail = "Production database migration is required before this action can persist safely.") {
  return {
    migrationRequired: true,
    feature,
    status: "blocked",
    message: detail
  };
}
