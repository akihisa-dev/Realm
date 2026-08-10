import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, type GeoJsonGeometry, type RealmBackend, type RealmFeature, type RealmSnapshot } from "../backend";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GlobeHemisphereWest } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { pdfFromJpeg, type MapRaster } from "../exportArtifacts";
import { duplicateOffset, transformGeometries } from "../map/geometryTransform";
import { MapCanvas, MapZoomControls } from "./MapCanvas";

const TERRAIN_TYPE = "terrain" as const;
type Tool = "pan" | "terrain" | "erase";

type EditorShellProps = {
  snapshot: RealmSnapshot;
  backend: RealmBackend;
  busy: boolean;
  onClose: () => void | Promise<void>;
  onSaved: (snapshot: RealmSnapshot) => void;
  onExportTransfer: () => Promise<void>;
  onExportArtifact: (format: "png" | "jpg" | "pdf", bytes: number[]) => Promise<void>;
};

type SerialTail = { current: Promise<void> };

const enqueueSerial = <T,>(tail: SerialTail, action: () => Promise<T>): Promise<T> => {
  const result = tail.current.then(action, action);
  tail.current = result.then(() => undefined, () => undefined);
  return result;
};

const validateWorldName = (value: string): string | null => {
  if (!value.trim()) return "世界の名前を入力してください。";
  if (value.trim().length > 200) return "世界の名前は200文字以内にしてください。";
  return null;
};

const cloneFeature = (feature: RealmFeature): RealmFeature => ({
  ...feature,
  geometry: JSON.parse(JSON.stringify(feature.geometry)) as GeoJsonGeometry,
  properties: JSON.parse(JSON.stringify(feature.properties ?? {})) as Record<string, unknown>,
});

