import { describe, expect, it } from "vitest";
import { modeAllowedForActiveLayer } from "./mapAdapterPolicy";

describe("mapAdapterPolicy", () => {
  it.each(["cell-select", "cell-region"] as const)("allows %s for terrain and region", (mode) => {
    expect(modeAllowedForActiveLayer("terrain", mode)).toBe(true);
    expect(modeAllowedForActiveLayer("region", mode)).toBe(true);
    expect(modeAllowedForActiveLayer("object", mode)).toBe(false);
  });
});
