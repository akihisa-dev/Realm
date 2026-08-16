import {
  MAP_SHAPE_GRID_COLUMNS,
  MAP_SHAPE_GRID_ROWS,
  MAP_SHAPE_WORLD_EXTENT,
  mapShapeCellCenter,
  mapShapeCellPolygon,
} from "../shared/mapShapeGeometry";

export const CELL_GRID_COLUMNS = MAP_SHAPE_GRID_COLUMNS;
export const CELL_GRID_ROWS = MAP_SHAPE_GRID_ROWS;
export const CELL_GRID_CELL_COUNT = CELL_GRID_COLUMNS * CELL_GRID_ROWS;
export const CELL_PAINT_RADII = { small: 2, medium: 4, large: 8 } as const;
export const CELL_PAINT_RANGE_MIN = 1;
export const CELL_PAINT_RANGE_MAX = 5;
export type CellPaintSize = keyof typeof CELL_PAINT_RADII;
export type CellPosition = [number, number];
export const WORLD_EXTENT = MAP_SHAPE_WORLD_EXTENT;

export const availableViewportSize = (width: number, height: number): [number, number] => {
  const padding = Math.min(160, Math.max(40, Math.min(width, height) * 0.1));
  return [Math.max(1, width - padding * 2), Math.max(1, height - padding * 2)];
};

/** Converts the user-facing cell range to a hex-grid distance radius. */
export const cellPaintRadiusForRange = (range: number): number => {
  if (!Number.isFinite(range)) return 0;
  return Math.max(0, Math.min(CELL_PAINT_RANGE_MAX - 1, Math.round(range) - 1) * 2);
};

const FIRST_CELL_CENTER = mapShapeCellCenter({ row: 0, column: 0 });
const CELL_COLUMN_STEP = mapShapeCellCenter({ row: 0, column: 1 })[0] - FIRST_CELL_CENTER[0];
const CELL_ROW_STEP = mapShapeCellCenter({ row: 1, column: 0 })[1] - FIRST_CELL_CENTER[1];

/** Stable persisted identity: x (column) first, then y (row). */
export const cellId = (row: number, column: number): string => `${column}:${row}`;

export const cellCenter = (row: number, column: number): [number, number] => mapShapeCellCenter({ row, column });

export const cellCenterWithinWorld = (row: number, column: number): boolean => {
  const [longitude, latitude] = cellCenter(row, column);
  return longitude >= WORLD_EXTENT[0] && longitude <= WORLD_EXTENT[2]
    && latitude >= WORLD_EXTENT[1] && latitude <= WORLD_EXTENT[3];
};

/**
 * Returns one regular point-topped hexagon in the fixed odd-row offset grid.
 */
export const cellPolygon = (row: number, column: number): CellPosition[] | null =>
  mapShapeCellPolygon({ row, column });

export const parseCellId = (value: string): [number, number] | null => {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const column = Number(match[1]);
  const row = Number(match[2]);
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) return null;
  if (column < 0 || column >= CELL_GRID_COLUMNS || row < 0 || row >= CELL_GRID_ROWS) return null;
  return [row, column];
};

const gridCoordinate = (coordinate: [number, number]): [number, number] => [
  (coordinate[0] - FIRST_CELL_CENTER[0]) / CELL_COLUMN_STEP,
  (coordinate[1] - FIRST_CELL_CENTER[1]) / CELL_ROW_STEP,
];

const distanceSquaredToSegment = (point: [number, number], start: [number, number], end: [number, number]): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return ((point[0] - start[0]) ** 2) + ((point[1] - start[1]) ** 2);
  const ratio = Math.max(0, Math.min(1, (((point[0] - start[0]) * dx) + ((point[1] - start[1]) * dy)) / ((dx * dx) + (dy * dy))));
  const closest: [number, number] = [start[0] + ratio * dx, start[1] + ratio * dy];
  return ((point[0] - closest[0]) ** 2) + ((point[1] - closest[1]) ** 2);
};

