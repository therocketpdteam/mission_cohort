const colorStyles: Record<string, string> = {
  purple: "color:#630ED4;font-weight:700;",
  red: "color:#DC2626;font-weight:700;",
  green: "color:#16A34A;font-weight:700;",
  amber: "color:#D97706;font-weight:700;"
};

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value: string) {
  const raw = value
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

  if (/^\{\{\s*[a-zA-Z0-9_.]+\s*\}\}$/.test(raw)) {
    return escapeHtml(raw);
  }

  if (/^(https?:|mailto:|tel:)/i.test(raw) || raw.startsWith("/")) {
    return escapeHtml(raw);
  }

  return "#";
}

function renderInlineFormatting(value: string) {
  return value
    .replace(/\{(purple|red|green|amber):([^{}]+)\}/g, (_match, color: string, text: string) => (
      `<span style="${colorStyles[color]}">${text.trim()}</span>`
    ))
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function renderInline(value: string) {
  const escaped = escapeHtml(value);

  return renderInlineFormatting(escaped.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_match, label: string, href: string) => (
    `<a href="${safeHref(href)}" target="_blank" rel="noopener noreferrer">${renderInlineFormatting(label.trim())}</a>`
  )));
}

function renderBlock(block: string) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInline(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
  }

  return `<p>${block.split("\n").map((line) => renderInline(line.trim())).join("<br />")}</p>`;
}

export function textToEmailHtml(value: string) {
  const blocks = value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return "<p></p>";
  }

  return blocks.map(renderBlock).join("");
}

export function htmlToTemplateText(value: string) {
  return value
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/ul>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
