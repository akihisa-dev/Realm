import { deriveRegionObjects } from "./regionObjects";

describe("deriveRegionObjects", () => {
  it("groups the same persistent region into disconnected components", () => {
    const regionId = "11111111-1111-4111-8111-111111111111";
    const regions = deriveRegionObjects([
      { cellId: "1:1", attribute: "region", value: "#2468AC", regionId },
      { cellId: "2:1", attribute: "region", value: "#2468AC", regionId },
      { cellId: "20:20", attribute: "region", value: "#2468AC", regionId },
      { cellId: "4:4", attribute: "region", value: "#E45756", regionId: "22222222-2222-4222-8222-222222222222" },
    ]);

    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ label: "領域 1", persistentId: regionId, color: "#2468AC", cellIds: ["1:1", "2:1", "20:20"] });
    expect(regions[0]?.components.map((component) => component.cellIds)).toEqual([["1:1", "2:1"], ["20:20"]]);
    expect(regions[1]).toMatchObject({ label: "領域 2", color: "#E45756", cellIds: ["4:4"] });
  });
});
