import { useEffect, useMemo } from "react";
import type { CellAttributeSnapshot, LayerId, MapShape, RealmFeature } from "../../backend";
import { canonicalValueSignature } from "../../canonicalValue";
import type {
  CellGridOptions,
  DrawingOptions,
  GridOptions,
  RealmMapMode,
  RealmMapRenderer,
} from "../../map/MapAdapter";
import type { MapThemeId, ThemeOverrides } from "../../map/themes";

type RendererRef = { current: RealmMapRenderer | null };

type RendererSyncOptions = {
  adapterRef: RendererRef;
  features: RealmFeature[];
  activeLayer: LayerId;
  themeId: MapThemeId;
  themeOverrides: ThemeOverrides;
  showGrid: boolean;
  gridOptions: GridOptions;
  showCellGrid: boolean;
  cellGridOptions: CellGridOptions;
  preview: boolean;
  drawingOptions: DrawingOptions;
  mapShapes: readonly MapShape[];
  cellAttributes: readonly CellAttributeSnapshot[];
  mode: RealmMapMode;
  selectedCellIds: readonly string[];
  effectivePaintRadius: number;
  eraseRadius: number;
  selectedFeatureIds: readonly string[];
  regionColor: string;
};

/** Synchronizes controlled React state into an existing renderer by value. */
export function useRendererSync({
  adapterRef,
  features,
  activeLayer,
  themeId,
  themeOverrides,
  showGrid,
  gridOptions,
  showCellGrid,
  cellGridOptions,
  preview,
  drawingOptions,
  mapShapes,
  cellAttributes,
  mode,
  selectedCellIds,
  effectivePaintRadius,
  eraseRadius,
  selectedFeatureIds,
  regionColor,
}: RendererSyncOptions): void {
  const featuresSignature = useMemo(() => canonicalValueSignature(features), [features]);
  const themeOverridesSignature = useMemo(() => canonicalValueSignature(themeOverrides), [themeOverrides]);
  const gridOptionsSignature = useMemo(() => canonicalValueSignature(gridOptions), [gridOptions]);
  const cellGridOptionsSignature = useMemo(() => canonicalValueSignature(cellGridOptions), [cellGridOptions]);
  const drawingOptionsSignature = useMemo(() => canonicalValueSignature(drawingOptions), [drawingOptions]);
  const mapShapesSignature = useMemo(() => canonicalValueSignature(mapShapes), [mapShapes]);
  const cellAttributesSignature = useMemo(() => canonicalValueSignature(cellAttributes), [cellAttributes]);
  const selectedCellIdsSignature = useMemo(() => canonicalValueSignature(selectedCellIds), [selectedCellIds]);
  const selectedFeatureIdsSignature = useMemo(() => canonicalValueSignature(selectedFeatureIds), [selectedFeatureIds]);

  useEffect(() => { adapterRef.current?.setFeatures(features); }, [adapterRef, featuresSignature]);
  useEffect(() => { adapterRef.current?.setActiveLayer?.(activeLayer); }, [adapterRef, activeLayer]);
  useEffect(() => { adapterRef.current?.setTheme(themeId); }, [adapterRef, themeId]);
  useEffect(() => { adapterRef.current?.setThemeOverrides(themeOverrides); }, [adapterRef, themeOverridesSignature]);
  useEffect(() => { adapterRef.current?.setGridVisible(showGrid); }, [adapterRef, showGrid]);
  useEffect(() => { adapterRef.current?.setGridOptions(gridOptions); }, [adapterRef, gridOptionsSignature]);
  useEffect(() => { adapterRef.current?.setCellGridVisible(showCellGrid); }, [adapterRef, showCellGrid]);
  useEffect(() => { adapterRef.current?.setCellGridOptions(cellGridOptions); }, [adapterRef, cellGridOptionsSignature]);
  useEffect(() => { adapterRef.current?.setPresentationMode?.(preview); }, [adapterRef, preview]);
  useEffect(() => { adapterRef.current?.setDrawingOptions(drawingOptions); }, [adapterRef, drawingOptionsSignature]);
  // Apply transient grid read-model attributes before mode changes so a save that switches
  // to pan cannot expose a stale erase preview for one render.
  useEffect(() => { adapterRef.current?.setCellAttributes(cellAttributes); }, [adapterRef, cellAttributesSignature]);
  useEffect(() => { adapterRef.current?.setMapShapes?.(mapShapes); }, [adapterRef, mapShapesSignature]);
  useEffect(() => { adapterRef.current?.setMode(mode); }, [adapterRef, mode]);
  useEffect(() => { adapterRef.current?.setSelectedCells(selectedCellIds); }, [adapterRef, selectedCellIdsSignature]);
  useEffect(() => { adapterRef.current?.setCellPaintRadius(effectivePaintRadius); }, [adapterRef, effectivePaintRadius]);
  useEffect(() => { adapterRef.current?.setCellEraseRadius(eraseRadius); }, [adapterRef, eraseRadius]);
  useEffect(() => { adapterRef.current?.setCellRegionColor?.(regionColor); }, [adapterRef, regionColor]);
  useEffect(() => { adapterRef.current?.setSelectedFeatures(selectedFeatureIds); }, [adapterRef, selectedFeatureIdsSignature]);
}
