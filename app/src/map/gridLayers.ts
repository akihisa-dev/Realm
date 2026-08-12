import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Graticule from "ol/layer/Graticule";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Text from "ol/style/Text";
import type { Position } from "../backend";
import { CELL_GRID_COLUMNS, CELL_GRID_ROWS, cellPolygon as gridCellPolygon } from "./gridGeometry";
import { MAP_LABEL_FONT } from "./styles";
import type { GridOptions } from "./contracts";

export const MAX_GRID_EDGES = 20_000;
export const DEFAULT_GRID_OPTIONS: GridOptions = { kind: "graticule", color: "#687784", width: 1, spacingDegrees: 10 };

export const fixedCellGridLines = (): Position[][] => {
  const lines: Position[][] = [];
  const seen = new Set<string>();
  for (let row = 0; row < CELL_GRID_ROWS; row += 1) {
    for (let column = 0; column < CELL_GRID_COLUMNS; column += 1) {
      const ring = gridCellPolygon(row, column);
      if (!ring) continue;
      for (let index = 1; index < ring.length; index += 1) {
        const first = ring[index - 1]!;
        const second = ring[index]!;
        const firstKey = `${first[0].toFixed(9)},${first[1].toFixed(9)}`;
        const secondKey = `${second[0].toFixed(9)},${second[1].toFixed(9)}`;
        const key = firstKey < secondKey ? `${firstKey}:${secondKey}` : `${secondKey}:${firstKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push([first, second]);
      }
    }
  }
  return lines;
};

export const createGraticule = (options: GridOptions): Graticule => new Graticule({
  strokeStyle: new Stroke({ color: options.color, lineDash: [4, 4], width: options.width }),
  intervals: [options.spacingDegrees],
  showLabels: true,
  targetSize: 170,
  lonLabelPosition: 0.96,
  latLabelPosition: 0.035,
  lonLabelStyle: new Text({
    font: MAP_LABEL_FONT,
    textBaseline: "bottom",
    fill: new Fill({ color: options.color }),
    stroke: new Stroke({ color: "#ffffff", width: 3 }),
  }),
  latLabelStyle: new Text({
    font: MAP_LABEL_FONT,
    textAlign: "start",
    textBaseline: "middle",
    fill: new Fill({ color: options.color }),
    stroke: new Stroke({ color: "#ffffff", width: 3 }),
  }),
  wrapX: false,
});

export const boundedSquareGrid = (spacing: number): Feature[] => {
  const features: Feature[] = [];
  let index = 0;
  for (let longitude = -180; longitude <= 180 + 1e-9; longitude += spacing) {
    features.push(new Feature({ geometry: new LineString([[longitude, -90], [longitude, 90]]) }));
    features[index++]!.setId(`square-v-${index}`);
  }
  for (let latitude = -90; latitude <= 90 + 1e-9; latitude += spacing) {
    features.push(new Feature({ geometry: new LineString([[-180, latitude], [180, latitude]]) }));
    features[index++]!.setId(`square-h-${index}`);
  }
  return features;
};

export const boundedHexGrid = (spacing: number): Feature[] => {
  const features: Feature[] = [];
  const seen = new Set<string>();
  const rowStep = spacing * 1.5;
  const columnStep = Math.sqrt(3) * spacing;
  let edgeIndex = 0;
  for (let row = 0, centerY = -90; centerY <= 90 + spacing && edgeIndex < MAX_GRID_EDGES; row += 1, centerY += rowStep) {
    const offset = row % 2 === 0 ? 0 : columnStep / 2;
    for (let centerX = -180 - columnStep; centerX <= 180 + columnStep && edgeIndex < MAX_GRID_EDGES; centerX += columnStep) {
      const cx = centerX + offset;
      const vertices: Position[] = [];
      for (let vertex = 0; vertex < 6; vertex += 1) {
        const angle = (Math.PI / 180) * (30 + vertex * 60);
        vertices.push([cx + spacing * Math.cos(angle), centerY + spacing * Math.sin(angle)]);
      }
      if (vertices.some(([x, y]) => x < -180 || x > 180 || y < -90 || y > 90)) continue;
      for (let vertex = 0; vertex < 6 && edgeIndex < MAX_GRID_EDGES; vertex += 1) {
        const first = vertices[vertex]!;
        const second = vertices[(vertex + 1) % 6]!;
        const key = `${first[0].toFixed(6)},${first[1].toFixed(6)}:${second[0].toFixed(6)},${second[1].toFixed(6)}`;
        const reverse = `${second[0].toFixed(6)},${second[1].toFixed(6)}:${first[0].toFixed(6)},${first[1].toFixed(6)}`;
        if (seen.has(key) || seen.has(reverse)) continue;
        seen.add(key);
        const feature = new Feature({ geometry: new LineString([first, second]) });
        feature.setId(`hex-edge-${edgeIndex}`);
        features.push(feature);
        edgeIndex += 1;
      }
    }
  }
  return features;
};

export type CellGridLineGeometry = ReturnType<typeof fixedCellGridLines>;
