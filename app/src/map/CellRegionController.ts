import Feature from "ol/Feature";
import Draw from "ol/interaction/Draw";
import type { StyleLike } from "ol/style/Style";
import type { CellAttributeSnapshot } from "../backend";
import { CellRegionAnimator } from "./CellRegionAnimator";
import { createCellRegionDraw } from "./cellRegionDrawing";
import type { MapErrorCode } from "./errors";
import { cellAttributeLayer } from "../shared/realmContract";

type CellAttributesById = ReadonlyMap<string, readonly CellAttributeSnapshot[]>;
type CellPaintLayer = "terrain" | "region";

export class CellRegionController {
  private readonly animator: CellRegionAnimator;
  private color = "#7A6FA8";
  private layer: CellPaintLayer = "region";

  constructor(
    view: Window | null,
    private readonly style: (feature: Feature) => StyleLike | undefined,
  ) {
    this.animator = new CellRegionAnimator(view);
  }

  createDraw(onSelect: (cellIds: readonly string[]) => void, onError: (code: MapErrorCode) => void, layer: CellPaintLayer = "region"): Draw {
    this.layer = layer;
    return createCellRegionDraw({ style: this.style(this.previewFeature()), onSelect, onError });
  }

  setColor(color: string, draw: Draw | null): void {
    if (!/^#[\da-f]{6}$/i.test(color)) return;
    this.color = color.toUpperCase();
    draw?.getOverlay().setStyle(this.style(this.previewFeature()));
  }

  animateChanges(previous: CellAttributesById, next: CellAttributesById, getFeature: (id: string) => Feature | undefined): void {
    const changed = [...next.entries()]
      .filter(([id, values]) => {
        const after = values.find((attribute) => cellAttributeLayer(attribute) === "region")?.value;
        const before = previous.get(id)?.find((attribute) => cellAttributeLayer(attribute) === "region")?.value;
        return after !== undefined && after !== before;
      })
      .map(([id]) => getFeature(id))
      .filter((feature): feature is Feature => feature instanceof Feature);
    this.animator.animateChanges(changed);
  }

  dispose(): void {
    this.animator.dispose();
  }

  private previewFeature(): Feature {
    const properties = this.layer === "region"
      ? { fillColor: this.color, strokeColor: this.color, fillOpacity: 0.18 }
      : {};
    return new Feature({
      kind: this.layer,
      label: "",
      properties,
    });
  }
}
