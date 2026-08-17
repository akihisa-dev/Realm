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
import type { ObjectKind } from "../backend";
import { createCellStyle, createObjectStyle } from "./styles";
import { mapTheme, type MapThemeId, type ThemeOverrides } from "./themes";
import { createTerrainPresentationStyle } from "./terrainPresentation";
import { boundedHexGrid, boundedSquareGrid, createGraticule, DEFAULT_GRID_OPTIONS, fixedCellGridLines } from "./gridLayers";
import type { CellGridOptions, GridOptions } from "./contracts";
import { colorWithOpacity, DEFAULT_CELL_GRID_OPTIONS, OUTSIDE_GRID_LINE_DASH, OUTSIDE_GRID_OPACITY, TERRAIN_GRID_OPACITY, terrainGridDotRadius } from "./mapAdapterPresentation";

type MapLayerRegistryOptions = {
  themeId: () => MapThemeId;
  themeOverrides: () => ThemeOverrides;
  objectKindVisible: (kind: ObjectKind | "terrain" | "region" | undefined) => boolean;
  assetUrl: (assetId: string | undefined) => string | undefined;
};

/**
 * Owns OpenLayers sources and layers without owning editor state or input
 * interactions.  The adapter only coordinates these layers with the current
 * renderer state and therefore does not need to construct or dispose each
 * visual resource itself.
 */
export class MapLayerRegistry {
  /** Canonical persisted render layers.  These are intentionally separate. */
  readonly terrainSource = new VectorSource({ wrapX: false });
  readonly regionSource = new VectorSource({ wrapX: false });
  readonly objectSource = new VectorSource({ wrapX: false });
  readonly cellSource = new VectorSource({ wrapX: false });
  readonly terrainOutlineSource = new VectorSource({ wrapX: false });
  /** Presentation-only terrain polygons. Canonical terrain stays outline-only in edit mode. */
  readonly terrainPreviewSource = new VectorSource({ wrapX: false });
  /** @deprecated The smooth names describe presentation, not ownership. */
  readonly terrainSmoothSource = this.terrainSource;
  /** @deprecated The smooth names describe presentation, not ownership. */
  readonly regionSmoothSource = this.regionSource;
  readonly cellGridSource = new VectorSource({ wrapX: false });
  readonly terrainCellGridSource = new VectorSource({ wrapX: false });
  readonly gridSource = new VectorSource({ wrapX: false });

  readonly objectStyle: ReturnType<typeof createObjectStyle>;
  readonly cellStyle: ReturnType<typeof createCellStyle>;
  readonly terrainLayer: VectorLayer;
  readonly regionLayer: VectorLayer;
  readonly objectLayer: VectorLayer;
  readonly cellLayer: VectorLayer;
  readonly terrainOutlineLayer: VectorLayer;
  readonly terrainPreviewLayer: VectorLayer;
  /** @deprecated The smooth names describe presentation, not ownership. */
  readonly terrainSmoothLayer: VectorLayer;
  /** @deprecated The smooth names describe presentation, not ownership. */
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
  private cellGridVisible = false;
  private presentationPreview = false;
  private regionSmoothHiddenIdentity: string | null = null;

