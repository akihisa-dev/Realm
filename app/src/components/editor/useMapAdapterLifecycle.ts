import { useEffect, useRef, type RefObject } from "react";
import type { ApplyCellAttributesInput, CellAttributeSnapshot, GeoJsonGeometry, MapShape, MoveRegionCellsInput, RealmFeature } from "../../backend";
import type { MapRaster } from "../../exportArtifacts";
import type { ExportCanvasSize } from "../../map/contracts";
import type {
  CellGridOptions,
  DrawingOptions,
  GridOptions,
  RealmMapMode,
  RealmMapRenderer,
  RealmMapRendererFactory,
} from "../../map/MapAdapter";
import type { MapErrorCode } from "../../map/errors";
import type { MapThemeId, ThemeOverrides } from "../../map/themes";

type RendererRef = { current: RealmMapRenderer | null };

export type MapAdapterLifecycleOptions = {
  hostRef: RefObject<HTMLDivElement | null>;
  adapterRef: RendererRef;
  createRenderer: RealmMapRendererFactory;
  zoom: number | undefined;
  features: RealmFeature[];
  themeId: MapThemeId;
  themeOverrides: ThemeOverrides;
  showGrid: boolean;
  gridOptions: GridOptions;
  showCellGrid: boolean;
  cellGridOptions: CellGridOptions;
  drawingOptions: DrawingOptions;
  mapShapes: readonly MapShape[];
  cellAttributes: readonly CellAttributeSnapshot[];
  mode: RealmMapMode;
  selectedCellIds: readonly string[];
  effectivePaintRadius: number;
  eraseRadius: number;
  selectedFeatureIds: readonly string[];
  regionColor: string;
  onZoomChange: (zoom: number) => void;
  onDraw: ((geometry: GeoJsonGeometry) => void) | undefined;
  onSelect: ((featureId: string | null) => void) | undefined;
  onSelectFeatures: ((featureIds: readonly string[]) => void) | undefined;
  onCellSelect: ((cellIds: readonly string[]) => void) | undefined;
  onRegionMove: ((input: MoveRegionCellsInput) => void) | undefined;
  onRegionShape: ((input: ApplyCellAttributesInput) => void) | undefined;
  onCellResize: ((input: ApplyCellAttributesInput) => void) | undefined;
  onModify: ((featureId: string, geometry: GeoJsonGeometry) => void) | undefined;
  onModifyFeatures: ((changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => void) | undefined;
  onErase: ((featureId: string) => void) | undefined;
  onEraseFeatures: ((featureIds: readonly string[]) => void) | undefined;
  onLayerShift: ((direction: -1 | 1) => void) | undefined;
  onError: ((code: MapErrorCode) => void) | undefined;
  onExporterReady: ((exporter: ((mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: ExportCanvasSize) => Promise<MapRaster>) | null) => void) | undefined;
};

/**
 * Owns the OpenLayers adapter lifecycle while React retains only a renderer
 * contract ref. Callback refs keep a long-lived adapter connected to the
 * latest React handlers without recreating the map for every render.
 */
export function useMapAdapterLifecycle({
  hostRef,
  adapterRef,
  createRenderer,
  zoom,
  features,
  themeId,
  themeOverrides,
  showGrid,
  gridOptions,
  showCellGrid,
  cellGridOptions,
  drawingOptions,
  mapShapes,
  cellAttributes,
  mode,
  selectedCellIds,
  effectivePaintRadius,
  eraseRadius,
  selectedFeatureIds,
  regionColor,
  onZoomChange,
  onDraw,
  onSelect,
  onSelectFeatures,
  onCellSelect,
  onRegionMove,
  onRegionShape,
  onCellResize,
  onModify,
  onModifyFeatures,
  onErase,
  onEraseFeatures,
  onLayerShift,
  onError,
  onExporterReady,
}: MapAdapterLifecycleOptions): void {
  const onZoomChangeRef = useRef(onZoomChange);
  const onDrawRef = useRef(onDraw);
  const onSelectRef = useRef(onSelect);
  const onSelectFeaturesRef = useRef(onSelectFeatures);
  const onCellSelectRef = useRef(onCellSelect);
  const onRegionMoveRef = useRef(onRegionMove);
  const onRegionShapeRef = useRef(onRegionShape);
  const onCellResizeRef = useRef(onCellResize);
  const onModifyRef = useRef(onModify);
  const onModifyFeaturesRef = useRef(onModifyFeatures);
  const onEraseRef = useRef(onErase);
  const onEraseFeaturesRef = useRef(onEraseFeatures);
  const onLayerShiftRef = useRef(onLayerShift);
  const onErrorRef = useRef(onError);
  const onExporterReadyRef = useRef(onExporterReady);

  useEffect(() => { onZoomChangeRef.current = onZoomChange; }, [onZoomChange]);
  useEffect(() => { onDrawRef.current = onDraw; }, [onDraw]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onSelectFeaturesRef.current = onSelectFeatures; }, [onSelectFeatures]);
  useEffect(() => { onCellSelectRef.current = onCellSelect; }, [onCellSelect]);
  useEffect(() => { onRegionMoveRef.current = onRegionMove; }, [onRegionMove]);
  useEffect(() => { onRegionShapeRef.current = onRegionShape; }, [onRegionShape]);
  useEffect(() => { onCellResizeRef.current = onCellResize; }, [onCellResize]);
  useEffect(() => { onModifyRef.current = onModify; }, [onModify]);
  useEffect(() => { onModifyFeaturesRef.current = onModifyFeatures; }, [onModifyFeatures]);
  useEffect(() => { onEraseRef.current = onErase; }, [onErase]);
  useEffect(() => { onEraseFeaturesRef.current = onEraseFeatures; }, [onEraseFeatures]);
  useEffect(() => { onLayerShiftRef.current = onLayerShift; }, [onLayerShift]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onExporterReadyRef.current = onExporterReady; }, [onExporterReady]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const adapter = createRenderer({ target: host });
    adapterRef.current = adapter;
    onExporterReadyRef.current?.((mimeType, scale, extent, size) => adapter.exportRaster(mimeType, scale, extent, size));
    if (zoom !== undefined && Math.abs(adapter.getZoom() - zoom) > 0.01) adapter.setZoom(zoom);
    const stopZoomListener = adapter.onZoomChange((nextZoom) => onZoomChangeRef.current(nextZoom));
    const stopDrawListener = adapter.onDraw((geometry) => onDrawRef.current?.(geometry));
    const stopSelectListener = adapter.onSelectFeatures((featureIds) => {
      onSelectFeaturesRef.current?.(featureIds);
      onSelectRef.current?.(featureIds[0] ?? null);
    });
    const stopCellSelectListener = adapter.onCellSelect((cellIds) => onCellSelectRef.current?.(cellIds));
    const stopRegionMoveListener = adapter.onRegionMove?.((input) => onRegionMoveRef.current?.(input)) ?? (() => undefined);
    const stopRegionShapeListener = adapter.onRegionShape?.((input) => onRegionShapeRef.current?.(input)) ?? (() => undefined);
    const stopCellResizeListener = adapter.onCellResize?.((input) => onCellResizeRef.current?.(input)) ?? (() => undefined);
    const stopModifyListener = adapter.onModifyFeatures((changes) => {
      onModifyFeaturesRef.current?.(changes);
      if (!onModifyFeaturesRef.current) for (const { id, geometry } of changes) onModifyRef.current?.(id, geometry);
    });
    const stopEraseListener = adapter.onEraseFeatures((featureIds) => {
      onEraseFeaturesRef.current?.(featureIds);
      if (!onEraseFeaturesRef.current) for (const id of featureIds) onEraseRef.current?.(id);
    });
    const stopLayerShiftListener = adapter.onLayerShift((direction) => onLayerShiftRef.current?.(direction));
    const stopErrorListener = adapter.onError((code) => onErrorRef.current?.(code));

    adapter.setFeatures(features);
    adapter.setTheme(themeId);
    adapter.setThemeOverrides(themeOverrides);
    adapter.setGridVisible(showGrid);
    adapter.setGridOptions(gridOptions);
    adapter.setCellGridVisible(showCellGrid);
    adapter.setCellGridOptions(cellGridOptions);
    adapter.setMode(mode);
    adapter.setDrawingOptions(drawingOptions);
    adapter.setMapShapes?.(mapShapes);
    adapter.setCellAttributes(cellAttributes);
    adapter.setSelectedCells(selectedCellIds);
    adapter.setCellPaintRadius(effectivePaintRadius);
    adapter.setCellEraseRadius(eraseRadius);
    adapter.setCellRegionColor?.(regionColor);
    adapter.setSelectedFeatures(selectedFeatureIds);
    onZoomChangeRef.current(adapter.getZoom());

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => adapter.updateSize());
    resizeObserver?.observe(host);

    return () => {
      resizeObserver?.disconnect();
      stopZoomListener();
      stopDrawListener();
      stopSelectListener();
      stopCellSelectListener();
      stopRegionMoveListener();
      stopRegionShapeListener();
      stopCellResizeListener();
      stopModifyListener();
      stopEraseListener();
      stopLayerShiftListener();
      stopErrorListener();
      // Adapter.dispose owns OpenLayers target/listener cleanup, including
      // external pointerup, blur, pointercancel, and lost-capture paths.
      adapter.dispose();
      if (adapterRef.current === adapter) adapterRef.current = null;
      onExporterReadyRef.current?.(null);
    };
  }, [createRenderer]);

  useEffect(() => {
    if (zoom === undefined || !adapterRef.current) return;
    if (Math.abs(adapterRef.current.getZoom() - zoom) > 0.01) adapterRef.current.setZoom(zoom);
  }, [zoom]);

}
