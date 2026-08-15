import PointerInteraction from "ol/interaction/Pointer";
import type { MapShape, Position } from "../shared/realmContract";
import { hitTestMapShapes, intersectionMapShapeGeometries, normalizeMapShapes, unionMapShapeGeometries } from "../shared/mapShapeGeometry";

type Options = {
  shapes: () => readonly MapShape[];
  hitTolerance: () => number;
  emit: (shapes: MapShape[]) => void;
};

/** Clips the complete logical region to the union of terrain polygons. */
export class RegionShapeController {
  readonly interaction: PointerInteraction;
  private pressedShapeId: string | null = null;

  constructor(options: Options) {
    this.interaction = new PointerInteraction({
      handleDownEvent: (event) => {
        const pointer = event.originalEvent as PointerEvent;
        if (!pointer.isPrimary || pointer.button !== 0) return false;
        const position = [...(event.coordinate as Position)] as Position;
        const regionShapes = options.shapes().filter((candidate) => candidate.layer === "region");
        const hit = hitTestMapShapes(regionShapes, position, options.hitTolerance());
        const shape = hit ? regionShapes.find((candidate) => candidate.id === hit.shapeId) : undefined;
        if (!shape || shape.layer !== "region") return false;
        this.pressedShapeId = shape.id;
        return true;
      },
      handleUpEvent: (event) => {
        const pressedShapeId = this.pressedShapeId;
        this.pressedShapeId = null;
        if (!pressedShapeId) return false;
        const position = [...(event.coordinate as Position)] as Position;
        const hit = hitTestMapShapes(options.shapes().filter((shape) => shape.layer === "region"), position, options.hitTolerance());
        if (!hit || hit.shapeId !== pressedShapeId) return false;
        const shapes = options.shapes().map((shape) => ({
          ...shape,
          geometry: { type: "Polygon" as const, coordinates: shape.geometry.coordinates.map((ring) => ring.map(([x, y]) => [x, y] as Position)) },
        }));
        const pressed = shapes.find((shape) => shape.id === pressedShapeId);
        if (!pressed?.regionId) return false;
        const terrain = unionMapShapeGeometries(shapes.filter((shape) => shape.layer === "terrain").map((shape) => shape.geometry));
        const next: MapShape[] = [];
        for (const shape of shapes) {
          if (shape.layer !== "region" || shape.regionId !== pressed.regionId) {
            next.push(shape);
            continue;
          }
          const clipped = unionMapShapeGeometries(terrain.flatMap((terrainGeometry) => intersectionMapShapeGeometries(shape.geometry, terrainGeometry)));
          clipped.forEach((geometry, index) => next.push({ ...shape, id: index === 0 ? shape.id : crypto.randomUUID(), geometry }));
        }
        const normalized = normalizeMapShapes(next);
        if (JSON.stringify(normalized) !== JSON.stringify(shapes)) options.emit(normalized);
        return false;
      },
    });
  }

  cancel(): void {
    this.pressedShapeId = null;
    this.interaction.setActive(false);
    this.interaction.setActive(true);
  }

  dispose(): void {
    this.cancel();
    this.interaction.dispose();
  }
}
