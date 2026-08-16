import type { LayerId } from "../shared/realmContract";
import type { RealmMapMode } from "./contracts";

export const sameStringSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => left.size === right.size && [...left].every((value) => right.has(value));

export const modeAllowedForActiveLayer = (activeLayer: LayerId, mode: RealmMapMode): boolean => {
  if (activeLayer === "terrain") return mode === "pan" || mode === "cell-select" || mode === "cell-erase" || mode === "grab";
  if (activeLayer === "region") return mode === "pan" || mode === "cell-region" || mode === "cell-erase" || mode === "grab" || mode === "shape";
  return mode === "pan" || mode === "erase" || mode === "city" || mode === "text" || mode === "mountain" || mode === "forest";
};

export const objectPanForMode = (activeLayer: LayerId, preview: boolean, mode: RealmMapMode): boolean => mode === "pan" && activeLayer === "object" && !preview;
