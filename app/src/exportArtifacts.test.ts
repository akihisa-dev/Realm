import { pdfFromJpeg } from "./exportArtifacts";

describe("map artifact encoding", () => {
  it("wraps JPEG bytes in a landscape single-page PDF", () => {
    const jpeg = [0xff, 0xd8, 0xff, 0xd9];
    const pdf = Uint8Array.from(pdfFromJpeg({ bytes: jpeg, width: 1600, height: 900 }));
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/Count 1");
    expect([...pdf]).toEqual(expect.arrayContaining(jpeg));
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("rejects empty raster data", () => {
    expect(() => pdfFromJpeg({ bytes: [], width: 10, height: 10 })).toThrow("空");
  });
});
