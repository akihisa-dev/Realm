export const CELL_GRID_COLUMNS = 512;
export const CELL_GRID_ROWS = 256;
export const CELL_GRID_CELL_COUNT = CELL_GRID_COLUMNS * CELL_GRID_ROWS;
export const CELL_BRUSH_RADII = { small: 1, medium: 2, large: 4 } as const;
export type CellBrushSize = keyof typeof CELL_BRUSH_RADII;

/** Stable persisted identity: x (column) first, then y (row). */
export const cellId = (row: number, column: number): string => `${column}:${row}`;

export const cellCenter = (row: number, column: number): [number, number] => [
  -180 + ((column + 0.5) * 360) / CELL_GRID_COLUMNS,
  -90 + ((row + 0.5) * 180) / CELL_GRID_ROWS,
];

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
  ((coordinate[0] + 180) / 360) * CELL_GRID_COLUMNS - 0.5,
  ((coordinate[1] + 90) / 180) * CELL_GRID_ROWS - 0.5,
];

const distanceSquaredToSegment = (point: [number, number], start: [number, number], end: [number, number]): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return ((point[0] - start[0]) ** 2) + ((point[1] - start[1]) ** 2);
  const ratio = Math.max(0, Math.min(1, (((point[0] - start[0]) * dx) + ((point[1] - start[1]) * dy)) / ((dx * dx) + (dy * dy))));
  const closest: [number, number] = [start[0] + ratio * dx, start[1] + ratio * dy];
  return ((point[0] - closest[0]) ** 2) + ((point[1] - closest[1]) ** 2);
};

/** Returns cells whose centers fall within the brush radius of every tested stroke segment. */
export const cellIdsWithinBrushPath = (path: readonly [number, number][], radiusCells: number): string[] => {
  if (path.length === 0 || !Number.isFinite(radiusCells) || radiusCells < 0) return [];
  if (path.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude))) return [];
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
  const minColumn = Math.max(0, Math.floor(minPathColumn - radiusCells));
  const maxColumn = Math.min(CELL_GRID_COLUMNS - 1, Math.ceil(maxPathColumn + radiusCells));
  const minRow = Math.max(0, Math.floor(minPathRow - radiusCells));
  const maxRow = Math.min(CELL_GRID_ROWS - 1, Math.ceil(maxPathRow + radiusCells));
  const selected: string[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const point: [number, number] = [column, row];
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
