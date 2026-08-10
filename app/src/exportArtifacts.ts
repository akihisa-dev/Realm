export type MapRaster = { bytes: number[]; width: number; height: number };

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

const joinBytes = (parts: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

/** Builds a single-page PDF around a JPEG without adding a PDF dependency. */
export const pdfFromJpeg = ({ bytes, width, height }: MapRaster): number[] => {
  if (width <= 0 || height <= 0 || bytes.length === 0) throw new Error("地図画像が空です。");
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const scale = Math.min(pageWidth / width, pageHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const left = (pageWidth - drawWidth) / 2;
  const bottom = (pageHeight - drawHeight) / 2;
  const content = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${left.toFixed(2)} ${bottom.toFixed(2)} cm\n/MapImage Do\nQ\n`;
  const objects = [
    ascii("<< /Type /Catalog /Pages 2 0 R >>"),
    ascii("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /MapImage 4 0 R >> >> /Contents 5 0 R >>`),
    joinBytes([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`),
      Uint8Array.from(bytes),
      ascii("\nendstream"),
    ]),
    ascii(`<< /Length ${ascii(content).length} >>\nstream\n${content}endstream`),
  ];
  const parts: Uint8Array[] = [ascii("%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n")];
  const offsets = [0];
  let length = parts[0]?.length ?? 0;
  objects.forEach((object, index) => {
    offsets.push(length);
    const encoded = joinBytes([ascii(`${index + 1} 0 obj\n`), object, ascii("\nendobj\n")]);
    parts.push(encoded);
    length += encoded.length;
  });
  const xrefOffset = length;
  const xref = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (const offset of offsets.slice(1)) xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
  parts.push(ascii(`${xref.join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return [...joinBytes(parts)];
};
