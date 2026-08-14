import PointerInteraction from "ol/interaction/Pointer";
import type { ApplyCellAttributesInput, CellAttributeSnapshot, Position } from "../backend";
import { sameRegionCells } from "./regionGrab";

type Options = {
  cellAt: (position: Position) => string | null;
  attributes: () => ReadonlyMap<string, readonly CellAttributeSnapshot[]>;
  emit: (input: ApplyCellAttributesInput) => void;
};

/** Emits one region clear for the non-terrain cells in a clicked logical region. */
export class RegionShapeController {
  readonly interaction: PointerInteraction;
  private pressedCell: string | null = null;

  constructor(options: Options) {
    this.interaction = new PointerInteraction({
      handleDownEvent: (event) => {
        const pointer = event.originalEvent as PointerEvent;
        if (!pointer.isPrimary || pointer.button !== 0) return false;
        const cellId = options.cellAt(event.coordinate as Position);
        if (!cellId || !options.attributes().get(cellId)?.some((item) => item.attribute === "region")) return false;
        this.pressedCell = cellId;
        return true;
      },
      handleUpEvent: (event) => {
        const pressedCell = this.pressedCell;
        const releasedCell = options.cellAt(event.coordinate as Position);
        this.pressedCell = null;
        if (!pressedCell || releasedCell !== pressedCell) return false;
        const attributes = options.attributes();
        const outsideTerrainIds = sameRegionCells(pressedCell, attributes)
          .filter((id) => !attributes.get(id)?.some((item) => item.attribute === "terrain"));
        if (outsideTerrainIds.length > 0) options.emit({ cellIds: outsideTerrainIds, attribute: "region", value: null });
        return false;
      },
    });
  }

  cancel(): void {
    this.pressedCell = null;
    this.interaction.setActive(false);
    this.interaction.setActive(true);
  }

  dispose(): void {
    this.cancel();
    this.interaction.dispose();
  }
}
