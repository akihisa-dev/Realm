import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, type GeoJsonGeometry, type RealmBackend, type RealmFeature, type RealmSnapshot } from "../backend";
import { Eraser } from "@phosphor-icons/react/dist/csr/Eraser";
import { Hand } from "@phosphor-icons/react/dist/csr/Hand";
import { PencilLine } from "@phosphor-icons/react/dist/csr/PencilLine";
import { MapCanvas } from "./MapCanvas";
import { mapErrorMessage } from "../locales/ja";

const TERRAIN_TYPE = "terrain" as const;
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

export function EditorShell({ snapshot, backend, busy, onSaved }: EditorShellProps) {
  const [viewedSnapshot, setViewedSnapshot] = useState(snapshot);
  const [activeTool, setActiveTool] = useState<Tool>("terrain");
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [operating, setOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewedIdentity = useRef(`${snapshot.path}:${snapshot.world.id}`);
  const mounted = useRef(true);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const projectIdentity = `${snapshot.path}:${snapshot.world.id}`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    const identityChanged = viewedIdentity.current !== projectIdentity;
    viewedIdentity.current = projectIdentity;
    setViewedSnapshot(snapshot);
    setSelectedFeatureIds((current) => identityChanged
      ? []
      : current.filter((id) => snapshot.features.some((feature) => feature.id === id && feature.featureType === TERRAIN_TYPE)));
  }, [projectIdentity, snapshot]);

  const terrainFeatures = viewedSnapshot.features.filter((feature) => feature.featureType === TERRAIN_TYPE);
  const settings = viewedSnapshot.settings;
  const locked = busy || operating;

  const run = async (action: () => Promise<RealmSnapshot>, fallback: string) => {
    await enqueueSerial(commandTail, async () => {
      setOperating(true);
      setError(null);
      try {
        const next = await action();
        if (!mounted.current || viewedIdentity.current !== projectIdentity) return;
        setViewedSnapshot(next);
        onSaved(next);
      } catch (cause) {
        setError(errorMessage(cause, fallback));
      } finally {
        setOperating(false);
      }
    });
  };

  const createTerrain = (geometry: GeoJsonGeometry) => {
    if (activeTool !== "terrain" || geometry.type !== "Polygon") return;
    void run(() => backend.createFeature({
      featureType: TERRAIN_TYPE,
      name: "地形",
      geometry,
      properties: {},
    }), "地形を作成できませんでした。");
  };

  const reviseTerrain = (changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => {
    const revisions = changes.map(({ id, geometry }) => {
      const feature = terrainFeatures.find((item) => item.id === id);
      return feature && feature.properties?.locked !== true && geometry.type === "Polygon"
        ? { id, name: feature.name, geometry, properties: feature.properties ?? {} }
        : null;
    }).filter((revision): revision is NonNullable<typeof revision> => Boolean(revision));
    if (revisions.length > 0) void run(() => backend.reviseFeaturesBatch({ features: revisions }), "地形を変更できませんでした。");
  };

  const shiftTerrain = (direction: -1 | 1) => {
    const revisions = selectedFeatureIds.map((id) => terrainFeatures.find((feature) => feature.id === id))
      .filter((feature): feature is RealmFeature => feature !== undefined && feature.properties?.locked !== true)
      .map((feature) => ({
        id: feature.id,
        name: feature.name,
        geometry: feature.geometry,
        properties: {
          ...feature.properties,
          zIndex: Math.max(-1000, Math.min(1000, (typeof feature.properties?.zIndex === "number" ? feature.properties.zIndex : 0) + direction)),
        },
      }));
    if (revisions.length > 0) void run(() => backend.reviseFeaturesBatch({ features: revisions }), "地形の描画順を変更できませんでした。");
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
        setActiveTool("terrain");
        setSelectedFeatureIds([]);
      } else if (key === "e" || key === "x") {
        event.preventDefault();
        setActiveTool("erase");
        setSelectedFeatureIds([]);
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
          <button className={activeTool === "pan" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "pan"} onClick={() => setActiveTool("pan")} disabled={locked}><Hand aria-hidden="true" size={24} /><span>移動</span></button>
          <button className={activeTool === "terrain" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "terrain"} onClick={() => { setActiveTool("terrain"); setSelectedFeatureIds([]); }} disabled={locked}><PencilLine aria-hidden="true" size={24} /><span>地形を描く</span></button>
          <button className={activeTool === "erase" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "erase"} onClick={() => { setActiveTool("erase"); setSelectedFeatureIds([]); }} disabled={locked}><Eraser aria-hidden="true" size={24} /><span>地形を消す</span></button>
        </aside>

        <section className="map-region" aria-label="地形編集領域">
          <MapCanvas
            features={terrainFeatures}
            mode={locked ? "pan" : activeTool}
            selectedFeatureIds={selectedFeatureIds}
            drawingOptions={{ gesture: "freehand", smoothingPasses: 2, snapAngleDegrees: null }}
            themeId={settings.themeId}
            themeOverrides={settings.themeOverrides}
            showGrid={settings.showGrid}
            gridOptions={{ kind: settings.gridKind, color: settings.gridColor, width: settings.gridWidth, spacingDegrees: settings.gridSpacing }}
            onDraw={createTerrain}
            onSelectFeatures={(ids) => setSelectedFeatureIds([...new Set(ids)].filter((id) => terrainFeatures.some((feature) => feature.id === id)))}
            onModifyFeatures={reviseTerrain}
            onEraseFeatures={(ids) => {
              const terrainIds = ids.filter((id) => terrainFeatures.some((feature) => feature.id === id));
              if (terrainIds.length === 0) return;
              setSelectedFeatureIds([]);
              void run(() => backend.deleteFeaturesBatch({ ids: terrainIds }), "地形を削除できませんでした。");
            }}
            onLayerShift={shiftTerrain}
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
