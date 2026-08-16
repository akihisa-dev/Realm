import type { CellAttributeSnapshot } from "../../backend";
import { connectedCellComponents } from "../../map/regionGrab";
import { cellAttributeLayer } from "../../shared/realmContract";

export type RegionComponent = {
  id: string;
  cellIds: string[];
};

export type RegionEntry = {
  id: string;
  persistentId: string | null;
  label: string;
  color: string;
  cellIds: string[];
  components: RegionComponent[];
};

const DEFAULT_REGION_COLOR = "#7A6FA8";

const compareCellIds = (left: string, right: string): number => {
  const [leftX = 0, leftY = 0] = left.split(":").map(Number);
  const [rightX = 0, rightY = 0] = right.split(":").map(Number);
  return (leftY - rightY) || (leftX - rightX) || left.localeCompare(right);
};

const displayColor = (value: string): string => /^#[\da-f]{6}$/iu.test(value) ? value.toUpperCase() : DEFAULT_REGION_COLOR;

const isPersistentRegionId = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

/** Derives logical regions and their disconnected six-neighbor components. */
export const deriveRegionEntries = (attributes: readonly CellAttributeSnapshot[]): RegionEntry[] => {
  const grouped = new Map<string, { persistentId: string | null; color: string; cellIds: Set<string> }>();
  for (const attribute of attributes) {
    if (cellAttributeLayer(attribute) !== "region") continue;
    const identity = attribute.regionId?.trim() || attribute.value.trim();
    if (!identity) continue;
    const current = grouped.get(identity) ?? {
      persistentId: isPersistentRegionId(attribute.regionId) ? attribute.regionId.trim() : null,
      color: displayColor(attribute.value),
      cellIds: new Set<string>(),
    };
    current.cellIds.add(attribute.cellId);
    if (current.persistentId === null && isPersistentRegionId(attribute.regionId)) current.persistentId = attribute.regionId.trim();
    grouped.set(identity, current);
  }

  return [...grouped.entries()]
    .map(([id, value]) => {
      const cellIds = [...value.cellIds].sort(compareCellIds);
      const components = connectedCellComponents(cellIds).map((component, index) => ({ id: `${id}:${index + 1}`, cellIds: component }));
      return { id, persistentId: value.persistentId, label: "", color: value.color, cellIds, components };
    })
    .sort((left, right) => compareCellIds(left.cellIds[0] ?? "", right.cellIds[0] ?? "") || left.id.localeCompare(right.id))
    .map((region, index) => ({ ...region, label: `領域 ${index + 1}` }));
};
