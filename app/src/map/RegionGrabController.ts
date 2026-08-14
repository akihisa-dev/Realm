import Feature from "ol/Feature";
import PointerInteraction from "ol/interaction/Pointer";
import type { ApplyCellAttributesInput, CellAttributeSnapshot, MoveRegionCellsInput, Position } from "../backend";
import { clipRegionCellsToAvailableTargets, clipRegionCellsToTerrain, connectedRegionCells, connectedTerrainCells, isRegionBoundaryCell, regionResizeStroke, sameCellSet, sameRegionCells, translateRegionCells } from "./regionGrab";

type ResizableAttribute = "terrain" | "region";

type Options = {
  cellAt: (position: Position) => string | null;
  cellCandidatesAt?: (position: Position) => readonly string[];
  attributes: () => ReadonlyMap<string, readonly CellAttributeSnapshot[]>;
  getFeature: (id: string) => Feature | undefined;
  ensureFeatures: (ids: Iterable<string>) => void;
  removeUnused: (id: string) => void;
  changed: () => void;
  setRegionSmoothVisible: (visible: boolean, regionIdentity?: string | null) => void;
  setTerrainSmoothVisible?: (visible: boolean, hiddenCellIds?: readonly string[]) => void;
  emit: (input: MoveRegionCellsInput) => void;
  /** Persists a boundary update without creating a separate map entity. */
  emitResize: (input: ApplyCellAttributesInput) => void;
};

