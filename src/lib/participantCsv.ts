import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";

type ParticipantCsvRow = Record<string, any>;

function csvCell(value: unknown) {
  const normalized = value == null ? "" : String(value).replace(/\r?\n/g, " ").trim();
  return `"${normalized.replace(/"/g, '""')}"`;
}

function csvDate(value: unknown) {
  return value ? new Date(String(value)).toLocaleString("en-US") : "";
}

export function exportParticipantsCsv(participants: ParticipantCsvRow[], filenamePrefix = "mission-control-participants") {
  const headers = [
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "Title",
    "Participant Status",
    "Certificate Issued",
    "Cohort",
    "Organization",
    "Registration POC",
    "POC Email",
    "Payment Status",
    "Payment Method",
    "Registration Total",
    "Registration Seats",
    "Registration Source",
    "Participant Created",
    "Participant Updated"
  ];
  const rows = participants.map((participant) => [
    participant.firstName,
    participant.lastName,
    participant.email,
    participant.phone,
    participant.title,
    formatStatusLabel(participant.status),
    participant.certificateIssued ? "Yes" : "No",
    participant.cohort?.title,
    formatProperDisplay(participant.organization?.name ?? ""),
    formatProperDisplay(participant.registration?.primaryContactName ?? ""),
    participant.registration?.primaryContactEmail,
    formatStatusLabel(participant.registration?.paymentStatus ?? ""),
    formatStatusLabel(participant.registration?.paymentMethod ?? ""),
    participant.registration?.totalAmount,
    participant.registration?.participantCount,
    participant.registration?.source,
    csvDate(participant.createdAt),
    csvDate(participant.updatedAt)
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `${filenamePrefix}-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
