import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { Eye } from "@phosphor-icons/react/dist/csr/Eye";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Stack } from "@phosphor-icons/react/dist/csr/Stack";
import { errorMessage, type CellAttributeSnapshot, type LayerId, type MapObject, type MapShape, type MapShapeEdit, type ObjectKind, type RealmBackend, type RealmSnapshot } from "../backend";
import { MapCanvas } from "./MapCanvas";
import { LayerManager } from "./editor/LayerManager";
import { mergeRegionShapes, splitRegionComponentShapes } from "./editor/editorMapOperations";
import { deriveRegionEntries, type RegionComponent, type RegionEntry } from "./editor/regionObjects";
import { useEditorPersistence } from "./editor/useEditorPersistence";
import { mapErrorMessage } from "../locales/ja";
import { CELL_PAINT_RANGE_MAX, CELL_PAINT_RANGE_MIN } from "../map/MapAdapter";
import { applyGridSelectionToMapShapes, deriveMapGridCells } from "../shared/mapShapeGeometry";

type Tool = "terrain" | "region" | "object" | "select" | "erase" | "grab" | "shape";

type EditorShellProps = {
  snapshot: RealmSnapshot;
  backend: RealmBackend;
  busy: boolean;
  onSaved: (snapshot: RealmSnapshot) => void;
};

