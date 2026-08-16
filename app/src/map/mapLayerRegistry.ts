import Feature from "ol/Feature";
import Map from "ol/Map";
import type Graticule from "ol/layer/Graticule";
import MultiLineString from "ol/geom/MultiLineString";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import type { RealmFeature } from "../backend";
import { createCellStyle, createFeatureStyle } from "./styles";
import { mapTheme, type MapThemeId, type ThemeOverrides } from "./themes";
import { boundedHexGrid, boundedSquareGrid, createGraticule, DEFAULT_GRID_OPTIONS, fixedCellGridLines } from "./gridLayers";
import type { CellGridOptions, GridOptions } from "./contracts";
import { colorWithOpacity, DEFAULT_CELL_GRID_OPTIONS, OUTSIDE_GRID_LINE_DASH, OUTSIDE_GRID_OPACITY, TERRAIN_GRID_OPACITY, terrainGridDotRadius } from "./mapAdapterPresentation";

type MapLayerRegistryOptions = {
  themeId: () => MapThemeId;
  themeOverrides: () => ThemeOverrides;
  featureVisible: (featureType: RealmFeature["featureType"] | undefined) => boolean;
  assetUrl: (assetId: string | undefined) => string | undefined;
};

/**
 * Owns OpenLayers sources and layers without owning editor state or input
 * interactions.  The adapter only coordinates these layers with the current
 * renderer state and therefore does not need to construct or dispose each
 * visual resource itself.
 */
export class MapLayerRegistry {
  readonly featureSource = new VectorSource({ wrapX: false });
  readonly cellSource = new VectorSource({ wrapX: false });
  readonly terrainOutlineSource = new VectorSource({ wrapX: false });
  readonly terrainSmoothSource = new VectorSource({ wrapX: false });
  readonly regionSmoothSource = new VectorSource({ wrapX: false });
  readonly cellGridSource = new VectorSource({ wrapX: false });
  readonly terrainCellGridSource = new VectorSource({ wrapX: false });
  readonly gridSource = new VectorSource({ wrapX: false });

  readonly featureStyle: ReturnType<typeof createFeatureStyle>;
  readonly cellStyle: ReturnType<typeof createCellStyle>;
  readonly featureLayer: VectorLayer;
  readonly cellLayer: VectorLayer;
  readonly terrainOutlineLayer: VectorLayer;
  readonly terrainSmoothLayer: VectorLayer;
  readonly regionSmoothLayer: VectorLayer;
  readonly cellGridLayer: VectorLayer;
  readonly terrainCellGridLayer: VectorLayer;
  readonly gridLayer: VectorLayer;
  readonly fixedCellGridLines = fixedCellGridLines();
  readonly cellGridStroke: Stroke;
  readonly terrainCellGridDot: CircleStyle;
  readonly gridStroke: Stroke;

  private graticule: Graticule;
  private gridOptions: GridOptions = { ...DEFAULT_GRID_OPTIONS };
  private gridVisible = true;
  private regionSmoothHiddenIdentity: string | null = null;

  constructor(options: MapLayerRegistryOptions) {
    this.featureStyle = createFeatureStyle(
      options.themeId,
      options.featureVisible,
      options.assetUrl,
      options.themeOverrides,
    );
    this.cellStyle = createCellStyle(options.themeId, options.themeOverrides);
    this.graticule = createGraticule(this.gridOptions);
    this.cellGridStroke = new Stroke({
      color: colorWithOpacity(DEFAULT_CELL_GRID_OPTIONS.color, OUTSIDE_GRID_OPACITY),
      width: DEFAULT_CELL_GRID_OPTIONS.width,
      lineDash: OUTSIDE_GRID_LINE_DASH,
      lineCap: "round",
    });
    this.terrainCellGridDot = new CircleStyle({
      radius: terrainGridDotRadius(DEFAULT_CELL_GRID_OPTIONS.width),
      fill: new Fill({ color: colorWithOpacity(DEFAULT_CELL_GRID_OPTIONS.color, TERRAIN_GRID_OPACITY) }),
    });

    this.featureLayer = new VectorLayer({ source: this.featureSource, style: this.featureStyle });
    this.cellLayer = new VectorLayer({ source: this.cellSource, style: this.cellStyle, visible: true });
    this.terrainOutlineLayer = new VectorLayer({
      source: this.terrainOutlineSource,
      style: () => new Style({ stroke: new Stroke({ color: mapTheme(options.themeId(), options.themeOverrides()).landInk, width: 1.6 }) }),
      visible: false,
      zIndex: 7,
    });
    this.terrainSmoothLayer = new VectorLayer({
      source: this.terrainSmoothSource,
      style: () => new Style({ stroke: new Stroke({ color: mapTheme(options.themeId(), options.themeOverrides()).landInk, width: 1.8, lineJoin: "round", lineCap: "round" }) }),
      visible: false,
      zIndex: 8,
    });
    this.regionSmoothLayer = new VectorLayer({
      source: this.regionSmoothSource,
      style: (feature) => {
        if (this.regionSmoothHiddenIdentity !== null && feature.get("regionIdentity") === this.regionSmoothHiddenIdentity) return [];
        const color = String(feature.get("regionColor"));
        return new Style({ fill: new Fill({ color: colorWithOpacity(color, 0.2) }), stroke: new Stroke({ color: colorWithOpacity(color, 0.78), width: 1.1, lineJoin: "round", lineCap: "round" }) });
      },
      zIndex: 6,
    });
    this.cellGridSource.addFeature(new Feature({ geometry: new MultiLineString(this.fixedCellGridLines) }));
    this.cellGridLayer = new VectorLayer({
      source: this.cellGridSource,
      style: new Style({ stroke: this.cellGridStroke }),
      visible: false,
      zIndex: 4,
    });
    this.terrainCellGridLayer = new VectorLayer({
      source: this.terrainCellGridSource,
      style: new Style({ image: this.terrainCellGridDot }),
      visible: false,
      zIndex: 4,
    });
    this.gridStroke = new Stroke({ color: DEFAULT_GRID_OPTIONS.color, width: DEFAULT_GRID_OPTIONS.width });
    this.gridLayer = new VectorLayer({ source: this.gridSource, style: new Style({ stroke: this.gridStroke }), zIndex: -10, visible: false });
  }

