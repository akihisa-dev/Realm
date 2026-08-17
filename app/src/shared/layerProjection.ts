import type { LayerTree, MapShape, RealmLayers } from "./realmContract";
import { flattenLayerTree } from "./layerTree";

/**
 * Builds the renderer-only polygon projection from the canonical three-layer
 * records. The result is never part of RealmSnapshot and is not persisted.
 */
export const mapShapesFromLayers = (layers: Pick<RealmLayers, "terrain" | "regions">, tree?: LayerTree): MapShape[] => {
  const order = tree ? new Map(flattenLayerTree(tree).filter((node) => node.kind === "leaf").map((node) => [node.id, node])) : undefined;
  const shapes: MapShape[] = [
    ...layers.terrain.map((shape) => ({ id: shape.id, layer: "terrain" as const, ...(shape.layerId ? { layerId: shape.layerId } : {}), value: "terrain", geometryVersion: 1, snapGridVersion: 2, geometry: shape.geometry })),
    ...layers.regions.flatMap((region) => region.shapes.map((shape) => ({ id: shape.id, layer: "region" as const, ...((shape.layerId ?? region.layerId) ? { layerId: shape.layerId ?? region.layerId } : {}), regionId: region.id, value: region.color, geometryVersion: 1, snapGridVersion: 2, geometry: shape.geometry }))),
  ];
  return shapes.sort((left, right) => (order ? (order.get(left.layerId ?? "")?.renderOrder ?? Number.MAX_SAFE_INTEGER) - (order.get(right.layerId ?? "")?.renderOrder ?? Number.MAX_SAFE_INTEGER) : (left.layerId ?? "").localeCompare(right.layerId ?? "")) || left.layer.localeCompare(right.layer) || left.id.localeCompare(right.id));
};
