import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  errorMessage,
  type CellAttribute,
  type CellAttributeSnapshot,
  type GeoJsonGeometry,
  type RealmBackend,
  type RealmFeature,
  type RealmSnapshot,
  type ProjectSettings,
} from "../backend";
import { MapCanvas, MapZoomControls } from "./MapCanvas";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GlobeHemisphereWest } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { pdfFromJpeg, type MapRaster } from "../exportArtifacts";
import { DEFAULT_MAP_THEME_ID, MAP_THEME_IDS, MAP_THEMES, type MapThemeId } from "../map/themes";
import { duplicateOffset, transformGeometry } from "../map/geometryTransform";
import { polygonAreaSquareDegrees, polylineLengthDegrees } from "../map/measurementGeometry";
import { generateSymbolSpray, type SprayFeatureType } from "../map/symbolSpray";

const FEATURE_TYPES = [
  ["terrain", "地形"], ["forest", "森林"], ["river", "河川"], ["coastline", "海岸線"],
  ["country", "国"], ["region", "地域"], ["boundary", "境界"], ["city", "都市"], ["town", "町"],
  ["road", "道路"], ["lake", "湖"], ["mountain", "山"], ["tree", "木"], ["symbol", "記号"],
  ["label", "ラベル"], ["overlay", "参照領域"], ["frame", "枠"], ["scale", "縮尺記号"],
] as const;
const CellAttributeSelect = "select";
type Tool = "pan" | "cell-select" | "erase" | typeof FEATURE_TYPES[number][0];
const defaultFeatureProperties = (featureType: typeof FEATURE_TYPES[number][0]): Record<string, unknown> => featureType === "river"
  ? { width: 2.4 }
  : featureType === "road"
    ? { width: 2.2 }
    : featureType === "mountain" || featureType === "tree" || featureType === "symbol"
      ? { scale: 1, rotation: 0 }
      : featureType === "scale"
        ? { scale: 1, rotation: 0, unit: "単位", unitsPerDegree: 1 }
      : featureType === "label"
        ? { fontSize: 18, textColor: "#29343b", haloColor: "#ffffff", haloWidth: 3, rotation: 0 }
        : featureType === "overlay"
          ? { opacity: 0.45 }
      : {};
type EditorShellProps = {
  snapshot: RealmSnapshot;
  backend: RealmBackend;
  busy: boolean;
  onClose: () => void | Promise<void>;
  onSaved: (snapshot: RealmSnapshot) => void;
  onExportTransfer: () => Promise<void>;
  onExportArtifact: (format: "png" | "jpg" | "pdf", bytes: number[]) => Promise<void>;
};

const validateWorldName = (value: string): string | null => {
  if (!value.trim()) return "世界の名前を入力してください。";
  if (value.trim().length > 200) return "世界の名前は200文字以内にしてください。";
  return null;
};

const bytesDataUrl = (mime: string, bytes: readonly number[]): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.slice(offset, offset + 32_768));
  return `data:${mime};base64,${btoa(binary)}`;
};

const imageDimensions = async (file: File): Promise<{ width: number; height: number }> => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
};

type SerialTail = { current: Promise<void> };
const enqueueSerial = <T,>(tail: SerialTail, action: () => Promise<T>): Promise<T> => {
  const result = tail.current.then(action, action);
  tail.current = result.then(() => undefined, () => undefined);
  return result;
};

