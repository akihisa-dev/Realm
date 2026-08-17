import { useEffect, useRef, type RefObject } from "react";
import type { ActiveKind, CellAttributeSnapshot, GeoJsonGeometry, LayerId, LayerTree, MapObject, MapShape, MapShapeEdit } from "../../backend";
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
  objects: MapObject[];
  activeLayer: LayerId;
  activeKind: ActiveKind;
  layerTree?: LayerTree;
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
  selectedObjectIds: readonly string[];
  regionColor: string;
  onZoomChange: (zoom: number) => void;
  onDraw: ((geometry: GeoJsonGeometry) => void) | undefined;
  onSelect: ((featureId: string | null) => void) | undefined;
  onSelectObjects: ((objectIds: readonly string[]) => void) | undefined;
  onCellSelect: ((cellIds: readonly string[]) => void) | undefined;
  onMapShapeEdit: ((edit: MapShapeEdit) => void) | undefined;
  onModify: ((featureId: string, geometry: GeoJsonGeometry) => void) | undefined;
  onModifyObjects: ((changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => void) | undefined;
  onErase: ((featureId: string) => void) | undefined;
  onEraseObjects: ((objectIds: readonly string[]) => void) | undefined;
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
  objects,
  activeLayer,
  activeKind,
  layerTree,
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
  selectedObjectIds,
  regionColor,
  onZoomChange,
  onDraw,
  onSelect,
  onSelectObjects,
  onCellSelect,
  onMapShapeEdit,
  onModify,
  onModifyObjects,
  onErase,
  onEraseObjects,
  onLayerShift,
  onError,
  onExporterReady,
}: MapAdapterLifecycleOptions): void {
  const onZoomChangeRef = useRef(onZoomChange);
  const onDrawRef = useRef(onDraw);
  const onSelectRef = useRef(onSelect);
  const onSelectObjectsRef = useRef(onSelectObjects);
  const onCellSelectRef = useRef(onCellSelect);
  const onMapShapeEditRef = useRef(onMapShapeEdit);
  const onModifyRef = useRef(onModify);
  const onModifyObjectsRef = useRef(onModifyObjects);
  const onEraseRef = useRef(onErase);
  const onEraseObjectsRef = useRef(onEraseObjects);
  const onLayerShiftRef = useRef(onLayerShift);
  const onErrorRef = useRef(onError);
  const onExporterReadyRef = useRef(onExporterReady);

  useEffect(() => { onZoomChangeRef.current = onZoomChange; }, [onZoomChange]);
  useEffect(() => { onDrawRef.current = onDraw; }, [onDraw]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onSelectObjectsRef.current = onSelectObjects; }, [onSelectObjects]);
  useEffect(() => { onCellSelectRef.current = onCellSelect; }, [onCellSelect]);
  useEffect(() => { onMapShapeEditRef.current = onMapShapeEdit; }, [onMapShapeEdit]);
  useEffect(() => { onModifyRef.current = onModify; }, [onModify]);
  useEffect(() => { onModifyObjectsRef.current = onModifyObjects; }, [onModifyObjects]);
  useEffect(() => { onEraseRef.current = onErase; }, [onErase]);
  useEffect(() => { onEraseObjectsRef.current = onEraseObjects; }, [onEraseObjects]);
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
    const stopSelectListener = adapter.onSelectObjects((objectIds) => {
      onSelectObjectsRef.current?.(objectIds);
      onSelectRef.current?.(objectIds[0] ?? null);
    });
    const stopCellSelectListener = adapter.onCellSelect((cellIds) => onCellSelectRef.current?.(cellIds));
    const stopMapShapeEditListener = adapter.onMapShapeEdit?.((edit) => onMapShapeEditRef.current?.(edit)) ?? (() => undefined);
    const stopModifyListener = adapter.onModifyObjects((changes) => {
      onModifyObjectsRef.current?.(changes);
      if (!onModifyObjectsRef.current) for (const { id, geometry } of changes) onModifyRef.current?.(id, geometry);
    });
    const stopEraseListener = adapter.onEraseObjects((objectIds) => {
      onEraseObjectsRef.current?.(objectIds);
      if (!onEraseObjectsRef.current) for (const id of objectIds) onEraseRef.current?.(id);
    });
    const stopLayerShiftListener = adapter.onLayerShift((direction) => onLayerShiftRef.current?.(direction));
    const stopErrorListener = adapter.onError((code) => onErrorRef.current?.(code));

    adapter.setObjects(objects);
    adapter.setActiveLayer(activeLayer);
    adapter.setActiveKind?.(activeKind);
    if (layerTree) adapter.setLayerTree?.(layerTree);
    adapter.setTheme(themeId);
    adapter.setThemeOverrides(themeOverrides);
    adapter.setGridVisible(showGrid);
    adapter.setGridOptions(gridOptions);
    adapter.setCellGridVisible(showCellGrid);
    adapter.setCellGridOptions(cellGridOptions);
    adapter.setPresentationMode?.(preview);
    adapter.setMode(mode);
    adapter.setDrawingOptions(drawingOptions);
    adapter.setMapShapes?.(mapShapes);
    adapter.setCellAttributes(cellAttributes);
    adapter.setSelectedCells(selectedCellIds);
    adapter.setCellPaintRadius(effectivePaintRadius);
    adapter.setCellEraseRadius(eraseRadius);
    adapter.setCellRegionColor?.(regionColor);
    adapter.setSelectedObjects(selectedObjectIds);
    onZoomChangeRef.current(adapter.getZoom());

    const updateMapSize = () => adapter.updateSize();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateMapSize);
    resizeObserver?.observe(host);
    updateMapSize();
    const animationFrame = host.ownerDocument.defaultView?.requestAnimationFrame(updateMapSize);

    return () => {
      resizeObserver?.disconnect();
      if (animationFrame !== undefined) host.ownerDocument.defaultView?.cancelAnimationFrame(animationFrame);
      stopZoomListener();
      stopDrawListener();
      stopSelectListener();
      stopCellSelectListener();
      stopMapShapeEditListener();
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

  useEffect(() => { adapterRef.current?.setActiveKind?.(activeKind); }, [adapterRef, activeKind]);
  useEffect(() => { if (layerTree) adapterRef.current?.setLayerTree?.(layerTree); }, [adapterRef, layerTree]);

  useEffect(() => {
    if (zoom === undefined || !adapterRef.current) return;
    if (Math.abs(adapterRef.current.getZoom() - zoom) > 0.01) adapterRef.current.setZoom(zoom);
  }, [zoom]);

}
