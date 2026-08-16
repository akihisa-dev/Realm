import type { MapShape, MapShapeGeometry, MapShapeLayer, Position } from "./realmContract";

export const MAP_SHAPE_GEOMETRY_VERSION = 1;
export const MAP_SHAPE_GRID_VERSION = 2;
export const MAP_SHAPE_WORLD_EXTENT = [-180, -90, 180, 90] as const;
export const MAP_SHAPE_GRID_COLUMNS = 128;
export const MAP_SHAPE_GRID_ROWS = 73;
const EPSILON = 1e-8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type Cell = { row: number; column: number };
type CellGroup = { layer: MapShapeLayer; value: string; regionId?: string; cells: Set<string> };

const cellId = ({ row, column }: Cell): string => `${column}:${row}`;
const parseCellId = (value: string): Cell | null => {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const column = Number(match[1]);
  const row = Number(match[2]);
  return Number.isSafeInteger(column) && Number.isSafeInteger(row)
    && column >= 0 && column < MAP_SHAPE_GRID_COLUMNS && row >= 0 && row < MAP_SHAPE_GRID_ROWS
    ? { row, column }
    : null;
};

const radius = 180 / (1.5 * MAP_SHAPE_GRID_ROWS + 0.5);
const columnStep = Math.sqrt(3) * radius;
const rowStep = 1.5 * radius;
const firstCenter: Position = [-180 + columnStep / 2, -90 + radius];

const clipPolygonToWorld = (polygon: readonly Position[]): Position[] => {
  let clipped = polygon.map(([x, y]) => [x, y] as Position);
  const edges: readonly ((point: Position) => boolean)[] = [
    ([x]) => x >= MAP_SHAPE_WORLD_EXTENT[0] - EPSILON,
    ([, y]) => y >= MAP_SHAPE_WORLD_EXTENT[1] - EPSILON,
    ([x]) => x <= MAP_SHAPE_WORLD_EXTENT[2] + EPSILON,
    ([, y]) => y <= MAP_SHAPE_WORLD_EXTENT[3] + EPSILON,
  ];
  const intersections: readonly ((start: Position, end: Position) => Position)[] = [
    ([x1, y1], [x2, y2]) => [MAP_SHAPE_WORLD_EXTENT[0], y1 + (y2 - y1) * (MAP_SHAPE_WORLD_EXTENT[0] - x1) / (x2 - x1)],
    ([x1, y1], [x2, y2]) => [x1 + (x2 - x1) * (MAP_SHAPE_WORLD_EXTENT[1] - y1) / (y2 - y1), MAP_SHAPE_WORLD_EXTENT[1]],
    ([x1, y1], [x2, y2]) => [MAP_SHAPE_WORLD_EXTENT[2], y1 + (y2 - y1) * (MAP_SHAPE_WORLD_EXTENT[2] - x1) / (x2 - x1)],
    ([x1, y1], [x2, y2]) => [x1 + (x2 - x1) * (MAP_SHAPE_WORLD_EXTENT[3] - y1) / (y2 - y1), MAP_SHAPE_WORLD_EXTENT[3]],
  ];
  for (let edge = 0; edge < edges.length && clipped.length > 0; edge += 1) {
    const inside = edges[edge]!;
    const intersect = intersections[edge]!;
    const next: Position[] = [];
    for (let index = 0; index < clipped.length; index += 1) {
      const start = clipped[index]!;
      const end = clipped[(index + 1) % clipped.length]!;
      const startInside = inside(start);
      const endInside = inside(end);
      if (startInside !== endInside) {
        const candidate = intersect(start, end);
        if (candidate.every(Number.isFinite)) next.push(candidate);
      }
      if (endInside) next.push(end);
    }
    clipped = next;
  }
  return clipped;
};

export const mapShapeCellCenter = (cell: Cell): Position => [
  firstCenter[0] + (cell.column + (cell.row % 2 === 0 ? 0 : 0.5)) * columnStep,
  firstCenter[1] + cell.row * rowStep,
];

const cellCenterWithinWorld = (cell: Cell): boolean => {
  const [x, y] = mapShapeCellCenter(cell);
  return x >= MAP_SHAPE_WORLD_EXTENT[0] && x <= MAP_SHAPE_WORLD_EXTENT[2]
    && y >= MAP_SHAPE_WORLD_EXTENT[1] && y <= MAP_SHAPE_WORLD_EXTENT[3];
};

