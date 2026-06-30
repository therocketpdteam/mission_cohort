function escapePdfText(value: string) {
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfLine(text: string, x: number, y: number, size = 10, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function textWidth(text: string, size: number) {
  return text.length * size * 0.52;
}

function pdfText(text: string, x: number, y: number, options: { size?: number; font?: string; color?: [number, number, number]; align?: "left" | "right" } = {}) {
  const size = options.size ?? 10;
  const font = options.font ?? "F1";
  const color = options.color ?? [15, 23, 42];
  const left = options.align === "right" ? x - textWidth(text, size) : x;
  return `BT ${color.map((value) => (value / 255).toFixed(3)).join(" ")} rg /${font} ${size} Tf ${left} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function fillRect(x: number, y: number, width: number, height: number, color: [number, number, number]) {
  return `q ${color.map((value) => (value / 255).toFixed(3)).join(" ")} rg ${x} ${y} ${width} ${height} re f Q`;
}

function strokeLine(x1: number, y1: number, x2: number, y2: number, color: [number, number, number] = [226, 232, 240], width = 1) {
  return `q ${color.map((value) => (value / 255).toFixed(3)).join(" ")} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q`;
}

function wrapText(text: string, maxCharacters: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharacters && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function invoiceDescriptionParts(description: string) {
  const [title, ...rest] = description.split(" - ");
  return {
    title: title?.trim() || description,
    detail: rest.join(" - ").trim()
  };
}

function buildPdf(content: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body);
}

export function buildSimplePdf(title: string, lines: string[]) {
  const visibleLines = [title, ...lines].slice(0, 42);
  const content = visibleLines
    .map((line, index) => pdfLine(line, 48, 760 - index * 17, index === 0 ? 18 : 10, index === 0 ? "F2" : "F1"))
    .join("\n");
  return buildPdf(content);
}

export type InvoicePdfInput = {
  issuer: {
    displayName: string;
    legalName: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    email?: string;
    website?: string;
    taxId?: string;
  };
  documentType: "invoice" | "receipt";
  invoiceNumber: string;
  status: string;
  organizationName: string;
  organizationAddressLines?: string[];
  contactName?: string | null;
  contactEmail?: string | null;
  cohortTitle: string;
  cohortDescription?: string | null;
  purchaseOrderNumber?: string | null;
  issueDate: string;
  dueDate: string;
  lineItems: Array<{ description: string; quantity: number; unitAmount: string; totalAmount: string }>;
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  notes?: string | null;
  footerNote?: string | null;
};

export function buildInvoicePdf(input: InvoicePdfInput) {
  const isReceipt = input.documentType === "receipt";
  const title = isReceipt ? "Receipt" : "Invoice";
  const purple: [number, number, number] = [59, 58, 109];
  const accent: [number, number, number] = [168, 93, 163];
  const lavender: [number, number, number] = [201, 202, 232];
  const ink: [number, number, number] = [15, 23, 42];
  const muted: [number, number, number] = [55, 65, 81];
  const cityStateZip = [
    input.issuer.city,
    [input.issuer.state, input.issuer.zip].filter(Boolean).join(" ")
  ].filter(Boolean).join(", ");
  const issuerAddress = [
    input.issuer.addressLine1,
    input.issuer.addressLine2,
    cityStateZip
  ].filter(Boolean);
  const issuerLines = [
    input.issuer.legalName || input.issuer.displayName,
    ...issuerAddress,
    input.issuer.phone,
    input.issuer.email,
    input.issuer.website,
    input.issuer.taxId ? `Tax ID: ${input.issuer.taxId}` : ""
  ].filter((line): line is string => Boolean(line));
  const content: string[] = [
    fillRect(0, 642, 612, 150, purple),
    pdfText("Rocket", 44, 728, { size: 30, font: "F2", color: [255, 255, 255] }),
    fillRect(151, 715, 47, 35, accent),
    pdfText("PD", 158, 728, { size: 28, font: "F2", color: [255, 255, 255] }),
    pdfText(title, 44, 684, { size: 42, font: "F2", color: [255, 255, 255] }),
    ...issuerLines.slice(0, 5).map((line, index) => pdfText(line, 552, 730 - index * 16, { size: index === 0 ? 12 : 9.5, font: index === 0 ? "F2" : "F1", color: [255, 255, 255], align: "right" })),
    pdfText(isReceipt ? "PAYMENT RECEIVED FROM:" : "BILL TO:", 44, 594, { size: 9, font: "F2", color: ink }),
    input.contactName ? pdfText(input.contactName, 44, 571, { size: 13, font: "F2", color: ink }) : "",
    pdfText(input.organizationName, 44, input.contactName ? 550 : 571, { size: 11, color: muted }),
    ...(input.organizationAddressLines ?? []).slice(0, 3).map((line, index) => pdfText(line, 44, (input.contactName ? 532 : 553) - index * 15, { size: 10.5, color: muted })),
    input.contactEmail ? pdfText(input.contactEmail, 44, 488, { size: 9, color: muted }) : "",
    pdfText(`${isReceipt ? "RECEIPT" : "INVOICE"} #`, 552, 594, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText(input.invoiceNumber, 552, 576, { size: 11, color: muted, align: "right" }),
    pdfText("DATE", 552, 544, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText(input.issueDate, 552, 526, { size: 11, color: muted, align: "right" }),
    pdfText("PURCHASE ORDER", 552, 494, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText(input.purchaseOrderNumber || "-", 552, 476, { size: 11, color: muted, align: "right" }),
    pdfText("ITEMS", 44, 426, { size: 9, font: "F2", color: ink }),
    pdfText("DESCRIPTION", 112, 426, { size: 9, font: "F2", color: ink }),
    pdfText("QUANTITY", 423, 426, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText("PRICE", 488, 426, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText("TAX", 520, 426, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText("AMOUNT", 568, 426, { size: 9, font: "F2", color: ink, align: "right" })
  ].filter(Boolean);

  let y = 388;
  input.lineItems.slice(0, 8).forEach((item, index) => {
    const { title: itemTitle, detail } = invoiceDescriptionParts(item.description);
    const detailLines = wrapText(detail || input.cohortDescription || "", 48).slice(0, 5);

    content.push(pdfText(`ITEM ${index + 1}`, 44, y, { size: 9, color: ink }));
    content.push(pdfText(wrapText(itemTitle, 45)[0] ?? itemTitle, 112, y, { size: 10, font: "F2", color: ink }));
    detailLines.forEach((line, lineIndex) => {
      content.push(pdfText(line, 112, y - 21 - lineIndex * 15, { size: 9, color: muted }));
    });
    content.push(pdfText(String(item.quantity), 423, y, { size: 10, color: ink, align: "right" }));
    content.push(pdfText(item.unitAmount, 488, y, { size: 10, color: ink, align: "right" }));
    content.push(pdfText(input.taxAmount === "$0.00" ? "NA" : input.taxAmount, 520, y, { size: 10, font: "F2", color: ink, align: "right" }));
    content.push(pdfText(item.totalAmount, 568, y, { size: 10, font: "F2", color: ink, align: "right" }));

    if (index < input.lineItems.length - 1) {
      content.push(strokeLine(44, y - 90, 568, y - 90, [226, 232, 240]));
    }
    y -= 104;
  });

  content.push(pdfText("PAYMENT", 44, 214, { size: 9, font: "F2", color: ink }));
  content.push(pdfText(isReceipt ? `Paid ${input.paidAmount}` : "-", 44, 194, { size: 10, color: muted }));
  content.push(pdfText("Subtotal", 420, 244, { size: 9, color: muted, align: "right" }));
  content.push(pdfText(input.subtotalAmount, 568, 244, { size: 9, color: ink, align: "right" }));
  content.push(pdfText("Tax", 420, 226, { size: 9, color: muted, align: "right" }));
  content.push(pdfText(input.taxAmount, 568, 226, { size: 9, color: ink, align: "right" }));
  content.push(pdfText(isReceipt ? "Balance Due" : "Balance", 420, 208, { size: 9, color: muted, align: "right" }));
  content.push(pdfText(input.balanceAmount, 568, 208, { size: 9, color: ink, align: "right" }));

  const noteLines = wrapText(input.notes || (isReceipt ? "Thank you. This receipt confirms payment recorded by RocketPD." : "Please address checks to RocketPD."), 42).slice(0, 4);
  content.push(fillRect(0, 58, 408, 96, lavender));
  content.push(fillRect(408, 58, 204, 96, accent));
  content.push(pdfText("NOTES:", 44, 118, { size: 9, font: "F2", color: ink }));
  noteLines.forEach((line, index) => {
    content.push(pdfText(line, 44, 99 - index * 14, { size: 9, font: index === 0 ? "F2" : "F1", color: ink }));
  });
  content.push(pdfText("TOTAL:", 552, 116, { size: 10, font: "F2", color: [255, 255, 255], align: "right" }));
  content.push(pdfText(isReceipt ? input.paidAmount : input.totalAmount, 552, 78, { size: 31, font: "F2", color: [255, 255, 255], align: "right" }));
  content.push(pdfText(input.footerNote || "In Demand Group, LLC", 306, 34, { size: 8, color: [100, 116, 139], align: "right" }));
  content.push(pdfText("DBA RocketPD", 306, 22, { size: 8, color: [100, 116, 139], align: "right" }));

  return buildPdf(content.join("\n"));
}