export function EditorShell({ snapshot, backend, busy, onSaved }: EditorShellProps) {
  const [activeTool, setActiveTool] = useState<Tool>("terrain");
  const [activeLayer, setActiveLayer] = useState<LayerId>("terrain");
  const [objectKind, setObjectKind] = useState<ObjectKind>("city");
  const [objectLabel, setObjectLabel] = useState("新しい都市");
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [regionColor, setRegionColor] = useState("#7A6FA8");
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [regionPaintTargetId, setRegionPaintTargetId] = useState<string | null>(null);
  const [layerManagerOpen, setLayerManagerOpen] = useState(true);
  const [strokeRange, setStrokeRange] = useState(CELL_PAINT_RANGE_MIN);
  const [zoom, setZoom] = useState(1);
  const [previewMode, setPreviewMode] = useState(false);
  const activeToolRef = useRef<Tool>("terrain");
  const {
    viewedSnapshot,
    mapShapes,
    error,
    setError,
    locked,
    editingLocked,
    run,
    commitMapShapes,
  } = useEditorPersistence({
    snapshot,
    backend,
    busy,
    onSaved,
    onProjectChanged: () => {
      setPreviewMode(false);
      setSelectedCellIds([]);
      setSelectedRegionIds([]);
      setSelectedComponentId(null);
      setRegionPaintTargetId(null);
      setSelectedObjectIds([]);
    },
    onOperationSettled: () => setSelectedCellIds([]),
  });
  const cellAttributes = useMemo(() => deriveMapGridCells(mapShapes) as CellAttributeSnapshot[], [mapShapes]);
  const regionEntries = useMemo(() => {
    const persisted = new Map(viewedSnapshot.layers.regions.map((region) => [region.id, region]));
    return deriveRegionEntries(cellAttributes).map((region) => {
      const saved = region.persistentId ? persisted.get(region.persistentId) : undefined;
      return saved ? { ...region, label: saved.name === "領域" ? region.label : saved.name, color: saved.color } : region;
    });
  }, [cellAttributes, viewedSnapshot.layers.regions]);

  useEffect(() => {
    const knownIds = new Set(regionEntries.map((region) => region.id));
    setSelectedRegionIds((current) => current.filter((id) => knownIds.has(id)));
    setRegionPaintTargetId((current) => current && knownIds.has(current) ? current : null);
    setSelectedComponentId((current) => current && regionEntries.some((region) => region.components.some((component) => component.id === current)) ? current : null);
  }, [regionEntries]);

  const settings = viewedSnapshot.settings;
  const cellGridOptions = useMemo(() => ({ color: settings.gridColor, width: settings.gridWidth }), [settings.gridColor, settings.gridWidth]);
  const gridOptions = useMemo(() => ({ kind: "hex" as const, color: settings.gridColor, width: settings.gridWidth, spacingDegrees: settings.gridSpacing }), [settings.gridColor, settings.gridWidth, settings.gridSpacing]);

  const selectTool = (tool: Tool) => {
    activeToolRef.current = tool;
    setActiveTool(tool);
  };

  const selectLayer = (layer: LayerId): void => {
    setActiveLayer(layer);
    setSelectedCellIds([]);
    setSelectedRegionIds([]);
    setSelectedComponentId(null);
    setRegionPaintTargetId(null);
    setSelectedObjectIds([]);
    selectTool(layer === "terrain" ? "terrain" : layer === "region" ? "region" : "object");
  };

  useEffect(() => {
    if (editingLocked) setSelectedCellIds([]);
  }, [activeTool, editingLocked]);

  const selectRegion = (region: RegionEntry): void => {
    setSelectedRegionIds([region.id]);
    setSelectedComponentId(null);
    setSelectedCellIds(region.cellIds);
  };

  const selectRegions = (regionIds: readonly string[]): void => {
    const ids = [...new Set(regionIds)];
    const cells = [...new Set(regionEntries.filter((region) => ids.includes(region.id)).flatMap((region) => region.cellIds))];
    setSelectedRegionIds(ids);
    setSelectedComponentId(null);
    setSelectedCellIds(cells);
  };

  const selectRegionComponent = (region: RegionEntry, component: RegionComponent): void => {
    setSelectedRegionIds([region.id]);
    setSelectedComponentId(component.id);
    setSelectedCellIds(component.cellIds);
  };

  const startNewRegion = (): void => {
    setRegionPaintTargetId(null);
    setSelectedRegionIds([]);
    setSelectedComponentId(null);
    setSelectedCellIds([]);
    selectTool("region");
  };

  const addToRegion = (region: RegionEntry): void => {
    if (!region.persistentId) return;
    setRegionPaintTargetId(region.id);
    setRegionColor(region.color);
    setSelectedRegionIds([region.id]);
    setSelectedComponentId(null);
    setSelectedCellIds([]);
    selectTool("region");
  };

  const changeRegionColor = (color: string): void => {
    setRegionColor(color);
    setRegionPaintTargetId(null);
    setSelectedRegionIds([]);
    setSelectedComponentId(null);
    setSelectedCellIds([]);
  };

  const applyCellSelection = (ids: readonly string[]) => {
    const nextIds = [...new Set(ids)];
    const tool = activeToolRef.current;
    if (editingLocked) {
      setSelectedCellIds([]);
      return;
    }
    if (nextIds.length === 0) {
      setSelectedCellIds([]);
      return;
    }
    if (activeLayer === "object") { setSelectedCellIds([]); return; }
    const attribute = activeLayer;
    const value = tool === "erase" ? null : activeLayer === "terrain" ? "terrain" : tool === "region" ? regionColor : null;
    const targetRegion = activeLayer === "region" && tool === "region" && regionPaintTargetId
      ? regionEntries.find((region) => region.id === regionPaintTargetId)
      : undefined;
    const regionId = activeLayer === "region" ? targetRegion?.persistentId ?? crypto.randomUUID() : undefined;
    const clearRegion = false;
    const fallback = "変更を保存できませんでした。変更は保存されていません。";
    let next: MapShape[];
    try {
      next = applyGridSelectionToMapShapes(mapShapes, { cellIds: nextIds, layer: attribute, value, ...(regionId ? { regionId } : {}), ...(clearRegion ? { clearRegion: true } : {}) });
    } catch (cause) {
      setSelectedCellIds([]);
      if (cause instanceof Error && cause.message === "セルを選択してください。") return;
      setError(errorMessage(cause, fallback));
      return;
    }
    setSelectedCellIds([]);
    // Cell selection already rebuilds complete, grid-snapped Polygon rows.
    // Do not reinterpret unrelated existing shapes a second time here.
    commitMapShapes(next, fallback, { normalize: false, layer: activeLayer === "region" ? "region" : "terrain" });
  };
  const commitShapeEdit = (edit: MapShapeEdit): void => {
    const untouched = mapShapes.filter((shape) => shape.layer !== activeLayer);
    commitMapShapes([...untouched, ...edit.shapes], activeToolRef.current === "shape" ? "領域を地形に合わせられませんでした。" : "図形を更新できませんでした。", { normalize: false, layer: activeLayer === "region" ? "region" : "terrain" });
  };

  const mergeRegions = (): void => {
    const regions = selectedRegionIds.map((id) => regionEntries.find((region) => region.id === id)).filter((region): region is RegionEntry => region !== undefined);
    const result = mergeRegionShapes(mapShapes, regions);
    if (!result) return;
    if (result.kind === "legacy") {
      setError("旧形式の領域は、先に新しい領域として描き直してください。");
      return;
    }
    const { target, shapes } = result;
    setSelectedRegionIds([target.id]);
    setSelectedComponentId(null);
    setRegionPaintTargetId(target.id);
    setRegionColor(target.color);
    setSelectedCellIds([]);
    commitMapShapes(shapes, "領域を統合できませんでした。", { normalize: false, layer: "region" });
  };

  const splitRegionComponent = (region: RegionEntry, component: RegionComponent): void => {
    const newRegionId = crypto.randomUUID();
    const next = splitRegionComponentShapes(mapShapes, region, component, newRegionId);
    if (!next) return;
    setSelectedRegionIds([]);
    setSelectedComponentId(null);
    setRegionPaintTargetId(null);
    setSelectedCellIds([]);
    commitMapShapes(next, "領域の塊を分離できませんでした。", { normalize: false, layer: "region" });
  };

  const currentObjects = viewedSnapshot.layers.objects;
  const startObjectDraw = (): void => { selectLayer("object"); selectTool("object"); };
  const createObject = (geometry: MapObject["geometry"]): void => {
    if (editingLocked || activeLayer !== "object") return;
    const fallback = "オブジェクトを保存できませんでした。";
    const object: MapObject = { id: crypto.randomUUID(), kind: objectKind, label: objectLabel.trim() || (objectKind === "city" ? "都市" : objectKind === "text" ? "テキスト" : objectKind === "forest" ? "森" : "山"), geometry, properties: {}, zIndex: currentObjects.length, locked: false };
    void run(() => backend.replaceObjectLayer({ objects: [...currentObjects, object] }), fallback);
  };
  const selectObjects = (ids: readonly string[]): void => { setSelectedObjectIds([...new Set(ids)]); };
  const modifyObjects = (changes: readonly { id: string; geometry: MapObject["geometry"] }[]): void => {
    if (activeLayer !== "object" || editingLocked) return;
    const byId = new Map(changes.map((change) => [change.id, change.geometry]));
    const objects = currentObjects.map((object) => byId.has(object.id) ? { ...object, geometry: byId.get(object.id)! } : object);
    void run(() => backend.replaceObjectLayer({ objects }), "オブジェクトを移動できませんでした。");
  };
  const eraseObjects = (ids: readonly string[]): void => {
    if (activeLayer !== "object" || editingLocked) return;
    const selected = new Set(ids);
    void run(() => backend.replaceObjectLayer({ objects: currentObjects.filter((object) => !selected.has(object.id)) }), "オブジェクトを削除できませんでした。");
  };
  const selectObjectFromPanel = (id: string): void => { selectLayer("object"); setActiveTool("select"); activeToolRef.current = "select"; setSelectedObjectIds([id]); };
  const deleteObjectFromPanel = (id: string): void => { eraseObjects([id]); };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      const redo = key === "y" || (key === "z" && event.shiftKey);
      const undo = key === "z" && !event.shiftKey;
      if (event.metaKey || event.ctrlKey) {
        if (locked || previewMode || (!undo && !redo) || (undo ? !viewedSnapshot.canUndo : !viewedSnapshot.canRedo)) return;
        event.preventDefault();
        void run(() => redo ? backend.redoProject() : backend.undoProject(), redo ? "操作を進められませんでした。" : "操作を戻せませんでした。");
        return;
      }
      if (editingLocked || previewMode || event.altKey || event.shiftKey) return;
      if (key === "c" || key === "z") {
        event.preventDefault();
        selectTool(activeLayer === "region" ? "region" : activeLayer === "object" ? "object" : "terrain");
      } else if (key === "e" || key === "x") {
        event.preventDefault();
        selectTool("erase");
      } else if (key === "g") {
        event.preventDefault();
        selectTool("grab");
      } else if (key === "s") {
        event.preventDefault();
        selectTool("shape");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeLayer, backend, editingLocked, locked, previewMode, viewedSnapshot.canRedo, viewedSnapshot.canUndo]);

  return (
    <main className="editor-shell" aria-label="Realm地形編集画面">
      <header className="editor-history" data-electron-drag-region="deep">
        <div className="editor-thickness-control" role="group" aria-label="描画と削除の太さ">
          <label htmlFor="editor-stroke-range">太さ</label>
          <input
            id="editor-stroke-range"
            type="range"
            min={CELL_PAINT_RANGE_MIN}
            max={CELL_PAINT_RANGE_MAX}
            step={1}
            value={strokeRange}
            aria-label="描画と削除の太さ"
            aria-valuetext={`太さ${strokeRange}セル`}
            onChange={(event) => setStrokeRange(Number(event.target.value))}
          />
          <output htmlFor="editor-stroke-range">{strokeRange}セル</output>
        </div>
        <nav aria-label="編集履歴">
          <button className="editor-preview-toggle" type="button" aria-label={previewMode ? "編集画面に戻る" : "レンダリングプレビューを表示"} title={previewMode ? "編集画面に戻る" : "レンダリングプレビューを表示"} aria-pressed={previewMode} onClick={() => setPreviewMode((current) => !current)}>
            {previewMode ? <PencilSimple aria-hidden="true" size={17} weight="bold" /> : <Eye aria-hidden="true" size={17} weight="bold" />}
          </button>
          <button type="button" aria-label="戻す" title="戻す" onClick={() => { void run(() => backend.undoProject(), "操作を戻せませんでした。"); }} disabled={locked || previewMode || !viewedSnapshot.canUndo}><ArrowCounterClockwise aria-hidden="true" size={17} weight="bold" /></button>
          <button type="button" aria-label="進む" title="進む" onClick={() => { void run(() => backend.redoProject(), "操作を進められませんでした。"); }} disabled={locked || previewMode || !viewedSnapshot.canRedo}><ArrowClockwise aria-hidden="true" size={17} weight="bold" /></button>
          <button className="layer-manager-toggle" type="button" aria-label={layerManagerOpen ? "レイヤー管理パネルを閉じる" : "レイヤー管理パネルを開く"} title={layerManagerOpen ? "レイヤー管理パネルを閉じる" : "レイヤー管理パネルを開く"} aria-pressed={layerManagerOpen} onClick={() => setLayerManagerOpen((current) => !current)}><Stack aria-hidden="true" size={17} weight="bold" /></button>
        </nav>
      </header>
      <div className={`editor-body${layerManagerOpen ? "" : " layer-manager-is-closed"}`}>
        <section className="map-region" aria-label="地形編集領域">
          <MapCanvas
            features={viewedSnapshot.features}
            activeLayer={activeLayer}
            mapShapes={mapShapes}
            mode={editingLocked || previewMode ? "pan" : activeLayer === "object" ? activeTool === "erase" ? "erase" : activeTool === "select" ? "pan" : objectKind : activeTool === "erase" ? "cell-erase" : activeTool === "region" ? "cell-region" : activeTool === "grab" ? "grab" : activeTool === "shape" ? "shape" : "cell-select"}
            disabled={busy}
            cellAttributes={cellAttributes}
            selectedCellIds={selectedCellIds}
            themeId={settings.themeId}
            themeOverrides={settings.themeOverrides}
            showGrid={false}
            showCellGrid={activeLayer !== "object"}
            cellGridOptions={cellGridOptions}
            gridOptions={gridOptions}
            onCellSelect={applyCellSelection}
            onMapShapeEdit={commitShapeEdit}
            onDraw={createObject}
            selectedFeatureIds={selectedObjectIds}
            onSelectFeatures={selectObjects}
            onModifyFeatures={modifyObjects}
            onEraseFeatures={eraseObjects}
            regionColor={regionColor}
            onToolChange={selectTool}
            onObjectKindChange={(kind) => { setObjectKind(kind); selectLayer("object"); selectTool("object"); }}
            onRegionColorChange={changeRegionColor}
            preview={previewMode}
            onError={(code) => setError(mapErrorMessage(code, activeLayer === "region" ? "region" : "terrain"))}
            onZoomChange={setZoom}
            strokeRange={strokeRange}
            zoom={zoom}
          />
          {error ? <p className="save-error" role="alert">{error}</p> : null}
        </section>
        {layerManagerOpen ? (
          <LayerManager
            activeLayer={activeLayer}
            onLayerChange={selectLayer}
            onClose={() => setLayerManagerOpen(false)}
            disabled={locked || previewMode}
            terrainCount={viewedSnapshot.layers.terrain.length}
            regions={regionEntries}
            selectedRegionIds={selectedRegionIds}
            selectedComponentId={selectedComponentId}
            regionPaintTargetId={regionPaintTargetId}
            onSelectRegion={selectRegion}
            onSelectionChange={selectRegions}
            onSelectComponent={selectRegionComponent}
            onStartNewRegion={startNewRegion}
            onAddToRegion={addToRegion}
            onMergeRegions={mergeRegions}
            onSplitComponent={splitRegionComponent}
            objects={currentObjects}
            selectedObjectIds={selectedObjectIds}
            objectKind={objectKind}
            objectLabel={objectLabel}
            onObjectKindChange={(kind) => { setObjectKind(kind); selectLayer("object"); selectTool("object"); }}
            onObjectLabelChange={setObjectLabel}
            onStartObjectDraw={startObjectDraw}
            onSelectObject={selectObjectFromPanel}
            onDeleteObject={deleteObjectFromPanel}
          />
        ) : null}
      </div>
    </main>
  );
}
