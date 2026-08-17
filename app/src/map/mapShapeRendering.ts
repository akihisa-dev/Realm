import Feature from "ol/Feature";
import MultiLineString from "ol/geom/MultiLineString";
import MultiPoint from "ol/geom/MultiPoint";
import Polygon from "ol/geom/Polygon";
import VectorSource from "ol/source/Vector";
import type { CellAttributeSnapshot, MapShape, Position } from "../backend";
import { connectedCellComponents } from "./regionGrab";
import { mapShapeCellIds } from "../shared/mapShapeGeometry";
import { cellAttributeLayer } from "../shared/realmContract";
import { exactCellBoundaryPolygons, exactCellBoundaryRings, smoothCellBoundaryPolygons, splitTerrainGridSegments, terrainCellCenters } from "./terrainOutline";

export const cloneMapShapes = (shapes: readonly MapShape[]): MapShape[] => shapes.map((shape) => ({
  ...shape,
  geometry: {
    type: "Polygon",
    coordinates: shape.geometry.coordinates.map((ring) => ring.map(([x, y]) => [x, y] as Position)),
  },
}));

const coordinatesEqual = (left: readonly (readonly (readonly number[])[])[], right: readonly (readonly (readonly number[])[])[]): boolean =>
  left.length === right.length
  && left.every((ring, ringIndex) => {
    const other = right[ringIndex];
    return other !== undefined
      && ring.length === other.length
      && ring.every(([x, y], pointIndex) => x === other[pointIndex]?.[0] && y === other[pointIndex]?.[1]);
  });

const exactFeatureForShape = (shape: MapShape): Feature => {
  const feature = new Feature({
    geometry: new Polygon(shape.geometry.coordinates),
    ...(shape.layer === "region" ? { regionColor: shape.value, regionIdentity: shape.regionId } : {}),
  });
  feature.setId(shape.id);
  return feature;
};

const firstFeature = (value: Feature | Feature[] | null): Feature | undefined =>
  Array.isArray(value) ? value[0] : value ?? undefined;

/** Updates one exact canonical feature in place during a grab preview. */
export const updateCanonicalMapShapeFeature = (
  shape: MapShape,
  terrainSource: VectorSource,
  regionSource: VectorSource,
): boolean => {
  const source = shape.layer === "terrain" ? terrainSource : regionSource;
  const feature = firstFeature(source.getFeatureById(shape.id));
  const geometry = feature?.getGeometry();
  if (!(feature instanceof Feature) || !(geometry instanceof Polygon)) return false;
  let changed = false;
  if (!coordinatesEqual(geometry.getCoordinates(), shape.geometry.coordinates)) {
    feature.setGeometry(new Polygon(shape.geometry.coordinates));
    changed = true;
  }
  if (shape.layer === "region") {
    if (feature.get("regionColor") !== shape.value) {
      feature.set("regionColor", shape.value, true);
      changed = true;
    }
    if (feature.get("regionIdentity") !== shape.regionId) {
      feature.set("regionIdentity", shape.regionId, true);
      changed = true;
    }
  }
  return changed;
};

export const renderCanonicalMapShapes = (
  shapes: readonly MapShape[],
  terrainSource: VectorSource,
  regionSource: VectorSource,
  renderSmoothShapes = false,
  terrainPreviewSource?: VectorSource,
): { terrainCount: number; regionCount: number } => {
  terrainSource.clear();
  regionSource.clear();
  terrainPreviewSource?.clear();
  let terrainCount = 0;
  let regionCount = 0;
  for (const shape of shapes) {
    if (shape.layer === "terrain") {
      terrainCount += 1;
      if (!renderSmoothShapes) {
        terrainSource.addFeature(exactFeatureForShape(shape));
        continue;
      }
      let cellIds: Set<string>;
      try { cellIds = mapShapeCellIds(shape); } catch { cellIds = new Set(); }
      const polygons = cellIds.size > 0 ? smoothCellBoundaryPolygons(cellIds) : [];
      const rings = polygons.flat();
      terrainSource.addFeature(new Feature({ geometry: rings.length > 0 ? new MultiLineString(rings) : new Polygon(shape.geometry.coordinates) }));
      if (terrainPreviewSource) {
        if (polygons.length === 0) terrainPreviewSource.addFeature(new Feature({ geometry: new Polygon(shape.geometry.coordinates), terrainIdentity: shape.id }));
        else for (const polygon of polygons) terrainPreviewSource.addFeature(new Feature({ geometry: new Polygon(polygon), terrainIdentity: shape.id }));
      }
    } else {
      regionCount += 1;
      if (!renderSmoothShapes) {
        regionSource.addFeature(exactFeatureForShape(shape));
        continue;
      }
      let cellIds: Set<string>;
      try { cellIds = mapShapeCellIds(shape); } catch { cellIds = new Set(); }
      const polygons = cellIds.size > 0 ? smoothCellBoundaryPolygons(cellIds) : [];
      if (polygons.length === 0) {
        regionSource.addFeature(new Feature({ geometry: new Polygon(shape.geometry.coordinates), regionColor: shape.value, regionIdentity: shape.regionId }));
      } else {
        for (const polygon of polygons) regionSource.addFeature(new Feature({ geometry: new Polygon(polygon), regionColor: shape.value, regionIdentity: shape.regionId }));
      }
    }
  }
  return { terrainCount, regionCount };
};

