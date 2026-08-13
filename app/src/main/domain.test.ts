// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateAsset, sha256Hex } from "./domain/assets";
import { RealmError, asRealmError, corrupt, invalid } from "./domain/errors";
import { validateGeometry, validateName, validateProperties } from "./domain/geometry";
import { DEFAULT_SETTINGS, parseStoredSettings, validateSettings } from "./domain/settings";
import { cellId, normalizeCellIds, parseCellId, validateCellLayer, validateCellValue } from "./domain/cell";

const png = [137, 80, 78, 71, 13, 10, 26, 10, 0];
const point = { type: "Point", coordinates: [12, 34] } as const;
const square = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] } as const;

describe("main domain validation", () => {
  it("normalizes names, properties, cells, and valid geometry", () => {
    expect(validateName("  Realm  ")).toBe("Realm");
    expect(validateProperties({ label: "ok" })).toEqual({ label: "ok" });
    expect(validateGeometry("city", point)).toContain("Point");
    expect(validateGeometry("terrain", square)).toContain("Polygon");
    expect(parseCellId(" 2:3 ")).toEqual([2, 3]);
    expect(cellId(2, 3)).toBe("2:3");
    expect(normalizeCellIds(["2:3", "1:1", "2:3"])).toEqual([[1, 1], [2, 3]]);
    expect(validateCellValue("  trees ")).toBe("trees");
    expect(validateCellValue(null)).toBeNull();
    expect(() => validateCellLayer("terrain")).not.toThrow();
  });

  it("rejects malformed names, geometry, properties, and cell input", () => {
    expect(() => validateName(" ")).toThrow(RealmError);
    expect(() => validateName("x".repeat(201))).toThrow("too long");
    expect(() => validateProperties([])).toThrow("properties");
    expect(() => validateGeometry("city", square)).toThrow("Geometry type");
    expect(() => validateGeometry("river", { type: "LineString", coordinates: [[0, 0], [0, 0]] })).toThrow("distinct");
    expect(() => validateGeometry("terrain", { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1]]] })).toThrow("closed");
    expect(() => parseCellId("128:0")).toThrow("outside");
    expect(() => normalizeCellIds([])).toThrow("selection");
    expect(() => validateCellValue(" ")).toThrow("value");
    expect(() => validateCellLayer("bad")).toThrow("layer");
  });

  it("validates settings and converts stored failures to corrupt errors", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings(JSON.stringify(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, gridColor: "red" })).toThrow("grid");
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, themeOverrides: { unknown: "#ffffff" } })).toThrow("overrides");
    expect(() => parseStoredSettings("not-json")).toThrow("invalid");
  });

  it("checks asset signatures, hashes, and metadata", () => {
    const digest = sha256Hex(Uint8Array.from(png));
    expect(validateAsset({ mime: "IMAGE/PNG", bytes: png, width: 4, height: 5, metadata: {}, sha256: digest })).toMatchObject({ mime: "image/png", sha256: digest, width: 4 });
    expect(() => validateAsset({ mime: "image/png", bytes: [1], width: 1, height: 1, metadata: {} })).toThrow("content");
    expect(() => validateAsset({ mime: "image/png", bytes: png, width: 0, height: 1, metadata: {} })).toThrow("dimensions");
    expect(() => validateAsset({ mime: "image/png", bytes: png, width: 1, height: 1, metadata: {}, sha256: "0".repeat(64) })).toThrow("SHA");
    expect(() => validateAsset({ mime: "image/gif", bytes: png, width: 1, height: 1, metadata: {} })).toThrow("format");
  });

  it("preserves realm error identity and normalizes unknown failures", () => {
    const known = invalid("bad");
    expect(asRealmError(known)).toBe(known);
    expect(asRealmError(new Error("disk"))).toMatchObject({ code: "storage_error", message: "disk" });
    expect(asRealmError("unknown", "fallback")).toMatchObject({ code: "storage_error", message: "fallback" });
    expect(corrupt().code).toBe("corrupt_project");
  });
});
