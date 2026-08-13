import Feature from "ol/Feature";
import PointerInteraction from "ol/interaction/Pointer";
import type { CellAttributeSnapshot, MoveRegionCellsInput, Position } from "../backend";
import { connectedRegionCells, sameCellSet, translateRegionCells } from "./regionGrab";

type Options = {
  cellAt: (position: Position) => string | null;
  attributes: () => ReadonlyMap<string, readonly CellAttributeSnapshot[]>;
  getFeature: (id: string) => Feature | undefined;
  ensureFeatures: (ids: Iterable<string>) => void;
  removeUnused: (id: string) => void;
  changed: () => void;
  emit: (input: MoveRegionCellsInput) => void;
};

/** Owns the transient exact-hex preview used while moving one region mass. */
export class RegionGrabController {
  readonly interaction: PointerInteraction;
  private sourceIds: string[] = [];
  private targetIds: string[] = [];
  private sourceAnchor: string | null = null;
  private previewIds = new Set<string>();
  private previewValid = false;

  constructor(private readonly options: Options) {
    this.interaction = new PointerInteraction({
      handleDownEvent: (event) => {
        const pointer = event.originalEvent as PointerEvent;
        if (!pointer.isPrimary || pointer.button !== 0) return false;
        const anchor = options.cellAt(event.coordinate as Position); if (!anchor) return false;
        const source = connectedRegionCells(anchor, options.attributes()); if (source.length === 0) return false;
        this.sourceAnchor = anchor; this.sourceIds = source; this.update(source); return true;
      },
      handleDragEvent: (event) => {
        if (!this.sourceAnchor) return;
        const target = options.cellAt(event.coordinate as Position);
        this.update(target ? translateRegionCells(this.sourceIds, this.sourceAnchor, target) : null);
      },
      handleUpEvent: (event) => {
        if (!this.sourceAnchor) return false;
        const target = options.cellAt(event.coordinate as Position);
        this.update(target ? translateRegionCells(this.sourceIds, this.sourceAnchor, target) : null);
        const sourceCellIds = this.sourceIds; const targetCellIds = this.targetIds;
        const valid = sourceCellIds.length > 0 && targetCellIds.length === sourceCellIds.length && !sameCellSet(sourceCellIds, targetCellIds) && this.previewValid;
        this.cancel(); if (valid) options.emit({ sourceCellIds, targetCellIds }); return false;
      },
    });
  }

  cancel(): void { this.clearPreview(); this.sourceIds = []; this.targetIds = []; this.sourceAnchor = null; this.previewValid = false; this.interaction.setActive(false); this.interaction.setActive(true); }
  dispose(): void { this.cancel(); this.interaction.dispose(); }

  private update(targetIds: readonly string[] | null): void {
    this.clearPreview();
    if (targetIds === null || targetIds.length !== this.sourceIds.length || new Set(targetIds).size !== targetIds.length) { this.targetIds = []; this.previewValid = false; return; }
    const attributes = this.options.attributes(); const sourceSet = new Set(this.sourceIds);
    this.previewValid = !targetIds.some((id) => !sourceSet.has(id) && attributes.get(id)?.some((item) => item.attribute === "region"));
    this.targetIds = [...targetIds]; const sourceRegions = this.sourceIds.map((id) => attributes.get(id)?.find((item) => item.attribute === "region"));
    for (const id of this.sourceIds) { this.options.getFeature(id)?.set("grabSourceHidden", true, true); this.previewIds.add(id); }
    this.options.ensureFeatures(targetIds);
    for (let index = 0; index < targetIds.length; index += 1) {
      const id = targetIds[index]!; const existing = attributes.get(id) ?? []; const region = sourceRegions[index];
      const feature = this.options.getFeature(id); feature?.set("attributes", region ? [...existing.filter((item) => item.attribute !== "region"), region] : existing, true); feature?.set("grabPreview", true, true); this.previewIds.add(id);
    }
    this.options.changed();
  }

  private clearPreview(): void {
    if (this.previewIds.size === 0) return;
    const attributes = this.options.attributes();
    for (const id of this.previewIds) { const feature = this.options.getFeature(id); if (!feature) continue; feature.unset("grabPreview", true); feature.unset("grabSourceHidden", true); feature.set("attributes", attributes.get(id) ?? [], true); feature.changed(); this.options.removeUnused(id); }
    this.previewIds.clear(); this.options.changed();
  }
}