export const mapShapeCellPolygon = (cell: Cell): Position[] | null => {
  if (cell.row < 0 || cell.row >= MAP_SHAPE_GRID_ROWS || cell.column < 0 || cell.column >= MAP_SHAPE_GRID_COLUMNS) return null;
  const [centerX, centerY] = mapShapeCellCenter(cell);
  const polygon = Array.from({ length: 6 }, (_, vertex): Position => {
    const angle = ((-90 + vertex * 60) * Math.PI) / 180;
    return [centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)];
  });
  const clipped = clipPolygonToWorld(polygon);
  return clipped.length >= 3 ? [...clipped, [...clipped[0]!] as Position] : null;
};

const coordinateKey = ([x, y]: Position): string => `${x.toFixed(9)},${y.toFixed(9)}`;
const edgeKey = (start: Position, end: Position): string => {
  const first = coordinateKey(start);
  const second = coordinateKey(end);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
};
const ringArea = (ring: readonly Position[]): number => {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) area += ring[index - 1]![0] * ring[index]![1] - ring[index]![0] * ring[index - 1]![1];
  return area / 2;
};
const pointInRing = (point: Position, ring: readonly Position[]): boolean => {
  let inside = false;
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1]!;
    const b = ring[index]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

/** The exposed edges of a cell set, joined into deterministic rings. */
export const cellIdsToRings = (cellIds: Iterable<string>): Position[][] => {
  const edges = new Map<string, { count: number; start: Position; end: Position }>();
  for (const id of new Set(cellIds)) {
    const cell = parseCellId(id);
    const polygon = cell ? mapShapeCellPolygon(cell) : null;
    if (!polygon) continue;
    for (let index = 1; index < polygon.length; index += 1) {
      const start = [...polygon[index - 1]!] as Position;
      const end = [...polygon[index]!] as Position;
      const key = edgeKey(start, end);
      const previous = edges.get(key);
      if (previous) previous.count += 1;
      else edges.set(key, { count: 1, start, end });
    }
  }
  const exposed = [...edges.values()].filter(({ count }) => count === 1);
  const outgoing = new Map<string, typeof exposed>();
  for (const edge of exposed) {
    const list = outgoing.get(coordinateKey(edge.start)) ?? [];
    list.push(edge);
    outgoing.set(coordinateKey(edge.start), list);
  }
  for (const list of outgoing.values()) list.sort((a, b) => coordinateKey(a.end).localeCompare(coordinateKey(b.end)));
  const identity = (edge: typeof exposed[number]): string => `${coordinateKey(edge.start)}>${coordinateKey(edge.end)}`;
  const used = new Set<string>();
  const rings: Position[][] = [];
  for (const seed of exposed.slice().sort((a, b) => identity(a).localeCompare(identity(b)))) {
    if (used.has(identity(seed))) continue;
    const ring: Position[] = [[...seed.start] as Position];
    let current = seed;
    let closed = false;
    for (let guard = 0; guard < 65536; guard += 1) {
      used.add(identity(current));
      ring.push([...current.end] as Position);
      if (coordinateKey(current.end) === coordinateKey(ring[0]!)) { closed = true; break; }
      const next = (outgoing.get(coordinateKey(current.end)) ?? []).find((candidate) => !used.has(identity(candidate)));
      if (!next) break;
      current = next;
    }
    if (closed && ring.length >= 4 && Math.abs(ringArea(ring)) > EPSILON) rings.push(ring);
  }
  return rings;
};

const ringsToPolygons = (rings: readonly Position[][]): Position[][][] => {
  const shells = rings.filter((ring) => ringArea(ring) > 0);
  const holes = rings.filter((ring) => ringArea(ring) < 0);
  const polygons = shells.map((shell) => [shell.map((point) => [...point] as Position)]);
  for (const hole of holes) {
    const owner = polygons.find(([shell]) => shell && pointInRing(hole[0]!, shell));
    if (owner) owner.push(hole.map((point) => [...point] as Position));
  }
  return polygons;
};

export const cellIdsToPolygonGeometries = (cellIds: Iterable<string>): MapShapeGeometry[] =>
  ringsToPolygons(cellIdsToRings(cellIds)).map((coordinates) => ({ type: "Polygon", coordinates }));

export type MapShapeHit = {
  kind: "vertex" | "edge" | "inside";
  ringIndex: number;
  vertexIndex?: number;
  segmentIndex?: number;
  distance: number;
};

const distanceToSegment = (point: Position, start: Position, end: Position): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const projection = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + projection * dx), point[1] - (start[1] + projection * dy));
};

const pointInGeometry = (point: Position, geometry: MapShapeGeometry): boolean => {
  const shell = geometry.coordinates[0];
  return Boolean(shell && pointInRing(point, shell) && !geometry.coordinates.slice(1).some((ring) => pointInRing(point, ring)));
};

