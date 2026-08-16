import { describe, expect, it } from "vitest";
import { DrawingGeometryError, mapErrorCode } from "./errors";

describe("map errors", () => {
  it("keeps typed drawing errors and maps unknown causes to a safe code", () => {
    const error = new DrawingGeometryError("drawing_angle");
    expect(error.name).toBe("DrawingGeometryError");
    expect(error.code).toBe("drawing_angle");
    expect(mapErrorCode(error)).toBe("drawing_angle");
    expect(mapErrorCode(new Error("other"))).toBe("drawing_invalid_geometry");
    expect(mapErrorCode("other")).toBe("drawing_invalid_geometry");
  });
});
