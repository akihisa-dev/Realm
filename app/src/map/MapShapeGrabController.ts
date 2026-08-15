import PointerInteraction from "ol/interaction/Pointer";
import type { MapShape, Position } from "../shared/realmContract";
import { normalizeSoftResizeMapShapeGeometry } from "../shared/mapShapeResizeInfluence";
import {
  hitTestMapShapes,
  normalizeMapShapes,
  resizeMapShapeGeometry,
  translateMapShapeGeometry,
  type MapShapeHitTarget,
} from "../shared/mapShapeGeometry";

type EditKind = "move" | "resize";

type Options = {
  shapes: () => readonly MapShape[];
  hitTolerance: () => number;
  setPreview: (shapes: readonly MapShape[] | null) => void;
  emit: (shapes: MapShape[]) => void;
  onInvalid?: () => void;
};

const cloneShapes = (shapes: readonly MapShape[]): MapShape[] => shapes.map((shape) => ({
  ...shape,
  geometry: {
    type: "Polygon",
    coordinates: shape.geometry.coordinates.map((ring) => ring.map(([x, y]) => [x, y] as Position)),
  },
}));

const translate = (shapes: readonly MapShape[], ids: ReadonlySet<string>, offset: Position): MapShape[] => shapes.map((shape) => ids.has(shape.id)
  ? { ...shape, geometry: translateMapShapeGeometry(shape.geometry, offset) }
  : cloneShapes([shape])[0]!);

const equalShapes = (left: readonly MapShape[], right: readonly MapShape[]): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Edits canonical map shapes as a continuous renderer-only preview. The only
 * outward mutation is the single normalized commit emitted on pointerup.
 */
export class MapShapeGrabController {
  readonly interaction: PointerInteraction;
  private baseShapes: MapShape[] = [];
  private previewShapes: MapShape[] | null = null;
  private startPosition: Position | null = null;
  private target: MapShapeHitTarget | null = null;
  private targetIds = new Set<string>();
  private editKind: EditKind | null = null;

  constructor(private readonly options: Options) {
    this.interaction = new PointerInteraction({
      handleDownEvent: (event) => {
        const pointer = event.originalEvent as PointerEvent;
        if (!pointer.isPrimary || pointer.button !== 0) return false;
        const position = [...(event.coordinate as Position)] as Position;
        const shapes = cloneShapes(options.shapes());
        const hit = hitTestMapShapes(shapes, position, options.hitTolerance());
        if (!hit) return false;
        const selected = shapes.find((shape) => shape.id === hit.shapeId);
        if (!selected) return false;
        this.baseShapes = shapes;
        this.startPosition = position;
        this.target = hit;
        this.editKind = hit.kind === "inside" ? "move" : "resize";
        this.targetIds = new Set(
          selected.layer === "region" && selected.regionId
            ? shapes.filter((shape) => shape.layer === "region" && shape.regionId === selected.regionId).map((shape) => shape.id)
            : [selected.id],
        );
        this.update(position);
        return true;
      },
      handleDragEvent: (event) => {
        if (!this.startPosition || !this.target || !this.editKind) return;
        this.update([...(event.coordinate as Position)] as Position);
      },
      handleUpEvent: (event) => {
        if (!this.startPosition || !this.target || !this.editKind) return false;
        this.update([...(event.coordinate as Position)] as Position);
        const preview = this.previewShapes;
        const original = this.baseShapes;
        const editKind = this.editKind;
        const target = this.target;
        this.reset();
        if (!preview || equalShapes(preview, original)) return false;
        try {
          const normalizedPreview = editKind === "resize" && target
            ? preview.map((shape) => {
              if (shape.id !== target.shapeId) return shape;
              const originalShape = original.find((candidate) => candidate.id === shape.id);
              const geometry = originalShape ? normalizeSoftResizeMapShapeGeometry(originalShape.geometry, shape.geometry)[0] : undefined;
              return geometry ? { ...shape, geometry } : shape;
            })
            : preview;
          const normalized = normalizeMapShapes(normalizedPreview);
          if (!equalShapes(normalized, original)) this.options.emit(normalized);
        } catch {
          this.options.onInvalid?.();
        }
        return false;
      },
    });
  }

  cancel(): void {
    this.reset();
    this.interaction.setActive(false);
    this.interaction.setActive(true);
  }

  dispose(): void {
    this.reset();
    this.interaction.dispose();
  }

  private update(position: Position): void {
    const start = this.startPosition;
    const target = this.target;
    if (!start || !target || !this.editKind) return;
    const next = this.editKind === "move"
      ? translate(this.baseShapes, this.targetIds, [position[0] - start[0], position[1] - start[1]])
      : this.baseShapes.map((shape) => shape.id === target.shapeId
        ? { ...shape, geometry: resizeMapShapeGeometry(shape.geometry, target, start, position) }
        : cloneShapes([shape])[0]!);
    this.previewShapes = next;
    this.options.setPreview(next);
  }

  private reset(): void {
    if (this.previewShapes !== null) this.options.setPreview(null);
    this.baseShapes = [];
    this.previewShapes = null;
    this.startPosition = null;
    this.target = null;
    this.targetIds.clear();
    this.editKind = null;
  }
}
