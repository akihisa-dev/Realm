import type { CellAttributeSnapshot } from "../backend";
import { CELL_GRID_COLUMNS, CELL_GRID_ROWS, cellId, parseCellId } from "./gridGeometry";

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
export const connectedRegionCells = (startId: string, attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>): string[] => {
  const values = new Map<string, string>();
  for (const [id, items] of attributes) { const value = items.find((item) => item.attribute === "region")?.value; if (value !== undefined) values.set(id, value); }
  const color = values.get(startId); if (color === undefined) return [];
  const visited = new Set<string>([startId]); const queue = [startId];
  for (let index = 0; index < queue.length; index += 1) for (const next of adjacentIds(queue[index]!)) if (!visited.has(next) && values.get(next) === color) { visited.add(next); queue.push(next); }
  return [...visited].sort((left, right) => { const a = parseCellId(left)!; const b = parseCellId(right)!; return a[0] - b[0] || a[1] - b[1]; });
};
export const translateRegionCells = (sourceIds: readonly string[], sourceAnchor: string, targetAnchor: string): string[] | null => {
  const source = axialFor(sourceAnchor); const target = axialFor(targetAnchor); if (!source || !target || sourceIds.length === 0) return null;
  const delta: Axial = [target[0] - source[0], target[1] - source[1]];
  const translated = sourceIds.map((id) => { const axial = axialFor(id); return axial ? idForAxial([axial[0] + delta[0], axial[1] + delta[1]]) : null; });
  return translated.every((id): id is string => id !== null) ? translated : null;
};
export const clipRegionCellsToTerrain = (cellIds: readonly string[], attributes: ReadonlyMap<string, readonly CellAttributeSnapshot[]>): string[] =>
  cellIds.filter((id) => attributes.get(id)?.some((item) => item.attribute === "terrain") === true);
export const sameCellSet = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && right.every((id) => new Set(left).has(id));
