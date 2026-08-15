import type { CellAttributeSnapshot, Position } from "../backend";
import { CELL_GRID_COLUMNS, CELL_GRID_ROWS, cellId, cellIdsWithinPaintPath, cellIdsWithinPaintPosition, cellPolygon, parseCellId } from "./gridGeometry";

type Axial = [number, number];
const axialFor = (id: string): Axial | null => {
  const parsed = parseCellId(id); if (!parsed) return null;
  const [row, column] = parsed; return [column - Math.floor(row / 2), row];
};
const idForAxial = ([q, row]: Axial): string | null => {
  const column = q + Math.floor(row / 2);
  return row >= 0 && row < CELL_GRID_ROWS && column >= 0 && column < CELL_GRID_COLUMNS ? cellId(row, column) : null;
};
const adjacentIds = (id: string): string[] => {
  const axial = axialFor(id); if (!axial) return [];
  return ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as Axial[])
    .map(([dq, dr]) => idForAxial([axial[0] + dq, axial[1] + dr]))
    .filter((next): next is string => next !== null);
};
export const adjacentCellIds = (id: string): string[] => adjacentIds(id);
const compareCellIds = (left: string, right: string): number => {
  const a = parseCellId(left)!; const b = parseCellId(right)!;
  return a[0] - b[0] || a[1] - b[1];
};
/** Splits a cell set into deterministic six-neighbor connected components. */
export const connectedCellComponents = (cellIds: Iterable<string>): string[][] => {
  const candidates = new Set<string>();
  for (const id of cellIds) if (parseCellId(id)) candidates.add(id);
  const visited = new Set<string>(); const components: string[][] = [];
  for (const seed of [...candidates].sort(compareCellIds)) {
    if (visited.has(seed)) continue;
    const component: string[] = []; const queue = [seed]; visited.add(seed);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!; component.push(current);
      for (const next of adjacentIds(current)) if (candidates.has(next) && !visited.has(next)) { visited.add(next); queue.push(next); }
    }
    components.push(component.sort(compareCellIds));
  }
  return components;
};
export const connectedRegionCells = (startId: string, attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>): string[] => {
  const values = new Map<string, string>();
  for (const [id, items] of attributes) { const region = items.find((item) => item.attribute === "region"); if (region) values.set(id, region.regionId ?? region.value); }
  const identity = values.get(startId); if (identity === undefined) return [];
  return connectedCellComponents([...values.entries()].filter(([, value]) => value === identity).map(([id]) => id)
  ).find((component) => component.includes(startId)) ?? [];
};
/** Returns the six-connected terrain mass containing the start cell. */
export const connectedTerrainCells = (startId: string, attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>): string[] => {
  const terrainIds = [...attributes.entries()]
    .filter(([, items]) => items.some((item) => item.attribute === "terrain"))
    .map(([id]) => id);
  return connectedCellComponents(terrainIds).find((component) => component.includes(startId)) ?? [];
};
/** Returns every persisted cell with the same region identity, including visually separated components. */
export const sameRegionCells = (startId: string, attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>): string[] => {
  let identity: string | undefined;
  const values: Array<[string, string]> = [];
  for (const [id, items] of attributes) {
    const region = items.find((item) => item.attribute === "region");
    if (id === startId && region) identity = region.regionId ?? region.value;
    if (region) values.push([id, region.regionId ?? region.value]);
  }
  return identity === undefined ? [] : values.filter(([, value]) => value === identity).map(([id]) => id).sort(compareCellIds);
};
/** Returns whether a cell is on the visible edge of its same-ID component. */
export const isRegionBoundaryCell = (cellId: string, component: readonly string[]): boolean => {
  const componentSet = new Set(component);
  return componentSet.has(cellId) && adjacentIds(cellId).some((next) => !componentSet.has(next));
};

type Segment = readonly [Position, Position];

const squaredDistance = (left: Position, right: Position): number => ((left[0] - right[0]) ** 2) + ((left[1] - right[1]) ** 2);

const squaredDistanceToSegment = (point: Position, start: Position, end: Position): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return squaredDistance(point, start);
  const ratio = Math.max(0, Math.min(1, (((point[0] - start[0]) * dx) + ((point[1] - start[1]) * dy)) / ((dx * dx) + (dy * dy))));
  return squaredDistance(point, [start[0] + ratio * dx, start[1] + ratio * dy]);
};

const polygonEdges = (polygon: readonly Position[]): Segment[] => polygon.slice(0, -1).map((start, index) => [start, polygon[index + 1]!] as const);

const sharesEdge = (left: Segment, right: Segment): boolean => {
  const tolerance = 1e-7;
  return (squaredDistance(left[0], right[0]) <= tolerance && squaredDistance(left[1], right[1]) <= tolerance)
    || (squaredDistance(left[0], right[1]) <= tolerance && squaredDistance(left[1], right[0]) <= tolerance);
};