/** Returns cells whose centers fall within the paint radius of every tested stroke segment. */
export const cellIdsWithinPaintPath = (path: readonly [number, number][], radiusCells: number): string[] => {
  if (path.length === 0 || !Number.isFinite(radiusCells) || radiusCells < 0) return [];
  if (path.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < WORLD_EXTENT[0] || longitude > WORLD_EXTENT[2]
    || latitude < WORLD_EXTENT[1] || latitude > WORLD_EXTENT[3])) return [];
  const gridPath = path.map(gridCoordinate);
  const radiusSquared = radiusCells ** 2;
  let minPathColumn = Number.POSITIVE_INFINITY;
  let maxPathColumn = Number.NEGATIVE_INFINITY;
  let minPathRow = Number.POSITIVE_INFINITY;
  let maxPathRow = Number.NEGATIVE_INFINITY;
  for (const [column, row] of gridPath) {
    minPathColumn = Math.min(minPathColumn, column);
    maxPathColumn = Math.max(maxPathColumn, column);
    minPathRow = Math.min(minPathRow, row);
    maxPathRow = Math.max(maxPathRow, row);
  }
  const minColumn = Math.max(0, Math.floor(minPathColumn - radiusCells - 1.5));
  const maxColumn = Math.min(CELL_GRID_COLUMNS - 1, Math.ceil(maxPathColumn + radiusCells + 0.5));
  const minRow = Math.max(0, Math.floor(minPathRow - radiusCells - 1));
  const maxRow = Math.min(CELL_GRID_ROWS - 1, Math.ceil(maxPathRow + radiusCells));
  const selected: string[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      if (!cellCenterWithinWorld(row, column)) continue;
      const point: [number, number] = [column + (row % 2 === 0 ? 0 : 0.5), row];
      let distanceSquared = Number.POSITIVE_INFINITY;
      for (let index = 1; index < gridPath.length; index += 1) {
        distanceSquared = Math.min(distanceSquared, distanceSquaredToSegment(point, gridPath[index - 1]!, gridPath[index]!));
      }
      if (gridPath.length === 1) distanceSquared = distanceSquaredToSegment(point, gridPath[0]!, gridPath[0]!);
      if (distanceSquared <= radiusSquared) selected.push(cellId(row, column));
    }
  }
  return selected;
};

/** Returns a fixed hexagonal footprint centered on the cell under the pointer. */
export const cellIdsWithinPaintPosition = (position: [number, number], radiusCells: number): string[] => {
  if (!Number.isFinite(position[0]) || !Number.isFinite(position[1]) || !Number.isFinite(radiusCells) || radiusCells < 0
    || position[0] < WORLD_EXTENT[0] || position[0] > WORLD_EXTENT[2]
    || position[1] < WORLD_EXTENT[1] || position[1] > WORLD_EXTENT[3]) return [];
  const [gridColumn, gridRow] = gridCoordinate(position);
  let centerRow = Math.round(gridRow);
  let centerColumn = Math.round(gridColumn - (centerRow % 2 === 0 ? 0 : 0.5));
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let row = Math.max(0, centerRow - 2); row <= Math.min(CELL_GRID_ROWS - 1, centerRow + 2); row += 1) {
    for (let column = Math.max(0, centerColumn - 2); column <= Math.min(CELL_GRID_COLUMNS - 1, centerColumn + 2); column += 1) {
      const candidate = [column + (row % 2 === 0 ? 0 : 0.5), row] as const;
      const distance = ((candidate[0] - gridColumn) ** 2) + ((candidate[1] - gridRow) ** 2);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        centerRow = row;
        centerColumn = column;
      }
    }
  }
  const radius = Math.floor(radiusCells);
  const centerAxialQ = centerColumn - (centerRow - (centerRow & 1)) / 2;
  const selected: string[] = [];
  for (let row = Math.max(0, centerRow - radius); row <= Math.min(CELL_GRID_ROWS - 1, centerRow + radius); row += 1) {
    for (let column = Math.max(0, centerColumn - radius - 1); column <= Math.min(CELL_GRID_COLUMNS - 1, centerColumn + radius + 1); column += 1) {
      if (!cellCenterWithinWorld(row, column)) continue;
      const axialQ = column - (row - (row & 1)) / 2;
      const axialR = row;
      const distance = Math.max(Math.abs(axialQ - centerAxialQ), Math.abs(axialR - centerRow), Math.abs((axialQ + axialR) - (centerAxialQ + centerRow)));
      if (distance <= radius) selected.push(cellId(row, column));
    }
  }
  return selected;
};
