import type { ContentKind } from "../shared/realmContract";
import type { RealmMapMode } from "./contracts";

export const sameStringSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => left.size === right.size && [...left].every((value) => right.has(value));

export const modeAllowedForActiveLayer = (activeKind: ContentKind, mode: RealmMapMode): boolean => {
  if (activeKind === "terrain") return mode === "pan" || mode === "cell-select" || mode === "cell-region" || mode === "cell-erase" || mode === "grab";
  if (activeKind === "region") return mode === "pan" || mode === "cell-select" || mode === "cell-region" || mode === "cell-erase" || mode === "grab" || mode === "shape";
  return mode === "pan" || mode === "grab" || mode === "erase" || mode === "city" || mode === "text" || mode === "mountain" || mode === "forest";
};

export const objectGrabForMode = (activeKind: ContentKind, preview: boolean, mode: RealmMapMode): boolean => mode === "grab" && activeKind === "object" && !preview;
