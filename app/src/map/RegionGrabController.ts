import Feature from "ol/Feature";
import PointerInteraction from "ol/interaction/Pointer";
import type { ApplyCellAttributesInput, CellAttributeSnapshot, MoveRegionCellsInput, Position } from "../backend";
import { clipRegionCellsToAvailableTargets, clipRegionCellsToTerrain, connectedRegionCells, isRegionBoundaryCell, regionResizeStroke, sameCellSet, sameRegionCells, translateRegionCells } from "./regionGrab";

type Options = {
  cellAt: (position: Position) => string | null;
  attributes: () => ReadonlyMap<string, readonly CellAttributeSnapshot[]>;
  getFeature: (id: string) => Feature | undefined;
  ensureFeatures: (ids: Iterable<string>) => void;
  removeUnused: (id: string) => void;
  changed: () => void;
  setRegionSmoothVisible: (visible: boolean, regionIdentity?: string | null) => void;
  emit: (input: MoveRegionCellsInput) => void;
  /** Persists a cell-attribute update; it does not create a separate region entity. */
  emitResize: (input: ApplyCellAttributesInput) => void;
};

/** Owns the transient exact-hex preview used while moving one region mass. */
export class RegionGrabController {
  readonly interaction: PointerInteraction;
  private sourceIds: string[] = [];
  private targetIds: string[] = [];
  private sourceAnchor: string | null = null;
  private previewIds = new Set<string>();
  private previewValid = false;
  private resizeMode: "expand" | "shrink" | null = null;
  private resizeColor: string | null = null;
  private resizeRegionId: string | null = null;
  private resizeLastPosition: Position | null = null;
  private resizeAddedIds = new Set<string>();
  private resizeRemovedIds = new Set<string>();
  private resizeComponentIds: string[] = [];

  constructor(private readonly options: Options) {
    this.interaction = new PointerInteraction({
      handleDownEvent: (event) => {
        const pointer = event.originalEvent as PointerEvent;
        if (!pointer.isPrimary || pointer.button !== 0) return false;
        const position = event.coordinate as Position;
        const anchor = options.cellAt(position); if (!anchor) return false;
        const attributes = options.attributes();
        const source = sameRegionCells(anchor, attributes); if (source.length === 0) return false;
        const localComponent = connectedRegionCells(anchor, attributes);
        const region = attributes.get(anchor)?.find((item) => item.attribute === "region");
        this.sourceIds = source; this.sourceAnchor = anchor;
        if (region && isRegionBoundaryCell(anchor, localComponent)) {
          this.resizeMode = null;
          this.resizeColor = region.value;
          this.resizeRegionId = region.regionId ?? null;
          this.resizeLastPosition = position;
          this.resizeComponentIds = localComponent;
          this.updateResizePreview();
          return true;
        }
        this.sourceAnchor = anchor; this.update(source, false); return true;
      },
      handleDragEvent: (event) => {
        if (this.resizeColor !== null) {
          this.resizeTo(event.coordinate as Position);
          return;
        }
        if (!this.sourceAnchor) return;
        const target = options.cellAt(event.coordinate as Position);
        this.update(target ? translateRegionCells(this.sourceIds, this.sourceAnchor, target) : null);
      },
      handleUpEvent: (event) => {
        if (this.resizeColor !== null) {
          this.resizeTo(event.coordinate as Position);
          const cellIds = this.resizeMode === "shrink" ? [...this.resizeRemovedIds] : [...this.resizeAddedIds];
          const value = this.resizeMode === "shrink" ? null : this.resizeColor;
          const regionId = this.resizeRegionId;
          const valid = this.previewValid && cellIds.length > 0;
          this.cancel();
          if (valid) options.emitResize({ cellIds, attribute: "region", value, ...(value !== null && regionId ? { regionId } : {}) });
          return false;
        }
        if (!this.sourceAnchor) return false;
        const target = options.cellAt(event.coordinate as Position);
        this.update(target ? translateRegionCells(this.sourceIds, this.sourceAnchor, target) : null);
        const sourceCellIds = this.sourceIds; const targetCellIds = this.targetIds;
        const valid = sourceCellIds.length > 0 && targetCellIds.length === sourceCellIds.length && !sameCellSet(sourceCellIds, targetCellIds) && this.previewValid;
        this.cancel(); if (valid) options.emit({ sourceCellIds, targetCellIds }); return false;
      },
    });
  }

  cancel(): void {
    this.clearPreview();
    this.sourceIds = []; this.targetIds = []; this.sourceAnchor = null; this.previewValid = false;
    this.resizeMode = null; this.resizeColor = null; this.resizeRegionId = null; this.resizeLastPosition = null;
    this.resizeAddedIds.clear(); this.resizeRemovedIds.clear(); this.resizeComponentIds = [];
    this.interaction.setActive(false); this.interaction.setActive(true);
  }
  dispose(): void { this.cancel(); this.interaction.dispose(); }

