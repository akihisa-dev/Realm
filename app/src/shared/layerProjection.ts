import type { MapShape, RealmLayers } from "./realmContract";

/**
 * Builds the renderer-only polygon projection from the canonical three-layer
 * records. The result is never part of RealmSnapshot and is not persisted.
 */
export const mapShapesFromLayers = (layers: Pick<RealmLayers, "terrain" | "regions">): MapShape[] => [
  ...layers.terrain.map((shape) => ({
    id: shape.id,
    layer: "terrain" as const,
    value: "terrain",
    geometryVersion: 1,
    snapGridVersion: 2,
    geometry: shape.geometry,
  })),
  ...layers.regions.flatMap((region) => region.shapes.map((shape) => ({
    id: shape.id,
    layer: "region" as const,
    regionId: region.id,
    value: region.color,
    geometryVersion: 1,
    snapGridVersion: 2,
    geometry: shape.geometry,
  }))),
];
