import type { CellAttributeSnapshot } from "../backend";
import { CELL_GRID_COLUMNS, CELL_GRID_ROWS, parseCellId } from "./gridGeometry";

/** Expands seeds through six-neighbor terrain cells without quadratic shift(). */
export const expandConnectedEraseCells = (
  cellAttributesById: ReadonlyMap<string, readonly CellAttributeSnapshot[]>,
  seedIds: readonly string[],
): string[] => {
  const terrain = new Set<string>();
  for (const [id, attributes] of cellAttributesById) {
    if (parseCellId(id) !== null && attributes.some((attribute) => attribute.attribute === "terrain" && attribute.value.trim().length > 0)) terrain.add(id);
  }
  const expanded = new Set<string>();
  const queue = [...seedIds];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    if (expanded.has(current) || !terrain.has(current)) continue;
    expanded.add(current);
    const parsed = parseCellId(current);
    if (!parsed) continue;
    const [row, column] = parsed;
    const neighbors: [number, number][] = row % 2 === 0
      ? [[row, column - 1], [row, column + 1], [row - 1, column - 1], [row - 1, column], [row + 1, column - 1], [row + 1, column]]
      : [[row, column - 1], [row, column + 1], [row - 1, column], [row - 1, column + 1], [row + 1, column], [row + 1, column + 1]];
    for (const [nextRow, nextColumn] of neighbors) {
      const id = nextRow >= 0 && nextRow < CELL_GRID_ROWS && nextColumn >= 0 && nextColumn < CELL_GRID_COLUMNS ? `${nextColumn}:${nextRow}` : null;
      if (id && !expanded.has(id) && terrain.has(id)) queue.push(id);
    }
  }
  return [...expanded];
};
