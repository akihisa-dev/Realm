import Feature from "ol/Feature";
import { describe, expect, it, vi } from "vitest";
import { cellPolygon } from "./gridGeometry";
import { GrabHoverController } from "./GrabHoverController";

describe("GrabHoverController", () => {
  it("creates, refreshes, and removes transient boundary hover state", () => {
    const feature = new Feature();
    const features = new Map([[("10:10"), feature]]);
    const ensured: string[][] = [];
    const removed: string[] = [];
    const targetStates: boolean[] = [];
    const changed = vi.fn();
    const controller = new GrabHoverController({
      attributes: () => new Map([["10:10", [{ cellId: "10:10", layer: "terrain", value: "terrain" }]]]),
      getFeature: (id) => features.get(id),
      ensureFeatures: (ids) => ensured.push([...ids]),
      removeUnused: (id) => removed.push(id),
      changed,
      setTargetState: (active) => targetStates.push(active),
    });
    const boundary = cellPolygon(10, 10)![0]!;

    controller.refresh(false, null);
    controller.refresh(true, boundary, "10:10");
    expect(feature.get("grabHover")).toBe(true);
    expect(ensured).toEqual([["10:10"]]);
    expect(targetStates).toContain(true);
    const calls = changed.mock.calls.length;
    controller.refresh(true, boundary, "10:10");
    expect(changed).toHaveBeenCalledTimes(calls);
    controller.clear();
    expect(feature.get("grabHover")).toBe(false);
    expect(removed).toEqual(["10:10"]);
    expect(targetStates).toContain(false);
    controller.dispose();
    expect(targetStates.at(-1)).toBe(false);
  });
});
