export function formatPersonName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

export function formatCurrency(value: number | string) {
  const amount = typeof value === "string" ? Number(value) : value;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(amount);
}

export function formatProperDisplay(value?: string | null) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");

  if (!text) {
    return "";
  }

  if (text.includes("@") || /https?:\/\//i.test(text) || /^[A-Z0-9_-]{8,}$/i.test(text)) {
    return text;
  }

  return text
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\b(Nyc|Po|Usa|Us|Ii|Iii|Iv)\b/g, (match) => match.toUpperCase())
    .replace(/\bMc([a-z])/g, (_match, letter: string) => `Mc${letter.toUpperCase()}`)
    .replace(/\bO'([a-z])/g, (_match, letter: string) => `O'${letter.toUpperCase()}`);
}

export function formatStatusLabel(value?: string | boolean | null) {
  if (typeof value === "boolean") {
    return value ? "Active" : "Inactive";
  }

  const text = String(value ?? "Unknown").trim();

  if (!text) {
    return "Unknown";
  }

  return text
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\b(Poc|Po|Qb|Url|Id|Api|Crm|Ics|W)\b/g, (match) => match.toUpperCase())
    .replace(/\bW 9\b/g, "W-9");
}

export function formatHumanLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/gi, (match) => match.toUpperCase())
    .replace(/\b(Url|Id|Api|Crm|Qb|Po|Poc|Sms|Csv|Json|Ics|Lms|Rls)\b/g, (match) => match.toUpperCase());
}
