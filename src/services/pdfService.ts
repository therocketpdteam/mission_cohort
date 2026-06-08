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
  documentType: "invoice" | "receipt";
  invoiceNumber: string;
  status: string;
  organizationName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  cohortTitle: string;
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
};

export function buildInvoicePdf(input: InvoicePdfInput) {
  const isReceipt = input.documentType === "receipt";
  const title = isReceipt ? "PAID RECEIPT" : "INVOICE";
  const content: string[] = [
    fillRect(0, 720, 612, 72, [10, 31, 68]),
    fillRect(44, 684, 524, 1, [203, 213, 225]),
    pdfText("RocketPD", 44, 752, { size: 22, font: "F2", color: [255, 255, 255] }),
    pdfText("Mission Control Finance", 44, 733, { size: 10, color: [203, 213, 225] }),
    pdfText(title, 568, 752, { size: 18, font: "F2", color: [255, 255, 255], align: "right" }),
    pdfText(input.invoiceNumber, 568, 733, { size: 10, color: [203, 213, 225], align: "right" }),
    pdfText(isReceipt ? "Payment received" : "Bill To", 44, 656, { size: 9, font: "F2", color: [20, 121, 201] }),
    pdfText(input.organizationName, 44, 636, { size: 14, font: "F2" }),
    input.contactName ? pdfText(input.contactName, 44, 618, { size: 10, color: [71, 85, 105] }) : "",
    input.contactEmail ? pdfText(input.contactEmail, 44, 602, { size: 10, color: [71, 85, 105] }) : "",
    fillRect(356, 610, 212, 72, [248, 250, 252]),
    pdfText("Status", 372, 658, { size: 8, font: "F2", color: [100, 116, 139] }),
    pdfText(isReceipt ? "PAID" : input.status, 568, 658, { size: 10, font: "F2", color: isReceipt ? [22, 163, 74] : [15, 23, 42], align: "right" }),
    pdfText("Issue Date", 372, 638, { size: 8, font: "F2", color: [100, 116, 139] }),
    pdfText(input.issueDate, 568, 638, { size: 10, align: "right" }),
    pdfText(isReceipt ? "Receipt Date" : "Due Date", 372, 618, { size: 8, font: "F2", color: [100, 116, 139] }),
    pdfText(isReceipt ? input.issueDate : input.dueDate, 568, 618, { size: 10, align: "right" }),
    pdfText("Cohort", 44, 560, { size: 8, font: "F2", color: [100, 116, 139] }),
    ...wrapText(input.cohortTitle, 86).slice(0, 2).map((line, index) => pdfText(line, 44, 542 - index * 15, { size: 10 })),
    pdfText("PO Number", 356, 560, { size: 8, font: "F2", color: [100, 116, 139] }),
    pdfText(input.purchaseOrderNumber || "-", 568, 542, { size: 10, align: "right" }),
    fillRect(44, 492, 524, 28, [15, 23, 42]),
    pdfText("Description", 58, 502, { size: 9, font: "F2", color: [255, 255, 255] }),
    pdfText("Qty", 374, 502, { size: 9, font: "F2", color: [255, 255, 255], align: "right" }),
    pdfText("Unit", 464, 502, { size: 9, font: "F2", color: [255, 255, 255], align: "right" }),
    pdfText("Amount", 552, 502, { size: 9, font: "F2", color: [255, 255, 255], align: "right" })
  ].filter(Boolean);

  let y = 466;
  input.lineItems.slice(0, 8).forEach((item, index) => {
    if (index % 2 === 0) {
      content.push(fillRect(44, y - 8, 524, 30, [248, 250, 252]));
    }
    const lines = wrapText(item.description, 50).slice(0, 2);
    content.push(pdfText(lines[0], 58, y, { size: 9, font: "F2" }));
    if (lines[1]) {
      content.push(pdfText(lines[1], 58, y - 13, { size: 8, color: [71, 85, 105] }));
    }
    content.push(pdfText(String(item.quantity), 374, y, { size: 9, align: "right" }));
    content.push(pdfText(item.unitAmount, 464, y, { size: 9, align: "right" }));
    content.push(pdfText(item.totalAmount, 552, y, { size: 9, font: "F2", align: "right" }));
    content.push(strokeLine(44, y - 14, 568, y - 14));
    y -= 34;
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
  content.push(pdfText("RocketPD | Generated by Mission Control", 44, 52, { size: 8, color: [100, 116, 139] }));
  content.push(pdfText(new Date().toLocaleDateString(), 568, 52, { size: 8, color: [100, 116, 139], align: "right" }));

  return buildPdf(content.join("\n"));
}