/** Exact Polygon hit testing used by the shape editor. No smoothed/cell outline is involved. */
export const hitTestMapShapeGeometry = (geometry: MapShapeGeometry, point: Position, tolerance: number): MapShapeHit | null => {
  if (!Number.isFinite(tolerance) || tolerance < 0) return null;
  let nearestVertex: MapShapeHit | null = null;
  let nearestEdge: MapShapeHit | null = null;
  for (let ringIndex = 0; ringIndex < geometry.coordinates.length; ringIndex += 1) {
    const ring = geometry.coordinates[ringIndex]!;
    for (let vertexIndex = 0; vertexIndex < ring.length - 1; vertexIndex += 1) {
      const distance = Math.hypot(point[0] - ring[vertexIndex]![0], point[1] - ring[vertexIndex]![1]);
      if (distance <= tolerance && (!nearestVertex || distance < nearestVertex.distance)) nearestVertex = { kind: "vertex", ringIndex, vertexIndex, distance };
    }
    for (let segmentIndex = 0; segmentIndex < ring.length - 1; segmentIndex += 1) {
      const distance = distanceToSegment(point, ring[segmentIndex]!, ring[segmentIndex + 1]!);
      if (distance <= tolerance && (!nearestEdge || distance < nearestEdge.distance)) nearestEdge = { kind: "edge", ringIndex, segmentIndex, distance };
    }
  }
  if (nearestVertex) return nearestVertex;
  if (nearestEdge) return nearestEdge;
  return pointInGeometry(point, geometry) ? { kind: "inside", ringIndex: 0, distance: 0 } : null;
};

export const mapShapeContainsPoint = (geometry: MapShapeGeometry, point: Position): boolean => pointInGeometry(point, geometry);

const clampWorldPosition = ([x, y]: Position): Position => [
  Math.max(MAP_SHAPE_WORLD_EXTENT[0], Math.min(MAP_SHAPE_WORLD_EXTENT[2], x)),
  Math.max(MAP_SHAPE_WORLD_EXTENT[1], Math.min(MAP_SHAPE_WORLD_EXTENT[3], y)),
];
const geometryIsWithinWorld = (geometry: MapShapeGeometry): boolean => geometry.type === "Polygon"
  && geometry.coordinates.every((ring) => ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)
    && x >= MAP_SHAPE_WORLD_EXTENT[0] - EPSILON && x <= MAP_SHAPE_WORLD_EXTENT[2] + EPSILON
    && y >= MAP_SHAPE_WORLD_EXTENT[1] - EPSILON && y <= MAP_SHAPE_WORLD_EXTENT[3] + EPSILON));

/** Applies a continuous pointer edit to one Polygon. The result is renderer-only until normalized. */
export const resizeMapShapeGeometry = (
  geometry: MapShapeGeometry,
  hit: MapShapeHit,
  startPosition: Position,
  currentPosition: Position,
): MapShapeGeometry => {
  const coordinates = geometry.coordinates.map((ring) => ring.map(([x, y]) => [x, y] as Position));
  const ring = coordinates[hit.ringIndex];
  if (!ring) return geometry;
  if (hit.kind === "inside") return geometry;
  if (hit.kind === "vertex" && hit.vertexIndex !== undefined) {
    const vertex = clampWorldPosition(currentPosition);
    ring[hit.vertexIndex] = vertex;
    if (hit.vertexIndex === 0) ring[ring.length - 1] = [...vertex] as Position;
    else if (hit.vertexIndex === ring.length - 1) ring[0] = [...vertex] as Position;
    return { type: "Polygon", coordinates };
  }
  if (hit.kind !== "edge" || hit.segmentIndex === undefined) return geometry;
  const start = ring[hit.segmentIndex];
  const end = ring[hit.segmentIndex + 1];
  if (!start || !end) return geometry;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return geometry;
  const normal: Position = [-dy / length, dx / length];
  const pointerDelta: Position = [currentPosition[0] - startPosition[0], currentPosition[1] - startPosition[1]];
  const distance = pointerDelta[0] * normal[0] + pointerDelta[1] * normal[1];
  const movedStart = clampWorldPosition([start[0] + normal[0] * distance, start[1] + normal[1] * distance]);
  const movedEnd = clampWorldPosition([end[0] + normal[0] * distance, end[1] + normal[1] * distance]);
  ring[hit.segmentIndex] = movedStart;
  ring[hit.segmentIndex + 1] = movedEnd;
  if (hit.segmentIndex === 0) ring[ring.length - 1] = [...movedStart] as Position;
  return { type: "Polygon", coordinates };
};

