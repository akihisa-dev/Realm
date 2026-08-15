import type { CellGridOptions } from "./contracts";

export const DEFAULT_CELL_GRID_OPTIONS: CellGridOptions = { color: "#d1d7dc", width: 0.65 };
export const TERRAIN_GRID_OPACITY = 0.32;
export const OUTSIDE_GRID_OPACITY = 0.28;
export const OUTSIDE_GRID_LINE_DASH = [1, 3];
export const terrainGridDotRadius = (width: number): number => Math.max(0.75, Math.min(1.75, width * 1.25));
export const colorWithOpacity = (color: string, opacity: number): string => {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
};