  get mapLayers(): [Graticule, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer] {
    return [
      this.graticule,
      this.featureLayer,
      this.cellLayer,
      this.gridLayer,
      this.cellGridLayer,
      this.terrainCellGridLayer,
      this.terrainOutlineLayer,
      this.regionSmoothLayer,
      this.terrainSmoothLayer,
    ];
  }

  invalidateTheme(): void {
    this.featureLayer.changed();
    this.cellLayer.changed();
    this.terrainOutlineLayer.changed();
    this.terrainSmoothLayer.changed();
    this.graticule.changed();
    this.gridLayer.changed();
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.graticule.setVisible(visible && this.gridOptions.kind === "graticule");
    this.gridLayer.setVisible(visible && this.gridOptions.kind !== "graticule");
  }

  setGridOptions(map: Map, options: GridOptions): void {
    if (options.kind !== "graticule" && options.kind !== "square" && options.kind !== "hex") throw new Error("Grid kind must be graticule, square, or hex.");
    if (!/^#[\da-f]{6}$/i.test(options.color)) throw new Error("Grid color must be a #RRGGBB value.");
    if (!Number.isFinite(options.width) || options.width < 0.25 || options.width > 4) throw new Error("Grid width must be between 0.25 and 4.");
    if (!Number.isFinite(options.spacingDegrees) || options.spacingDegrees < 2 || options.spacingDegrees > 45) throw new Error("Grid spacing must be between 2 and 45 degrees.");
    this.gridOptions = { ...options };
    this.gridStroke.setColor(options.color);
    this.gridStroke.setWidth(options.width);
    this.gridSource.clear();
    if (options.kind === "square") this.gridSource.addFeatures(boundedSquareGrid(options.spacingDegrees));
    if (options.kind === "hex") this.gridSource.addFeatures(boundedHexGrid(options.spacingDegrees));
    this.gridLayer.changed();
    if (options.kind === "graticule") {
      const previous = this.graticule;
      this.graticule = createGraticule(options);
      map.removeLayer(previous);
      map.getLayers().insertAt(0, this.graticule);
      previous.dispose();
    }
    this.setGridVisible(this.gridVisible);
  }

  setCellGridOptions(options: CellGridOptions): void {
    if (!/^#[\da-f]{6}$/i.test(options.color)) throw new Error("Cell grid color must be a #RRGGBB value.");
    if (!Number.isFinite(options.width) || options.width < 0.25 || options.width > 4) throw new Error("Cell grid width must be between 0.25 and 4.");
    this.cellGridStroke.setColor(colorWithOpacity(options.color, OUTSIDE_GRID_OPACITY));
    this.cellGridStroke.setWidth(options.width);
    this.terrainCellGridDot.getFill()?.setColor(colorWithOpacity(options.color, TERRAIN_GRID_OPACITY));
    this.terrainCellGridDot.setRadius(terrainGridDotRadius(options.width));
    this.cellGridLayer.changed();
    this.terrainCellGridLayer.changed();
  }

  dispose(map: Map): void {
    this.featureSource.clear();
    this.cellSource.clear();
    this.terrainOutlineSource.clear();
    map.removeLayer(this.terrainOutlineLayer);
    this.terrainSmoothSource.clear();
    map.removeLayer(this.terrainSmoothLayer);
    this.regionSmoothSource.clear();
    map.removeLayer(this.regionSmoothLayer);
    this.gridSource.clear();
    map.removeLayer(this.gridLayer);
    this.cellGridSource.clear();
    map.removeLayer(this.cellGridLayer);
    this.terrainCellGridSource.clear();
    map.removeLayer(this.terrainCellGridLayer);
  }
}