const neighborForEdge = (cell: string, edge: Segment): string | null => {
  const parsed = parseCellId(cell);
  if (!parsed) return null;
  const neighbors = adjacentIds(cell);
  const neighborPolygons = neighbors.map((neighbor) => {
    const [row, column] = parseCellId(neighbor)!;
    return [neighbor, cellPolygon(row, column)] as const;
  });
  for (const [neighbor, polygon] of neighborPolygons) {
    if (polygon && polygonEdges(polygon).some((candidate) => sharesEdge(edge, candidate))) return neighbor;
  }
  return null;
};

const boundaryDistance = (
  position: Position,
  cell: string,
  attribute: "terrain" | "region",
  attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>,
): number => {
  const parsed = parseCellId(cell);
  if (!parsed) return Number.POSITIVE_INFINITY;
  const polygon = cellPolygon(parsed[0], parsed[1]);
  if (!polygon) return Number.POSITIVE_INFINITY;
  const values = attributes.get(cell) ?? [];
  const region = values.find((item) => item.attribute === "region");
  const hasTerrain = values.some((item) => item.attribute === "terrain");
  if ((attribute === "region" && !region) || (attribute === "terrain" && !hasTerrain)) return Number.POSITIVE_INFINITY;
  const identity = region ? region.regionId ?? region.value : null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const edge of polygonEdges(polygon)) {
    const neighbor = neighborForEdge(cell, edge);
    const neighborValues = neighbor ? attributes.get(neighbor) ?? [] : [];
    const neighborRegion = neighborValues.find((item) => item.attribute === "region");
    const isBoundary = attribute === "terrain"
      ? !neighborValues.some((item) => item.attribute === "terrain")
      : !neighborRegion || (neighborRegion.regionId ?? neighborRegion.value) !== identity;
    if (isBoundary) nearest = Math.min(nearest, squaredDistanceToSegment(position, edge[0], edge[1]));
  }
  return nearest;
};

const boundaryHitToleranceSquared = (cell: string): number => {
  const parsed = parseCellId(cell);
  if (!parsed) return 0;
  const polygon = cellPolygon(parsed[0], parsed[1]);
  if (!polygon) return 0;
  const longestEdgeSquared = Math.max(...polygonEdges(polygon).map(([start, end]) => squaredDistance(start, end)), 0);
  return longestEdgeSquared * 0.32 ** 2;
};

/** Returns persisted terrain/region cells whose exact hex boundary is under a pointer. */
export const resizableCellIdsAt = (
  position: Position,
  attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>,
  candidateIds = cellIdsWithinPaintPosition(position, 1),
): string[] => {
  const result = new Map<string, number>();
  for (const id of candidateIds) {
    const values = attributes.get(id) ?? [];
    const region = values.find((item) => item.attribute === "region");
    const regionDistance = region ? boundaryDistance(position, id, "region", attributes) : Number.POSITIVE_INFINITY;
    const terrainDistance = values.some((item) => item.attribute === "terrain") ? boundaryDistance(position, id, "terrain", attributes) : Number.POSITIVE_INFINITY;
    const distance = Math.min(regionDistance, terrainDistance);
    if (distance <= boundaryHitToleranceSquared(id)) result.set(id, distance);
  }
  return [...result.entries()].sort((left, right) => left[1] - right[1] || compareCellIds(left[0], right[0])).map(([id]) => id);
};
/** Returns the one-cell-wide stroke cells crossed by a pointer segment. */
export const regionResizeStroke = (path: readonly Position[], radiusCells = 0): string[] => cellIdsWithinPaintPath(path, Math.max(1e-6, radiusCells));
export const translateRegionCells = (sourceIds: readonly string[], sourceAnchor: string, targetAnchor: string): string[] | null => {
  const source = axialFor(sourceAnchor); const target = axialFor(targetAnchor); if (!source || !target || sourceIds.length === 0) return null;
  const delta: Axial = [target[0] - source[0], target[1] - source[1]];
  const translated = sourceIds.map((id) => { const axial = axialFor(id); return axial ? idForAxial([axial[0] + delta[0], axial[1] + delta[1]]) : null; });
  return translated.every((id): id is string => id !== null) ? translated : null;
};
export const clipRegionCellsToTerrain = (cellIds: readonly string[], attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>): string[] =>
  cellIds.filter((id) => attributes.get(id)?.some((item) => item.attribute === "terrain") === true);
/** Removes destination cells occupied by a different persisted region, while allowing the moving region to overlap itself. */
export const clipRegionCellsToAvailableTargets = (
  cellIds: readonly string[],
  sourceIds: readonly string[],
  sourceIdentity: string,
  attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>,
): string[] => {
  const sourceSet = new Set(sourceIds);
  return cellIds.filter((id) => sourceSet.has(id) || !attributes.get(id)?.some((item) => item.attribute === "region" && (item.regionId ?? item.value) !== sourceIdentity));
};
export const sameCellSet = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && right.every((id) => new Set(left).has(id));
