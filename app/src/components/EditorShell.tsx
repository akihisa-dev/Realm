import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, type CellAttributeSnapshot, type RealmBackend, type RealmSnapshot } from "../backend";
import { Hand } from "@phosphor-icons/react/dist/csr/Hand";
import { PencilLine } from "@phosphor-icons/react/dist/csr/PencilLine";
import { MapCanvas } from "./MapCanvas";
import { mapErrorMessage } from "../locales/ja";

type Tool = "pan" | "terrain" | "erase";

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
  const [cellAttributes, setCellAttributes] = useState<CellAttributeSnapshot[]>([]);
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [operating, setOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeToolRef = useRef<Tool>("terrain");
  const viewedIdentity = useRef(`${snapshot.path}:${snapshot.world.id}`);
  const mounted = useRef(true);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const cellRequest = useRef(0);
  const cellMutation = useRef(0);
  const projectIdentity = `${snapshot.path}:${snapshot.world.id}`;

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
      setError(null);
    }
  }, [projectIdentity, snapshot]);

  const settings = viewedSnapshot.settings;
  const locked = busy || operating;

  const selectTool = (tool: Tool) => {
    activeToolRef.current = tool;
    setActiveTool(tool);
  };

  const refreshCellAttributes = async (identity: string): Promise<void> => {
    const request = ++cellRequest.current;
    try {
      const attributes = await backend.viewCellAttributes({});
      const terrain = attributes.filter((attribute) => attribute.attribute === "terrain");
      if (mounted.current && viewedIdentity.current === identity && cellRequest.current === request) setCellAttributes(terrain);
    } catch (cause) {
      if (mounted.current && viewedIdentity.current === identity && cellRequest.current === request) setError(errorMessage(cause, "セル属性を読み込めませんでした。"));
    }
  };

  useEffect(() => {
    void refreshCellAttributes(projectIdentity);
  }, [backend, projectIdentity]);

  useEffect(() => {
    if (activeTool === "pan" || locked) setSelectedCellIds([]);
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

  const updateOptimisticCellAttributes = (cellIds: readonly string[], value: string | null): void => {
    // Invalidate an in-flight read before publishing the optimistic state. Its
    // old read result must not overwrite a newer paint operation.
    ++cellRequest.current;
    const selected = new Set(cellIds);
    setCellAttributes((current) => {
      const byCell = new Map(current.map((attribute) => [attribute.cellId, attribute]));
      if (value === null) {
        for (const cellId of selected) byCell.delete(cellId);
      } else {
        for (const cellId of selected) byCell.set(cellId, { cellId, attribute: "terrain", value });
      }
      return [...byCell.values()];
    });
  };

  const applyCellSelection = (ids: readonly string[]) => {
    const nextIds = [...new Set(ids)];
    const tool = activeToolRef.current;
    if (locked || tool === "pan") {
      setSelectedCellIds([]);
      return;
    }
    if (nextIds.length === 0) {
      setSelectedCellIds([]);
      return;
    }
    const value = tool === "terrain" ? "terrain" : null;
    const mutation = ++cellMutation.current;
    updateOptimisticCellAttributes(nextIds, value);
    setSelectedCellIds(value === null ? [] : nextIds);
    void run(
      () => backend.applyCellAttributes({ cellIds: nextIds, attribute: "terrain", value }),
      "セルの地形属性を更新できませんでした。",
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
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [backend, locked, viewedSnapshot.canRedo, viewedSnapshot.canUndo]);

  return (
    <main className="editor-shell" aria-label="Realm地形編集画面">
      <header className="editor-history" data-tauri-drag-region="deep">
        <nav aria-label="編集履歴">
          <button type="button" onClick={() => { void run(() => backend.undoProject(), "操作を戻せませんでした。"); }} disabled={locked || !viewedSnapshot.canUndo}>戻す</button>
          <button type="button" onClick={() => { void run(() => backend.redoProject(), "操作を進められませんでした。"); }} disabled={locked || !viewedSnapshot.canRedo}>進む</button>
        </nav>
      </header>
      <div className="editor-body">
        <aside className="left-rail" aria-label="地形ツール">
          <button className={activeTool === "pan" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "pan"} onClick={() => selectTool("pan")} disabled={locked}><Hand aria-hidden="true" size={24} /><span>移動</span></button>
          <button className={activeTool === "terrain" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "terrain"} onClick={() => selectTool("terrain")} disabled={locked}><PencilLine aria-hidden="true" size={24} /><span>地形を描く</span></button>
        </aside>

        <section className="map-region" aria-label="地形編集領域">
          <MapCanvas
            features={[]}
            mode={locked || activeTool === "pan" ? "pan" : activeTool === "erase" ? "cell-erase" : "cell-select"}
            cellAttributes={cellAttributes}
            selectedCellIds={selectedCellIds}
            themeId={settings.themeId}
            themeOverrides={settings.themeOverrides}
            showGrid={false}
            showCellGrid
            cellGridOptions={{ color: settings.gridColor, width: settings.gridWidth }}
            gridOptions={{ kind: "hex", color: settings.gridColor, width: settings.gridWidth, spacingDegrees: settings.gridSpacing }}
            onCellSelect={applyCellSelection}
            onToolChange={selectTool}
            onError={(code) => setError(mapErrorMessage(code))}
            onZoomChange={setZoom}
            zoom={zoom}
          />
          {error ? <p className="save-error" role="alert">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