/** Converts a renderer preview back into one or more canonical grid-snapped polygons. */
export const normalizeMapShapeGeometry = (geometry: MapShapeGeometry): MapShapeGeometry[] => {
  if (!geometryIsWithinWorld(geometry)) throw new Error("形状を地図の範囲外へ移動できません。");
  const cells = geometryCellIds(geometry);
  if (cells.size === 0) throw new Error("形状にグリッドセルがありません。");
  return cellIdsToPolygonGeometries(cells);
};

const nearestCellId = (point: Position): string => {
  let nearest = "0:0";
  let distance = Number.POSITIVE_INFINITY;
  for (let row = 0; row < MAP_SHAPE_GRID_ROWS; row += 1) {
    for (let column = 0; column < MAP_SHAPE_GRID_COLUMNS; column += 1) {
      const center = mapShapeCellCenter({ row, column });
      const nextDistance = (center[0] - point[0]) ** 2 + (center[1] - point[1]) ** 2;
      if (nextDistance < distance) { distance = nextDistance; nearest = `${column}:${row}`; }
    }
  }
  return nearest;
};

const movedResizeAnchorCells = (original: MapShapeGeometry, preview: MapShapeGeometry): string[] => {
  const anchors: string[] = [];
  for (let ringIndex = 0; ringIndex < preview.coordinates.length; ringIndex += 1) {
    const originalRing = original.coordinates[ringIndex];
    const previewRing = preview.coordinates[ringIndex];
    if (!originalRing || !previewRing) continue;
    for (let vertexIndex = 0; vertexIndex < previewRing.length - 1; vertexIndex += 1) {
      const originalPoint = originalRing[vertexIndex];
      const previewPoint = previewRing[vertexIndex];
      if (!originalPoint || !previewPoint) continue;
      if (Math.hypot(previewPoint[0] - originalPoint[0], previewPoint[1] - originalPoint[1]) <= radius) continue;
      anchors.push(nearestCellId(previewPoint));
    }
  }
  return anchors;
};

/**
 * Returns a bounded bridge corridor for a continuous preview.  A cell-center
 * sample can leave gaps along a long, narrow pull; the bridge may fill those
 * gaps, but it must remain inside the preview's local extent instead of
 * searching through the entire world grid.
 */
const cellsWithinGeometryBounds = (geometry: MapShapeGeometry): Set<string> => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of geometry.coordinates) {
    for (const [x, y] of ring) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return new Set();
  const padding = radius * 1.5;
  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;
  const cells = new Set<string>();
  for (let row = 0; row < MAP_SHAPE_GRID_ROWS; row += 1) {
    for (let column = 0; column < MAP_SHAPE_GRID_COLUMNS; column += 1) {
      const [x, y] = mapShapeCellCenter({ row, column });
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) cells.add(`${column}:${row}`);
    }
  }
  return cells;
};

/**
 * Normalizes a boundary pull while retaining the original surface as the
 * continuity anchor. A narrow, long preview can contain cell centers at both
 * ends without containing any center between them, so plain center sampling
 * would turn one pull into multiple disconnected shapes.
 */
export const normalizeResizedMapShapeGeometry = (
  original: MapShapeGeometry,
  preview: MapShapeGeometry,
): MapShapeGeometry[] => {
  if (!geometryIsWithinWorld(original) || !geometryIsWithinWorld(preview)) throw new Error("形状を地図の範囲外へ移動できません。");
  const originalCells = geometryCellIds(original);
  const previewCells = geometryCellIds(preview);
  if (originalCells.size === 0) throw new Error("形状にグリッドセルがありません。");

  const isExpansion = Math.abs(ringArea(preview.coordinates[0] ?? [])) >= Math.abs(ringArea(original.coordinates[0] ?? []));
  const cells = isExpansion
    ? (() => {
      const candidateCells = new Set([
        ...originalCells,
        ...previewCells,
        ...movedResizeAnchorCells(original, preview),
      ]);
      const bridgeCorridor = cellsWithinGeometryBounds(preview);
      return connectCellComponents(candidateCells, new Set([...candidateCells, ...bridgeCorridor]));
    })()
    : (() => {
      const remaining = new Set([...originalCells].filter((cell) => previewCells.has(cell)));
      const components = connectedComponents(remaining);
      // A boundary pull must not silently delete a detached part that was
      // unrelated to the pulled edge.  The current map-shape edit contract
      // emits one replacement for one source shape, so preserve the source
      // unchanged when this contraction would split it instead of choosing
      // the largest component and discarding the rest.
      if (components.length > 1) return originalCells;
      return components[0] ?? new Set<string>();
    })();
  if (cells.size === 0) throw new Error("形状にグリッドセルがありません。");
  return cellIdsToPolygonGeometries(cells);
};

const cellsForGeometries = (geometries: readonly MapShapeGeometry[]): Set<string> => {
  const cells = new Set<string>();
  for (const geometry of geometries) for (const cell of geometryCellIds(geometry)) cells.add(cell);
  return cells;
};