  constructor(options: MapLayerRegistryOptions) {
    this.objectStyle = createObjectStyle(
      options.themeId,
      options.objectKindVisible,
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

    // These layers are static presentation projections. Keep their style
    // objects stable across redraws so a large world does not allocate a new
    // Fill/Stroke tree for every feature on every frame.
    let terrainStyleKey = "";
    let terrainStyle: Style | Style[] | undefined;
    let terrainPreviewStyleKey = "";
    let terrainPreviewStyle: Style | undefined;
    const regionStyles = new globalThis.Map<string, Style | Style[]>();
    const themeStateKey = (): string => JSON.stringify([options.themeId(), options.themeOverrides(), this.presentationPreview]);

    this.objectLayer = new VectorLayer({ source: this.objectSource, style: this.objectStyle, visible: true, zIndex: 20 });
    this.cellLayer = new VectorLayer({ source: this.cellSource, style: this.cellStyle, visible: true });
    this.terrainOutlineLayer = new VectorLayer({
      source: this.terrainOutlineSource,
      style: () => new Style({ stroke: new Stroke({ color: mapTheme(options.themeId(), options.themeOverrides()).landInk, width: 1.6, lineJoin: "miter", lineCap: "butt" }) }),
      visible: false,
      zIndex: 7,
    });
    this.terrainSmoothLayer = new VectorLayer({
      source: this.terrainSmoothSource,
      style: () => {
        const preview = this.presentationPreview;
        const theme = mapTheme(options.themeId(), options.themeOverrides());
        const key = themeStateKey();
        if (terrainStyleKey === key && terrainStyle) return terrainStyle;
        terrainStyleKey = key;
        if (!preview) {
          terrainStyle = new Style({ stroke: new Stroke({ color: theme.landInk, width: 1.6, lineJoin: "miter", lineCap: "butt" }) });
          return terrainStyle;
        }
        terrainStyle = [
          new Style({ stroke: new Stroke({ color: colorWithOpacity(theme.river, 0.18), width: 2.2, lineJoin: "round", lineCap: "round" }), zIndex: 8 }),
          new Style({ stroke: new Stroke({ color: colorWithOpacity(theme.boundary, 0.76), width: 1.05, lineJoin: "round", lineCap: "round" }), zIndex: 9 }),
        ];
        return terrainStyle;
      },
      visible: false,
      zIndex: 8,
    });
    this.terrainPreviewLayer = new VectorLayer({
      source: this.terrainPreviewSource,
      style: () => {
        if (!this.presentationPreview) return [];
        const theme = mapTheme(options.themeId(), options.themeOverrides());
        const key = themeStateKey();
        if (terrainPreviewStyleKey === key && terrainPreviewStyle) return terrainPreviewStyle;
        terrainPreviewStyleKey = key;
        terrainPreviewStyle = createTerrainPresentationStyle(theme);
        return terrainPreviewStyle;
      },
      visible: false,
      zIndex: 6,
    });
    this.regionSmoothLayer = new VectorLayer({
      source: this.regionSmoothSource,
      style: (feature) => {
        if (this.regionSmoothHiddenIdentity !== null && feature.get("regionIdentity") === this.regionSmoothHiddenIdentity) return [];
        const color = String(feature.get("regionColor"));
        const preview = this.presentationPreview;
        const key = `${themeStateKey()}\u0000${color}`;
        const cached = regionStyles.get(key);
        if (cached) return cached;
        const styles = !preview
          ? new Style({ fill: new Fill({ color: colorWithOpacity(color, 0.2) }), stroke: new Stroke({ color: colorWithOpacity(color, 0.78), width: 1, lineJoin: "miter", lineCap: "butt" }) })
          : [
            new Style({ fill: new Fill({ color: colorWithOpacity(color, 0.15) }), stroke: new Stroke({ color: colorWithOpacity(color, 0.48), width: 1.15, lineJoin: "round", lineCap: "round" }), zIndex: 10 }),
            new Style({ stroke: new Stroke({ color: colorWithOpacity(color, 0.62), width: 0.55, lineJoin: "round", lineCap: "round" }), zIndex: 11 }),
          ];
        if (regionStyles.size >= 256) regionStyles.clear();
        regionStyles.set(key, styles);
        return styles;
      },
      zIndex: 10,
    });
    this.terrainLayer = this.terrainSmoothLayer;
    this.regionLayer = this.regionSmoothLayer;
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

  get mapLayers(): [Graticule, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer, VectorLayer] {
    return [
      this.graticule,
      this.objectLayer,
      this.cellLayer,
      this.gridLayer,
      this.cellGridLayer,
      this.terrainCellGridLayer,
      this.terrainOutlineLayer,
      this.regionSmoothLayer,
      this.terrainSmoothLayer,
      this.terrainPreviewLayer,
    ];
  }

  invalidateTheme(): void {
    this.objectLayer.changed();
    this.cellLayer.changed();
    this.terrainOutlineLayer.changed();
    this.terrainSmoothLayer.changed();
    this.terrainPreviewLayer.changed();
    this.regionSmoothLayer.changed();
    this.graticule.changed();
    this.gridLayer.changed();
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.graticule.setVisible(visible && !this.presentationPreview && this.gridOptions.kind === "graticule");
    this.gridLayer.setVisible(visible && !this.presentationPreview && this.gridOptions.kind !== "graticule");
  }

  setCellGridVisible(visible: boolean): void {
    this.cellGridVisible = visible;
    this.cellGridLayer.setVisible(visible && !this.presentationPreview);
    this.terrainCellGridLayer.setVisible(visible && !this.presentationPreview);
  }

  setPresentationMode(preview: boolean): void {
    this.presentationPreview = preview;
    this.cellLayer.setVisible(!preview);
    this.terrainOutlineLayer.setVisible(false);
    this.terrainPreviewLayer.setVisible(preview && this.terrainPreviewSource.getFeatures().length > 0);
    this.setGridVisible(this.gridVisible);
    this.setCellGridVisible(this.cellGridVisible);
    this.terrainSmoothLayer.changed();
    this.terrainPreviewLayer.changed();
    this.regionSmoothLayer.changed();
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
    this.objectSource.clear();
    this.cellSource.clear();
    this.terrainOutlineSource.clear();
    map.removeLayer(this.terrainOutlineLayer);
    this.terrainPreviewSource.clear();
    map.removeLayer(this.terrainPreviewLayer);
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
