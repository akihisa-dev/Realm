import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorMessage, type ApplyCellAttributesInput, type CellAttributeSnapshot, type MoveRegionCellsInput, type RealmBackend, type RealmSnapshot } from "../backend";
import { MapCanvas } from "./MapCanvas";
import { DEFAULT_ERASE_TARGET, eraseTargetDefinition, type EraseTarget } from "./editor/eraseTargets";
import { ObjectManager } from "./editor/ObjectManager";
import { deriveRegionObjects, type RegionComponent, type RegionObject } from "./editor/regionObjects";
import { mapErrorMessage } from "../locales/ja";

type Tool = "terrain" | "region" | "erase" | "grab" | "shape";

type EditorShellProps = {
  snapshot: RealmSnapshot;
  backend: RealmBackend;
  busy: boolean;
  onSaved: (snapshot: RealmSnapshot) => void;
};

const enqueueSerial = <T,>(tail: { current: Promise<void> }, action: () => Promise<T>): Promise<T> => {
  const result = tail.current.then(action, action);
  tail.current = result.then(() => undefined, () => undefined);
  return result;
};

type RunOptions = {
  recover?: (identity: string) => Promise<void>;
  refreshOnSuccess?: boolean;
  isCurrent?: () => boolean;
};

export function EditorShell({ snapshot, backend, busy, onSaved }: EditorShellProps) {
  const [viewedSnapshot, setViewedSnapshot] = useState(snapshot);
  const [activeTool, setActiveTool] = useState<Tool>("terrain");
  const [regionColor, setRegionColor] = useState("#7A6FA8");
  const [cellAttributes, setCellAttributes] = useState<CellAttributeSnapshot[]>([]);
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [regionPaintTargetId, setRegionPaintTargetId] = useState<string | null>(null);
  const [objectManagerOpen, setObjectManagerOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [operating, setOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeToolRef = useRef<Tool>("terrain");
  const eraseTargetRef = useRef<EraseTarget>(DEFAULT_ERASE_TARGET);
  const viewedIdentity = useRef(`${snapshot.path}:${snapshot.world.id}`);
  const mounted = useRef(true);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const cellRequest = useRef(0);
  const cellMutation = useRef(0);
  const projectIdentity = `${snapshot.path}:${snapshot.world.id}`;
  const regionObjects = useMemo(() => deriveRegionObjects(cellAttributes), [cellAttributes]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    const identityChanged = viewedIdentity.current !== projectIdentity;
    viewedIdentity.current = projectIdentity;
    setViewedSnapshot(snapshot);
    if (identityChanged) {
      cellRequest.current += 1;
      setCellAttributes([]);
      setSelectedCellIds([]);
      setSelectedRegionIds([]);
      setSelectedComponentId(null);
      setRegionPaintTargetId(null);
      setError(null);
    }
  }, [projectIdentity, snapshot]);

  useEffect(() => {
    const knownIds = new Set(regionObjects.map((region) => region.id));
    setSelectedRegionIds((current) => current.filter((id) => knownIds.has(id)));
    setRegionPaintTargetId((current) => current && knownIds.has(current) ? current : null);
    setSelectedComponentId((current) => current && regionObjects.some((region) => region.components.some((component) => component.id === current)) ? current : null);
  }, [regionObjects]);

  const settings = viewedSnapshot.settings;
  const locked = busy || operating;
  const cellGridOptions = useMemo(() => ({ color: settings.gridColor, width: settings.gridWidth }), [settings.gridColor, settings.gridWidth]);
  const gridOptions = useMemo(() => ({ kind: "hex" as const, color: settings.gridColor, width: settings.gridWidth, spacingDegrees: settings.gridSpacing }), [settings.gridColor, settings.gridWidth, settings.gridSpacing]);

  const selectTool = (tool: Tool) => {
    activeToolRef.current = tool;
    setActiveTool(tool);
  };

  const selectEraseTarget = (target: EraseTarget) => {
    eraseTargetRef.current = target;
  };

  const refreshCellAttributes = async (identity: string): Promise<void> => {
    const request = ++cellRequest.current;
    const mutation = cellMutation.current;
    try {
      const attributes = await backend.viewCellAttributes({});
      const terrainAndRegions = attributes.filter((attribute) => attribute.attribute === "terrain" || attribute.attribute === "region");
      if (mounted.current && viewedIdentity.current === identity && cellRequest.current === request && cellMutation.current === mutation) setCellAttributes(terrainAndRegions);
    } catch (cause) {
      if (mounted.current && viewedIdentity.current === identity && cellRequest.current === request && cellMutation.current === mutation) setError(errorMessage(cause, "セル属性を読み込めませんでした。"));
    }
  };

  useEffect(() => {
    void refreshCellAttributes(projectIdentity);
  }, [backend, projectIdentity]);

  useEffect(() => {
    if (locked) setSelectedCellIds([]);
  }, [activeTool, locked]);

  const run = async (action: () => Promise<RealmSnapshot>, fallback: string, options: RunOptions = {}) => {
    await enqueueSerial(commandTail, async () => {
      const identity = projectIdentity;
      setOperating(true);
      setError(null);
      try {
        if (!mounted.current || viewedIdentity.current !== identity) return;
        const next = await action();
        if (!mounted.current || viewedIdentity.current !== identity) return;
        setViewedSnapshot(next);
        onSaved(next);
        if (options.refreshOnSuccess !== false) await refreshCellAttributes(identity);
        if (!options.isCurrent || options.isCurrent()) setSelectedCellIds([]);
      } catch (cause) {
        if (mounted.current && viewedIdentity.current === identity) {
          if (options.recover) await options.recover(identity);
          if (mounted.current && viewedIdentity.current === identity && (!options.isCurrent || options.isCurrent())) setError(errorMessage(cause, fallback));
        }
      } finally {
        if (mounted.current) setOperating(false);
      }
    });
  };

  const updateOptimisticCellAttributes = (cellIds: readonly string[], attribute: "terrain" | "region", value: string | null, regionId?: string, clearRegion = false): void => {
    // Invalidate an in-flight read before publishing the optimistic state. Its
    // old read result must not overwrite a newer paint operation.
    ++cellRequest.current;
    const selected = new Set(cellIds);
    setCellAttributes((current) => {
      const byCell = new Map(current.map((item) => [`${item.cellId}:${item.attribute}`, item]));
      if (value === null) {
        for (const cellId of selected) {
          byCell.delete(`${cellId}:${attribute}`);
          if (clearRegion) byCell.delete(`${cellId}:region`);
        }
      } else {
        for (const cellId of selected) byCell.set(`${cellId}:${attribute}`, { cellId, attribute, value, ...(attribute === "region" && regionId ? { regionId } : {}) });
      }
      return [...byCell.values()];
    });
  };

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
    const mutation = ++cellMutation.current;
    updateOptimisticCellAttributes(nextIds, attribute, value, regionId, clearRegion);
    // Completed strokes are represented immediately by the optimistic terrain
    // outline. Keep controlled selection empty so only pointer hover can show
    // a transient fill after commit.
    setSelectedCellIds([]);
    const input: ApplyCellAttributesInput = { cellIds: nextIds, attribute, value, ...(regionId ? { regionId } : {}), ...(clearRegion ? { clearRegion: true } : {}) };
    void run(
      () => backend.applyCellAttributes(input),
      attribute === "region" ? "セルの領域属性を更新できませんでした。" : "セルの地形属性を更新できませんでした。",
      {
        recover: async (identity) => {
          if (cellMutation.current === mutation) await refreshCellAttributes(identity);
        },
        refreshOnSuccess: false,
        isCurrent: () => cellMutation.current === mutation,
      },
    );
  };
  const moveRegion = (input: MoveRegionCellsInput): void => {
    if (locked) return;
    void run(() => backend.moveRegionCells(input), "領域を移動できませんでした。", { recover: async (identity) => refreshCellAttributes(identity) });
  };
  const resizeCells = (input: ApplyCellAttributesInput): void => {
    if (locked || (input.attribute !== "terrain" && input.attribute !== "region")) return;
    const mutation = ++cellMutation.current;
    updateOptimisticCellAttributes(input.cellIds, input.attribute, input.value, input.regionId);
    void run(
      () => backend.applyCellAttributes(input),
      input.attribute === "terrain" ? "地形の端を変更できませんでした。" : "領域の端を変更できませんでした。",
      {
        recover: async (identity) => {
          if (cellMutation.current === mutation) await refreshCellAttributes(identity);
        },
        refreshOnSuccess: false,
        isCurrent: () => cellMutation.current === mutation,
      },
    );
  };

  const shapeRegion = (input: ApplyCellAttributesInput): void => {
    if (locked || input.attribute !== "region" || input.value !== null) return;
    const cellIds = [...new Set(input.cellIds)];
    if (cellIds.length === 0) return;
    const mutation = ++cellMutation.current;
    updateOptimisticCellAttributes(cellIds, "region", null);
    setSelectedCellIds([]);
    void run(
      () => backend.applyCellAttributes({ cellIds, attribute: "region", value: null }),
      "領域をシェイピングできませんでした。",
      {
        recover: async (identity) => {
          if (cellMutation.current === mutation) await refreshCellAttributes(identity);
        },
        refreshOnSuccess: false,
        isCurrent: () => cellMutation.current === mutation,
      },
    );
  };

  const mergeRegions = (): void => {
    const regions = selectedRegionIds.map((id) => regionObjects.find((region) => region.id === id)).filter((region): region is RegionObject => region !== undefined);
    if (regions.length < 2) return;
    const target = regions[0];
    if (!target) return;
    if (!target.persistentId || regions.some((region) => region.persistentId === null)) {
      setError("旧形式の領域は、先に新しい領域として描き直してください。");
      return;
    }
    const cellIds = [...new Set(regions.flatMap((region) => region.cellIds))];
    const mutation = ++cellMutation.current;
    updateOptimisticCellAttributes(cellIds, "region", target.color, target.persistentId);
    setSelectedRegionIds([target.id]);
    setSelectedComponentId(null);
    setRegionPaintTargetId(target.id);
    setRegionColor(target.color);
    setSelectedCellIds([]);
    void run(
      () => backend.applyCellAttributes({ cellIds, attribute: "region", value: target.color, regionId: target.persistentId! }),
      "領域を統合できませんでした。",
      {
        recover: async (identity) => {
          if (cellMutation.current === mutation) await refreshCellAttributes(identity);
        },
        refreshOnSuccess: false,
        isCurrent: () => cellMutation.current === mutation,
      },
    );
  };

  const splitRegionComponent = (region: RegionObject, component: RegionComponent): void => {
    if (!region.persistentId || region.components.length < 2) return;
    const newRegionId = crypto.randomUUID();
    const mutation = ++cellMutation.current;
    updateOptimisticCellAttributes(component.cellIds, "region", region.color, newRegionId);
    setSelectedRegionIds([]);
    setSelectedComponentId(null);
    setRegionPaintTargetId(null);
    setSelectedCellIds([]);
    void run(
      () => backend.applyCellAttributes({ cellIds: component.cellIds, attribute: "region", value: region.color, regionId: newRegionId }),
      "領域の塊を分離できませんでした。",
      {
        recover: async (identity) => {
          if (cellMutation.current === mutation) await refreshCellAttributes(identity);
        },
        refreshOnSuccess: false,
        isCurrent: () => cellMutation.current === mutation,
      },
    );
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      const redo = key === "y" || (key === "z" && event.shiftKey);
      const undo = key === "z" && !event.shiftKey;
      if (event.metaKey || event.ctrlKey) {
        if (locked || (!undo && !redo) || (undo ? !viewedSnapshot.canUndo : !viewedSnapshot.canRedo)) return;
        event.preventDefault();
        void run(() => redo ? backend.redoProject() : backend.undoProject(), redo ? "操作を進められませんでした。" : "操作を戻せませんでした。");
        return;
      }
      if (locked || event.altKey || event.shiftKey) return;
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
  }, [backend, locked, viewedSnapshot.canRedo, viewedSnapshot.canUndo]);

  return (
    <main className="editor-shell" aria-label="Realm地形編集画面">
      <header className="editor-history" data-electron-drag-region="deep">
        <nav aria-label="編集履歴">
          <button type="button" onClick={() => { void run(() => backend.undoProject(), "操作を戻せませんでした。"); }} disabled={locked || !viewedSnapshot.canUndo}>戻す</button>
          <button type="button" onClick={() => { void run(() => backend.redoProject(), "操作を進められませんでした。"); }} disabled={locked || !viewedSnapshot.canRedo}>進む</button>
          <button className="object-manager-toggle" type="button" aria-label={objectManagerOpen ? "オブジェクトマネージャーを閉じる" : "オブジェクトマネージャーを開く"} aria-pressed={objectManagerOpen} onClick={() => setObjectManagerOpen((current) => !current)}>オブジェクト</button>
        </nav>
      </header>
      <div className={`editor-body${objectManagerOpen ? "" : " object-manager-is-closed"}`}>
        <section className="map-region" aria-label="地形編集領域">
          <MapCanvas
            // Compatibility region objects remain in snapshots but are not
            // rendered or created by the cell-region editor.
            features={[]}
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
            onRegionMove={moveRegion}
            onRegionShape={shapeRegion}
            onCellResize={resizeCells}
            regionColor={regionColor}
            onToolChange={selectTool}
            onEraseTargetChange={selectEraseTarget}
            onRegionColorChange={changeRegionColor}
            onError={(code) => setError(mapErrorMessage(code, activeToolRef.current === "region" || (activeToolRef.current === "erase" && eraseTargetRef.current === "region") ? "region" : "terrain"))}
            onZoomChange={setZoom}
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
            disabled={locked}
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