/** Grid-backed boolean operations. Cells are only an internal calculation; callers receive Polygons. */
export const unionMapShapeGeometries = (geometries: readonly MapShapeGeometry[]): MapShapeGeometry[] =>
  cellIdsToPolygonGeometries(cellsForGeometries(geometries));

export const differenceMapShapeGeometry = (subject: MapShapeGeometry, subtractors: readonly MapShapeGeometry[]): MapShapeGeometry[] => {
  const remaining = cellsForGeometries([subject]);
  for (const cell of cellsForGeometries(subtractors)) remaining.delete(cell);
  return cellIdsToPolygonGeometries(remaining);
};

export const intersectionMapShapeGeometries = (first: MapShapeGeometry, second: MapShapeGeometry): MapShapeGeometry[] => {
  const secondCells = cellsForGeometries([second]);
  return cellIdsToPolygonGeometries([...cellsForGeometries([first])].filter((cell) => secondCells.has(cell)));
};

/** Normalizes every shape after a continuous preview, merging touching parts that share one canonical identity. */
export const normalizeMapShapes = (shapes: readonly MapShape[]): MapShape[] => {
  const groups = new Map<string, CellGroup>();
  for (const shape of shapes) {
    if (!geometryIsWithinWorld(shape.geometry)) throw new Error("形状を地図の範囲外へ移動できません。");
    const cells = geometryCellIds(shape.geometry);
    if (cells.size === 0) throw new Error("形状にグリッドセルがありません。");
    const key = `${shape.layer}:${shape.regionId ?? ""}:${shape.value}`;
    const group = groups.get(key) ?? { layer: shape.layer, value: shape.value, ...(shape.regionId ? { regionId: shape.regionId } : {}), cells: new Set<string>() };
    for (const cell of cells) group.cells.add(cell);
    groups.set(key, group);
  }
  const normalized = shapesFromGroups([...groups.values()], shapes);
  validateMapShapes(normalized);
  return normalized;
};

const samePoint = (a: readonly number[], b: readonly number[]): boolean => Math.abs(a[0]! - b[0]!) <= EPSILON && Math.abs(a[1]! - b[1]!) <= EPSILON;
const orientation = (a: readonly number[], b: readonly number[], c: readonly number[]): number =>
  (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
const pointOnSegment = (a: readonly number[], b: readonly number[], point: readonly number[]): boolean =>
  point[0]! >= Math.min(a[0]!, b[0]!) - EPSILON && point[0]! <= Math.max(a[0]!, b[0]!) + EPSILON
  && point[1]! >= Math.min(a[1]!, b[1]!) - EPSILON && point[1]! <= Math.max(a[1]!, b[1]!) + EPSILON;
const segmentsIntersect = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return (Math.abs(abC) <= EPSILON && pointOnSegment(a, b, c))
    || (Math.abs(abD) <= EPSILON && pointOnSegment(a, b, d))
    || (Math.abs(cdA) <= EPSILON && pointOnSegment(c, d, a))
    || (Math.abs(cdB) <= EPSILON && pointOnSegment(c, d, b));
};
const ringSelfIntersects = (ring: readonly Position[]): boolean => {
  const segments = ring.length - 1;
  for (let first = 0; first < segments; first += 1) {
    for (let second = first + 1; second < segments; second += 1) {
      if (second === first + 1 || (first === 0 && second === segments - 1)) continue;
      if (segmentsIntersect(ring[first]!, ring[first + 1]!, ring[second]!, ring[second + 1]!)) return true;
    }
  }
  return false;
};

const geometryCellIds = (geometry: MapShapeGeometry): Set<string> => {
  const cells = new Set<string>();
  const points = geometry.coordinates.flat();
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minX = MAP_SHAPE_WORLD_EXTENT[0]; maxX = MAP_SHAPE_WORLD_EXTENT[2];
    minY = MAP_SHAPE_WORLD_EXTENT[1]; maxY = MAP_SHAPE_WORLD_EXTENT[3];
  }
  const firstRow = Math.max(0, Math.floor((minY - firstCenter[1]) / rowStep) - 1);
  const lastRow = Math.min(MAP_SHAPE_GRID_ROWS - 1, Math.ceil((maxY - firstCenter[1]) / rowStep) + 1);
  for (let row = firstRow; row <= lastRow; row += 1) {
    const rowOffset = row % 2 === 0 ? 0 : 0.5;
    const firstColumn = Math.max(0, Math.floor((minX - firstCenter[0]) / columnStep - rowOffset) - 1);
    const lastColumn = Math.min(MAP_SHAPE_GRID_COLUMNS - 1, Math.ceil((maxX - firstCenter[0]) / columnStep - rowOffset) + 1);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const point = mapShapeCellCenter({ row, column });
      const inShell = geometry.coordinates[0] ? pointInRing(point, geometry.coordinates[0]) : false;
      const inHole = geometry.coordinates.slice(1).some((ring) => pointInRing(point, ring));
      if (inShell && !inHole) cells.add(`${column}:${row}`);
    }
  }
  return cells;
};