export function EditorShell(props: EditorShellProps) {
  const { snapshot, backend, busy, onClose, onSaved, onExportTransfer, onExportArtifact } = props;
  const [viewedSnapshot, setViewedSnapshot] = useState(snapshot);
  const [worldName, setWorldName] = useState(snapshot.world.name);
  const [activeTool, setActiveTool] = useState<Tool>("pan");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [cellAttributes, setCellAttributes] = useState<CellAttributeSnapshot[]>([]);
  const [cellAttribute, setCellAttribute] = useState<CellAttribute>("forest");
  const [cellAttributeValue, setCellAttributeValue] = useState("forest");
  const [cellPaintMode, setCellPaintMode] = useState<"paint" | "erase">("paint");
  const [cellBrushRadius, setCellBrushRadius] = useState(2);
  const [featureName, setFeatureName] = useState("新しい地物");
  const [featureQuery, setFeatureQuery] = useState("");
  const [featureWidth, setFeatureWidth] = useState(2.4);
  const [featureStrokeColor, setFeatureStrokeColor] = useState("#357da5");
  const [featureCasingColor, setFeatureCasingColor] = useState("#ffffff");
  const [featureLineStyle, setFeatureLineStyle] = useState<"solid" | "dashed" | "dotted">("solid");
  const [featureScale, setFeatureScale] = useState(1);
  const [featureRotation, setFeatureRotation] = useState(0);
  const [labelFontSize, setLabelFontSize] = useState(18);
  const [labelTextColor, setLabelTextColor] = useState("#29343b");
  const [labelHaloColor, setLabelHaloColor] = useState("#ffffff");
  const [labelHaloWidth, setLabelHaloWidth] = useState(3);
  const [zoom, setZoom] = useState(1);
  const [themeId, setThemeId] = useState<MapThemeId>(snapshot.settings.themeId ?? DEFAULT_MAP_THEME_ID);
  const [exportScale, setExportScale] = useState(snapshot.settings.exportScale ?? 2);
  const [exportExtent, setExportExtent] = useState<"viewport" | "world">(snapshot.settings.exportExtent ?? "world");
  const [showGrid, setShowGrid] = useState(snapshot.settings.showGrid ?? true);
  const [sprayFeatureType, setSprayFeatureType] = useState<SprayFeatureType>("tree");
  const [sprayCount, setSprayCount] = useState(80);
  const [spraySpacing, setSpraySpacing] = useState(2);
  const [spraySeed, setSpraySeed] = useState("realm");
  const [featureAssetId, setFeatureAssetId] = useState("");
  const [featureVisible, setFeatureVisible] = useState(true);
  const [featureLocked, setFeatureLocked] = useState(false);
  const [featureZIndex, setFeatureZIndex] = useState(0);
  const [featureOpacity, setFeatureOpacity] = useState(1);
  const [scaleUnit, setScaleUnit] = useState("単位");
  const [scaleUnitsPerDegree, setScaleUnitsPerDegree] = useState(1);
  const [assetUrls, setAssetUrls] = useState<Readonly<Record<string, string>>>({});
  const [hiddenFeatureTypes, setHiddenFeatureTypes] = useState<Set<typeof FEATURE_TYPES[number][0]>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [operating, setOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const worldNameRef = useRef(worldName);
  const mapExporter = useRef<((mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world") => Promise<MapRaster>) | null>(null);
  const saveTimer = useRef<number | null>(null);
  const cellRequest = useRef(0);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const projectIdentity = `${snapshot.path}:${snapshot.world.id}`;
  const assetManifestKey = viewedSnapshot.assets.map((asset) => `${asset.id}:${asset.sha256}`).join("|");
  const referencedAssetIds = new Set(viewedSnapshot.features.map((feature) => feature.properties?.assetId).filter((id): id is string => typeof id === "string"));
  const renderedAssetKey = viewedSnapshot.assets.filter((asset) => referencedAssetIds.has(asset.id)).map((asset) => `${asset.id}:${asset.sha256}`).join("|");
  const viewedIdentity = useRef(projectIdentity);
  const mounted = useRef(true);
  const assetInputRef = useRef<HTMLInputElement>(null);

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
      setSelectedFeatureId(null);
      setSelectedCellIds([]);
      setFeatureAssetId("");
    } else {
      setSelectedFeatureId((current) => current && snapshot.features.some((feature) => feature.id === current) ? current : null);
    }
  }, [projectIdentity, snapshot]);

  const refreshCells = useCallback(async () => {
    const request = ++cellRequest.current;
    const expectedIdentity = projectIdentity;
    try {
      const next = await backend.viewCellAttributes({});
      if (cellRequest.current === request && viewedIdentity.current === expectedIdentity) setCellAttributes(next);
    } catch (cause) {
      if (cellRequest.current === request && viewedIdentity.current === expectedIdentity) setError(errorMessage(cause, "セル属性を読み込めませんでした。"));
    }
  }, [backend, projectIdentity]);

  useEffect(() => { void refreshCells(); }, [refreshCells]);

  useEffect(() => {
    let cancelled = false;
    const requiredAssets = viewedSnapshot.assets.filter((asset) => referencedAssetIds.has(asset.id));
    void Promise.all(requiredAssets.map(async (asset) => {
      const read = await backend.readAsset({ id: asset.id });
      return [asset.id, bytesDataUrl(read.manifest.mime, read.bytes)] as const;
    })).then((entries) => { if (!cancelled) setAssetUrls(Object.fromEntries(entries)); })
      .catch((cause) => { if (!cancelled) setError(errorMessage(cause, "素材を読み込めませんでした。")); });
    return () => { cancelled = true; };
  }, [backend, projectIdentity, renderedAssetKey]);

  useEffect(() => {
    if (featureAssetId && !viewedSnapshot.assets.some((asset) => asset.id === featureAssetId)) setFeatureAssetId("");
  }, [assetManifestKey, featureAssetId, viewedSnapshot.assets]);

  const locked = busy || saving || operating;
  const selectedFeature = viewedSnapshot.features.find((feature) => feature.id === selectedFeatureId) ?? null;
  const normalizedFeatureQuery = featureQuery.trim().toLocaleLowerCase("ja-JP");
  const matchingFeatures = normalizedFeatureQuery
    ? viewedSnapshot.features.filter((feature) => `${feature.name} ${FEATURE_TYPES.find(([type]) => type === feature.featureType)?.[1] ?? feature.featureType}`.toLocaleLowerCase("ja-JP").includes(normalizedFeatureQuery))
    : viewedSnapshot.features;
  const listedFeatures = matchingFeatures.slice(0, 500);
  const mapScaleFeature = viewedSnapshot.features.find((feature) => feature.featureType === "scale");
  const mapScaleUnit = typeof mapScaleFeature?.properties?.unit === "string" ? mapScaleFeature.properties.unit : "単位";
  const mapScaleUnitsPerDegree = typeof mapScaleFeature?.properties?.unitsPerDegree === "number" && mapScaleFeature.properties.unitsPerDegree > 0 ? mapScaleFeature.properties.unitsPerDegree : 1;
  const selectedMeasurement = selectedFeature?.geometry.type === "LineString"
    ? `${(polylineLengthDegrees(selectedFeature.geometry.coordinates) * mapScaleUnitsPerDegree).toFixed(2)} ${mapScaleUnit}`
    : selectedFeature?.geometry.type === "Polygon"
      ? `${(polygonAreaSquareDegrees(selectedFeature.geometry.coordinates) * mapScaleUnitsPerDegree ** 2).toFixed(2)} ${mapScaleUnit}²`
      : null;
  const layerVisibility = Object.fromEntries(FEATURE_TYPES.map(([type]) => [type, !hiddenFeatureTypes.has(type)]));
  const toggleLayerVisibility = (featureType: typeof FEATURE_TYPES[number][0]) => {
    setHiddenFeatureTypes((current) => {
      const next = new Set(current);
      if (next.has(featureType)) next.delete(featureType);
      else next.add(featureType);
      return next;
    });
  };
  const dirty = worldName !== viewedSnapshot.world.name;
  const saveName = useCallback(async (): Promise<boolean> => {
    const validation = validateWorldName(worldName);
    setNameError(validation);
    if (validation) return false;
    if (!dirty) return true;
    const requestedName = worldName.trim();
    return enqueueSerial(commandTail, async () => {
      setSaving(true); setError(null);
      try {
        const next = await backend.saveProject({ name: requestedName });
        if (!mounted.current || viewedIdentity.current !== projectIdentity) return false;
        if (worldNameRef.current.trim() === requestedName) setWorldName(next.world.name);
        setViewedSnapshot(next); onSaved(next); return true;
      } catch (cause) {
        setError(errorMessage(cause, "自動保存に失敗しました。")); return false;
      } finally { setSaving(false); }
    });
  }, [backend, dirty, onSaved, projectIdentity, worldName]);

  useEffect(() => {
    if (!dirty) { setNameError(null); return undefined; }
    setNameError(validateWorldName(worldName));
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveName(); }, 350);
    return () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); };
  }, [dirty, saveName, worldName]);

  const flushSave = async (): Promise<boolean> => {
    if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    return saveName();
  };

  const run = async (action: () => Promise<RealmSnapshot>, fallback: string, refresh = false) => {
    if (!(await flushSave())) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true); setError(null);
      try {
        const next = await action();
        if (!mounted.current || viewedIdentity.current !== projectIdentity) return;
        setViewedSnapshot(next); onSaved(next);
        if (refresh) await refreshCells();
      } catch (cause) { setError(errorMessage(cause, fallback)); }
      finally { setOperating(false); }
    });
  };
  const persistViewSettings = (overrides: Partial<ProjectSettings>) => {
    const settings: ProjectSettings = { themeId, showGrid, exportScale: exportScale as 1 | 2 | 4, exportExtent, ...overrides };
    if (settings.themeId) setThemeId(settings.themeId);
    if (settings.showGrid !== undefined) setShowGrid(settings.showGrid);
    if (settings.exportScale) setExportScale(settings.exportScale);
    if (settings.exportExtent) setExportExtent(settings.exportExtent);
    void run(() => backend.updateProjectSettings({ settings }), "プロジェクト設定を保存できませんでした。");
  };

  const createDrawnFeature = (geometry: GeoJsonGeometry) => {
    if (activeTool === "pan" || activeTool === "cell-select" || activeTool === "erase") return;
    const properties = defaultFeatureProperties(activeTool);
    if (["mountain", "tree", "symbol", "overlay"].includes(activeTool) && featureAssetId) properties.assetId = featureAssetId;
    void run(() => backend.createFeature({ featureType: activeTool, name: featureName.trim() || "新しい地物", geometry, properties }), "地物を作成できませんでした。");
  };
  const applyCellAttribute = (value: string | null, ids = selectedCellIds) => {
    if (!ids.length) return;
    void run(() => backend.applyCellAttributes({ cellIds: ids, attribute: cellAttribute, value }), "セル属性を変更できませんでした。", true);
  };
  const selectFeature = (id: string | null) => {
    setSelectedFeatureId(id);
    const feature = viewedSnapshot.features.find((item) => item.id === id);
    if (feature) {
      setFeatureName(feature.name);
      setFeatureWidth(typeof feature.properties?.width === "number" ? feature.properties.width : feature.featureType === "road" ? 2.2 : 2.4);
      setFeatureStrokeColor(typeof feature.properties?.strokeColor === "string" ? feature.properties.strokeColor : feature.featureType === "road" ? "#7a573a" : "#357da5");
      setFeatureCasingColor(typeof feature.properties?.casingColor === "string" ? feature.properties.casingColor : "#ffffff");
      setFeatureLineStyle(feature.properties?.lineStyle === "dashed" || feature.properties?.lineStyle === "dotted" ? feature.properties.lineStyle : "solid");
      setFeatureScale(typeof feature.properties?.scale === "number" ? feature.properties.scale : 1);
      setFeatureRotation(typeof feature.properties?.rotation === "number" ? feature.properties.rotation * 180 / Math.PI : 0);
      setLabelFontSize(typeof feature.properties?.fontSize === "number" ? feature.properties.fontSize : 18);
      setLabelTextColor(typeof feature.properties?.textColor === "string" ? feature.properties.textColor : "#29343b");
      setLabelHaloColor(typeof feature.properties?.haloColor === "string" ? feature.properties.haloColor : "#ffffff");
      setLabelHaloWidth(typeof feature.properties?.haloWidth === "number" ? feature.properties.haloWidth : 3);
      setFeatureAssetId(typeof feature.properties?.assetId === "string" ? feature.properties.assetId : "");
      setFeatureVisible(feature.properties?.visible !== false);
      setFeatureLocked(feature.properties?.locked === true);
      setFeatureZIndex(typeof feature.properties?.zIndex === "number" ? feature.properties.zIndex : 0);
      setFeatureOpacity(typeof feature.properties?.opacity === "number" ? feature.properties.opacity : 1);
      setScaleUnit(typeof feature.properties?.unit === "string" ? feature.properties.unit : "単位");
      setScaleUnitsPerDegree(typeof feature.properties?.unitsPerDegree === "number" ? feature.properties.unitsPerDegree : 1);
    }
  };
  const reviseFeature = (feature: RealmFeature, geometry = feature.geometry, properties = feature.properties ?? {}) => {
    void run(() => backend.reviseFeature({ id: feature.id, name: featureName.trim() || feature.name, geometry, properties }), "地物を変更できませんでした。");
  };
  const saveFeatureAppearance = (feature: RealmFeature) => {
    const properties = { ...feature.properties };
    if (feature.featureType === "river" || feature.featureType === "road") {
      properties.width = featureWidth;
      properties.strokeColor = featureStrokeColor;
      properties.casingColor = featureCasingColor;
      properties.lineStyle = featureLineStyle;
    }
    if (["mountain", "tree", "symbol", "scale"].includes(feature.featureType)) {
      properties.scale = featureScale;
      properties.rotation = featureRotation * Math.PI / 180;
    }
    if (feature.featureType === "scale") {
      properties.unit = scaleUnit.trim() || "単位";
      properties.unitsPerDegree = Math.max(0.0001, scaleUnitsPerDegree);
    }
    if (["mountain", "tree", "symbol", "overlay"].includes(feature.featureType)) {
      if (featureAssetId) properties.assetId = featureAssetId;
      else delete properties.assetId;
    }
    if (feature.featureType === "label") {
      properties.fontSize = labelFontSize;
      properties.textColor = labelTextColor;
      properties.haloColor = labelHaloColor;
      properties.haloWidth = labelHaloWidth;
      properties.rotation = featureRotation * Math.PI / 180;
    }
    properties.visible = featureVisible;
    properties.locked = featureLocked;
    properties.zIndex = featureZIndex;
    properties.opacity = featureOpacity;
    reviseFeature(feature, feature.geometry, properties);
  };
  const transformSelectedFeature = (feature: RealmFeature, options: Parameters<typeof transformGeometry>[1]) => {
    try { reviseFeature(feature, transformGeometry(feature.geometry, options)); }
    catch (cause) { setError(errorMessage(cause, "地物を変形できませんでした。")); }
  };
  const duplicateFeature = (feature: RealmFeature) => {
    try {
      const geometry = transformGeometry(feature.geometry, { offset: duplicateOffset(feature.geometry) });
      void run(() => backend.createFeature({ featureType: feature.featureType, name: `${feature.name} の複製`, geometry, properties: feature.properties ?? {} }), "地物を複製できませんでした。");
    } catch (cause) { setError(errorMessage(cause, "地物を複製できませんでした。")); }
  };
  const sprayInsideFeature = (feature: RealmFeature) => {
    if (feature.geometry.type !== "Polygon") return;
    try {
      const candidates = generateSymbolSpray({ seed: spraySeed, spacing: spraySpacing, maxCount: sprayCount, polygon: feature.geometry.coordinates, featureType: sprayFeatureType });
      if (candidates.length === 0) throw new Error("この条件では配置できる記号がありません。");
      void run(() => backend.createFeaturesBatch({ features: candidates.map((candidate) => ({
        featureType: sprayFeatureType,
        name: `${sprayFeatureType === "tree" ? "木" : sprayFeatureType === "mountain" ? "山" : "記号"} ${candidate.ordinal + 1}`,
        geometry: { type: "Point", coordinates: candidate.coordinates },
        properties: { scale: candidate.scale, rotation: candidate.rotation, sourceFeatureId: feature.id, spraySeed, sprayOrdinal: candidate.ordinal },
      })) }), "記号を散布できませんでした。");
    } catch (cause) { setError(errorMessage(cause, "記号を散布できませんでした。")); }
  };
  const importAssetFile = async (file: File) => {
    if (!(await flushSave())) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true); setError(null);
      try {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size === 0 || file.size > 8 * 1024 * 1024) throw new Error("PNG・JPEG・WebP（8 MiB以下）を選んでください。");
        const dimensions = await imageDimensions(file);
        const next = await backend.importAsset({ mime: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())], ...dimensions, metadata: { originalName: file.name } });
        if (!mounted.current || viewedIdentity.current !== projectIdentity) return;
        setViewedSnapshot(next); onSaved(next);
      } catch (cause) { setError(errorMessage(cause, "素材を読み込めませんでした。")); }
      finally { setOperating(false); }
    });
  };
  const exportMap = async (format: "png" | "jpg" | "pdf") => {
    if (!(await flushSave()) || !mapExporter.current) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true); setError(null);
      try { const raster = await mapExporter.current!(format === "png" ? "image/png" : "image/jpeg", exportScale, exportExtent); await onExportArtifact(format, format === "pdf" ? pdfFromJpeg(raster) : raster.bytes); }
      catch (cause) { setError(errorMessage(cause, "地図を書き出せませんでした。")); }
      finally { setOperating(false); }
    });
  };
  const exportTransfer = async () => {
    if (!(await flushSave())) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true); setError(null);
      try { await onExportTransfer(); } catch (cause) { setError(errorMessage(cause, "移行データを書き出せませんでした。")); } finally { setOperating(false); }
    });
  };
  const close = async () => {
    if (!(await flushSave())) return;
    await enqueueSerial(commandTail, async () => { await onClose(); });
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const redo = key === "y" || (key === "z" && event.shiftKey);
      const undo = key === "z" && !event.shiftKey;
      if (locked || (!undo && !redo) || (undo ? !viewedSnapshot.canUndo : !viewedSnapshot.canRedo)) return;
      event.preventDefault();
      void run(() => redo ? backend.redoProject() : backend.undoProject(), redo ? "操作をやり直せませんでした。" : "操作を元に戻せませんでした。", true);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [backend, locked, viewedSnapshot.canRedo, viewedSnapshot.canUndo]);

  return (
    <main className="editor-shell" aria-label="Realm編集画面">
      <header className="editor-toolbar">
        <div className="app-mark"><strong>Realm</strong></div>
        <nav className="document-actions" aria-label="ファイル操作">
          <button type="button" onClick={() => { void close(); }} disabled={locked}><FolderOpen aria-hidden="true" size={21} /><span>ライブラリ</span></button>
          <button type="button" onClick={() => { void exportMap("png"); }} disabled={locked}>PNG</button>
          <button type="button" onClick={() => { void exportMap("jpg"); }} disabled={locked}>JPEG</button>
          <button type="button" onClick={() => { void exportMap("pdf"); }} disabled={locked}>PDF</button>
          <button type="button" onClick={() => { void exportTransfer(); }} disabled={locked}>移行データ</button>
          <button type="button" onClick={() => { void close(); }} disabled={locked} aria-label="世界を閉じる"><X aria-hidden="true" size={20} /></button>
        </nav>
        <nav className="history-actions" aria-label="編集履歴">
          <button type="button" onClick={() => { void run(() => backend.undoProject(), "操作を元に戻せませんでした。", true); }} disabled={locked || !viewedSnapshot.canUndo}>元に戻す</button>
          <button type="button" onClick={() => { void run(() => backend.redoProject(), "操作をやり直せませんでした。", true); }} disabled={locked || !viewedSnapshot.canRedo}>やり直す</button>
        </nav>
        <label className="world-name-input"><span className="sr-only">世界の名前</span><input value={worldName} onChange={(event) => setWorldName(event.target.value)} disabled={locked} maxLength={200} /><PencilSimple aria-hidden="true" size={17} /></label>
        <span className={`save-state ${dirty ? "save-state-dirty" : ""}`} aria-live="polite">{nameError ? "入力を確認" : saving || dirty ? "自動保存中…" : "自動保存済み"}</span>
      </header>
      <div className="editor-body">
        <aside className="left-rail" aria-label="主要ナビゲーション">
          <button className={activeTool === "pan" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "pan"} onClick={() => { setActiveTool("pan"); setSelectedCellIds([]); }} disabled={locked}><GlobeHemisphereWest aria-hidden="true" size={25} /><span>移動</span></button>
          <button className={activeTool === "erase" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "erase"} onClick={() => { setActiveTool("erase"); setSelectedCellIds([]); setSelectedFeatureId(null); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>消去</span></button>
          {FEATURE_TYPES.map(([type, label]) => <button key={type} className={activeTool === type ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === type} onClick={() => { setActiveTool(type); setSelectedCellIds([]); setSelectedFeatureId(null); setFeatureName(`新しい${label}`); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>{label}</span></button>)}
          <button className={activeTool === "cell-select" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "cell-select"} onClick={() => { setActiveTool("cell-select"); setSelectedCellIds([]); setSelectedFeatureId(null); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>ブラシ</span></button>
        </aside>
        <aside className="world-sidebar" aria-label="世界の構成">
          <div className="sidebar-heading"><h2>世界</h2></div>
          <p>{viewedSnapshot.featureCount === 0 ? "地物はまだありません" : `地物 ${viewedSnapshot.featureCount}件`}</p>
          <label className="feature-search">地物を検索<input type="search" value={featureQuery} onChange={(event) => setFeatureQuery(event.target.value)} disabled={locked} /></label>
          <div className="feature-list" aria-label="地物一覧">{listedFeatures.map((feature) => <button key={feature.id} type="button" className={feature.id === selectedFeatureId ? "feature-row feature-row-selected" : "feature-row"} aria-pressed={feature.id === selectedFeatureId} onClick={() => selectFeature(feature.id)} disabled={locked}><strong>{feature.name}</strong><span>{FEATURE_TYPES.find(([type]) => type === feature.featureType)?.[1]}</span></button>)}</div>
          {matchingFeatures.length > listedFeatures.length ? <p className="feature-list-limit">先頭500件を表示中。検索で絞り込めます。</p> : null}
          <section className="feature-editor" aria-label="地物編集">
            <label>地物名<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} disabled={locked} maxLength={200} /></label>
            {selectedFeature?.featureType === "river" || selectedFeature?.featureType === "road" ? <><label>線の太さ<input type="range" min="0.5" max="12" step="0.1" value={featureWidth} onChange={(event) => setFeatureWidth(Number(event.target.value))} disabled={locked} /><output>{featureWidth.toFixed(1)}</output></label><label>線色<input type="color" value={featureStrokeColor} onChange={(event) => setFeatureStrokeColor(event.target.value)} disabled={locked} /></label><label>縁色<input type="color" value={featureCasingColor} onChange={(event) => setFeatureCasingColor(event.target.value)} disabled={locked} /></label><label>線種<CellAttributeSelect value={featureLineStyle} onChange={(event) => setFeatureLineStyle(event.target.value as typeof featureLineStyle)} disabled={locked}><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></CellAttributeSelect></label></> : null}
            {selectedFeature && ["mountain", "tree", "symbol", "scale"].includes(selectedFeature.featureType) ? <><label>記号サイズ<input type="range" min="0.25" max="4" step="0.05" value={featureScale} onChange={(event) => setFeatureScale(Number(event.target.value))} disabled={locked} /><output>{featureScale.toFixed(2)}</output></label><label>回転<input type="range" min="-180" max="180" step="1" value={featureRotation} onChange={(event) => setFeatureRotation(Number(event.target.value))} disabled={locked} /><output>{Math.round(featureRotation)}°</output></label></> : null}
            {selectedFeature?.featureType === "scale" ? <><label>計測単位<input value={scaleUnit} onChange={(event) => setScaleUnit(event.target.value)} disabled={locked} maxLength={32} /></label><label>1度あたり<input type="number" min="0.0001" max="1000000" step="0.1" value={scaleUnitsPerDegree} onChange={(event) => setScaleUnitsPerDegree(Number(event.target.value))} disabled={locked} /></label></> : null}
            {selectedFeature && ["mountain", "tree", "symbol", "overlay"].includes(selectedFeature.featureType) ? <label>カスタム素材<CellAttributeSelect value={featureAssetId} onChange={(event) => setFeatureAssetId(event.target.value)} disabled={locked}><option value="">内蔵表現</option>{viewedSnapshot.assets.map((asset) => <option key={asset.id} value={asset.id}>{typeof asset.metadata.originalName === "string" ? asset.metadata.originalName : asset.id}</option>)}</CellAttributeSelect></label> : null}
            {selectedFeature?.featureType === "label" ? <><label>文字サイズ<input type="range" min="8" max="96" step="1" value={labelFontSize} onChange={(event) => setLabelFontSize(Number(event.target.value))} disabled={locked} /><output>{Math.round(labelFontSize)}px</output></label><label>文字色<input type="color" value={labelTextColor} onChange={(event) => setLabelTextColor(event.target.value)} disabled={locked} /></label><label>縁取り色<input type="color" value={labelHaloColor} onChange={(event) => setLabelHaloColor(event.target.value)} disabled={locked} /></label><label>縁取り幅<input type="range" min="0" max="10" step="0.5" value={labelHaloWidth} onChange={(event) => setLabelHaloWidth(Number(event.target.value))} disabled={locked} /><output>{labelHaloWidth.toFixed(1)}px</output></label><label>回転<input type="range" min="-180" max="180" step="1" value={featureRotation} onChange={(event) => setFeatureRotation(Number(event.target.value))} disabled={locked} /><output>{Math.round(featureRotation)}°</output></label></> : null}
            {selectedFeature ? <div className="feature-layer-controls" aria-label="地物レイヤー設定"><label><input type="checkbox" checked={featureVisible} onChange={(event) => setFeatureVisible(event.target.checked)} disabled={locked} />表示</label><label><input type="checkbox" checked={featureLocked} onChange={(event) => setFeatureLocked(event.target.checked)} disabled={locked} />ロック</label><label className="feature-opacity">不透明度<input type="range" min="0.05" max="1" step="0.05" value={featureOpacity} onChange={(event) => setFeatureOpacity(Number(event.target.value))} disabled={locked} /><output>{Math.round(featureOpacity * 100)}%</output></label><button type="button" onClick={() => setFeatureZIndex((value) => Math.min(1000, value + 1))} disabled={locked}>前面へ</button><button type="button" onClick={() => setFeatureZIndex((value) => Math.max(-1000, value - 1))} disabled={locked}>背面へ</button><output>順序 {featureZIndex}</output></div> : null}
            {selectedFeature ? <><div className="feature-transform-actions" aria-label="地物の変形"><button type="button" onClick={() => duplicateFeature(selectedFeature)} disabled={locked}>複製</button><button type="button" onClick={() => transformSelectedFeature(selectedFeature, { rotationRadians: Math.PI / 2 })} disabled={locked}>90°回転</button><button type="button" onClick={() => transformSelectedFeature(selectedFeature, { flipX: true })} disabled={locked}>左右反転</button><button type="button" onClick={() => transformSelectedFeature(selectedFeature, { flipY: true })} disabled={locked}>上下反転</button></div><div className="feature-editor-actions"><button type="button" onClick={() => saveFeatureAppearance(selectedFeature)} disabled={locked}>変更を保存</button><button type="button" className="danger-action" onClick={() => { if (window.confirm("この地物を削除しますか？")) void run(() => backend.deleteFeature({ id: selectedFeature.id }), "地物を削除できませんでした。"); }} disabled={locked}>削除</button></div></> : null}
            {selectedMeasurement ? <p className="feature-measurement"><span>平面計測</span><strong>{selectedMeasurement}</strong><small>最初の縮尺記号の換算値を使用</small></p> : null}
            {selectedFeature?.geometry.type === "Polygon" ? <div className="feature-spray" aria-label="領域へ記号を散布"><strong>領域内へ散布</strong><label>種類<CellAttributeSelect value={sprayFeatureType} onChange={(event) => setSprayFeatureType(event.target.value as SprayFeatureType)} disabled={locked}><option value="tree">木</option><option value="mountain">山</option><option value="symbol">記号</option></CellAttributeSelect></label><label>個数<input type="number" min="1" max="1000" value={sprayCount} onChange={(event) => setSprayCount(Math.max(1, Math.min(1000, Number(event.target.value))))} disabled={locked} /></label><label>最小間隔<input type="number" min="0" max="90" step="0.25" value={spraySpacing} onChange={(event) => setSpraySpacing(Math.max(0, Math.min(90, Number(event.target.value))))} disabled={locked} /></label><label>seed<input value={spraySeed} onChange={(event) => setSpraySeed(event.target.value)} disabled={locked} maxLength={128} /></label><button type="button" onClick={() => sprayInsideFeature(selectedFeature)} disabled={locked}>この領域へ散布</button></div> : null}
          </section>
          <section className="cell-inspector" aria-label="描画テーマ"><h3>描画テーマ</h3><label>地図の表現<CellAttributeSelect value={themeId} onChange={(event) => persistViewSettings({ themeId: event.target.value as MapThemeId })} disabled={locked}>{MAP_THEME_IDS.map((id) => <option key={id} value={id}>{MAP_THEMES[id].name}</option>)}</CellAttributeSelect></label><label>書き出し範囲<CellAttributeSelect value={exportExtent} onChange={(event) => persistViewSettings({ exportExtent: event.target.value as typeof exportExtent })} disabled={locked}><option value="world">世界全体</option><option value="viewport">現在の表示</option></CellAttributeSelect></label><label>書き出し解像度<CellAttributeSelect value={String(exportScale)} onChange={(event) => persistViewSettings({ exportScale: Number(event.target.value) as 1 | 2 | 4 })} disabled={locked}><option value="1">標準</option><option value="2">2倍</option><option value="4">4倍</option></CellAttributeSelect></label><label><input type="checkbox" checked={showGrid} onChange={(event) => persistViewSettings({ showGrid: event.target.checked })} disabled={locked} />経緯線を表示・出力</label></section>
          <section className="layer-inspector" aria-label="表示レイヤー"><h3>表示レイヤー</h3>{FEATURE_TYPES.map(([type, label]) => <label key={type}><input type="checkbox" checked={!hiddenFeatureTypes.has(type)} onChange={() => toggleLayerVisibility(type)} disabled={locked} />{label}</label>)}</section>
          <section className="cell-inspector asset-inspector" aria-label="カスタム素材"><h3>カスタム素材</h3><input ref={assetInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importAssetFile(file); event.currentTarget.value = ""; }} /><button type="button" onClick={() => assetInputRef.current?.click()} disabled={locked}>画像素材を追加</button><label>配置に使う素材<CellAttributeSelect value={featureAssetId} onChange={(event) => setFeatureAssetId(event.target.value)} disabled={locked}><option value="">内蔵記号</option>{viewedSnapshot.assets.map((asset) => <option key={asset.id} value={asset.id}>{typeof asset.metadata.originalName === "string" ? asset.metadata.originalName : `${asset.width}×${asset.height}`}</option>)}</CellAttributeSelect></label>{viewedSnapshot.assets.map((asset) => <div className="asset-row" key={asset.id}><span>{typeof asset.metadata.originalName === "string" ? asset.metadata.originalName : `${asset.width}×${asset.height}`}</span><button type="button" onClick={() => { if (window.confirm("この素材を削除しますか？")) void run(() => backend.deleteAsset({ id: asset.id }), "素材を削除できませんでした。"); }} disabled={locked}>削除</button></div>)}</section>
          <section className="cell-inspector" aria-label="ブラシ設定"><h3>ブラシ</h3><label>操作<CellAttributeSelect value={cellPaintMode} onChange={(event) => setCellPaintMode(event.target.value as "paint" | "erase")} disabled={locked}><option value="paint">塗る</option><option value="erase">消す</option></CellAttributeSelect></label><label>筆の属性<CellAttributeSelect value={cellAttribute} onChange={(event) => { const attribute = event.target.value as CellAttribute; setCellAttribute(attribute); setCellAttributeValue(attribute); }} disabled={locked}><option value="forest">森林</option><option value="country">国</option><option value="region">地域</option></CellAttributeSelect></label><label>値<input value={cellAttributeValue} onChange={(event) => setCellAttributeValue(event.target.value)} disabled={locked || cellAttribute === "forest" || cellPaintMode === "erase"} /></label><label>筆サイズ<CellAttributeSelect value={String(cellBrushRadius)} onChange={(event) => setCellBrushRadius(Number(event.target.value))} disabled={locked}><option value="1">小</option><option value="2">中</option><option value="4">大</option><option value="8">特大</option></CellAttributeSelect></label></section>
        </aside>
        <section className="map-region" aria-label="地図編集領域"><MapCanvas features={viewedSnapshot.features} mode={locked ? "pan" : activeTool} selectedFeatureId={selectedFeatureId} selectedCellIds={selectedCellIds} cellAttributes={cellAttributes} cellBrushRadius={cellBrushRadius} themeId={themeId} showGrid={showGrid} assetUrls={assetUrls} layerVisibility={layerVisibility} onDraw={createDrawnFeature} onSelect={selectFeature} onCellSelect={(ids) => { const selected = [...ids]; setSelectedCellIds(selected); applyCellAttribute(cellPaintMode === "erase" ? null : cellAttributeValue, selected); }} onModify={(id, geometry) => { const feature = viewedSnapshot.features.find((item) => item.id === id); if (feature) reviseFeature(feature, geometry); }} onErase={(id) => { setSelectedFeatureId(null); void run(() => backend.deleteFeature({ id }), "地物を削除できませんでした。"); }} onError={setError} onExporterReady={(exporter) => { mapExporter.current = exporter; }} onZoomChange={setZoom} zoom={zoom} />{nameError ? <p className="save-error" role="alert">{nameError}</p> : error ? <p className="save-error" role="alert">{error}</p> : null}</section>
        <footer className="editor-footer"><MapZoomControls zoom={zoom} onChange={setZoom} /></footer>
      </div>
    </main>
  );
}
