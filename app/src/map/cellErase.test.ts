import { expandConnectedEraseCells } from "./cellErase";

describe("expandConnectedEraseCells", () => {
  it("walks the complete connected terrain component in stable discovery order", () => {
    const attributes = new Map([
      ["1:1", [{ cellId: "1:1", attribute: "terrain" as const, value: "terrain" }]],
      ["2:1", [{ cellId: "2:1", attribute: "terrain" as const, value: "terrain" }]],
      ["1:2", [{ cellId: "1:2", attribute: "terrain" as const, value: "terrain" }]],
      ["20:20", [{ cellId: "20:20", attribute: "terrain" as const, value: "terrain" }]],
    ]);
    expect(expandConnectedEraseCells(attributes, ["1:1"])).toEqual(["1:1", "2:1", "1:2"]);
  });

  it("ignores non-terrain seeds and never traverses outside the 64 by 37 grid", () => {
    const attributes = new Map([
      ["0:0", [{ cellId: "0:0", attribute: "terrain" as const, value: "terrain" }]],
      ["63:0", [{ cellId: "63:0", attribute: "terrain" as const, value: "terrain" }]],
      ["1:0", [{ cellId: "1:0", attribute: "forest" as const, value: "forest" }]],
      ["64:0", [{ cellId: "64:0", attribute: "terrain" as const, value: "terrain" }]],
    ]);
    expect(expandConnectedEraseCells(attributes, ["1:0", "0:0", "-1:0", "64:0"])).toEqual(["0:0"]);
  });
});
