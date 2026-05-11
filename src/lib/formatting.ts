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
    .replace(/\b(Nyc|Doe|Po|Usa|Us|Ii|Iii|Iv)\b/g, (match) => match.toUpperCase())
    .replace(/\bMc([a-z])/g, (_match, letter: string) => `Mc${letter.toUpperCase()}`)
    .replace(/\bO'([a-z])/g, (_match, letter: string) => `O'${letter.toUpperCase()}`);
}