export const mapShapeCellIds = (shape: Pick<MapShape, "geometry">): Set<string> => geometryCellIds(shape.geometry);

const canonicalGeometrySignature = (geometry: MapShapeGeometry): string => JSON.stringify(geometry);

const validateGeometry = (geometry: MapShapeGeometry): Set<string> => {
  if (geometry.type !== "Polygon" || geometry.coordinates.length === 0 || geometry.coordinates.length > 64) throw new Error("形状のポリゴンが不正です。");
  for (const ring of geometry.coordinates) {
    if (ring.length < 4 || ring.length > 4096 || !samePoint(ring[0]!, ring.at(-1)!) || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < -180 - EPSILON || x > 180 + EPSILON || y < -90 - EPSILON || y > 90 + EPSILON)) throw new Error("形状のリングが不正です。");
    for (let index = 1; index < ring.length; index += 1) if (samePoint(ring[index - 1]!, ring[index]!)) throw new Error("形状のリングに重複座標があります。");
    if (Math.abs(ringArea(ring)) <= EPSILON || ringSelfIntersects(ring)) throw new Error("形状のリングが自己交差または退化しています。");
  }
  const shell = geometry.coordinates[0]!;
  for (const hole of geometry.coordinates.slice(1)) {
    if (!pointInRing(hole[0]!, shell) || segmentsIntersect(hole[0]!, hole[1]!, shell[0]!, shell[1]!)) throw new Error("形状の穴が外周の内側にありません。");
  }
  const cells = geometryCellIds(geometry);
  if (cells.size === 0) throw new Error("形状にグリッドセルがありません。");
  const parts = cellIdsToPolygonGeometries(cells);
  if (parts.length !== 1 || canonicalGeometrySignature(parts[0]!) !== canonicalGeometrySignature(geometry)) throw new Error("形状は固定グリッドに整列している必要があります。");
  return cells;
};

