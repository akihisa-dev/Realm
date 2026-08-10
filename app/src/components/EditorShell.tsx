import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  errorMessage,
  type GeoJsonGeometry,
  type ProjectSettings,
  type RealmBackend,
  type RealmFeature,
  type RealmSnapshot,
} from "../backend";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GlobeHemisphereWest } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { pdfFromJpeg, type MapRaster } from "../exportArtifacts";
import type { DrawingOptions } from "../map/MapAdapter";
import { duplicateOffset, transformGeometries, type TransformOptions } from "../map/geometryTransform";
import { polygonAreaSquareDegrees } from "../map/measurementGeometry";
import { positionWithinPolygon } from "../map/symbolSpray";
import {
  DEFAULT_MAP_THEME_ID,
  MAP_THEME_IDS,
  MAP_THEMES,
  mapTheme,
  type MapThemeId,
  type ThemeColorKey,
  type ThemeOverrides,
} from "../map/themes";
import { MapCanvas, MapZoomControls } from "./MapCanvas";

const TERRAIN_TYPE = "terrain" as const;
const TerrainSelect = "select";
const CUSTOM_THEME_COLORS: readonly [ThemeColorKey, string][] = [
  ["canvas", "海・背景"],
  ["land", "地形"],
  ["landInk", "輪郭"],
  ["coastGlow", "海岸効果"],
  ["grid", "グリッド"],
];
type Tool = "pan" | "terrain" | "erase" | "polygon-hole";

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
  const [featureName, setFeatureName] = useState("新しい地形");
  const [featureQuery, setFeatureQuery] = useState("");
  const [featureClipboard, setFeatureClipboard] = useState<readonly RealmFeature[]>([]);
  const clipboardPasteCount = useRef(0);
  const [featureVisible, setFeatureVisible] = useState(true);
  const [featureLocked, setFeatureLocked] = useState(false);
  const [featureZIndex, setFeatureZIndex] = useState(0);
  const [featureOpacity, setFeatureOpacity] = useState(1);
  const [drawingGesture, setDrawingGesture] = useState<DrawingOptions["gesture"]>("freehand");
  const [drawingSmoothingPasses, setDrawingSmoothingPasses] = useState(2);
  const [drawingSnapAngleDegrees, setDrawingSnapAngleDegrees] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [themeId, setThemeId] = useState<MapThemeId>(snapshot.settings.themeId ?? DEFAULT_MAP_THEME_ID);
  const [themeOverrides, setThemeOverrides] = useState<ThemeOverrides>(snapshot.settings.themeOverrides ?? {});
  const [showGrid, setShowGrid] = useState(snapshot.settings.showGrid ?? true);
  const [gridKind, setGridKind] = useState<ProjectSettings["gridKind"]>(snapshot.settings.gridKind ?? "graticule");
  const [gridColor, setGridColor] = useState(snapshot.settings.gridColor ?? "#687784");
  const [gridWidth, setGridWidth] = useState(snapshot.settings.gridWidth ?? 1);
  const [gridSpacing, setGridSpacing] = useState(snapshot.settings.gridSpacing ?? 10);
  const [canvasWidth, setCanvasWidth] = useState(snapshot.settings.canvasWidth ?? 2048);
  const [canvasHeight, setCanvasHeight] = useState(snapshot.settings.canvasHeight ?? 1024);
  const [exportScale, setExportScale] = useState(snapshot.settings.exportScale ?? 2);
  const [exportExtent, setExportExtent] = useState<"viewport" | "world">(snapshot.settings.exportExtent ?? "world");
  const [exportTransparent, setExportTransparent] = useState(false);
  const [exportQuality, setExportQuality] = useState(0.92);
  const [saving, setSaving] = useState(false);
  const [operating, setOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
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
  const selectedFeature = selectedFeatures.length === 1 ? selectedFeatures[0]! : null;
  const normalizedQuery = featureQuery.trim().toLocaleLowerCase("ja-JP");
  const listedFeatures = (normalizedQuery
    ? terrainFeatures.filter((feature) => feature.name.toLocaleLowerCase("ja-JP").includes(normalizedQuery))
    : terrainFeatures).slice(0, 500);
  const effectiveTheme = mapTheme(themeId, themeOverrides);
  const locked = busy || saving || operating;
  const dirty = worldName !== viewedSnapshot.world.name;

  const loadFeatureEditor = (feature: RealmFeature | undefined) => {
    if (!feature) return;
    setFeatureName(feature.name);
    setFeatureVisible(feature.properties?.visible !== false);
    setFeatureLocked(feature.properties?.locked === true);
    setFeatureZIndex(typeof feature.properties?.zIndex === "number" ? feature.properties.zIndex : 0);
    setFeatureOpacity(typeof feature.properties?.opacity === "number" ? feature.properties.opacity : 1);
  };

  const selectFeatures = (ids: readonly string[]) => {
    const next = [...new Set(ids)].filter((id) => terrainFeatures.some((feature) => feature.id === id));
    setSelectedFeatureIds(next);
    loadFeatureEditor(next.length === 1 ? terrainFeatures.find((feature) => feature.id === next[0]) : undefined);
  };

  const toggleFeatureSelection = (id: string, additive: boolean) => {
    if (!additive) {
      selectFeatures([id]);
      return;
    }
    selectFeatures(selectedFeatureIds.includes(id)
      ? selectedFeatureIds.filter((selectedId) => selectedId !== id)
      : [...selectedFeatureIds, id]);
  };

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

  const persistViewSettings = (overrides: Partial<ProjectSettings>) => {
    const settings: ProjectSettings = {
      themeId,
      showGrid,
      exportScale: exportScale as 1 | 2 | 4,
      exportExtent,
      canvasWidth,
      canvasHeight,
      gridKind,
      gridColor,
      gridWidth,
      gridSpacing,
      themeOverrides,
      ...overrides,
    };
    setThemeId(settings.themeId);
    setShowGrid(settings.showGrid);
    setExportScale(settings.exportScale);
    setExportExtent(settings.exportExtent);
    setCanvasWidth(settings.canvasWidth);
    setCanvasHeight(settings.canvasHeight);
    setGridKind(settings.gridKind);
    setGridColor(settings.gridColor);
    setGridWidth(settings.gridWidth);
    setGridSpacing(settings.gridSpacing);
    setThemeOverrides(settings.themeOverrides);
    void run(() => backend.updateProjectSettings({ settings }), "プロジェクト設定を保存できませんでした。");
  };

  const createDrawnFeature = (geometry: GeoJsonGeometry) => {
    if (activeTool === "polygon-hole") {
      if (!selectedFeature || selectedFeature.geometry.type !== "Polygon" || geometry.type !== "Polygon") {
        setError("穴を追加する地形を1件選択してください。");
        setActiveTool("pan");
        return;
      }
      const selectedGeometry = selectedFeature.geometry;
      const hole = geometry.coordinates[0];
      if (!hole || hole.some((position) => !positionWithinPolygon(position, selectedGeometry.coordinates))) {
        setError("穴は選択した地形の内側へ描いてください。");
        return;
      }
      const nextGeometry: GeoJsonGeometry = {
        type: "Polygon",
        coordinates: [...selectedGeometry.coordinates, hole],
      };
      void run(() => backend.reviseFeature({
        id: selectedFeature.id,
        name: selectedFeature.name,
        geometry: nextGeometry,
        properties: selectedFeature.properties ?? {},
      }), "地形へ穴を追加できませんでした。");
      setActiveTool("pan");
      return;
    }
    if (activeTool !== "terrain" || geometry.type !== "Polygon") return;
    void run(() => backend.createFeature({
      featureType: TERRAIN_TYPE,
      name: featureName.trim() || "新しい地形",
      geometry,
      properties: {},
    }), "地形を作成できませんでした。");
  };

  const reviseSelectedFeatures = (changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => {
    const revisions = changes.map(({ id, geometry }) => {
      const feature = terrainFeatures.find((item) => item.id === id);
      return feature && feature.properties?.locked !== true && geometry.type === "Polygon"
        ? { id, name: feature.name, geometry, properties: feature.properties ?? {} }
        : null;
    }).filter((revision): revision is NonNullable<typeof revision> => Boolean(revision));
    if (revisions.length > 0) void run(() => backend.reviseFeaturesBatch({ features: revisions }), "地形を変更できませんでした。");
  };

  const saveFeature = (feature: RealmFeature) => {
    void run(() => backend.reviseFeature({
      id: feature.id,
      name: featureName.trim() || feature.name,
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        visible: featureVisible,
        locked: featureLocked,
        zIndex: featureZIndex,
        opacity: featureOpacity,
      },
    }), "地形を変更できませんでした。");
  };

  const transformSelectedFeatures = (options: TransformOptions) => {
    const editable = selectedFeatures.filter((feature) => feature.properties?.locked !== true);
    if (editable.length === 0) return;
    try {
      const geometries = transformGeometries(editable.map((feature) => feature.geometry), options);
      reviseSelectedFeatures(editable.map((feature, index) => ({ id: feature.id, geometry: geometries[index]! })));
    } catch (cause) {
      setError(errorMessage(cause, "地形を変形できませんでした。"));
    }
  };

  const duplicateSelectedFeatures = () => {
    const editable = selectedFeatures.filter((feature) => feature.properties?.locked !== true);
    if (editable.length === 0) return;
    try {
      const offset = duplicateOffset(editable[0]!.geometry);
      const geometries = transformGeometries(editable.map((feature) => feature.geometry), { offset });
      void run(() => backend.createFeaturesBatch({
        features: editable.map((feature, index) => ({
          featureType: TERRAIN_TYPE,
          name: `${feature.name} の複製`,
          geometry: geometries[index]!,
          properties: { ...feature.properties, locked: false },
        })),
      }), "地形を複製できませんでした。");
    } catch (cause) {
      setError(errorMessage(cause, "地形を複製できませんでした。"));
    }
  };

  const copySelectedFeatures = () => {
    if (selectedFeatures.length === 0) return;
    setFeatureClipboard(selectedFeatures.map(cloneFeature));
    clipboardPasteCount.current = 0;
  };

  const pasteCopiedFeatures = () => {
    if (featureClipboard.length === 0) return;
    try {
      clipboardPasteCount.current += 1;
      const baseOffset = duplicateOffset(featureClipboard[0]!.geometry);
      const offset: [number, number] = [baseOffset[0] * clipboardPasteCount.current, baseOffset[1] * clipboardPasteCount.current];
      const geometries = transformGeometries(featureClipboard.map((feature) => feature.geometry), { offset });
      void run(() => backend.createFeaturesBatch({
        features: featureClipboard.map((feature, index) => ({
          featureType: TERRAIN_TYPE,
          name: `${feature.name} のコピー`,
          geometry: geometries[index]!,
          properties: { ...feature.properties, locked: false },
        })),
      }), "地形を貼り付けできませんでした。");
    } catch (cause) {
      setError(errorMessage(cause, "地形を貼り付けできませんでした。"));
    }
  };

  const cutSelectedFeatures = () => {
    const editable = selectedFeatures.filter((feature) => feature.properties?.locked !== true);
    if (editable.length === 0) return;
    setFeatureClipboard(editable.map(cloneFeature));
    clipboardPasteCount.current = 0;
    setSelectedFeatureIds([]);
    void run(() => backend.deleteFeaturesBatch({ ids: editable.map((feature) => feature.id) }), "地形を切り取りできませんでした。");
  };

  const deleteSelectedFeatures = () => {
    const editableIds = selectedFeatures.filter((feature) => feature.properties?.locked !== true).map((feature) => feature.id);
    if (editableIds.length === 0 || !window.confirm(`${editableIds.length}件の地形を削除しますか？`)) return;
    setSelectedFeatureIds([]);
    void run(() => backend.deleteFeaturesBatch({ ids: editableIds }), "地形を削除できませんでした。");
  };

  const shiftSelectedLayers = (direction: -1 | 1) => {
    const revisions = selectedFeatures.filter((feature) => feature.properties?.locked !== true).map((feature) => ({
      id: feature.id,
      name: feature.name,
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        zIndex: Math.max(-1000, Math.min(1000, (typeof feature.properties?.zIndex === "number" ? feature.properties.zIndex : 0) + direction)),
      },
    }));
    if (revisions.length === 1) setFeatureZIndex(revisions[0]!.properties.zIndex as number);
    if (revisions.length > 0) void run(() => backend.reviseFeaturesBatch({ features: revisions }), "地形の描画順を変更できませんでした。");
  };

  const setSelectedFeaturesLocked = (nextLocked: boolean) => {
    if (selectedFeatureIds.length === 0) return;
    void run(() => backend.setFeaturesLocked({ ids: [...selectedFeatureIds], locked: nextLocked }), nextLocked ? "地形をロックできませんでした。" : "地形のロックを解除できませんでした。");
  };

  const exportMap = async (format: "png" | "jpg" | "pdf") => {
    if (!(await flushSave()) || !mapExporter.current) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true);
      setError(null);
      try {
        const raster = await mapExporter.current!(
          format === "png" ? "image/png" : "image/jpeg",
          exportScale,
          exportExtent,
          { width: canvasWidth, height: canvasHeight, transparent: format === "png" && exportTransparent, quality: exportQuality },
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
        if (key === "c") copySelectedFeatures();
        else if (key === "x") cutSelectedFeatures();
        else pasteCopiedFeatures();
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
          <button className={activeTool === "terrain" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "terrain"} onClick={() => { setActiveTool("terrain"); setSelectedFeatureIds([]); setFeatureName("新しい地形"); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>地形を描く</span></button>
          <button className={activeTool === "erase" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "erase"} onClick={() => { setActiveTool("erase"); setSelectedFeatureIds([]); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>地形を消す</span></button>
        </aside>

        <aside className="world-sidebar" aria-label="地形の構成">
          <div className="sidebar-heading"><h2>地形</h2></div>
          <p>{terrainFeatures.length === 0 ? "地形はまだありません" : `地形 ${terrainFeatures.length}件`}</p>
          <label className="feature-search">地形を検索<input type="search" value={featureQuery} onChange={(event) => setFeatureQuery(event.target.value)} disabled={locked} /></label>
          <div className="feature-list" aria-label="地形一覧">
            {listedFeatures.map((feature) => <button key={feature.id} type="button" className={selectedFeatureIds.includes(feature.id) ? "feature-row feature-row-selected" : "feature-row"} aria-pressed={selectedFeatureIds.includes(feature.id)} onClick={(event) => toggleFeatureSelection(feature.id, event.shiftKey || event.metaKey || event.ctrlKey)} disabled={locked}><strong>{feature.name}</strong><span>地形</span></button>)}
          </div>
          {terrainFeatures.length > listedFeatures.length ? <p className="feature-list-note">先頭500件を表示しています。</p> : null}

          <section className="feature-editor" aria-label="地形編集">
            <h3>{selectedFeatures.length > 1 ? `${selectedFeatures.length}件の地形を選択` : selectedFeature ? "選択した地形" : "新しい地形"}</h3>
            <label>名前<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} disabled={locked || selectedFeatures.length > 1 || featureLocked} maxLength={200} /></label>
            {selectedFeature ? <>
              <div className="feature-layer-controls" aria-label="地形表示設定">
                <label><input type="checkbox" checked={featureVisible} onChange={(event) => setFeatureVisible(event.target.checked)} disabled={locked || featureLocked} />表示</label>
                <label><input type="checkbox" checked={featureLocked} onChange={(event) => { const next = event.target.checked; setFeatureLocked(next); setSelectedFeaturesLocked(next); }} disabled={locked} />ロック</label>
                <label className="feature-opacity">不透明度<input type="range" min="0.05" max="1" step="0.05" value={featureOpacity} onChange={(event) => setFeatureOpacity(Number(event.target.value))} disabled={locked || featureLocked} /><output>{Math.round(featureOpacity * 100)}%</output></label>
                <button type="button" onClick={() => setFeatureZIndex((value) => Math.min(1000, value + 1))} disabled={locked || featureLocked}>前面へ</button>
                <button type="button" onClick={() => setFeatureZIndex((value) => Math.max(-1000, value - 1))} disabled={locked || featureLocked}>背面へ</button>
                <output>順序 {featureZIndex}</output>
              </div>
              <div className="feature-transform-actions" aria-label="地形の変形">
                <button type="button" onClick={duplicateSelectedFeatures} disabled={locked || featureLocked}>複製</button>
                <button type="button" onClick={() => transformSelectedFeatures({ scale: 1.25 })} disabled={locked || featureLocked}>拡大</button>
                <button type="button" onClick={() => transformSelectedFeatures({ scale: 0.8 })} disabled={locked || featureLocked}>縮小</button>
                <button type="button" onClick={() => transformSelectedFeatures({ rotationRadians: Math.PI / 2 })} disabled={locked || featureLocked}>90°回転</button>
                <button type="button" onClick={() => transformSelectedFeatures({ flipX: true })} disabled={locked || featureLocked}>左右反転</button>
                <button type="button" onClick={() => transformSelectedFeatures({ flipY: true })} disabled={locked || featureLocked}>上下反転</button>
              </div>
              <button type="button" aria-pressed={activeTool === "polygon-hole"} onClick={() => setActiveTool(activeTool === "polygon-hole" ? "pan" : "polygon-hole")} disabled={locked || featureLocked}>{activeTool === "polygon-hole" ? "穴の追加を終了" : "地形の内側に穴を追加"}</button>
              <p className="feature-measurement"><span>平面面積</span><strong>{polygonAreaSquareDegrees(selectedFeature.geometry.type === "Polygon" ? selectedFeature.geometry.coordinates : []).toFixed(2)}°²</strong></p>
              <div className="feature-editor-actions">
                <button type="button" onClick={() => saveFeature(selectedFeature)} disabled={locked || featureLocked}>変更を保存</button>
                <button type="button" className="danger-action" onClick={() => { if (window.confirm("この地形を削除しますか？")) { setSelectedFeatureIds([]); void run(() => backend.deleteFeature({ id: selectedFeature.id }), "地形を削除できませんでした。"); } }} disabled={locked || featureLocked}>削除</button>
              </div>
            </> : null}
            {selectedFeatures.length > 1 ? <div className="feature-transform-actions" aria-label="複数地形の操作"><button type="button" onClick={duplicateSelectedFeatures} disabled={locked}>複製</button><button type="button" onClick={() => transformSelectedFeatures({ scale: 1.25 })} disabled={locked}>拡大</button><button type="button" onClick={() => transformSelectedFeatures({ scale: 0.8 })} disabled={locked}>縮小</button><button type="button" onClick={() => transformSelectedFeatures({ flipX: true })} disabled={locked}>左右反転</button><button type="button" className="danger-action" onClick={deleteSelectedFeatures} disabled={locked}>削除</button></div> : null}
          </section>

          <section className="terrain-settings" aria-label="地形の描き方">
            <h3>描き方</h3>
            <label>入力方式<TerrainSelect value={drawingGesture} onChange={(event) => setDrawingGesture(event.target.value as DrawingOptions["gesture"])} disabled={locked}><option value="freehand">フリーハンド</option><option value="vertices">点をつないで描く</option></TerrainSelect></label>
            <label>滑らかさ<input type="range" min="0" max="4" step="1" value={drawingSmoothingPasses} onChange={(event) => setDrawingSmoothingPasses(Number(event.target.value))} disabled={locked} /><output>{drawingSmoothingPasses}</output></label>
            <label>角度スナップ<TerrainSelect value={drawingSnapAngleDegrees === null ? "none" : String(drawingSnapAngleDegrees)} onChange={(event) => setDrawingSnapAngleDegrees(event.target.value === "none" ? null : Number(event.target.value))} disabled={locked || drawingGesture !== "vertices"}><option value="none">なし</option><option value="15">15°</option><option value="30">30°</option><option value="45">45°</option><option value="90">90°</option></TerrainSelect></label>
          </section>

          <section className="terrain-settings" aria-label="地形図の表現">
            <h3>地形図の表現</h3>
            <label>テーマ<TerrainSelect value={themeId} onChange={(event) => persistViewSettings({ themeId: event.target.value as MapThemeId })} disabled={locked}>{MAP_THEME_IDS.map((id) => <option key={id} value={id}>{MAP_THEMES[id].name}</option>)}</TerrainSelect></label>
            <label>キャンバス幅<input type="number" min="512" max="8192" value={canvasWidth} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 512 && value <= 8192) setCanvasWidth(value); }} onBlur={() => persistViewSettings({ canvasWidth })} disabled={locked} /></label>
            <label>キャンバス高さ<input type="number" min="512" max="8192" value={canvasHeight} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 512 && value <= 8192) setCanvasHeight(value); }} onBlur={() => persistViewSettings({ canvasHeight })} disabled={locked} /></label>
            <label>書き出し範囲<TerrainSelect value={exportExtent} onChange={(event) => persistViewSettings({ exportExtent: event.target.value as typeof exportExtent })} disabled={locked}><option value="world">全体</option><option value="viewport">現在の表示</option></TerrainSelect></label>
            <label>書き出し解像度<TerrainSelect value={String(exportScale)} onChange={(event) => persistViewSettings({ exportScale: Number(event.target.value) as 1 | 2 | 4 })} disabled={locked}><option value="1">標準</option><option value="2">2倍</option><option value="4">4倍</option></TerrainSelect></label>
            <label><input type="checkbox" checked={showGrid} onChange={(event) => persistViewSettings({ showGrid: event.target.checked })} disabled={locked} />グリッドを表示・出力</label>
            <label>グリッド種類<TerrainSelect value={gridKind} onChange={(event) => persistViewSettings({ gridKind: event.target.value as ProjectSettings["gridKind"] })} disabled={locked}><option value="graticule">経緯線</option><option value="square">正方格子</option><option value="hex">六角格子</option></TerrainSelect></label>
            <label>グリッド色<input type="color" value={gridColor} onChange={(event) => persistViewSettings({ gridColor: event.target.value })} disabled={locked} /></label>
            <label>グリッド線幅<input type="range" min="0.25" max="4" step="0.25" value={gridWidth} onChange={(event) => persistViewSettings({ gridWidth: Number(event.target.value) })} disabled={locked} /><output>{gridWidth.toFixed(2)}px</output></label>
            <label>グリッド間隔<input type="range" min="2" max="45" step="1" value={gridSpacing} onChange={(event) => persistViewSettings({ gridSpacing: Number(event.target.value) })} disabled={locked} /><output>{Math.round(gridSpacing)}°</output></label>
          </section>

          <section className="terrain-settings theme-customizer" aria-label="地形図の配色">
            <h3>配色</h3>
            {CUSTOM_THEME_COLORS.map(([key, label]) => <label key={key}>{label}<input type="color" value={themeOverrides[key] ?? effectiveTheme[key]} onChange={(event) => persistViewSettings({ themeOverrides: { ...themeOverrides, [key]: event.target.value } })} disabled={locked} /></label>)}
            <button type="button" onClick={() => persistViewSettings({ themeOverrides: {} })} disabled={locked || Object.keys(themeOverrides).length === 0}>既定の配色に戻す</button>
          </section>
        </aside>

        <section className="map-region" aria-label="地形編集領域">
          <MapCanvas
            features={terrainFeatures}
            mode={locked ? "pan" : activeTool}
            selectedFeatureIds={selectedFeatureIds}
            drawingOptions={{ gesture: drawingGesture, smoothingPasses: drawingSmoothingPasses, snapAngleDegrees: drawingSnapAngleDegrees }}
            themeId={themeId}
            themeOverrides={themeOverrides}
            showGrid={showGrid}
            gridOptions={{ kind: gridKind, color: gridColor, width: gridWidth, spacingDegrees: gridSpacing }}
            onDraw={createDrawnFeature}
            onSelectFeatures={selectFeatures}
            onModifyFeatures={reviseSelectedFeatures}
            onEraseFeatures={(ids) => {
              const terrainIds = ids.filter((id) => terrainFeatures.some((feature) => feature.id === id));
              if (terrainIds.length === 0) return;
              setSelectedFeatureIds([]);
              void run(() => backend.deleteFeaturesBatch({ ids: terrainIds }), "地形を削除できませんでした。");
            }}
            onLayerShift={shiftSelectedLayers}
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
