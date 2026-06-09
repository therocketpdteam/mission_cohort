export type ParsedRosterParticipant = {
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  phone?: string;
};

export type ParsedRosterResult = {
  participants: ParsedRosterParticipant[];
  errors: string[];
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailInTextPattern = /[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/;

function cleanCell(value: string) {
  return value.replace(/^"|"$/g, "").trim();
}

function splitDelimitedLine(line: string) {
  if (line.includes("\t")) {
    return line.split("\t").map(cleanCell);
  }

  if (line.includes(",")) {
    return line.split(",").map(cleanCell);
  }

  return [];
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") || "-"
  };
}

export function parseRosterText(text: string): ParsedRosterResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const participants: ParsedRosterParticipant[] = [];
  const errors: string[] = [];
  const seenEmails = new Set<string>();

  for (const [index, line] of lines.entries()) {
    const columns = splitDelimitedLine(line);
    const emailMatch = line.match(emailInTextPattern);
    let firstName = "";
    let lastName = "";
    let email = "";
    let title = "";
    let phone = "";

    if (columns.length >= 3 && emailPattern.test(columns[2]?.toLowerCase() ?? "")) {
      firstName = columns[0] ?? "";
      lastName = columns[1] ?? "";
      email = columns[2]?.toLowerCase() ?? "";
      title = columns[3] ?? "";
      phone = columns[4] ?? "";
    } else if (columns.length >= 2 && emailPattern.test(columns[1]?.toLowerCase() ?? "")) {
      const name = splitName(columns[0] ?? "");
      firstName = name.firstName;
      lastName = name.lastName;
      email = columns[1]?.toLowerCase() ?? "";
      title = columns[2] ?? "";
      phone = columns[3] ?? "";
    } else if (emailMatch?.[0]) {
      const emailValue = emailMatch[0].toLowerCase();
      const nameText = line.replace(emailMatch[0], "").replace(/[,;]/g, " ").replace(/\s+/g, " ").trim();
      const name = splitName(nameText);
      firstName = name.firstName;
      lastName = name.lastName;
      email = emailValue;
    }

    if (!firstName || !emailPattern.test(email)) {
      errors.push(`Line ${index + 1} needs a name and valid email.`);
      continue;
    }

    if (seenEmails.has(email)) {
      errors.push(`Line ${index + 1} repeats ${email}.`);
      continue;
    }

    seenEmails.add(email);
    participants.push({
      firstName,
      lastName: lastName || "-",
      email,
      ...(title ? { title } : {}),
      ...(phone ? { phone } : {})
    });
  }

  return { participants, errors };
}
