import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { Eye } from "@phosphor-icons/react/dist/csr/Eye";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Stack } from "@phosphor-icons/react/dist/csr/Stack";
import { errorMessage, type CellAttributeSnapshot, type MapShape, type MapShapeEdit, type RealmBackend, type RealmSnapshot } from "../backend";
import { MapCanvas } from "./MapCanvas";
import { DEFAULT_ERASE_TARGET, eraseTargetDefinition, type EraseTarget } from "./editor/eraseTargets";
import { ObjectManager } from "./editor/ObjectManager";
import { mergeRegionShapes, splitRegionComponentShapes } from "./editor/editorMapOperations";
import { deriveRegionObjects, type RegionComponent, type RegionObject } from "./editor/regionObjects";
import { useEditorPersistence } from "./editor/useEditorPersistence";
import { mapErrorMessage } from "../locales/ja";
import { CELL_PAINT_RANGE_MAX, CELL_PAINT_RANGE_MIN } from "../map/MapAdapter";
import { applyGridSelectionToMapShapes, deriveMapGridCells } from "../shared/mapShapeGeometry";

type Tool = "terrain" | "region" | "erase" | "grab" | "shape";

type EditorShellProps = {
  snapshot: RealmSnapshot;
  backend: RealmBackend;
  busy: boolean;
  onSaved: (snapshot: RealmSnapshot) => void;
};

