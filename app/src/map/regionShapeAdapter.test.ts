import { describe, expect, it, vi } from "vitest";
import { RealmMapAdapter, cellCenter } from "./MapAdapter";

describe("RealmMapAdapter shaping mode", () => {
  it("emits one clear for the clicked region's non-terrain cells", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const shaped = vi.fn();
    adapter.onRegionShape?.(shaped);
    adapter.setCellAttributes([
      { cellId: "1:1", attribute: "terrain", value: "terrain" },
      { cellId: "1:1", attribute: "region", value: "#2468AC", regionId: "region-a" },
      { cellId: "2:1", attribute: "region", value: "#2468AC", regionId: "region-a" },
      { cellId: "20:20", attribute: "region", value: "#2468AC", regionId: "region-a" },
    ]);
    adapter.setMode("shape");
    const interaction = adapter.getMap().getInteractions().getArray().at(-1) as unknown as { handleDownEvent: (event: unknown) => boolean; handleUpEvent: (event: unknown) => boolean };
    const pointer = new MouseEvent("pointerdown", { button: 0, bubbles: true });
    Object.defineProperty(pointer, "isPrimary", { value: true });
    const event = { originalEvent: pointer, coordinate: cellCenter(1, 1) };
    expect(interaction.handleDownEvent(event)).toBe(true);
    interaction.handleUpEvent(event);
    expect(shaped).toHaveBeenCalledWith({ cellIds: ["2:1", "20:20"], attribute: "region", value: null });
    adapter.dispose();
    host.remove();
  });
});