type RenderTransientCellGeometryOptions = {
  attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>;
  fixedCellGridLines: readonly Position[][];
  cellGridSource: VectorSource;
  terrainCellGridSource: VectorSource;
  terrainSmoothSource: VectorSource;
  terrainPreviewSource?: VectorSource;
  regionSmoothSource: VectorSource;
  regionFallbackColor: string;
  renderSmoothShapes: boolean;
  renderShapes?: boolean;
};

/** Rebuilds renderer-only geometry derived from the transient cell read model. */
export const renderTransientCellGeometry = ({
  attributes,
  fixedCellGridLines,
  cellGridSource,
  terrainCellGridSource,
  terrainSmoothSource,
  terrainPreviewSource,
  regionSmoothSource,
  regionFallbackColor,
  renderSmoothShapes,
  renderShapes = true,
}: RenderTransientCellGeometryOptions): Set<string> => {
  const terrainCellIds = [...attributes.entries()]
    .filter(([, values]) => values.some((attribute) => cellAttributeLayer(attribute) === "terrain"))
    .map(([id]) => id);
  const grid = splitTerrainGridSegments(fixedCellGridLines, terrainCellIds);
  cellGridSource.clear();
  if (grid.outside.length > 0) cellGridSource.addFeature(new Feature({ geometry: new MultiLineString(grid.outside) }));
  terrainCellGridSource.clear();
  const centers = terrainCellCenters(terrainCellIds);
  if (centers.length > 0) terrainCellGridSource.addFeature(new Feature({ geometry: new MultiPoint(centers) }));
  if (renderShapes) {
    terrainSmoothSource.clear();
    terrainPreviewSource?.clear();
    const smoothTerrainPolygons = renderSmoothShapes ? smoothCellBoundaryPolygons(terrainCellIds) : [];
    const terrainRings = renderSmoothShapes ? smoothTerrainPolygons.flat() : exactCellBoundaryRings(terrainCellIds);
    if (terrainRings.length > 0) terrainSmoothSource.addFeature(new Feature({ geometry: new MultiLineString(terrainRings) }));
    if (terrainPreviewSource && renderSmoothShapes) {
      for (const polygon of smoothTerrainPolygons) terrainPreviewSource.addFeature(new Feature({ geometry: new Polygon(polygon), terrainIdentity: "transient-terrain" }));
    }
    regionSmoothSource.clear();
    const regionIdsByIdentity = new globalThis.Map<string, { color: string; ids: string[]; identity: string }>();
    for (const [id, values] of attributes) {
      const region = values.find((attribute) => cellAttributeLayer(attribute) === "region");
      if (!region) continue;
      const color = /^#[\da-f]{6}$/i.test(region.value) ? region.value.toUpperCase() : regionFallbackColor;
      const identity = region.regionId ?? region.value;
      const key = `${identity}\u0000${color}`;
      const entry = regionIdsByIdentity.get(key) ?? { color, ids: [], identity };
      entry.ids.push(id);
      regionIdsByIdentity.set(key, entry);
    }
    for (const { color, ids, identity } of regionIdsByIdentity.values()) for (const component of connectedCellComponents(ids)) {
      const polygons = renderSmoothShapes ? smoothCellBoundaryPolygons(component) : exactCellBoundaryPolygons(component);
      for (const polygon of polygons) regionSmoothSource.addFeature(new Feature({ geometry: new Polygon(polygon), regionColor: color, regionIdentity: identity }));
    }
  }
  return new Set(terrainCellIds);
};
