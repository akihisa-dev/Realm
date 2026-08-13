import type { CellAttribute } from "../../shared/realmContract";
import { invalid } from "./errors";
export const EDITOR_GRID_COLUMNS = 128;
export const EDITOR_GRID_ROWS = 73;
export const GRID_VERSION = 2;
export function parseCellId(value: string): [number, number] { if (typeof value !== "string") throw invalid("A cell identifier must use x:y coordinates."); const parts = value.trim().split(":"); if (parts.length !== 2 || !/^\d+$/.test(parts[0]!) || !/^\d+$/.test(parts[1]!)) throw invalid("A cell identifier must use x:y coordinates."); const x = Number(parts[0]); const y = Number(parts[1]); if (x < 0 || x >= EDITOR_GRID_COLUMNS || y < 0 || y >= EDITOR_GRID_ROWS) throw invalid("A cell identifier is outside the world grid."); return [x, y]; }
export const cellId = (x: number, y: number): string => `${x}:${y}`;
export function normalizeCellIds(ids: string[]): [number, number][] { if (!Array.isArray(ids) || !ids.length || ids.length > 200_000) throw invalid("The cell selection is invalid."); const cells = ids.map(parseCellId).sort((a, b) => a[1] - b[1] || a[0] - b[0]); return cells.filter((cell, index) => index === 0 || cell[0] !== cells[index - 1]![0] || cell[1] !== cells[index - 1]![1]); }
export function validateCellValue(value: string | null): string | null { if (value === null) return null; if (typeof value !== "string") throw invalid("A cell attribute value is invalid."); const normalized = value.trim(); if (!normalized || [...normalized].length > 200) throw invalid("A cell attribute value is invalid."); return normalized; }
export function validateCellLayer(attribute: string): asserts attribute is CellAttribute { if (!(attribute === "terrain" || attribute === "forest" || attribute === "country" || attribute === "region")) throw invalid("The cell layer is invalid."); }