export function EditorShell({ snapshot, backend, busy, onSaved }: EditorShellProps) {
  const [activeTool, setActiveTool] = useState<Tool>("terrain");
  const [regionColor, setRegionColor] = useState("#7A6FA8");
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [regionPaintTargetId, setRegionPaintTargetId] = useState<string | null>(null);
  const [objectManagerOpen, setObjectManagerOpen] = useState(true);
  const [strokeRange, setStrokeRange] = useState(CELL_PAINT_RANGE_MIN);
  const [zoom, setZoom] = useState(1);
  const [previewMode, setPreviewMode] = useState(false);
  const activeToolRef = useRef<Tool>("terrain");
  const eraseTargetRef = useRef<EraseTarget>(DEFAULT_ERASE_TARGET);
  const {
    viewedSnapshot,
    mapShapes,
    error,
    setError,
    locked,
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
    },
    onOperationSettled: () => setSelectedCellIds([]),
  });
  const cellAttributes = useMemo(() => deriveMapGridCells(mapShapes) as CellAttributeSnapshot[], [mapShapes]);
  const regionObjects = useMemo(() => deriveRegionObjects(cellAttributes), [cellAttributes]);

  useEffect(() => {
    const knownIds = new Set(regionObjects.map((region) => region.id));
    setSelectedRegionIds((current) => current.filter((id) => knownIds.has(id)));
    setRegionPaintTargetId((current) => current && knownIds.has(current) ? current : null);
    setSelectedComponentId((current) => current && regionObjects.some((region) => region.components.some((component) => component.id === current)) ? current : null);
  }, [regionObjects]);

  const settings = viewedSnapshot.settings;
  const cellGridOptions = useMemo(() => ({ color: settings.gridColor, width: settings.gridWidth }), [settings.gridColor, settings.gridWidth]);
  const gridOptions = useMemo(() => ({ kind: "hex" as const, color: settings.gridColor, width: settings.gridWidth, spacingDegrees: settings.gridSpacing }), [settings.gridColor, settings.gridWidth, settings.gridSpacing]);

  const selectTool = (tool: Tool) => {
    activeToolRef.current = tool;
    setActiveTool(tool);
  };

  const selectEraseTarget = (target: EraseTarget) => {
    eraseTargetRef.current = target;
  };

  useEffect(() => {
    if (locked) setSelectedCellIds([]);
  }, [activeTool, locked]);

  const selectRegionObject = (region: RegionObject): void => {
    setSelectedRegionIds([region.id]);
    setSelectedComponentId(null);
    setSelectedCellIds(region.cellIds);
  };

  const selectRegionObjects = (regionIds: readonly string[]): void => {
    const ids = [...new Set(regionIds)];
    const cells = [...new Set(regionObjects.filter((region) => ids.includes(region.id)).flatMap((region) => region.cellIds))];
    setSelectedRegionIds(ids);
    setSelectedComponentId(null);
    setSelectedCellIds(cells);
  };

  const selectRegionComponent = (region: RegionObject, component: RegionComponent): void => {
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

  const addToRegion = (region: RegionObject): void => {
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
    if (locked) {
      setSelectedCellIds([]);
      return;
    }
    if (nextIds.length === 0) {
      setSelectedCellIds([]);
      return;
    }
    const attribute = tool === "region"
      ? "region"
      : tool === "erase"
        ? eraseTargetDefinition(eraseTargetRef.current).attribute
        : "terrain";
    const value = tool === "terrain" ? "terrain" : tool === "region" ? regionColor : null;
    const targetRegion = tool === "region" && regionPaintTargetId
      ? regionObjects.find((region) => region.id === regionPaintTargetId)
      : undefined;
    const regionId = tool === "region" ? targetRegion?.persistentId ?? crypto.randomUUID() : undefined;
    const clearRegion = tool === "erase" && attribute === "terrain";
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
    commitMapShapes(next, fallback, { normalize: false });
  };
  const commitShapeEdit = (edit: MapShapeEdit): void => {
    commitMapShapes(edit.shapes, activeToolRef.current === "shape" ? "領域を地形に合わせられませんでした。" : "図形を更新できませんでした。");
  };

  const mergeRegions = (): void => {
    const regions = selectedRegionIds.map((id) => regionObjects.find((region) => region.id === id)).filter((region): region is RegionObject => region !== undefined);
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
    commitMapShapes(shapes, "領域を統合できませんでした。");
  };

  const splitRegionComponent = (region: RegionObject, component: RegionComponent): void => {
    const newRegionId = crypto.randomUUID();
    const next = splitRegionComponentShapes(mapShapes, region, component, newRegionId);
    if (!next) return;
    setSelectedRegionIds([]);
    setSelectedComponentId(null);
    setRegionPaintTargetId(null);
    setSelectedCellIds([]);
    commitMapShapes(next, "領域の塊を分離できませんでした。");
  };

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
      if (locked || previewMode || event.altKey || event.shiftKey) return;
      if (key === "c" || key === "z") {
        event.preventDefault();
        selectTool("terrain");
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
  }, [backend, locked, previewMode, viewedSnapshot.canRedo, viewedSnapshot.canUndo]);

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
          <button className="object-manager-toggle" type="button" aria-label={objectManagerOpen ? "オブジェクトマネージャーを閉じる" : "オブジェクトマネージャーを開く"} title={objectManagerOpen ? "オブジェクトマネージャーを閉じる" : "オブジェクトマネージャーを開く"} aria-pressed={objectManagerOpen} onClick={() => setObjectManagerOpen((current) => !current)}><Stack aria-hidden="true" size={17} weight="bold" /></button>
        </nav>
      </header>
      <div className={`editor-body${objectManagerOpen ? "" : " object-manager-is-closed"}`}>
        <section className="map-region" aria-label="地形編集領域">
          <MapCanvas
            // Compatibility region objects remain in snapshots but are not
            // rendered or created by the cell-region editor.
            features={[]}
            mapShapes={mapShapes}
            mode={locked ? "pan" : activeTool === "erase" ? "cell-erase" : activeTool === "region" ? "cell-region" : activeTool === "grab" ? "grab" : activeTool === "shape" ? "shape" : "cell-select"}
            disabled={busy}
            cellAttributes={cellAttributes}
            selectedCellIds={selectedCellIds}
            themeId={settings.themeId}
            themeOverrides={settings.themeOverrides}
            showGrid={false}
            showCellGrid
            cellGridOptions={cellGridOptions}
            gridOptions={gridOptions}
            onCellSelect={applyCellSelection}
            onMapShapeEdit={commitShapeEdit}
            regionColor={regionColor}
            onToolChange={selectTool}
            onEraseTargetChange={selectEraseTarget}
            onRegionColorChange={changeRegionColor}
            preview={previewMode}
            onError={(code) => setError(mapErrorMessage(code, activeToolRef.current === "region" || (activeToolRef.current === "erase" && eraseTargetRef.current === "region") ? "region" : "terrain"))}
            onZoomChange={setZoom}
            strokeRange={strokeRange}
            zoom={zoom}
          />
          {error ? <p className="save-error" role="alert">{error}</p> : null}
        </section>
        {objectManagerOpen ? (
          <ObjectManager
            regions={regionObjects}
            selectedRegionIds={selectedRegionIds}
            selectedComponentId={selectedComponentId}
            regionPaintTargetId={regionPaintTargetId}
            disabled={locked || previewMode}
            onSelectRegion={selectRegionObject}
            onSelectionChange={selectRegionObjects}
            onSelectComponent={selectRegionComponent}
            onStartNewRegion={startNewRegion}
            onAddToRegion={addToRegion}
            onMergeRegions={mergeRegions}
            onSplitComponent={splitRegionComponent}
            onClose={() => setObjectManagerOpen(false)}
          />
        ) : null}
      </div>
    </main>
  );
}