  private resizeTo(position: Position): void {
    const lastPosition = this.resizeLastPosition;
    this.resizeLastPosition = position;
    const target = this.options.cellAt(position);
    if (!this.resizeMode && target) this.resizeMode = new Set(this.sourceIds).has(target) ? "shrink" : "expand";
    if (!this.resizeMode || !this.resizeColor) return;
    const stroke = regionResizeStroke(lastPosition ? [lastPosition, position] : [position]);
    const attributes = this.options.attributes();
    const sourceSet = new Set(this.resizeComponentIds);
    if (this.resizeMode === "expand") {
      for (const id of stroke) {
        if (sourceSet.has(id) || this.resizeAddedIds.has(id)) continue;
        const current = attributes.get(id)?.find((item) => item.attribute === "region");
        if (current) continue;
        this.resizeAddedIds.add(id);
      }
    } else {
      for (const id of stroke) {
        if (id === this.sourceAnchor || !sourceSet.has(id)) continue;
        this.resizeRemovedIds.add(id);
      }
    }
    this.updateResizePreview();
  }

  private updateResizePreview(): void {
    this.clearPreview(false);
    const attributes = this.options.attributes();
    const sourceRegion = attributes.get(this.sourceIds[0] ?? "")?.find((item) => item.attribute === "region");
    const sourceIdentity = sourceRegion ? sourceRegion.regionId ?? sourceRegion.value : null;
    this.options.setRegionSmoothVisible(false, sourceIdentity);
    this.previewValid = this.resizeColor !== null;
    for (const id of this.sourceIds) {
      const feature = this.options.getFeature(id);
      if (this.resizeRemovedIds.has(id)) feature?.set("grabSourceHidden", true, true);
      else feature?.set("grabPreview", true, true);
      this.previewIds.add(id);
    }
    const visibleAddedIds = [...this.resizeAddedIds].filter((id) => attributes.get(id)?.some((item) => item.attribute === "terrain") === true);
    this.options.ensureFeatures(visibleAddedIds);
    for (const id of visibleAddedIds) {
      const existing = attributes.get(id) ?? [];
      const feature = this.options.getFeature(id);
      feature?.set("attributes", [...existing.filter((item) => item.attribute !== "region"), { cellId: id, attribute: "region", value: this.resizeColor!, ...(this.resizeRegionId ? { regionId: this.resizeRegionId } : {}) }], true);
      feature?.set("grabPreview", true, true);
      this.previewIds.add(id);
    }
    this.options.changed();
  }

  private update(targetIds: readonly string[] | null, clipToTerrain = true): void {
    this.clearPreview(false);
    const attributes = this.options.attributes();
    const sourceRegion = attributes.get(this.sourceIds[0] ?? "")?.find((item) => item.attribute === "region");
    const sourceIdentity = sourceRegion ? sourceRegion.regionId ?? sourceRegion.value : null;
    this.options.setRegionSmoothVisible(false, sourceIdentity);
    if (targetIds === null || targetIds.length !== this.sourceIds.length || new Set(targetIds).size !== targetIds.length) { this.targetIds = []; this.previewValid = false; return; }
    const availableTargetIds = sourceIdentity === null ? [...targetIds] : clipRegionCellsToAvailableTargets(targetIds, this.sourceIds, sourceIdentity, attributes);
    const previewTargetIds = clipToTerrain ? clipRegionCellsToTerrain(availableTargetIds, attributes) : availableTargetIds;
    this.previewValid = true;
    this.targetIds = [...targetIds]; const region = attributes.get(this.sourceIds[0] ?? "")?.find((item) => item.attribute === "region");
    for (const id of this.sourceIds) { this.options.getFeature(id)?.set("grabSourceHidden", true, true); this.previewIds.add(id); }
    this.options.ensureFeatures(previewTargetIds);
    for (const id of previewTargetIds) {
      const existing = attributes.get(id) ?? [];
      const feature = this.options.getFeature(id); feature?.set("attributes", region ? [...existing.filter((item) => item.attribute !== "region"), region] : existing, true); feature?.set("grabPreview", true, true); this.previewIds.add(id);
    }
    this.options.changed();
  }

  private clearPreview(restoreSmooth = true): void {
    const attributes = this.options.attributes();
    for (const id of this.previewIds) {
      const feature = this.options.getFeature(id); if (!feature) continue;
      const values = attributes.get(id) ?? [];
      const visibleValues = values.some((item) => item.attribute === "terrain") ? values : values.filter((item) => item.attribute !== "region");
      feature.unset("grabPreview", true); feature.unset("grabSourceHidden", true); feature.set("attributes", visibleValues, true); feature.changed(); this.options.removeUnused(id);
    }
    this.previewIds.clear(); this.options.changed();
    if (restoreSmooth) this.options.setRegionSmoothVisible(true);
  }
}
