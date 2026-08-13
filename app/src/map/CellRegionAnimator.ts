import Feature from "ol/Feature";

const TRANSITION_DURATION_MS = 240;

/**
 * Renderer-only fade for region cell changes. Persisted cell attributes remain
 * the source of truth; this class only controls a transient feature opacity.
 */
export class CellRegionAnimator {
  private readonly animationFrames = new Map<Feature, number>();
  private initialized = false;
  private disposed = false;

  constructor(private readonly view: Window | null) {}

  animateChanges(features: readonly Feature[]): void {
    if (this.disposed) return;
    if (!this.initialized) {
      this.initialized = true;
      return;
    }
    const reduced = this.view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced || !this.view?.requestAnimationFrame) {
      for (const feature of features) {
        feature.unset("regionAnimationOpacity", true);
        feature.changed();
      }
      return;
    }
    for (const feature of features) {
      const previousFrame = this.animationFrames.get(feature);
      if (previousFrame !== undefined) this.view.cancelAnimationFrame(previousFrame);
      feature.set("regionAnimationOpacity", 0, true);
      feature.changed();
      const started = this.view.performance?.now() ?? Date.now();
      let frameId = 0;
      const tick = (time: number): void => {
        if (this.disposed) return;
        if (this.animationFrames.get(feature) !== frameId) return;
        const progress = Math.min(1, Math.max(0, (time - started) / TRANSITION_DURATION_MS));
        feature.set("regionAnimationOpacity", progress, true);
        feature.changed();
        if (progress < 1) {
          frameId = this.view!.requestAnimationFrame(tick);
          this.animationFrames.set(feature, frameId);
        } else {
          this.animationFrames.delete(feature);
          feature.unset("regionAnimationOpacity", true);
          feature.changed();
        }
      };
      frameId = this.view.requestAnimationFrame(tick);
      this.animationFrames.set(feature, frameId);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.view?.cancelAnimationFrame) {
      for (const frameId of this.animationFrames.values()) this.view.cancelAnimationFrame(frameId);
    }
    this.animationFrames.clear();
  }
}
