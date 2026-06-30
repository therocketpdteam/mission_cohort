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
    pdfText(input.issuer.displayName || "RocketPD", 44, 742, { size: 24, font: "F2", color: [37, 0, 90] }),
    pdfText(title, 44, 710, { size: 30, font: "F2", color: [15, 23, 42] }),
    pdfText(input.invoiceNumber, 44, 690, { size: 10, color: [71, 85, 105] }),
    ...issuerLines.slice(0, 7).map((line, index) => pdfText(line, 568, 744 - index * 14, { size: index === 0 ? 10 : 8.5, font: index === 0 ? "F2" : "F1", color: [71, 85, 105], align: "right" })),
    strokeLine(44, 662, 568, 662, [203, 195, 216]),
    pdfText(isReceipt ? "Payment received from" : "Bill To", 44, 628, { size: 8, font: "F2", color: [99, 14, 212] }),
    pdfText(input.organizationName, 44, 608, { size: 14, font: "F2" }),
    input.contactName ? pdfText(input.contactName, 44, 590, { size: 10, color: [71, 85, 105] }) : "",
    input.contactEmail ? pdfText(input.contactEmail, 44, 574, { size: 10, color: [71, 85, 105] }) : "",
    fillRect(356, 572, 212, 72, [248, 250, 252]),
    pdfText("Status", 372, 620, { size: 8, font: "F2", color: [100, 116, 139] }),
    pdfText(isReceipt ? "PAID" : input.status, 552, 620, { size: 10, font: "F2", color: isReceipt ? [22, 163, 74] : [15, 23, 42], align: "right" }),
    pdfText("Issue Date", 372, 600, { size: 8, font: "F2", color: [100, 116, 139] }),
    pdfText(input.issueDate, 552, 600, { size: 10, align: "right" }),
    pdfText(isReceipt ? "Receipt Date" : "Due Date", 372, 580, { size: 8, font: "F2", color: [100, 116, 139] }),
    pdfText(isReceipt ? input.issueDate : input.dueDate, 552, 580, { size: 10, align: "right" }),
    pdfText("Cohort", 44, 526, { size: 8, font: "F2", color: [100, 116, 139] }),
    ...wrapText(input.cohortTitle, 72).slice(0, 2).map((line, index) => pdfText(line, 44, 508 - index * 15, { size: 10, font: index === 0 ? "F2" : "F1" })),
    input.cohortDescription ? pdfText(wrapText(input.cohortDescription, 74)[0] ?? "", 44, 478, { size: 8.5, color: [71, 85, 105] }) : "",
    pdfText("PO Number", 356, 526, { size: 8, font: "F2", color: [100, 116, 139] }),
    pdfText(input.purchaseOrderNumber || "-", 552, 508, { size: 10, align: "right" }),
    fillRect(44, 438, 524, 26, [37, 0, 90]),
    pdfText("Description", 58, 448, { size: 9, font: "F2", color: [255, 255, 255] }),
    pdfText("Qty", 374, 448, { size: 9, font: "F2", color: [255, 255, 255], align: "right" }),
    pdfText("Unit", 464, 448, { size: 9, font: "F2", color: [255, 255, 255], align: "right" }),
    pdfText("Amount", 552, 448, { size: 9, font: "F2", color: [255, 255, 255], align: "right" })
  ].filter(Boolean);

  let y = 412;
  input.lineItems.slice(0, 8).forEach((item, index) => {
    if (index % 2 === 0) {
      content.push(fillRect(44, y - 8, 524, 34, [248, 250, 252]));
    }
    const lines = wrapText(item.description, 55).slice(0, 3);
    content.push(pdfText(lines[0], 58, y, { size: 9, font: "F2" }));
    if (lines[1]) {
      content.push(pdfText(lines[1], 58, y - 13, { size: 8, color: [71, 85, 105] }));
    }
    if (lines[2]) {
      content.push(pdfText(lines[2], 58, y - 25, { size: 8, color: [71, 85, 105] }));
    }
    content.push(pdfText(String(item.quantity), 374, y, { size: 9, align: "right" }));
    content.push(pdfText(item.unitAmount, 464, y, { size: 9, align: "right" }));
    content.push(pdfText(item.totalAmount, 552, y, { size: 9, font: "F2", align: "right" }));
    content.push(strokeLine(44, y - 26, 568, y - 26));
    y -= 42;
  });

  const totalsTop = Math.min(y - 10, 212);
  content.push(fillRect(356, totalsTop - 10, 212, 122, [248, 250, 252]));
  [
    ["Subtotal", input.subtotalAmount, false],
    ["Tax", input.taxAmount, false],
    ["Total", input.totalAmount, true],
    ["Paid", input.paidAmount, false],
    [isReceipt ? "Balance Due" : "Balance", input.balanceAmount, true]
  ].forEach(([label, value, strong], index) => {
    const rowY = totalsTop + 84 - index * 22;
    content.push(pdfText(String(label), 372, rowY, { size: 9, font: strong ? "F2" : "F1", color: [71, 85, 105] }));
    content.push(pdfText(String(value), 552, rowY, { size: strong ? 12 : 9, font: strong ? "F2" : "F1", align: "right" }));
  });

  const noteLines = wrapText(input.notes || (isReceipt ? "Thank you. This receipt confirms payment recorded by RocketPD." : "Thank you. Please include the invoice number with payment."), 72).slice(0, 4);
  content.push(pdfText("Notes", 44, 172, { size: 8, font: "F2", color: [100, 116, 139] }));
  noteLines.forEach((line, index) => {
    content.push(pdfText(line, 44, 154 - index * 14, { size: 9, color: [71, 85, 105] }));
  });
  content.push(strokeLine(44, 72, 568, 72));
  content.push(pdfText(input.footerNote || "RocketPD | Generated by Mission Control", 44, 52, { size: 8, color: [100, 116, 139] }));
  content.push(pdfText(new Date().toLocaleDateString(), 568, 52, { size: 8, color: [100, 116, 139], align: "right" }));

  return buildPdf(content.join("\n"));
}
