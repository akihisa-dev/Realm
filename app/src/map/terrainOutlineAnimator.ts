import { terrainOutlineSegments, type TerrainOutlineSegment } from "./terrainOutline";
import { terrainOutlineTransitionSegments } from "./terrainOutlineTransition";

const TRANSITION_DURATION_MS = 240;
export type TerrainOutlineRenderPhase = "transition" | "complete";

/** Keeps terrain-boundary motion transient and independent from persisted cell state. */
export class TerrainOutlineAnimator {
  private cellIds = new Set<string>();
  private initialized = false;
  private animationFrame: number | null = null;

  constructor(
    private readonly view: Window | null,
    private readonly render: (segments: TerrainOutlineSegment[], phase: TerrainOutlineRenderPhase) => void,
  ) {}

  update(nextCellIds: Set<string>): void {
    const previousCellIds = this.cellIds;
    this.cellIds = nextCellIds;
    this.cancel();
    const finalOutline = terrainOutlineSegments(nextCellIds);
    const changed = previousCellIds.size !== nextCellIds.size
      || [...previousCellIds].some((id) => !nextCellIds.has(id));
    const reducedMotion = this.view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (!this.initialized || !changed || reducedMotion || !this.view?.requestAnimationFrame) {
      this.initialized = true;
      this.render(finalOutline, "complete");
      return;
    }

    this.render(terrainOutlineTransitionSegments(previousCellIds, nextCellIds, 0), "transition");
    const startedAt = this.view.performance.now();
    const animate = (timestamp: number): void => {
      const linearProgress = Math.min(1, Math.max(0, timestamp - startedAt) / TRANSITION_DURATION_MS);
      const easedProgress = 1 - ((1 - linearProgress) ** 3);
      const phase: TerrainOutlineRenderPhase = linearProgress < 1 ? "transition" : "complete";
      this.render(terrainOutlineTransitionSegments(previousCellIds, nextCellIds, easedProgress), phase);
      if (linearProgress < 1) this.animationFrame = this.view!.requestAnimationFrame(animate);
      else this.animationFrame = null;
    };
    this.animationFrame = this.view.requestAnimationFrame(animate);
  }

  dispose(): void {
    this.cancel();
    this.cellIds.clear();
  }

  private cancel(): void {
    if (this.animationFrame === null) return;
    this.view?.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }
}
