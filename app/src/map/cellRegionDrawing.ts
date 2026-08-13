import Draw from "ol/interaction/Draw";
import type { StyleLike } from "ol/style/Style";
import type { Position, RealmFeature } from "../backend";
import { CELL_GRID_COLUMNS, CELL_GRID_ROWS, cellCenter } from "./gridGeometry";
import { geometryToGeoJson } from "./geoJsonGeometry";
import { mapErrorCode, type MapErrorCode } from "./errors";
import { selectFeatureIdsWithinLasso } from "./lassoSelection";

const cellCenters = (): Pick<RealmFeature, "id" | "geometry">[] => {
  const candidates: Pick<RealmFeature, "id" | "geometry">[] = [];
  for (let row = 0; row < CELL_GRID_ROWS; row += 1) {
    for (let column = 0; column < CELL_GRID_COLUMNS; column += 1) {
      candidates.push({ id: `${column}:${row}`, geometry: { type: "Point", coordinates: cellCenter(row, column) } });
    }
  }
  return candidates;
};

const CELL_CENTER_FEATURES = cellCenters();

export const cellIdsWithinRegionEnclosure = (ring: readonly Position[]): string[] =>
  selectFeatureIdsWithinLasso(CELL_CENTER_FEATURES, ring);

export const createCellRegionDraw = (options: {
  style: StyleLike | undefined;
  onSelect: (cellIds: readonly string[]) => void;
  onError: (code: MapErrorCode) => void;
}): Draw => {
  const draw = new Draw({ type: "Polygon", style: options.style });
  draw.setFreehand(true);
  draw.on("drawend", (event) => {
    const geometry = event.feature.getGeometry();
    if (!geometry) return;
    try {
      const encoded = geometryToGeoJson(geometry);
      options.onSelect(encoded.type === "Polygon" ? cellIdsWithinRegionEnclosure(encoded.coordinates[0] ?? []) : []);
    } catch (cause) {
      options.onError(mapErrorCode(cause));
    }
  });
  return draw;
};
