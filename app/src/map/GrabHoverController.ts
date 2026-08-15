import Feature from "ol/Feature";
import type { CellAttributeSnapshot, Position } from "../backend";
import { resizableCellIdsAt } from "./regionGrab";

type Options = {
  attributes: () => ReadonlyMap<string, readonly CellAttributeSnapshot[]>;
  getFeature: (id: string) => Feature | undefined;
  ensureFeatures: (ids: Iterable<string>) => void;
  removeUnused: (id: string) => void;
  changed: () => void;
  setTargetState: (active: boolean) => void;
};

/** Keeps the boundary affordance in sync without coupling hover state to React. */
export class GrabHoverController {
  private ids = new Set<string>();

  constructor(private readonly options: Options) {}

  refresh(enabled: boolean, position: Position | null, interiorCellId: string | null = null): void {
    const next = enabled && position
      ? new Set(resizableCellIdsAt(position, this.options.attributes(), undefined, { interiorCellId }))
      : new Set<string>();
    if (next.size === this.ids.size && [...next].every((id) => this.ids.has(id))) return;
    const previous = this.ids;
    this.ids = next;
    for (const id of previous) {
      if (next.has(id)) continue;
      this.options.getFeature(id)?.set("grabHover", false, true);
      this.options.removeUnused(id);
    }
    this.options.ensureFeatures(next);
    for (const id of next) this.options.getFeature(id)?.set("grabHover", true, true);
    this.options.setTargetState(next.size > 0);
    this.options.changed();
  }

  clear(): void { this.refresh(false, null); }
  dispose(): void { this.clear(); this.options.setTargetState(false); }
}
