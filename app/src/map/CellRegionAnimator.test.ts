import Feature from "ol/Feature";
import { describe, expect, it, vi } from "vitest";
import { CellRegionAnimator } from "./CellRegionAnimator";

describe("CellRegionAnimator", () => {
  it("fades changed features, replaces pending frames, and cleans up on completion", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrame++;
      callbacks.set(id, callback);
      return id;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { callbacks.delete(id); });
    const now = vi.spyOn(window.performance, "now").mockReturnValue(1_000);
    const feature = new Feature();
    const animator = new CellRegionAnimator(window);

    animator.animateChanges([feature]);
    expect(request).not.toHaveBeenCalled();
    animator.animateChanges([feature]);
    expect(feature.get("regionAnimationOpacity")).toBe(0);
    const firstId = [...callbacks.keys()][0]!;
    callbacks.get(firstId)?.(1_060);
    expect(feature.get("regionAnimationOpacity")).toBeCloseTo(0.25);
    const secondId = [...callbacks.keys()][0]!;
    callbacks.get(secondId)?.(1_300);
    expect(feature.get("regionAnimationOpacity")).toBeUndefined();

    animator.animateChanges([feature]);
    const pendingId = [...callbacks.keys()].at(-1)!;
    animator.animateChanges([feature]);
    expect(cancel).toHaveBeenCalledWith(pendingId);
    animator.dispose();
    animator.dispose();
    expect(cancel).toHaveBeenCalled();
    request.mockRestore();
    cancel.mockRestore();
    now.mockRestore();
  });

  it("skips animation for reduced motion, unavailable views, and disposed instances", () => {
    const request = vi.spyOn(window, "requestAnimationFrame");
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
    const reducedFeature = new Feature({ regionAnimationOpacity: 0.4 });
    const reduced = new CellRegionAnimator(window);
    reduced.animateChanges([reducedFeature]);
    reduced.animateChanges([reducedFeature]);
    expect(reducedFeature.get("regionAnimationOpacity")).toBeUndefined();
    expect(request).not.toHaveBeenCalled();

    const noViewFeature = new Feature({ regionAnimationOpacity: 0.4 });
    const noView = new CellRegionAnimator(null);
    noView.animateChanges([noViewFeature]);
    noView.animateChanges([noViewFeature]);
    expect(noViewFeature.get("regionAnimationOpacity")).toBeUndefined();
    noView.dispose();
    noView.animateChanges([noViewFeature]);
    expect(noViewFeature.get("regionAnimationOpacity")).toBeUndefined();
    request.mockRestore();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });
});
