import { useEffect } from "react";
import type { CellAttributeSnapshot, RealmFeature } from "../../backend";
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
  themeId: MapThemeId;
  themeOverrides: ThemeOverrides;
  showGrid: boolean;
  gridOptions: GridOptions;
  showCellGrid: boolean;
  cellGridOptions: CellGridOptions;
  drawingOptions: DrawingOptions;
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
  themeId,
  themeOverrides,
  showGrid,
  gridOptions,
  showCellGrid,
  cellGridOptions,
  drawingOptions,
  cellAttributes,
  mode,
  selectedCellIds,
  effectivePaintRadius,
  eraseRadius,
  selectedFeatureIds,
  regionColor,
}: RendererSyncOptions): void {
  const featuresSignature = canonicalValueSignature(features);
  const themeOverridesSignature = canonicalValueSignature(themeOverrides);
  const gridOptionsSignature = canonicalValueSignature(gridOptions);
  const cellGridOptionsSignature = canonicalValueSignature(cellGridOptions);
  const drawingOptionsSignature = canonicalValueSignature(drawingOptions);
  const cellAttributesSignature = canonicalValueSignature(cellAttributes);
  const selectedCellIdsSignature = canonicalValueSignature(selectedCellIds);
  const selectedFeatureIdsSignature = canonicalValueSignature(selectedFeatureIds);

  useEffect(() => { adapterRef.current?.setFeatures(features); }, [adapterRef, featuresSignature]);
  useEffect(() => { adapterRef.current?.setTheme(themeId); }, [adapterRef, themeId]);
  useEffect(() => { adapterRef.current?.setThemeOverrides(themeOverrides); }, [adapterRef, themeOverridesSignature]);
  useEffect(() => { adapterRef.current?.setGridVisible(showGrid); }, [adapterRef, showGrid]);
  useEffect(() => { adapterRef.current?.setGridOptions(gridOptions); }, [adapterRef, gridOptionsSignature]);
  useEffect(() => { adapterRef.current?.setCellGridVisible(showCellGrid); }, [adapterRef, showCellGrid]);
  useEffect(() => { adapterRef.current?.setCellGridOptions(cellGridOptions); }, [adapterRef, cellGridOptionsSignature]);
  useEffect(() => { adapterRef.current?.setDrawingOptions(drawingOptions); }, [adapterRef, drawingOptionsSignature]);
  // Apply semantic cell attributes before mode changes so a save that switches
  // to pan cannot expose a stale erase preview for one render.
  useEffect(() => { adapterRef.current?.setCellAttributes(cellAttributes); }, [adapterRef, cellAttributesSignature]);
  useEffect(() => { adapterRef.current?.setMode(mode); }, [adapterRef, mode]);
  useEffect(() => { adapterRef.current?.setSelectedCells(selectedCellIds); }, [adapterRef, selectedCellIdsSignature]);
  useEffect(() => { adapterRef.current?.setCellPaintRadius(effectivePaintRadius); }, [adapterRef, effectivePaintRadius]);
  useEffect(() => { adapterRef.current?.setCellEraseRadius(eraseRadius); }, [adapterRef, eraseRadius]);
  useEffect(() => { adapterRef.current?.setCellRegionColor?.(regionColor); }, [adapterRef, regionColor]);
  useEffect(() => { adapterRef.current?.setSelectedFeatures(selectedFeatureIds); }, [adapterRef, selectedFeatureIdsSignature]);
}
