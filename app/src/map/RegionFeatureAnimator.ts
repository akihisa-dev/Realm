import Feature from "ol/Feature";

const TRANSITION_DURATION_MS = 240;

/** Owns renderer-only region appearance without changing persisted properties. */
export class RegionFeatureAnimator {
  private readonly animationFrames = new Set<number>();
  private initialized = false;
  private disposed = false;

  constructor(private readonly view: Window | null) {}

  animateAdditions(features: readonly Feature[]): void {
    if (!this.initialized) {
      this.initialized = true;
      return;
    }
    const reduced = this.view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced || !this.view?.requestAnimationFrame) return;
    for (const feature of features) {
      if (feature.get("featureType") !== "region") continue;
      feature.set("regionAnimationOpacity", 0, true);
      const started = this.view.performance?.now() ?? Date.now();
      let frameId = 0;
      const tick = (time: number): void => {
        if (this.disposed) return;
        this.animationFrames.delete(frameId);
        const progress = Math.min(1, (time - started) / TRANSITION_DURATION_MS);
        feature.set("regionAnimationOpacity", progress, true);
        feature.changed();
        if (progress < 1) {
          frameId = this.view!.requestAnimationFrame(tick);
          this.animationFrames.add(frameId);
        } else feature.unset("regionAnimationOpacity", true);
      };
      frameId = this.view.requestAnimationFrame(tick);
      this.animationFrames.add(frameId);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.view?.cancelAnimationFrame) {
      for (const frame of this.animationFrames) this.view.cancelAnimationFrame(frame);
    }
    this.animationFrames.clear();
  }
}
