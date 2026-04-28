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