/** Owns the transient exact-hex preview used while moving or resizing a cell mass. */
export class RegionGrabController {
  readonly interaction: PointerInteraction;
  private sourceIds: string[] = [];
  private targetIds: string[] = [];
  private sourceAnchor: string | null = null;
  private previewIds = new Set<string>();
  private previewValid = false;
  private resizeMode: "expand" | "shrink" | null = null;
  private resizeAttribute: ResizableAttribute | null = null;
  private resizeValue: string | null = null;
  private resizeRegionId: string | null = null;
  private resizeStartPosition: Position | null = null;
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
        const region = attributes.get(anchor)?.find((item) => item.attribute === "region");
        const regionSource = region ? sameRegionCells(anchor, attributes) : [];
        const regionComponent = regionSource.length > 0 ? connectedRegionCells(anchor, attributes) : [];
        if (region && isRegionBoundaryCell(anchor, regionComponent)) {
          this.beginResize("region", region.value, region.regionId ?? null, regionSource, regionComponent, anchor, position);
          return true;
        }
        const terrain = attributes.get(anchor)?.find((item) => item.attribute === "terrain");
        const terrainComponent = terrain ? connectedTerrainCells(anchor, attributes) : [];
        if (terrain && isRegionBoundaryCell(anchor, terrainComponent)) {
          this.beginResize("terrain", terrain.value, null, terrainComponent, terrainComponent, anchor, position);
          return true;
        }
        if (!region && !terrain) {
          for (const candidate of new Set(options.cellCandidatesAt?.(position) ?? [])) {
            const candidateRegion = attributes.get(candidate)?.find((item) => item.attribute === "region");
            const candidateRegionSource = candidateRegion ? sameRegionCells(candidate, attributes) : [];
            const candidateRegionComponent = candidateRegionSource.length > 0 ? connectedRegionCells(candidate, attributes) : [];
            if (candidateRegion && isRegionBoundaryCell(candidate, candidateRegionComponent)) {
              this.beginResize("region", candidateRegion.value, candidateRegion.regionId ?? null, candidateRegionSource, candidateRegionComponent, candidate, position);
              return true;
            }
            const candidateTerrain = attributes.get(candidate)?.find((item) => item.attribute === "terrain");
            const candidateTerrainComponent = candidateTerrain ? connectedTerrainCells(candidate, attributes) : [];
            if (candidateTerrain && isRegionBoundaryCell(candidate, candidateTerrainComponent)) {
              this.beginResize("terrain", candidateTerrain.value, null, candidateTerrainComponent, candidateTerrainComponent, candidate, position);
              return true;
            }
          }
        }
        if (regionSource.length === 0) return false;
        this.sourceIds = regionSource; this.sourceAnchor = anchor; this.update(regionSource, false); return true;
      },
      handleDragEvent: (event) => {
        if (this.resizeAttribute !== null) {
          this.resizeTo(event.coordinate as Position);
          return;
        }
        if (!this.sourceAnchor) return;
        const target = options.cellAt(event.coordinate as Position);
        this.update(target ? translateRegionCells(this.sourceIds, this.sourceAnchor, target) : null);
      },
      handleUpEvent: (event) => {
        if (this.resizeAttribute !== null) {
          this.resizeTo(event.coordinate as Position);
          const cellIds = this.resizeMode === "shrink" ? [...this.resizeRemovedIds] : [...this.resizeAddedIds];
          const attribute = this.resizeAttribute;
          const value = this.resizeMode === "shrink" ? null : this.resizeValue;
          const regionId = this.resizeRegionId;
          const valid = this.previewValid && cellIds.length > 0 && this.resizeValue !== null;
          this.cancel();
          if (valid) options.emitResize({ cellIds, attribute, value, ...(value !== null && attribute === "region" && regionId ? { regionId } : {}) });
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
    this.resizeMode = null; this.resizeAttribute = null; this.resizeValue = null; this.resizeRegionId = null; this.resizeStartPosition = null;
    this.resizeAddedIds.clear(); this.resizeRemovedIds.clear(); this.resizeComponentIds = [];
    this.interaction.setActive(false); this.interaction.setActive(true);
  }
  dispose(): void { this.cancel(); this.interaction.dispose(); }

  private beginResize(
    attribute: ResizableAttribute,
    value: string,
    regionId: string | null,
    sourceIds: readonly string[],
    componentIds: readonly string[],
    anchor: string,
    position: Position,
  ): void {
    this.sourceIds = [...sourceIds];
    this.sourceAnchor = anchor;
    this.resizeAttribute = attribute;
    this.resizeValue = value;
    this.resizeRegionId = regionId;
    this.resizeStartPosition = position;
    this.resizeComponentIds = [...componentIds];
    this.resizeMode = null;
    this.updateResizePreview();
  }

  private resizeTo(position: Position): void {
    const target = this.options.cellAt(position);
    if (!this.resizeMode && target) this.resizeMode = new Set(this.sourceIds).has(target) ? "shrink" : "expand";
    if (!this.resizeMode || !this.resizeAttribute || this.resizeValue === null) return;
    const stroke = regionResizeStroke(this.resizeStartPosition ? [this.resizeStartPosition, position] : [position]);
    const attributes = this.options.attributes();
    const sourceSet = new Set(this.resizeComponentIds);
    this.resizeAddedIds.clear();
    this.resizeRemovedIds.clear();
    if (this.resizeMode === "expand") {
      for (const id of stroke) {
        if (sourceSet.has(id) || this.resizeAddedIds.has(id)) continue;
        const current = attributes.get(id)?.find((item) => item.attribute === this.resizeAttribute);
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
    const resizeAttribute = this.resizeAttribute;
    if (!resizeAttribute || this.resizeValue === null) return;
    const attributes = this.options.attributes();
    const sourceRegion = attributes.get(this.sourceIds[0] ?? "")?.find((item) => item.attribute === "region");
    const sourceIdentity = sourceRegion ? sourceRegion.regionId ?? sourceRegion.value : null;
    if (resizeAttribute === "region") this.options.setRegionSmoothVisible(false, sourceIdentity);
    else this.options.setTerrainSmoothVisible?.(false, this.resizeComponentIds);
    this.previewValid = true;
    for (const id of this.sourceIds) {
      const feature = this.options.getFeature(id);
      if (this.resizeRemovedIds.has(id)) feature?.set("grabSourceHidden", true, true);
      else feature?.set("grabPreview", true, true);
      this.previewIds.add(id);
    }
    const visibleAddedIds = [...this.resizeAddedIds].filter((id) => resizeAttribute === "terrain" || attributes.get(id)?.some((item) => item.attribute === "terrain") === true);
    this.options.ensureFeatures(visibleAddedIds);
    for (const id of visibleAddedIds) {
      const existing = attributes.get(id) ?? [];
      const feature = this.options.getFeature(id);
      feature?.set("attributes", [
        ...existing.filter((item) => item.attribute !== resizeAttribute),
        { cellId: id, attribute: resizeAttribute, value: this.resizeValue, ...(resizeAttribute === "region" && this.resizeRegionId ? { regionId: this.resizeRegionId } : {}) },
      ], true);
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
    if (restoreSmooth) {
      if (this.resizeAttribute === "terrain") this.options.setTerrainSmoothVisible?.(true);
      else this.options.setRegionSmoothVisible(true);
    }
  }
}
