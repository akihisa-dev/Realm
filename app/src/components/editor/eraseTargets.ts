export const ERASE_TARGETS = [
  { id: "terrain", label: "地形削除", attribute: "terrain" },
  { id: "region", label: "領域削除", attribute: "region" },
] as const;

export type EraseTarget = (typeof ERASE_TARGETS)[number]["id"];
export type EraseTargetDefinition = (typeof ERASE_TARGETS)[number];

export const DEFAULT_ERASE_TARGET: EraseTarget = ERASE_TARGETS[0].id;

export const eraseTargetDefinition = (target: EraseTarget): EraseTargetDefinition =>
  ERASE_TARGETS.find((definition) => definition.id === target) ?? ERASE_TARGETS[0];
