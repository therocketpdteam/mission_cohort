import { deflateSync, inflateSync } from "node:zlib";

function escapePdfText(value: string) {
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfLine(text: string, x: number, y: number, size = 10, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function textWidth(text: string, size: number) {
  return text.length * size * 0.52;
}

function pdfText(text: string, x: number, y: number, options: { size?: number; font?: string; color?: [number, number, number]; align?: "left" | "center" | "right" } = {}) {
  const size = options.size ?? 10;
  const font = options.font ?? "F1";
  const color = options.color ?? [15, 23, 42];
  const left = options.align === "right"
    ? x - textWidth(text, size)
    : options.align === "center"
      ? x - textWidth(text, size) / 2
      : x;
  return `BT ${color.map((value) => (value / 255).toFixed(3)).join(" ")} rg /${font} ${size} Tf ${left} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function fillRect(x: number, y: number, width: number, height: number, color: [number, number, number]) {
  return `q ${color.map((value) => (value / 255).toFixed(3)).join(" ")} rg ${x} ${y} ${width} ${height} re f Q`;
}

function drawImage(name: string, x: number, y: number, width: number, height: number) {
  return `q ${width} 0 0 ${height} ${x} ${y} cm /${name} Do Q`;
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

function paethPredictor(left: number, up: number, upperLeft: number) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }

  if (upDistance <= upperLeftDistance) {
    return up;
  }

  return upperLeft;
}

function parsePngForPdf(bytes: Buffer, name = "Logo"): PdfImage | null {
  const signature = bytes.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset < bytes.byteLength) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    }

    if (type === "IDAT") {
      idatChunks.push(data);
    }

    if (type === "IEND") {
      break;
    }
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    return null;
  }

  const channels = colorType === 6 ? 4 : 3;
  const rowLength = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const raw = Buffer.alloc(width * height * channels);
  let inputOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[inputOffset++];
    const rowStart = row * rowLength;

    for (let column = 0; column < rowLength; column += 1) {
      const rawValue = inflated[inputOffset++];
      const left = column >= channels ? raw[rowStart + column - channels] : 0;
      const up = row > 0 ? raw[rowStart + column - rowLength] : 0;
      const upperLeft = row > 0 && column >= channels ? raw[rowStart + column - rowLength - channels] : 0;
      let value = rawValue;

      if (filter === 1) {
        value = rawValue + left;
      } else if (filter === 2) {
        value = rawValue + up;
      } else if (filter === 3) {
        value = rawValue + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        value = rawValue + paethPredictor(left, up, upperLeft);
      } else if (filter !== 0) {
        return null;
      }

      raw[rowStart + column] = value & 255;
    }
  }

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = colorType === 6 ? Buffer.alloc(width * height) : undefined;
  let hasAlpha = false;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceIndex = pixel * channels;
    const rgbIndex = pixel * 3;
    rgb[rgbIndex] = raw[sourceIndex];
    rgb[rgbIndex + 1] = raw[sourceIndex + 1];
    rgb[rgbIndex + 2] = raw[sourceIndex + 2];

    if (alpha) {
      const alphaValue = raw[sourceIndex + 3];
      alpha[pixel] = alphaValue;
      hasAlpha = hasAlpha || alphaValue < 255;
    }
  }

  return { name, width, height, rgb, alpha: hasAlpha ? alpha : undefined };
}

type PdfImage = {
  name: string;
  width: number;
  height: number;
  rgb: Buffer;
  alpha?: Buffer;
};

function buildStreamObject(dictionary: string, stream: Buffer | string) {
  const bytes = Buffer.isBuffer(stream) ? stream : Buffer.from(stream);
  return Buffer.concat([
    Buffer.from(`${dictionary.replace(/>>$/, `/Length ${bytes.byteLength} >>`)}\nstream\n`, "binary"),
    bytes,
    Buffer.from("\nendstream", "binary")
  ]);
}

function buildPdf(content: string, images: PdfImage[] = []) {
  const imageObjectStart = 6;
  const imageObjectEntries: Array<{ image: PdfImage; objectNumber: number; alphaObjectNumber?: number }> = [];
  let nextObjectNumber = imageObjectStart;

  images.forEach((image) => {
    const objectNumber = nextObjectNumber++;
    const alphaObjectNumber = image.alpha ? nextObjectNumber++ : undefined;
    imageObjectEntries.push({ image, objectNumber, alphaObjectNumber });
  });

  const contentObjectNumber = nextObjectNumber;
  const xObjectResource = imageObjectEntries.length
    ? `/XObject << ${imageObjectEntries.map((entry) => `/${entry.image.name} ${entry.objectNumber} 0 R`).join(" ")} >>`
    : "";
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> ${xObjectResource} >> /Contents ${contentObjectNumber} 0 R >>`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
  ];

  imageObjectEntries.forEach((entry) => {
    const smask = entry.alphaObjectNumber ? `/SMask ${entry.alphaObjectNumber} 0 R` : "";
    objects.push(buildStreamObject(
      `<< /Type /XObject /Subtype /Image /Width ${entry.image.width} /Height ${entry.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ${smask} >>`,
      deflateSync(entry.image.rgb)
    ));

    if (entry.image.alpha) {
      objects.push(buildStreamObject(
        `<< /Type /XObject /Subtype /Image /Width ${entry.image.width} /Height ${entry.image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`,
        deflateSync(entry.image.alpha)
      ));
    }
  });

  objects.push(buildStreamObject("<< >>", content));

  let body = Buffer.from("%PDF-1.4\n", "binary");
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body = Buffer.concat([
      body,
      Buffer.from(`${index + 1} 0 obj\n`, "binary"),
      object,
      Buffer.from("\nendobj\n", "binary")
    ]);
  });

  const xrefOffset = Buffer.byteLength(body);
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    `trailer << /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF"
  ].join("\n");

  return Buffer.concat([body, Buffer.from(xref, "binary")]);
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
  logoImage?: {
    bytes: Buffer;
    contentType: string;
  } | null;
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
  const logoImage = input.logoImage?.contentType.toLowerCase().startsWith("image/png") ? parsePngForPdf(input.logoImage.bytes, "Logo") : null;
  const logoMaxWidth = 185;
  const logoHeight = logoImage ? Math.min(38, logoMaxWidth * (logoImage.height / logoImage.width)) : 0;
  const logoWidth = logoImage ? logoHeight * (logoImage.width / logoImage.height) : 0;
  const logoX = 56;
  const logoY = 716 + (45 - logoHeight) / 2;
  const rightLabelX = 552;
  const rightValueX = 552;
  const amountX = 568;
  const content: string[] = [
    fillRect(0, 642, 612, 150, purple),
    logoImage ? fillRect(44, 713, 210, 45, [255, 255, 255]) : pdfText("Rocket", 44, 728, { size: 30, font: "F2", color: [255, 255, 255] }),
    logoImage ? drawImage("Logo", logoX, logoY, logoWidth, logoHeight) : fillRect(151, 715, 47, 35, accent),
    logoImage ? "" : pdfText("PD", 158, 728, { size: 28, font: "F2", color: [255, 255, 255] }),
    pdfText(title, 44, 684, { size: 42, font: "F2", color: [255, 255, 255] }),
    ...issuerLines.slice(0, 5).map((line, index) => pdfText(line, 552, 730 - index * 16, { size: index === 0 ? 12 : 9.5, font: index === 0 ? "F2" : "F1", color: [255, 255, 255], align: "right" })),
    pdfText(isReceipt ? "PAYMENT RECEIVED FROM:" : "BILL TO:", 44, 594, { size: 9, font: "F2", color: ink }),
    input.contactName ? pdfText(input.contactName, 44, 571, { size: 13, font: "F2", color: ink }) : "",
    pdfText(input.organizationName, 44, input.contactName ? 550 : 571, { size: 11, color: muted }),
    ...(input.organizationAddressLines ?? []).slice(0, 3).map((line, index) => pdfText(line, 44, (input.contactName ? 532 : 553) - index * 15, { size: 10.5, color: muted })),
    input.contactEmail ? pdfText(input.contactEmail, 44, 488, { size: 9, color: muted }) : "",
    pdfText(`${isReceipt ? "RECEIPT" : "INVOICE"} #`, rightLabelX, 594, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText(input.invoiceNumber, rightValueX, 576, { size: 11, color: muted, align: "right" }),
    pdfText("DATE", rightLabelX, 544, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText(input.issueDate, rightValueX, 526, { size: 11, color: muted, align: "right" }),
    pdfText("PURCHASE ORDER", rightLabelX, 494, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText(input.purchaseOrderNumber || "-", rightValueX, 476, { size: 11, color: muted, align: "right" }),
    pdfText("ITEMS", 44, 426, { size: 9, font: "F2", color: ink }),
    pdfText("DESCRIPTION", 112, 426, { size: 9, font: "F2", color: ink }),
    pdfText("QUANTITY", 423, 426, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText("PRICE", 488, 426, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText("TAX", 520, 426, { size: 9, font: "F2", color: ink, align: "right" }),
    pdfText("AMOUNT", amountX, 426, { size: 9, font: "F2", color: ink, align: "right" })
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
    content.push(pdfText(item.totalAmount, amountX, y, { size: 10, font: "F2", color: ink, align: "right" }));

    if (index < input.lineItems.length - 1) {
      content.push(strokeLine(44, y - 90, 568, y - 90, [226, 232, 240]));
    }
    y -= 104;
  });

  content.push(pdfText("PAYMENT", 44, 214, { size: 9, font: "F2", color: ink }));
  content.push(pdfText(isReceipt ? `Paid ${input.paidAmount}` : "-", 44, 194, { size: 10, color: muted }));
  content.push(pdfText("Subtotal", 448, 244, { size: 9, color: muted, align: "right" }));
  content.push(pdfText(input.subtotalAmount, amountX, 244, { size: 9, color: ink, align: "right" }));
  content.push(pdfText("Tax", 448, 226, { size: 9, color: muted, align: "right" }));
  content.push(pdfText(input.taxAmount, amountX, 226, { size: 9, color: ink, align: "right" }));
  content.push(pdfText(isReceipt ? "Balance Due" : "Balance", 448, 208, { size: 9, color: muted, align: "right" }));
  content.push(pdfText(input.balanceAmount, amountX, 208, { size: 9, color: ink, align: "right" }));

  const noteLines = wrapText(input.notes || (isReceipt ? "Thank you. This receipt confirms payment recorded by RocketPD." : "Please address checks to RocketPD."), 42).slice(0, 4);
  content.push(fillRect(0, 58, 408, 96, lavender));
  content.push(fillRect(408, 58, 204, 96, accent));
  content.push(pdfText("NOTES:", 44, 118, { size: 9, font: "F2", color: ink }));
  noteLines.forEach((line, index) => {
    content.push(pdfText(line, 44, 99 - index * 14, { size: 9, font: index === 0 ? "F2" : "F1", color: ink }));
  });
  content.push(pdfText("TOTAL:", 552, 116, { size: 10, font: "F2", color: [255, 255, 255], align: "right" }));
  content.push(pdfText(isReceipt ? input.paidAmount : input.totalAmount, 552, 78, { size: 31, font: "F2", color: [255, 255, 255], align: "right" }));
  content.push(pdfText(input.footerNote || "In Demand Group, LLC", 306, 34, { size: 8, color: [100, 116, 139], align: "center" }));
  content.push(pdfText("DBA RocketPD", 306, 22, { size: 8, color: [100, 116, 139], align: "center" }));

  return buildPdf(content.join("\n"), logoImage ? [logoImage] : []);
}
