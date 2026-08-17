import type { DatabaseSync } from "node:sqlite";
import {
  ProjectStore,
  equalState,
  type AssetRow,
  type CaptureStateOptions,
  type LayerNodeRow,
  type ObjectRow,
  type PersistentState,
  type RegionRow,
  type RegionShapeRow,
  type TerrainShapeRow,
} from "../storage/projectStore";

export type { AssetRow, CaptureStateOptions, LayerNodeRow, ObjectRow, PersistentState, RegionRow, RegionShapeRow, TerrainShapeRow };
export type { EditOperation } from "../storage/projectStore";

export function captureState(db: DatabaseSync, options: CaptureStateOptions = {}): PersistentState {
  return new ProjectStore(db).readState(options);
}

export function captureAssetBytes(db: DatabaseSync, state: PersistentState, ids: readonly string[]): void {
  new ProjectStore(db).captureAssetBytes(state, ids);
}

export function restoreState(db: DatabaseSync, state: PersistentState): void {
  new ProjectStore(db).restoreState(state);
}

export { equalState };
