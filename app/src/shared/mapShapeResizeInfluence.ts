import {
  cellIdsToPolygonGeometries,
  MAP_SHAPE_GRID_COLUMNS,
  MAP_SHAPE_GRID_ROWS,
  mapShapeCellCenter,
  mapShapeCellIds,
  mapShapeCellPolygon,
  mapShapeContainsPoint,
  normalizeResizedMapShapeGeometry,
} from "./mapShapeGeometry";
import type { MapShapeGeometry, Position } from "./realmContract";

const EPSILON = 1e-8;
const radius = 180 / (1.5 * MAP_SHAPE_GRID_ROWS + 0.5);
const firstCellCenter = mapShapeCellCenter({ row: 0, column: 0 });
const columnStep = mapShapeCellCenter({ row: 0, column: 1 })[0] - firstCellCenter[0];
const rowStep = mapShapeCellCenter({ row: 1, column: 0 })[1] - firstCellCenter[1];

type CellBounds = { minX: number; maxX: number; minY: number; maxY: number };

const ringArea = (ring: readonly Position[]): number => {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) area += ring[index - 1]![0] * ring[index]![1] - ring[index]![0] * ring[index - 1]![1];
  return area / 2;
};

const pointInRing = (point: Position, ring: readonly Position[]): boolean => {
  let inside = false;
  for (let index = 1; index < ring.length; index += 1) {
    const start = ring[index - 1]!;
    const end = ring[index]!;
    if ((start[1] > point[1]) !== (end[1] > point[1]) && point[0] < (end[0] - start[0]) * (point[1] - start[1]) / (end[1] - start[1]) + start[0]) inside = !inside;
  }
  return inside;
};

const orientation = (a: readonly number[], b: readonly number[], c: readonly number[]): number =>
  (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);

const segmentsCross = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
};

const distanceToSegment = (point: Position, start: Position, end: Position): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const projection = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + projection * dx), point[1] - (start[1] + projection * dy));
};

const maxResizeDisplacement = (original: MapShapeGeometry, preview: MapShapeGeometry): number => {
  let maximum = 0;
  for (let ringIndex = 0; ringIndex < preview.coordinates.length; ringIndex += 1) {
    const originalRing = original.coordinates[ringIndex];
    const previewRing = preview.coordinates[ringIndex];
    if (!originalRing || !previewRing) continue;
    for (let vertexIndex = 0; vertexIndex < previewRing.length - 1; vertexIndex += 1) {
      const originalPoint = originalRing[vertexIndex];
      const previewPoint = previewRing[vertexIndex];
      if (!originalPoint || !previewPoint) continue;
      maximum = Math.max(maximum, Math.hypot(previewPoint[0] - originalPoint[0], previewPoint[1] - originalPoint[1]));
    }
  }
  return maximum;
};

const movedBoundarySegments = (original: MapShapeGeometry, preview: MapShapeGeometry): [Position, Position][] => {
  const segments: [Position, Position][] = [];
  for (let ringIndex = 0; ringIndex < preview.coordinates.length; ringIndex += 1) {
    const originalRing = original.coordinates[ringIndex];
    const previewRing = preview.coordinates[ringIndex];
    if (!originalRing || !previewRing) continue;
    for (let segmentIndex = 0; segmentIndex < previewRing.length - 1; segmentIndex += 1) {
      const originalStart = originalRing[segmentIndex];
      const originalEnd = originalRing[segmentIndex + 1];
      const previewStart = previewRing[segmentIndex];
      const previewEnd = previewRing[segmentIndex + 1];
      if (!originalStart || !originalEnd || !previewStart || !previewEnd) continue;
      const startMoved = Math.hypot(previewStart[0] - originalStart[0], previewStart[1] - originalStart[1]) > EPSILON;
      const endMoved = Math.hypot(previewEnd[0] - originalEnd[0], previewEnd[1] - originalEnd[1]) > EPSILON;
      if (startMoved || endMoved) segments.push([[...previewStart] as Position, [...previewEnd] as Position]);
    }
  }
  return segments;
};

const geometryTouchesCell = (preview: MapShapeGeometry, cellPolygon: readonly Position[]): boolean => {
  const shell = preview.coordinates[0];
  if (!shell || cellPolygon.length < 4) return false;
  if (cellPolygon.some((point) => mapShapeContainsPoint(preview, point))) return true;
  if (shell.some((point) => pointInRing(point, cellPolygon))) return true;
  return preview.coordinates.some((ring) => {
    for (let ringIndex = 1; ringIndex < ring.length; ringIndex += 1) {
      const start = ring[ringIndex - 1];
      const end = ring[ringIndex];
      if (!start || !end) continue;
      for (let cellIndex = 1; cellIndex < cellPolygon.length; cellIndex += 1) {
        const cellStart = cellPolygon[cellIndex - 1];
        const cellEnd = cellPolygon[cellIndex];
        if (cellStart && cellEnd && segmentsCross(start, end, cellStart, cellEnd)) return true;
      }
    }
    return false;
  });
};