export const validateMapShape = (shape: MapShape): Set<string> => {
  if (!shape || typeof shape !== "object" || !UUID_PATTERN.test(shape.id)) throw new Error("形状IDが不正です。");
  if (shape.layer !== "terrain" && shape.layer !== "region") throw new Error("形状レイヤーが不正です。");
  if (!Number.isInteger(shape.geometryVersion) || shape.geometryVersion !== MAP_SHAPE_GEOMETRY_VERSION || !Number.isInteger(shape.snapGridVersion) || shape.snapGridVersion !== MAP_SHAPE_GRID_VERSION) throw new Error("形状バージョンが不正です。");
  if (shape.layer === "terrain" && (shape.regionId !== undefined || shape.value !== "terrain")) throw new Error("地形形状の属性が不正です。");
  if (shape.layer === "region" && (!shape.regionId || !UUID_PATTERN.test(shape.regionId) || !/^#[\da-f]{6}$/iu.test(shape.value))) throw new Error("領域形状の属性が不正です。");
  return validateGeometry(shape.geometry);
};

export const validateMapShapes = (shapes: readonly MapShape[]): void => {
  if (!Array.isArray(shapes) || shapes.length > 4096) throw new Error("形状の件数が不正です。");
  const ids = new Set<string>();
  const occupied = new Map<MapShapeLayer, Set<string>>([['terrain', new Set()], ['region', new Set()]]);
  const regionValues = new Map<string, string>();
  const validatedShapes: { shape: MapShape; cells: Set<string> }[] = [];
  for (const shape of shapes) {
    if (ids.has(shape.id)) throw new Error("形状IDが重複しています。");
    ids.add(shape.id);
    const cells = validateMapShape(shape);
    if (shape.layer === "region") {
      const previous = regionValues.get(shape.regionId!);
      if (previous !== undefined && previous !== shape.value) throw new Error("同じ領域IDに複数の色を設定できません。");
      regionValues.set(shape.regionId!, shape.value);
    }
    const layerCells = occupied.get(shape.layer)!;
    for (const cell of cells) if (layerCells.has(cell)) throw new Error("同じレイヤーの形状を重ねることはできません。");
    for (const cell of cells) layerCells.add(cell);
    validatedShapes.push({ shape, cells });
  }
  const identityGroups = new Map<string, { shapeCount: number; cells: Set<string> }>();
  for (const { shape, cells } of validatedShapes) {
    const key = `${shape.layer}:${shape.regionId ?? ""}:${shape.value}`;
    const group = identityGroups.get(key) ?? { shapeCount: 0, cells: new Set<string>() };
    group.shapeCount += 1;
    for (const cell of cells) group.cells.add(cell);
    identityGroups.set(key, group);
  }
  for (const { shapeCount, cells } of identityGroups.values()) {
    if (connectedComponents(cells).length !== shapeCount) throw new Error("同じ属性の接続面は一つの形状にまとめる必要があります。");
  }
};

export type MapShapeHitTarget = MapShapeHit & { shapeId: string };

/** Finds the exact editable Polygon under a pointer, preferring vertices and edges over interiors. */
export const hitTestMapShapes = (shapes: readonly MapShape[], point: Position, tolerance: number): MapShapeHitTarget | null => {
  const candidates = shapes.flatMap((shape) => {
    const hit = hitTestMapShapeGeometry(shape.geometry, point, tolerance);
    return hit ? [{ ...hit, shapeId: shape.id }] : [];
  });
  const priority = (hit: MapShapeHit): number => hit.kind === "vertex" ? 0 : hit.kind === "edge" ? 1 : 2;
  return candidates.sort((left, right) => priority(left) - priority(right) || left.distance - right.distance || left.shapeId.localeCompare(right.shapeId))[0] ?? null;
};

const newId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = (length: number): string => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${["8", "9", "a", "b"][Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
};
const componentNeighbors = (cell: Cell): Cell[] => {
  const axialQ = cell.column - Math.floor(cell.row / 2);
  return ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const).flatMap(([dq, drow]) => {
    const row = cell.row + drow;
    const column = axialQ + dq + Math.floor(row / 2);
    return row >= 0 && row < MAP_SHAPE_GRID_ROWS && column >= 0 && column < MAP_SHAPE_GRID_COLUMNS ? [{ row, column }] : [];
  });
};
const connectedComponents = (cells: Set<string>): Set<string>[] => {
  const remaining = new Set(cells);
  const components: Set<string>[] = [];
  while (remaining.size > 0) {
    const seed = [...remaining].sort()[0]!;
    const queue = [seed];
    const component = new Set<string>();
    remaining.delete(seed);
    for (let index = 0; index < queue.length; index += 1) {
      const currentId = queue[index]!;
      component.add(currentId);
      const current = parseCellId(currentId);
      if (!current) continue;
      for (const neighbor of componentNeighbors(current)) {
        const neighborId = cellId(neighbor);
        if (remaining.delete(neighborId)) queue.push(neighborId);
      }
    }
    components.push(component);
  }
  return components;
};

const connectCellComponents = (cells: Set<string>, allowedCells: ReadonlySet<string> = cells): Set<string> => {
  let connected = new Set(cells);
  while (true) {
    const components = connectedComponents(connected);
    if (components.length <= 1) return connected;
    const base = components[0]!;
    const targets = new Set([...connected].filter((cell) => !base.has(cell)));
    const queue = [...base].sort();
    const parent = new Map<string, string | null>(queue.map((cell) => [cell, null]));
    let found: string | null = null;
    for (let index = 0; index < queue.length && !found; index += 1) {
      const current = queue[index]!;
      const parsed = parseCellId(current);
      if (!parsed) continue;
      for (const neighbor of componentNeighbors(parsed).sort((left, right) => cellId(left).localeCompare(cellId(right)))) {
        const neighborId = cellId(neighbor);
        if (!allowedCells.has(neighborId)) continue;
        if (parent.has(neighborId)) continue;
        parent.set(neighborId, current);
        queue.push(neighborId);
        if (targets.has(neighborId)) { found = neighborId; break; }
      }
    }
    if (!found) return connected;
    for (let current: string | null = found; current; current = parent.get(current) ?? null) connected.add(current);
  }
};

type ExistingPart = { shape: MapShape; cells: Set<string> };
const shapeParts = (shapes: readonly MapShape[]): ExistingPart[] => shapes.map((shape) => ({ shape, cells: mapShapeCellIds(shape) }));
const geometryForCells = (cells: Set<string>): MapShapeGeometry => {
  const [geometry] = cellIdsToPolygonGeometries(cells);
  if (!geometry) throw new Error("形状を構成するセルがありません。");
  return geometry;
};

const shapesFromGroups = (groups: readonly CellGroup[], existing: readonly MapShape[], preserveUnchanged = false): MapShape[] => {
  const parts = shapeParts(existing);
  const usedIds = new Set<string>();
  const result: MapShape[] = [];
  for (const group of groups) {
    for (const component of connectedComponents(group.cells)) {
      const candidates = parts.filter(({ shape }) => !usedIds.has(shape.id) && shape.layer === group.layer && shape.value === group.value && shape.regionId === group.regionId)
        .map((part) => ({ ...part, overlap: [...component].filter((cell) => part.cells.has(cell)).length }))
        .filter((candidate) => candidate.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || a.shape.id.localeCompare(b.shape.id));
      const unchanged = preserveUnchanged
        ? candidates.find((candidate) => candidate.cells.size === component.size && [...component].every((cell) => candidate.cells.has(cell)))
        : undefined;
      const id = candidates[0]?.shape.id ?? newId();
      usedIds.add(id);
      result.push({ id, layer: group.layer, ...(group.regionId ? { regionId: group.regionId } : {}), value: group.value, geometryVersion: MAP_SHAPE_GEOMETRY_VERSION, snapGridVersion: MAP_SHAPE_GRID_VERSION, geometry: unchanged?.shape.geometry ?? geometryForCells(component) });
    }
  }
  return result.sort((a, b) => a.layer.localeCompare(b.layer) || (a.regionId ?? "").localeCompare(b.regionId ?? "") || a.id.localeCompare(b.id));
};

const groupsFromShapes = (shapes: readonly MapShape[]): CellGroup[] => {
  const groups = new Map<string, CellGroup>();
  for (const shape of shapes) {
    const key = `${shape.layer}:${shape.regionId ?? ""}:${shape.value}`;
    const group = groups.get(key) ?? { layer: shape.layer, value: shape.value, ...(shape.regionId ? { regionId: shape.regionId } : {}), cells: new Set<string>() };
    for (const cell of mapShapeCellIds(shape)) group.cells.add(cell);
    groups.set(key, group);
  }
  return [...groups.values()];
};

export const deriveMapGridCells = (shapes: readonly MapShape[]) => groupsFromShapes(shapes)
  .sort((first, second) => (first.layer === second.layer ? (first.regionId ?? "").localeCompare(second.regionId ?? "") || first.value.localeCompare(second.value) : first.layer === "terrain" ? -1 : 1))
  .flatMap((group) => [...group.cells].sort().map((cellIdValue) => ({
    cellId: cellIdValue,
    layer: group.layer,
    /** @deprecated Keep the renderer projection available to old adapters. */
    attribute: group.layer,
    value: group.value,
    ...(group.regionId ? { regionId: group.regionId } : {}),
  })));

export type MapGridSelectionInput = { cellIds: readonly string[]; layer: "terrain" | "region"; value: string | null; regionId?: string; clearRegion?: boolean };
export const applyGridSelectionToMapShapes = (shapes: readonly MapShape[], input: MapGridSelectionInput): MapShape[] => {
  const selected = new Set(input.cellIds.flatMap((id) => {
    const cell = parseCellId(id);
    return cell && cellCenterWithinWorld(cell) ? [id] : [];
  }));
  if (selected.size === 0) throw new Error("セルを選択してください。");
  const groups = groupsFromShapes(shapes);
  if (input.layer === "terrain") {
    const terrain = groups.find((group) => group.layer === "terrain");
    if (input.value === null) terrain?.cells.forEach((cell) => { if (selected.has(cell)) terrain.cells.delete(cell); });
    else {
      const target = terrain ?? (() => { const created: CellGroup = { layer: "terrain", value: "terrain", cells: new Set() }; groups.push(created); return created; })();
      for (const cell of selected) target.cells.add(cell);
    }
    if (input.clearRegion) for (const group of groups.filter((candidate) => candidate.layer === "region")) for (const cell of selected) group.cells.delete(cell);
  } else {
    for (const group of groups.filter((candidate) => candidate.layer === "region")) for (const cell of selected) group.cells.delete(cell);
    if (input.value !== null) {
      if (!input.regionId || !UUID_PATTERN.test(input.regionId)) throw new Error("領域IDが不正です。");
      const region = groups.find((group) => group.layer === "region" && group.regionId === input.regionId && group.value === input.value)
        ?? (() => { const created: CellGroup = { layer: "region", regionId: input.regionId, value: input.value!, cells: new Set() }; groups.push(created); return created; })();
      for (const cell of selected) region.cells.add(cell);
    }
  }
  return shapesFromGroups(groups.filter((group) => group.cells.size > 0), shapes, true);
};

export const translateMapShapeGeometry = (geometry: MapShapeGeometry, offset: Position): MapShapeGeometry => ({
  type: "Polygon",
  coordinates: geometry.coordinates.map((ring) => ring.map(([x, y]) => [x + offset[0], y + offset[1]] as Position)),
});
