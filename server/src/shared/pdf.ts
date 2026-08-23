export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gapBefore?: number;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Minimal single-page A4 PDF generator (Helvetica only) — enough for payslips
 * and simple documents without pulling in a PDF dependency.
 */
export function buildTextPdf(title: string, lines: PdfLine[]): Buffer {
  const pageWidth = 595;
  const pageHeight = 842;
  let y = pageHeight - 60;
  const parts: string[] = [];

  const emit = (text: string, size: number, bold: boolean) => {
    if (y < 50) return;
    parts.push(`BT /F${bold ? 2 : 1} ${size} Tf 50 ${y} Td (${escapePdfText(text)}) Tj ET`);
    y -= Math.round(size * 1.45);
  };

  emit(title, 16, true);
  y -= 6;
  for (const line of lines) {
    y -= line.gapBefore ?? 0;
    emit(line.text.slice(0, 110), line.size ?? 10, line.bold ?? false);
  }

  const content = parts.join("\n");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