const boundsForGeometries = (geometries: readonly MapShapeGeometry[], padding: number): CellBounds | null => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const geometry of geometries) {
    for (const ring of geometry.coordinates) {
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  return { minX: minX - padding, maxX: maxX + padding, minY: minY - padding, maxY: maxY + padding };
};

const boundsForSegments = (segments: readonly [Position, Position][], padding: number): CellBounds | null => {
  const points = segments.flat();
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  return { minX: minX - padding, maxX: maxX + padding, minY: minY - padding, maxY: maxY + padding };
};

const forEachCellInBounds = (bounds: CellBounds, visit: (row: number, column: number) => void): void => {
  const firstRow = Math.max(0, Math.floor((bounds.minY - firstCellCenter[1]) / rowStep) - 1);
  const lastRow = Math.min(MAP_SHAPE_GRID_ROWS - 1, Math.ceil((bounds.maxY - firstCellCenter[1]) / rowStep) + 1);
  for (let row = firstRow; row <= lastRow; row += 1) {
    const rowOffset = row % 2 === 0 ? 0 : columnStep / 2;
    const firstColumn = Math.max(0, Math.floor((bounds.minX - firstCellCenter[0] - rowOffset) / columnStep) - 1);
    const lastColumn = Math.min(MAP_SHAPE_GRID_COLUMNS - 1, Math.ceil((bounds.maxX - firstCellCenter[0] - rowOffset) / columnStep) + 1);
    for (let column = firstColumn; column <= lastColumn; column += 1) visit(row, column);
  }
};

const cellsAddedByPreview = (
  original: MapShapeGeometry,
  preview: MapShapeGeometry,
  originalCells: ReadonlySet<string>,
): Set<string> => {
  const cells = new Set<string>();
  const bounds = boundsForGeometries([original, preview], radius * 2);
  if (!bounds) return cells;
  forEachCellInBounds(bounds, (row, column) => {
    const id = `${column}:${row}`;
    const cellPolygon = mapShapeCellPolygon({ row, column });
    if (originalCells.has(id) || !cellPolygon) return;
    if (geometryTouchesCell(preview, cellPolygon) && !geometryTouchesCell(original, cellPolygon)) cells.add(id);
  });
  return cells;
};

const parseCellId = (value: string): { row: number; column: number } | null => {
  const [columnText, rowText] = value.split(":");
  const column = Number(columnText);
  const row = Number(rowText);
  return Number.isInteger(column) && Number.isInteger(row)
    && column >= 0 && column < MAP_SHAPE_GRID_COLUMNS && row >= 0 && row < MAP_SHAPE_GRID_ROWS
    ? { row, column }
    : null;
};

const cellId = ({ row, column }: { row: number; column: number }): string => `${column}:${row}`;
const componentNeighbors = ({ row, column }: { row: number; column: number }): { row: number; column: number }[] => {
  const axialQ = column - Math.floor(row / 2);
  return ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const).flatMap(([dq, drow]) => {
    const nextRow = row + drow;
    const nextColumn = axialQ + dq + Math.floor(nextRow / 2);
    return nextRow >= 0 && nextRow < MAP_SHAPE_GRID_ROWS && nextColumn >= 0 && nextColumn < MAP_SHAPE_GRID_COLUMNS
      ? [{ row: nextRow, column: nextColumn }]
      : [];
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
      const current = parseCellId(queue[index]!);
      if (!current) continue;
      for (const neighbor of componentNeighbors(current).sort((left, right) => cellId(left).localeCompare(cellId(right)))) {
        const neighborId = cellId(neighbor);
        if (!allowedCells.has(neighborId)) continue;
        if (parent.has(neighborId)) continue;
        parent.set(neighborId, queue[index]!);
        queue.push(neighborId);
        if (targets.has(neighborId)) { found = neighborId; break; }
      }
    }
    if (!found) return connected;
    for (let current: string | null = found; current; current = parent.get(current) ?? null) connected.add(current);
  }
};

const cellsNearMovedBoundary = (
  originalCells: ReadonlySet<string>,
  original: MapShapeGeometry,
  preview: MapShapeGeometry,
  displacement: number,
): Set<string> => {
  const influenceStart = radius * 2;
  if (displacement <= influenceStart) return new Set();
  const influenceDistance = Math.min(radius * 3, (displacement - influenceStart) * 0.12);
  const segments = movedBoundarySegments(original, preview);
  if (influenceDistance <= EPSILON || segments.length === 0) return new Set();
  const cells = new Set<string>();
  const bounds = boundsForSegments(segments, influenceDistance + radius);
  if (!bounds) return cells;
  forEachCellInBounds(bounds, (row, column) => {
    const id = `${column}:${row}`;
    if (originalCells.has(id)) return;
    const center = mapShapeCellCenter({ row, column });
    const cellPolygon = mapShapeCellPolygon({ row, column });
    if (!cellPolygon || geometryTouchesCell(original, cellPolygon) || !geometryTouchesCell(preview, cellPolygon)) return;
    if (segments.some(([start, end]) => distanceToSegment(center, start, end) <= influenceDistance)) cells.add(id);
  });
  return cells;
};

/** Adds a bounded, distance-based neighborhood around a released boundary pull. */
export const normalizeSoftResizeMapShapeGeometry = (
  original: MapShapeGeometry,
  preview: MapShapeGeometry,
): MapShapeGeometry[] => {
  const base = normalizeResizedMapShapeGeometry(original, preview);
  const baseGeometry = base[0];
  if (!baseGeometry) return base;
  const originalArea = Math.abs(ringArea(original.coordinates[0] ?? []));
  const previewArea = Math.abs(ringArea(preview.coordinates[0] ?? []));
  const displacement = maxResizeDisplacement(original, preview);
  if (previewArea < originalArea || displacement <= radius * 0.75) return base;
  const originalCells = mapShapeCellIds({ geometry: original });
  const candidateCells = new Set([
    ...originalCells,
    ...mapShapeCellIds({ geometry: baseGeometry }),
    ...cellsAddedByPreview(original, preview, originalCells),
    ...cellsNearMovedBoundary(originalCells, original, preview, displacement),
  ]);
  const cells = connectCellComponents(candidateCells, candidateCells);
  return cells.size > 0 ? cellIdsToPolygonGeometries(cells) : base;
};