export function EditorShell({
  snapshot,
  backend,
  busy,
  onClose,
  onSaved,
  onExportTransfer,
  onExportArtifact,
}: EditorShellProps) {
  const [viewedSnapshot, setViewedSnapshot] = useState(snapshot);
  const [worldName, setWorldName] = useState(snapshot.world.name);
  const [activeTool, setActiveTool] = useState<Tool>("pan");
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [featureClipboard, setFeatureClipboard] = useState<readonly RealmFeature[]>([]);
  const [zoom, setZoom] = useState(1);
  const [exportTransparent, setExportTransparent] = useState(false);
  const [exportQuality, setExportQuality] = useState(0.92);
  const [saving, setSaving] = useState(false);
  const [operating, setOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const clipboardPasteCount = useRef(0);
  const worldNameRef = useRef(worldName);
  const viewedIdentity = useRef(`${snapshot.path}:${snapshot.world.id}`);
  const mounted = useRef(true);
  const saveTimer = useRef<number | null>(null);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const mapExporter = useRef<((mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: { width: number; height: number; transparent?: boolean; quality?: number }) => Promise<MapRaster>) | null>(null);
  const projectIdentity = `${snapshot.path}:${snapshot.world.id}`;

  worldNameRef.current = worldName;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    const identityChanged = viewedIdentity.current !== projectIdentity;
    viewedIdentity.current = projectIdentity;
    setViewedSnapshot(snapshot);
    if (identityChanged) {
      setWorldName(snapshot.world.name);
      setSelectedFeatureIds([]);
      setFeatureClipboard([]);
      clipboardPasteCount.current = 0;
    } else {
      setSelectedFeatureIds((current) => current.filter((id) => snapshot.features.some((feature) => feature.id === id && feature.featureType === TERRAIN_TYPE)));
    }
  }, [projectIdentity, snapshot]);

  const terrainFeatures = viewedSnapshot.features.filter((feature) => feature.featureType === TERRAIN_TYPE);
  const selectedFeatures = selectedFeatureIds
    .map((id) => terrainFeatures.find((feature) => feature.id === id))
    .filter((feature): feature is RealmFeature => Boolean(feature));
  const settings = viewedSnapshot.settings;
  const locked = busy || saving || operating;
  const dirty = worldName !== viewedSnapshot.world.name;

  const saveName = useCallback(async (): Promise<boolean> => {
    const validation = validateWorldName(worldName);
    setNameError(validation);
    if (validation) return false;
    if (!dirty) return true;
    const requestedName = worldName.trim();
    return enqueueSerial(commandTail, async () => {
      setSaving(true);
      setError(null);
      try {
        const next = await backend.saveProject({ name: requestedName });
        if (!mounted.current || viewedIdentity.current !== projectIdentity) return false;
        if (worldNameRef.current.trim() === requestedName) setWorldName(next.world.name);
        setViewedSnapshot(next);
        onSaved(next);
        return true;
      } catch (cause) {
        setError(errorMessage(cause, "自動保存に失敗しました。"));
        return false;
      } finally {
        setSaving(false);
      }
    });
  }, [backend, dirty, onSaved, projectIdentity, worldName]);

  useEffect(() => {
    if (!dirty) {
      setNameError(null);
      return undefined;
    }
    setNameError(validateWorldName(worldName));
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveName(); }, 350);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [dirty, saveName, worldName]);

  const flushSave = async (): Promise<boolean> => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    return saveName();
  };

  const run = async (action: () => Promise<RealmSnapshot>, fallback: string) => {
    if (!(await flushSave())) return;
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

  const selectTerrain = (ids: readonly string[]) => {
    setSelectedFeatureIds([...new Set(ids)].filter((id) => terrainFeatures.some((feature) => feature.id === id)));
  };

  const reviseSelectedTerrain = (changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => {
    const revisions = changes.map(({ id, geometry }) => {
      const feature = terrainFeatures.find((item) => item.id === id);
      return feature && feature.properties?.locked !== true && geometry.type === "Polygon"
        ? { id, name: feature.name, geometry, properties: feature.properties ?? {} }
        : null;
    }).filter((revision): revision is NonNullable<typeof revision> => Boolean(revision));
    if (revisions.length > 0) void run(() => backend.reviseFeaturesBatch({ features: revisions }), "地形を変更できませんでした。");
  };

  const copySelectedTerrain = () => {
    if (selectedFeatures.length === 0) return;
    setFeatureClipboard(selectedFeatures.map(cloneFeature));
    clipboardPasteCount.current = 0;
  };

  const pasteCopiedTerrain = () => {
    if (featureClipboard.length === 0) return;
    try {
      clipboardPasteCount.current += 1;
      const baseOffset = duplicateOffset(featureClipboard[0]!.geometry);
      const offset: [number, number] = [baseOffset[0] * clipboardPasteCount.current, baseOffset[1] * clipboardPasteCount.current];
      const geometries = transformGeometries(featureClipboard.map((feature) => feature.geometry), { offset });
      void run(() => backend.createFeaturesBatch({
        features: featureClipboard.map((feature, index) => ({
          featureType: TERRAIN_TYPE,
          name: feature.name,
          geometry: geometries[index]!,
          properties: { ...feature.properties, locked: false },
        })),
      }), "地形を貼り付けできませんでした。");
    } catch (cause) {
      setError(errorMessage(cause, "地形を貼り付けできませんでした。"));
    }
  };

  const cutSelectedTerrain = () => {
    const editable = selectedFeatures.filter((feature) => feature.properties?.locked !== true);
    if (editable.length === 0) return;
    setFeatureClipboard(editable.map(cloneFeature));
    clipboardPasteCount.current = 0;
    setSelectedFeatureIds([]);
    void run(() => backend.deleteFeaturesBatch({ ids: editable.map((feature) => feature.id) }), "地形を切り取りできませんでした。");
  };

  const shiftSelectedTerrain = (direction: -1 | 1) => {
    const revisions = selectedFeatures.filter((feature) => feature.properties?.locked !== true).map((feature) => ({
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

  const exportMap = async (format: "png" | "jpg" | "pdf") => {
    if (!(await flushSave()) || !mapExporter.current) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true);
      setError(null);
      try {
        const raster = await mapExporter.current!(
          format === "png" ? "image/png" : "image/jpeg",
          settings.exportScale,
          settings.exportExtent,
          {
            width: settings.canvasWidth,
            height: settings.canvasHeight,
            transparent: format === "png" && exportTransparent,
            quality: exportQuality,
          },
        );
        await onExportArtifact(format, format === "pdf" ? pdfFromJpeg(raster) : raster.bytes);
      } catch (cause) {
        setError(errorMessage(cause, "地形図を書き出せませんでした。"));
      } finally {
        setOperating(false);
      }
    });
  };

  const exportTransfer = async () => {
    if (!(await flushSave())) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true);
      setError(null);
      try {
        await onExportTransfer();
      } catch (cause) {
        setError(errorMessage(cause, "移行データを書き出せませんでした。"));
      } finally {
        setOperating(false);
      }
    });
  };

  const close = async () => {
    if (!(await flushSave())) return;
    await enqueueSerial(commandTail, async () => { await onClose(); });
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === "c" || key === "x" || key === "v")) {
        if (locked) return;
        event.preventDefault();
        if (key === "c") copySelectedTerrain();
        else if (key === "x") cutSelectedTerrain();
        else pasteCopiedTerrain();
        return;
      }
      const redo = key === "y" || (key === "z" && event.shiftKey);
      const undo = key === "z" && !event.shiftKey;
      if (event.metaKey || event.ctrlKey) {
        if (locked || (!undo && !redo) || (undo ? !viewedSnapshot.canUndo : !viewedSnapshot.canRedo)) return;
        event.preventDefault();
        void run(() => redo ? backend.redoProject() : backend.undoProject(), redo ? "操作をやり直せませんでした。" : "操作を元に戻せませんでした。");
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
  }, [backend, featureClipboard, locked, selectedFeatures, viewedSnapshot.canRedo, viewedSnapshot.canUndo]);

  return (
    <main className="editor-shell" aria-label="Realm地形編集画面">
      <header className="editor-toolbar">
        <div className="app-mark"><strong>Realm</strong></div>
        <nav className="document-actions" aria-label="ファイル操作">
          <button type="button" onClick={() => { void close(); }} disabled={locked}><FolderOpen aria-hidden="true" size={21} /><span>ライブラリ</span></button>
          <button type="button" onClick={() => { void exportMap("png"); }} disabled={locked}>PNG</button>
          <button type="button" onClick={() => { void exportMap("jpg"); }} disabled={locked}>JPEG</button>
          <button type="button" onClick={() => { void exportMap("pdf"); }} disabled={locked}>PDF</button>
          <label className="export-option"><input type="checkbox" checked={exportTransparent} onChange={(event) => setExportTransparent(event.target.checked)} disabled={locked} />PNG透過</label>
          <label className="export-option">品質<input aria-label="JPEG・PDF品質" type="range" min="0.5" max="1" step="0.01" value={exportQuality} onChange={(event) => setExportQuality(Number(event.target.value))} disabled={locked} /><output>{Math.round(exportQuality * 100)}%</output></label>
          <button type="button" onClick={() => { void exportTransfer(); }} disabled={locked}>移行データ</button>
          <button type="button" onClick={() => { void close(); }} disabled={locked} aria-label="世界を閉じる"><X aria-hidden="true" size={20} /></button>
        </nav>
        <nav className="history-actions" aria-label="編集履歴">
          <button type="button" onClick={() => { void run(() => backend.undoProject(), "操作を元に戻せませんでした。"); }} disabled={locked || !viewedSnapshot.canUndo}>元に戻す</button>
          <button type="button" onClick={() => { void run(() => backend.redoProject(), "操作をやり直せませんでした。"); }} disabled={locked || !viewedSnapshot.canRedo}>やり直す</button>
        </nav>
        <label className="world-name-input"><span className="sr-only">世界の名前</span><input value={worldName} onChange={(event) => setWorldName(event.target.value)} disabled={locked} maxLength={200} /><PencilSimple aria-hidden="true" size={17} /></label>
        <span className={`save-state ${dirty ? "save-state-dirty" : ""}`} aria-live="polite">{nameError ? "入力を確認" : saving || dirty ? "自動保存中…" : "自動保存済み"}</span>
      </header>

      <div className="editor-body">
        <aside className="left-rail" aria-label="地形ツール">
          <button className={activeTool === "pan" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "pan"} onClick={() => setActiveTool("pan")} disabled={locked}><GlobeHemisphereWest aria-hidden="true" size={25} /><span>移動</span></button>
          <button className={activeTool === "terrain" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "terrain"} onClick={() => { setActiveTool("terrain"); setSelectedFeatureIds([]); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>地形を描く</span></button>
          <button className={activeTool === "erase" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "erase"} onClick={() => { setActiveTool("erase"); setSelectedFeatureIds([]); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>地形を消す</span></button>
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
            onSelectFeatures={selectTerrain}
            onModifyFeatures={reviseSelectedTerrain}
            onEraseFeatures={(ids) => {
              const terrainIds = ids.filter((id) => terrainFeatures.some((feature) => feature.id === id));
              if (terrainIds.length === 0) return;
              setSelectedFeatureIds([]);
              void run(() => backend.deleteFeaturesBatch({ ids: terrainIds }), "地形を削除できませんでした。");
            }}
            onLayerShift={shiftSelectedTerrain}
            onError={setError}
            onExporterReady={(exporter) => { mapExporter.current = exporter; }}
            onZoomChange={setZoom}
            zoom={zoom}
          />
          {nameError ? <p className="save-error" role="alert">{nameError}</p> : error ? <p className="save-error" role="alert">{error}</p> : null}
        </section>
        <footer className="editor-footer"><MapZoomControls zoom={zoom} onChange={setZoom} /></footer>
      </div>
    </main>
  );
}
