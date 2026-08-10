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
import type { DrawingOptions } from "../map/MapAdapter";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GlobeHemisphereWest } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { pdfFromJpeg, type MapRaster } from "../exportArtifacts";
import { MAP_LABEL_FONT_FAMILIES, type MapLabelFontFamily } from "../map/styles";
import { DEFAULT_MAP_THEME_ID, MAP_THEME_IDS, MAP_THEMES, mapTheme, type MapThemeId, type ThemeColorKey, type ThemeOverrides } from "../map/themes";
import { duplicateOffset, transformGeometries, transformGeometry, type TransformOptions } from "../map/geometryTransform";
import { polygonAreaSquareDegrees, polylineLengthDegrees } from "../map/measurementGeometry";
import { generateSymbolSpray, positionWithinPolygon, type SprayFeatureType } from "../map/symbolSpray";

const FEATURE_TYPES = [
  ["terrain", "地形"], ["forest", "森林"], ["river", "河川"], ["coastline", "海岸線"],
  ["country", "国"], ["region", "地域"], ["boundary", "境界"], ["city", "都市"], ["town", "町"],
  ["road", "道路"], ["lake", "湖"], ["mountain", "山"], ["tree", "木"], ["symbol", "記号"],
  ["label", "ラベル"], ["overlay", "参照領域"], ["frame", "枠"], ["scale", "縮尺記号"],
] as const;
const CellAttributeSelect = "select";
const CUSTOM_THEME_COLORS: readonly [ThemeColorKey, string][] = [
  ["canvas", "海・背景"], ["land", "陸地"], ["landInk", "海岸線"], ["river", "河川"], ["forest", "森林"],
  ["country", "国"], ["region", "地域"], ["boundary", "境界"], ["settlement", "都市・記号"], ["label", "ラベル"],
];
type Tool = "pan" | "cell-select" | "erase" | "polygon-hole" | "label-path" | typeof FEATURE_TYPES[number][0];
const TOOL_SHORTCUTS: Readonly<Partial<Record<string, Tool>>> = {
  c: "terrain", z: "terrain", x: "erase", r: "river", g: "cell-select", m: "mountain", t: "tree",
  p: "road", w: "lake", l: "label", s: "symbol", e: "erase",
};
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
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [cellAttributes, setCellAttributes] = useState<CellAttributeSnapshot[]>([]);
  const [cellAttribute, setCellAttribute] = useState<CellAttribute>("forest");
  const [cellAttributeValue, setCellAttributeValue] = useState("forest");
  const [cellPaintMode, setCellPaintMode] = useState<"paint" | "erase">("paint");
  const [cellBrushRadius, setCellBrushRadius] = useState(2);
  const [drawingGesture, setDrawingGesture] = useState<DrawingOptions["gesture"]>("freehand");
  const [drawingSmoothingPasses, setDrawingSmoothingPasses] = useState(1);
  const [drawingSnapAngleDegrees, setDrawingSnapAngleDegrees] = useState<number | null>(null);
  const [featureName, setFeatureName] = useState("新しい地物");
  const [featureQuery, setFeatureQuery] = useState("");
  const [featureClipboard, setFeatureClipboard] = useState<readonly RealmFeature[]>([]);
  const clipboardPasteCount = useRef(0);
  const [featureWidth, setFeatureWidth] = useState(2.4);
  const [featureStrokeColor, setFeatureStrokeColor] = useState("#357da5");
  const [featureCasingColor, setFeatureCasingColor] = useState("#ffffff");
  const [featureLineStyle, setFeatureLineStyle] = useState<"solid" | "dashed" | "dotted">("solid");
  const [lineProfile, setLineProfile] = useState<"smooth" | "rough" | "angular">("smooth");
  const [lineRoughness, setLineRoughness] = useState(0.55);
  const [areaFillColor, setAreaFillColor] = useState("#c99b67");
  const [areaBorderColor, setAreaBorderColor] = useState("#a97949");
  const [areaFillOpacity, setAreaFillOpacity] = useState(0.18);
  const [areaBorderStyle, setAreaBorderStyle] = useState<"solid" | "dashed" | "dotted">("solid");
  const [featureScale, setFeatureScale] = useState(1);
  const [featureRotation, setFeatureRotation] = useState(0);
  const [featureFlipX, setFeatureFlipX] = useState(false);
  const [symbolKind, setSymbolKind] = useState<"marker" | "compass" | "north">("marker");
  const [labelFontSize, setLabelFontSize] = useState(18);
  const [labelFontFamily, setLabelFontFamily] = useState<MapLabelFontFamily>("system");
  const [labelTextColor, setLabelTextColor] = useState("#29343b");
  const [labelHaloColor, setLabelHaloColor] = useState("#ffffff");
  const [labelHaloWidth, setLabelHaloWidth] = useState(3);
  const [labelPlacement, setLabelPlacement] = useState<"point" | "line">("point");
  const [labelRepeat, setLabelRepeat] = useState(0);
  const [labelMaxAngle, setLabelMaxAngle] = useState(45);
  const [zoom, setZoom] = useState(1);
  const [themeId, setThemeId] = useState<MapThemeId>(snapshot.settings.themeId ?? DEFAULT_MAP_THEME_ID);
  const [exportScale, setExportScale] = useState(snapshot.settings.exportScale ?? 2);
  const [exportExtent, setExportExtent] = useState<"viewport" | "world">(snapshot.settings.exportExtent ?? "world");
  const [exportTransparent, setExportTransparent] = useState(false);
  const [exportQuality, setExportQuality] = useState(0.92);
  const [showGrid, setShowGrid] = useState(snapshot.settings.showGrid ?? true);
  const [canvasWidth, setCanvasWidth] = useState(snapshot.settings.canvasWidth ?? 2048);
  const [canvasHeight, setCanvasHeight] = useState(snapshot.settings.canvasHeight ?? 1024);
  const [gridKind, setGridKind] = useState<ProjectSettings["gridKind"]>(snapshot.settings.gridKind ?? "graticule");
  const [gridColor, setGridColor] = useState(snapshot.settings.gridColor ?? "#687784");
  const [gridWidth, setGridWidth] = useState(snapshot.settings.gridWidth ?? 1);
  const [gridSpacing, setGridSpacing] = useState(snapshot.settings.gridSpacing ?? 10);
  const [themeOverrides, setThemeOverrides] = useState<ThemeOverrides>(snapshot.settings.themeOverrides ?? {});
  const [sprayFeatureType, setSprayFeatureType] = useState<SprayFeatureType>("tree");
  const [sprayCount, setSprayCount] = useState(80);
  const [spraySpacing, setSpraySpacing] = useState(2);
  const [spraySeed, setSpraySeed] = useState("realm");
  const [featureAssetId, setFeatureAssetId] = useState("");
  const [assetPackName, setAssetPackName] = useState("自作素材");
  const [featureVisible, setFeatureVisible] = useState(true);
  const [featureLocked, setFeatureLocked] = useState(false);
  const [featureZIndex, setFeatureZIndex] = useState(0);
  const [featureOpacity, setFeatureOpacity] = useState(1);
  const [overlayBlendMode, setOverlayBlendMode] = useState<"source-over" | "multiply" | "screen" | "overlay" | "soft-light">("source-over");
  const [overlayCrop, setOverlayCrop] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  const [scaleUnit, setScaleUnit] = useState("単位");
  const [scaleUnitsPerDegree, setScaleUnitsPerDegree] = useState(1);
  const [scaleBarLength, setScaleBarLength] = useState(160);
  const [scaleSegments, setScaleSegments] = useState(4);
  const [frameWidth, setFrameWidth] = useState(3);
  const [frameColor, setFrameColor] = useState("#29343b");
  const [frameStyle, setFrameStyle] = useState<"solid" | "dashed" | "double">("solid");
  const [assetUrls, setAssetUrls] = useState<Readonly<Record<string, string>>>({});
  const [hiddenFeatureTypes, setHiddenFeatureTypes] = useState<Set<typeof FEATURE_TYPES[number][0]>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [operating, setOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const worldNameRef = useRef(worldName);
  const mapExporter = useRef<((mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: { width: number; height: number; transparent?: boolean; quality?: number }) => Promise<MapRaster>) | null>(null);
  const saveTimer = useRef<number | null>(null);
  const cellRequest = useRef(0);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const projectIdentity = `${snapshot.path}:${snapshot.world.id}`;
  const assetManifestKey = viewedSnapshot.assets.map((asset) => `${asset.id}:${asset.sha256}`).join("|");
  const referencedAssetIds = new Set(viewedSnapshot.features.map((feature) => feature.properties?.assetId).filter((id): id is string => typeof id === "string"));
  if (featureAssetId) referencedAssetIds.add(featureAssetId);
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
      setSelectedFeatureIds([]);
      setSelectedCellIds([]);
      setFeatureAssetId("");
    } else {
      setSelectedFeatureIds((current) => current.filter((id) => snapshot.features.some((feature) => feature.id === id)));
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
  const selectedFeatures = selectedFeatureIds.map((id) => viewedSnapshot.features.find((feature) => feature.id === id)).filter((feature): feature is RealmFeature => Boolean(feature));
  const selectedFeature = selectedFeatures.length === 1 ? selectedFeatures[0]! : null;
  const effectiveTheme = mapTheme(themeId, themeOverrides);
  const assetPackGroups = [...viewedSnapshot.assets.reduce((groups, asset) => {
    const packId = typeof asset.metadata.packId === "string" ? asset.metadata.packId : "ungrouped";
    const packName = typeof asset.metadata.packName === "string" ? asset.metadata.packName : "個別素材";
    const group = groups.get(packId) ?? { id: packId, name: packName, assets: [] as typeof viewedSnapshot.assets };
    group.assets.push(asset);
    groups.set(packId, group);
    return groups;
  }, new Map<string, { id: string; name: string; assets: typeof viewedSnapshot.assets }>()).values()];
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
      else {
        next.add(featureType);
        setSelectedFeatureIds((selected) => selected.filter((id) => viewedSnapshot.features.find((feature) => feature.id === id)?.featureType !== featureType));
      }
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
    const settings: ProjectSettings = { themeId, showGrid, exportScale: exportScale as 1 | 2 | 4, exportExtent, canvasWidth, canvasHeight, gridKind, gridColor, gridWidth, gridSpacing, themeOverrides, ...overrides };
    if (settings.themeId) setThemeId(settings.themeId);
    if (settings.showGrid !== undefined) setShowGrid(settings.showGrid);
    if (settings.exportScale) setExportScale(settings.exportScale);
    if (settings.exportExtent) setExportExtent(settings.exportExtent);
    if (settings.canvasWidth) setCanvasWidth(settings.canvasWidth);
    if (settings.canvasHeight) setCanvasHeight(settings.canvasHeight);
    if (settings.gridKind) setGridKind(settings.gridKind);
    if (settings.gridColor) setGridColor(settings.gridColor);
    if (settings.gridWidth) setGridWidth(settings.gridWidth);
    if (settings.gridSpacing) setGridSpacing(settings.gridSpacing);
    if (settings.themeOverrides) setThemeOverrides(settings.themeOverrides);
    void run(() => backend.updateProjectSettings({ settings }), "プロジェクト設定を保存できませんでした。");
  };

  const createDrawnFeature = (geometry: GeoJsonGeometry) => {
    if (activeTool === "pan" || activeTool === "cell-select" || activeTool === "erase") return;
    if (activeTool === "polygon-hole") {
      if (!selectedFeature || selectedFeature.geometry.type !== "Polygon" || geometry.type !== "Polygon") {
        setError("穴を追加する領域を1件選択してください。");
        setActiveTool("pan");
        return;
      }
      const selectedPolygon = selectedFeature.geometry;
      const hole = geometry.coordinates[0];
      if (!hole || hole.some((position) => !positionWithinPolygon(position, selectedPolygon.coordinates))) {
        setError("穴は選択した領域の内側へ描いてください。");
        return;
      }
      const nextGeometry: GeoJsonGeometry = { type: "Polygon", coordinates: [...selectedPolygon.coordinates, hole] };
      void run(() => backend.reviseFeature({ id: selectedFeature.id, name: selectedFeature.name, geometry: nextGeometry, properties: selectedFeature.properties ?? {} }), "領域へ穴を追加できませんでした。");
      setActiveTool("pan");
      return;
    }
    if (activeTool === "label-path") {
      if (!selectedFeature || selectedFeature.featureType !== "label" || geometry.type !== "LineString") {
        setError("曲線を設定するラベルを1件選択してください。");
        setActiveTool("pan");
        return;
      }
      void run(() => backend.reviseFeature({
        id: selectedFeature.id,
        name: selectedFeature.name,
        geometry: selectedFeature.geometry,
        properties: { ...selectedFeature.properties, labelPath: geometry.coordinates, labelPlacement: "line", labelRepeat, labelMaxAngle: labelMaxAngle * Math.PI / 180 },
      }), "ラベルの曲線を保存できませんでした。");
      setActiveTool("pan");
      return;
    }
    const properties = defaultFeatureProperties(activeTool);
    if (activeTool === "river" || activeTool === "road") Object.assign(properties, {
      width: featureWidth, strokeColor: featureStrokeColor, casingColor: featureCasingColor, lineStyle: featureLineStyle,
      lineProfile, roughness: lineRoughness,
      fontSize: labelFontSize, fontFamily: labelFontFamily, textColor: labelTextColor, haloColor: labelHaloColor,
      haloWidth: labelHaloWidth, labelPlacement,
    });
    if (activeTool === "country" || activeTool === "region") Object.assign(properties, {
      fillColor: areaFillColor, strokeColor: areaBorderColor, fillOpacity: areaFillOpacity, lineStyle: areaBorderStyle,
      fontFamily: labelFontFamily,
    });
    if (activeTool === "mountain" || activeTool === "tree" || activeTool === "symbol") Object.assign(properties, {
      scale: featureScale, rotation: featureRotation * Math.PI / 180, flipX: featureFlipX,
    });
    if (activeTool === "symbol") properties.symbolKind = symbolKind;
    if (activeTool === "label") Object.assign(properties, {
      fontSize: labelFontSize, fontFamily: labelFontFamily, textColor: labelTextColor, haloColor: labelHaloColor,
      haloWidth: labelHaloWidth, rotation: featureRotation * Math.PI / 180,
    });
    if (["mountain", "tree", "symbol", "overlay"].includes(activeTool) && featureAssetId) properties.assetId = featureAssetId;
    void run(() => backend.createFeature({ featureType: activeTool, name: featureName.trim() || "新しい地物", geometry, properties }), "地物を作成できませんでした。");
  };
  const applyCellAttribute = (value: string | null, ids = selectedCellIds) => {
    if (!ids.length) return;
    void run(() => backend.applyCellAttributes({ cellIds: ids, attribute: cellAttribute, value }), "セル属性を変更できませんでした。", true);
  };
  const loadFeatureEditor = (feature: RealmFeature | undefined) => {
    if (feature) {
      setFeatureName(feature.name);
      setFeatureWidth(typeof feature.properties?.width === "number" ? feature.properties.width : feature.featureType === "road" ? 2.2 : 2.4);
      setFeatureStrokeColor(typeof feature.properties?.strokeColor === "string" ? feature.properties.strokeColor : feature.featureType === "road" ? "#7a573a" : "#357da5");
      setFeatureCasingColor(typeof feature.properties?.casingColor === "string" ? feature.properties.casingColor : "#ffffff");
      setFeatureLineStyle(feature.properties?.lineStyle === "dashed" || feature.properties?.lineStyle === "dotted" ? feature.properties.lineStyle : "solid");
      setLineProfile(feature.properties?.lineProfile === "rough" || feature.properties?.lineProfile === "angular" ? feature.properties.lineProfile : "smooth");
      setLineRoughness(typeof feature.properties?.roughness === "number" ? Math.max(0, Math.min(1, feature.properties.roughness)) : 0.55);
      setAreaFillColor(typeof feature.properties?.fillColor === "string" ? feature.properties.fillColor : feature.featureType === "region" ? "#8e77b4" : "#c99b67");
      setAreaBorderColor(typeof feature.properties?.strokeColor === "string" ? feature.properties.strokeColor : feature.featureType === "region" ? "#705a98" : "#a97949");
      setAreaFillOpacity(typeof feature.properties?.fillOpacity === "number" ? Math.max(0, Math.min(1, feature.properties.fillOpacity)) : feature.featureType === "region" ? 0.12 : 0.18);
      setAreaBorderStyle(feature.properties?.lineStyle === "dashed" || feature.properties?.lineStyle === "dotted" ? feature.properties.lineStyle : "solid");
      setFeatureScale(typeof feature.properties?.scale === "number" ? feature.properties.scale : 1);
      setFeatureRotation(typeof feature.properties?.rotation === "number" ? feature.properties.rotation * 180 / Math.PI : 0);
      setFeatureFlipX(feature.properties?.flipX === true);
      setSymbolKind(feature.properties?.symbolKind === "compass" || feature.properties?.symbolKind === "north" ? feature.properties.symbolKind : "marker");
      setLabelFontSize(typeof feature.properties?.fontSize === "number" ? feature.properties.fontSize : 18);
      setLabelFontFamily(typeof feature.properties?.fontFamily === "string" && feature.properties.fontFamily in MAP_LABEL_FONT_FAMILIES ? feature.properties.fontFamily as MapLabelFontFamily : "system");
      setLabelTextColor(typeof feature.properties?.textColor === "string" ? feature.properties.textColor : "#29343b");
      setLabelHaloColor(typeof feature.properties?.haloColor === "string" ? feature.properties.haloColor : "#ffffff");
      setLabelHaloWidth(typeof feature.properties?.haloWidth === "number" ? feature.properties.haloWidth : 3);
      setLabelPlacement(feature.properties?.labelPlacement === "line" ? "line" : feature.featureType === "river" || feature.featureType === "road" ? "line" : "point");
      setLabelRepeat(typeof feature.properties?.labelRepeat === "number" ? Math.max(0, Math.min(512, feature.properties.labelRepeat)) : 0);
      setLabelMaxAngle(typeof feature.properties?.labelMaxAngle === "number" ? Math.max(15, Math.min(90, feature.properties.labelMaxAngle * 180 / Math.PI)) : 45);
      setFeatureAssetId(typeof feature.properties?.assetId === "string" ? feature.properties.assetId : "");
      setFeatureVisible(feature.properties?.visible !== false);
      setFeatureLocked(feature.properties?.locked === true);
      setFeatureZIndex(typeof feature.properties?.zIndex === "number" ? feature.properties.zIndex : 0);
      setFeatureOpacity(typeof feature.properties?.opacity === "number" ? feature.properties.opacity : 1);
      setOverlayBlendMode(feature.properties?.blendMode === "multiply" || feature.properties?.blendMode === "screen" || feature.properties?.blendMode === "overlay" || feature.properties?.blendMode === "soft-light" ? feature.properties.blendMode : "source-over");
      setOverlayCrop({
        left: typeof feature.properties?.cropLeft === "number" ? Math.max(0, Math.min(0.49, feature.properties.cropLeft)) : 0,
        top: typeof feature.properties?.cropTop === "number" ? Math.max(0, Math.min(0.49, feature.properties.cropTop)) : 0,
        right: typeof feature.properties?.cropRight === "number" ? Math.max(0, Math.min(0.49, feature.properties.cropRight)) : 0,
        bottom: typeof feature.properties?.cropBottom === "number" ? Math.max(0, Math.min(0.49, feature.properties.cropBottom)) : 0,
      });
      setScaleUnit(typeof feature.properties?.unit === "string" ? feature.properties.unit : "単位");
      setScaleUnitsPerDegree(typeof feature.properties?.unitsPerDegree === "number" ? feature.properties.unitsPerDegree : 1);
      setScaleBarLength(typeof feature.properties?.barLengthPx === "number" ? feature.properties.barLengthPx : 160);
      setScaleSegments(typeof feature.properties?.segments === "number" ? feature.properties.segments : 4);
      setFrameWidth(typeof feature.properties?.frameWidth === "number" ? feature.properties.frameWidth : 3);
      setFrameColor(typeof feature.properties?.frameColor === "string" ? feature.properties.frameColor : "#29343b");
      setFrameStyle(feature.properties?.frameStyle === "dashed" || feature.properties?.frameStyle === "double" ? feature.properties.frameStyle : "solid");
    }
  };
  const selectFeatures = (ids: readonly string[]) => {
    const next = [...new Set(ids)].filter((id) => viewedSnapshot.features.some((feature) => feature.id === id));
    setSelectedFeatureIds(next);
    loadFeatureEditor(next.length === 1 ? viewedSnapshot.features.find((feature) => feature.id === next[0]) : undefined);
  };
  const toggleFeatureSelection = (id: string, additive: boolean) => {
    if (!additive) { selectFeatures([id]); return; }
    selectFeatures(selectedFeatureIds.includes(id) ? selectedFeatureIds.filter((selectedId) => selectedId !== id) : [...selectedFeatureIds, id]);
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
      properties.lineProfile = lineProfile;
      properties.roughness = lineRoughness;
    }
    if (feature.featureType === "country" || feature.featureType === "region") {
      properties.fillColor = areaFillColor;
      properties.strokeColor = areaBorderColor;
      properties.fillOpacity = areaFillOpacity;
      properties.lineStyle = areaBorderStyle;
    }
    if (["mountain", "tree", "symbol", "scale"].includes(feature.featureType)) {
      properties.scale = featureScale;
      properties.rotation = featureRotation * Math.PI / 180;
    }
    if (["mountain", "tree", "symbol"].includes(feature.featureType)) properties.flipX = featureFlipX;
    if (feature.featureType === "symbol") properties.symbolKind = symbolKind;
    if (feature.featureType === "overlay") {
      properties.rotation = featureRotation * Math.PI / 180;
      properties.blendMode = overlayBlendMode;
      properties.cropLeft = overlayCrop.left;
      properties.cropTop = overlayCrop.top;
      properties.cropRight = overlayCrop.right;
      properties.cropBottom = overlayCrop.bottom;
    }
    if (feature.featureType === "scale") {
      properties.unit = scaleUnit.trim() || "単位";
      properties.unitsPerDegree = Math.max(0.0001, scaleUnitsPerDegree);
      properties.barLengthPx = Math.max(24, Math.min(640, scaleBarLength));
      properties.segments = Math.max(1, Math.min(12, Math.round(scaleSegments)));
    }
    if (feature.featureType === "frame") {
      properties.frameWidth = Math.max(0.5, Math.min(32, frameWidth));
      properties.frameColor = frameColor;
      properties.frameStyle = frameStyle;
    }
    if (["mountain", "tree", "symbol", "overlay"].includes(feature.featureType)) {
      if (featureAssetId) properties.assetId = featureAssetId;
      else delete properties.assetId;
    }
    if (feature.featureType === "label") {
      properties.fontSize = labelFontSize;
      properties.fontFamily = labelFontFamily;
      properties.textColor = labelTextColor;
      properties.haloColor = labelHaloColor;
      properties.haloWidth = labelHaloWidth;
      properties.rotation = featureRotation * Math.PI / 180;
      properties.labelRepeat = labelRepeat;
      properties.labelMaxAngle = labelMaxAngle * Math.PI / 180;
    }
    if (feature.featureType === "river" || feature.featureType === "road") {
      properties.fontSize = labelFontSize;
      properties.fontFamily = labelFontFamily;
      properties.textColor = labelTextColor;
      properties.haloColor = labelHaloColor;
      properties.haloWidth = labelHaloWidth;
      properties.labelPlacement = labelPlacement;
    }
    if (feature.featureType === "country" || feature.featureType === "region") properties.fontFamily = labelFontFamily;
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
  const clearLabelPath = (feature: RealmFeature) => {
    const properties = { ...feature.properties }; delete properties.labelPath; properties.labelPlacement = "point";
    void run(() => backend.reviseFeature({ id: feature.id, name: feature.name, geometry: feature.geometry, properties }), "ラベルの曲線を解除できませんでした。");
    setActiveTool("pan");
  };
  const duplicateFeature = (feature: RealmFeature) => {
    try {
      const geometry = transformGeometry(feature.geometry, { offset: duplicateOffset(feature.geometry) });
      void run(() => backend.createFeature({ featureType: feature.featureType, name: `${feature.name} の複製`, geometry, properties: feature.properties ?? {} }), "地物を複製できませんでした。");
    } catch (cause) { setError(errorMessage(cause, "地物を複製できませんでした。")); }
  };
  const reviseSelectedFeatures = (changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => {
    const revisions = changes.map(({ id, geometry }) => {
      const feature = viewedSnapshot.features.find((item) => item.id === id);
      return feature && feature.properties?.locked !== true
        ? { id, name: feature.name, geometry, properties: feature.properties ?? {} }
        : null;
    }).filter((revision): revision is NonNullable<typeof revision> => Boolean(revision));
    if (revisions.length === 0) return;
    void run(() => backend.reviseFeaturesBatch({ features: revisions }), "選択した地物を変更できませんでした。");
  };
  const shiftSelectedLayers = (direction: -1 | 1) => {
    const revisions = selectedFeatures.filter((feature) => feature.properties?.locked !== true).map((feature) => {
      const current = typeof feature.properties?.zIndex === "number" ? feature.properties.zIndex : 0;
      return { ...feature, properties: { ...feature.properties, zIndex: Math.max(-1000, Math.min(1000, current + direction)) } };
    });
    if (revisions.length === 0) return;
    if (revisions.length === 1) setFeatureZIndex(revisions[0]!.properties.zIndex as number);
    void run(() => backend.reviseFeaturesBatch({ features: revisions.map((feature) => ({ id: feature.id, name: feature.name, geometry: feature.geometry, properties: feature.properties })) }), "選択した地物の描画順を変更できませんでした。");
  };
  const adjustActiveTool = (direction: -1 | 1, cycleVariant: boolean) => {
    if (cycleVariant) {
      if (activeTool === "river" || activeTool === "road") {
        const profiles = ["smooth", "rough", "angular"] as const; const index = profiles.indexOf(lineProfile);
        setLineProfile(profiles[(index + direction + profiles.length) % profiles.length]!);
      } else if (activeTool === "symbol") {
        const kinds = ["marker", "compass", "north"] as const; const index = kinds.indexOf(symbolKind);
        setSymbolKind(kinds[(index + direction + kinds.length) % kinds.length]!);
      }
      return;
    }
    if (activeTool === "cell-select") {
      const sizes = [1, 2, 4, 8]; const index = sizes.indexOf(cellBrushRadius);
      setCellBrushRadius(sizes[Math.max(0, Math.min(sizes.length - 1, index + direction))]!);
    } else if (activeTool === "river" || activeTool === "road") setFeatureWidth((value) => Math.max(0.5, Math.min(12, value + direction * 0.5)));
    else if (activeTool === "mountain" || activeTool === "tree" || activeTool === "symbol") setFeatureScale((value) => Math.max(0.25, Math.min(4, value + direction * 0.1)));
  };
  const transformSelectedFeatures = (options: TransformOptions) => {
    const editable = selectedFeatures.filter((feature) => feature.properties?.locked !== true);
    if (editable.length === 0) return;
    try {
      const geometries = transformGeometries(editable.map((feature) => feature.geometry), options);
      reviseSelectedFeatures(editable.map((feature, index) => ({ id: feature.id, geometry: geometries[index]! })));
    } catch (cause) { setError(errorMessage(cause, "選択した地物を変形できませんでした。")); }
  };
  const duplicateSelectedFeatures = () => {
    const editable = selectedFeatures.filter((feature) => feature.properties?.locked !== true);
    if (editable.length === 0) return;
    try {
      const offset = duplicateOffset(editable[0]!.geometry);
      const geometries = transformGeometries(editable.map((feature) => feature.geometry), { offset });
      void run(() => backend.createFeaturesBatch({ features: editable.map((feature, index) => ({
        featureType: feature.featureType,
        name: `${feature.name} の複製`,
        geometry: geometries[index]!,
        properties: feature.properties ?? {},
      })) }), "選択した地物を複製できませんでした。");
    } catch (cause) { setError(errorMessage(cause, "選択した地物を複製できませんでした。")); }
  };
  const copySelectedFeatures = () => {
    if (selectedFeatures.length === 0) return;
    setFeatureClipboard(selectedFeatures.map((feature) => ({
      ...feature,
      geometry: JSON.parse(JSON.stringify(feature.geometry)) as GeoJsonGeometry,
      properties: JSON.parse(JSON.stringify(feature.properties ?? {})) as Record<string, unknown>,
    })));
    clipboardPasteCount.current = 0;
  };
  const pasteCopiedFeatures = () => {
    if (featureClipboard.length === 0) return;
    try {
      clipboardPasteCount.current += 1;
      const baseOffset = duplicateOffset(featureClipboard[0]!.geometry);
      const offset: [number, number] = [baseOffset[0] * clipboardPasteCount.current, baseOffset[1] * clipboardPasteCount.current];
      const geometries = transformGeometries(featureClipboard.map((feature) => feature.geometry), { offset });
      void run(() => backend.createFeaturesBatch({ features: featureClipboard.map((feature, index) => ({
        featureType: feature.featureType,
        name: `${feature.name} のコピー`,
        geometry: geometries[index]!,
        properties: { ...feature.properties, locked: false },
      })) }), "コピーした地物を貼り付けできませんでした。");
    } catch (cause) { setError(errorMessage(cause, "コピーした地物を貼り付けできませんでした。")); }
  };
  const cutSelectedFeatures = () => {
    const editable = selectedFeatures.filter((feature) => feature.properties?.locked !== true);
    if (editable.length === 0) return;
    setFeatureClipboard(editable.map((feature) => ({ ...feature, geometry: JSON.parse(JSON.stringify(feature.geometry)) as GeoJsonGeometry, properties: JSON.parse(JSON.stringify(feature.properties ?? {})) as Record<string, unknown> })));
    clipboardPasteCount.current = 0;
    setSelectedFeatureIds([]);
    void run(() => backend.deleteFeaturesBatch({ ids: editable.map((feature) => feature.id) }), "選択した地物を切り取りできませんでした。");
  };
  const deleteSelectedFeatures = () => {
    if (selectedFeatureIds.length === 0 || !window.confirm(`${selectedFeatureIds.length}件の地物を削除しますか？`)) return;
    const ids = [...selectedFeatureIds];
    setSelectedFeatureIds([]);
    void run(() => backend.deleteFeaturesBatch({ ids }), "選択した地物を削除できませんでした。");
  };
  const setSelectedFeaturesLocked = (nextLocked: boolean) => {
    if (selectedFeatureIds.length === 0) return;
    const ids = [...selectedFeatureIds];
    void run(() => backend.setFeaturesLocked({ ids, locked: nextLocked }), nextLocked ? "選択した地物をロックできませんでした。" : "選択した地物のロックを解除できませんでした。");
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
  const importAssetFiles = async (files: readonly File[]) => {
    if (files.length === 0) return;
    if (!(await flushSave())) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true); setError(null);
      try {
        if (files.length > 256 || files.reduce((total, file) => total + file.size, 0) > 64 * 1024 * 1024) throw new Error("素材パックは256件・合計64 MiB以下にしてください。");
        const assets = await Promise.all(files.map(async (file) => {
          if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size === 0 || file.size > 8 * 1024 * 1024) throw new Error("PNG・JPEG・WebP（各8 MiB以下）を選んでください。");
          const dimensions = await imageDimensions(file);
          return { mime: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())], ...dimensions, metadata: { originalName: file.name } };
        }));
        const next = await backend.importAssetsBatch({ packName: assetPackName.trim() || "自作素材", assets });
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
      try { const raster = await mapExporter.current!(format === "png" ? "image/png" : "image/jpeg", exportScale, exportExtent, { width: canvasWidth, height: canvasHeight, transparent: format === "png" && exportTransparent, quality: exportQuality }); await onExportArtifact(format, format === "pdf" ? pdfFromJpeg(raster) : raster.bytes); }
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
      if (!(event.metaKey || event.ctrlKey)) {
        if (locked || event.altKey || event.shiftKey) return;
        const tool = TOOL_SHORTCUTS[key];
        if (tool) {
          event.preventDefault();
          setActiveTool(tool);
          setSelectedCellIds([]);
          if (tool !== "pan") setSelectedFeatureIds([]);
          return;
        }
        const direction = key === "]" ? 1 : key === "[" ? -1 : 0;
        if (direction !== 0) {
          event.preventDefault();
          if (activeTool === "cell-select") {
            const sizes = [1, 2, 4, 8]; const index = sizes.indexOf(cellBrushRadius);
            setCellBrushRadius(sizes[Math.max(0, Math.min(sizes.length - 1, index + direction))]!);
          } else if (activeTool === "river" || activeTool === "road") setFeatureWidth((value) => Math.max(0.5, Math.min(12, value + direction * 0.5)));
          else if (activeTool === "mountain" || activeTool === "tree" || activeTool === "symbol") setFeatureScale((value) => Math.max(0.25, Math.min(4, value + direction * 0.1)));
          return;
        }
        if ((key === "," || key === "." || key === "/") && (activeTool === "mountain" || activeTool === "tree" || activeTool === "symbol")) {
          event.preventDefault();
          setFeatureRotation((value) => key === "/" ? 0 : Math.max(-180, Math.min(180, value + (key === "." ? 15 : -15))));
        }
        if (key === "f" && (activeTool === "mountain" || activeTool === "tree" || activeTool === "symbol")) {
          event.preventDefault();
          setFeatureFlipX((value) => !value);
        }
        return;
      }
      const redo = key === "y" || (key === "z" && event.shiftKey);
      const undo = key === "z" && !event.shiftKey;
      if (locked || (!undo && !redo) || (undo ? !viewedSnapshot.canUndo : !viewedSnapshot.canRedo)) return;
      event.preventDefault();
      void run(() => redo ? backend.redoProject() : backend.undoProject(), redo ? "操作をやり直せませんでした。" : "操作を元に戻せませんでした。", true);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeTool, backend, cellBrushRadius, featureClipboard, locked, selectedFeatures, viewedSnapshot.canRedo, viewedSnapshot.canUndo]);

  return (
    <main className="editor-shell" aria-label="Realm編集画面">
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
          <button type="button" onClick={() => { void run(() => backend.undoProject(), "操作を元に戻せませんでした。", true); }} disabled={locked || !viewedSnapshot.canUndo}>元に戻す</button>
          <button type="button" onClick={() => { void run(() => backend.redoProject(), "操作をやり直せませんでした。", true); }} disabled={locked || !viewedSnapshot.canRedo}>やり直す</button>
        </nav>
        <label className="world-name-input"><span className="sr-only">世界の名前</span><input value={worldName} onChange={(event) => setWorldName(event.target.value)} disabled={locked} maxLength={200} /><PencilSimple aria-hidden="true" size={17} /></label>
        <span className={`save-state ${dirty ? "save-state-dirty" : ""}`} aria-live="polite">{nameError ? "入力を確認" : saving || dirty ? "自動保存中…" : "自動保存済み"}</span>
      </header>
      <div className="editor-body">
        <aside className="left-rail" aria-label="主要ナビゲーション">
          <button className={activeTool === "pan" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "pan"} onClick={() => { setActiveTool("pan"); setSelectedCellIds([]); }} disabled={locked}><GlobeHemisphereWest aria-hidden="true" size={25} /><span>移動</span></button>
          <button className={activeTool === "erase" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "erase"} onClick={() => { setActiveTool("erase"); setSelectedCellIds([]); setSelectedFeatureIds([]); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>消去</span></button>
          {FEATURE_TYPES.map(([type, label]) => <button key={type} className={activeTool === type ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === type} onClick={() => { setActiveTool(type); setSelectedCellIds([]); setSelectedFeatureIds([]); setFeatureName(`新しい${label}`); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>{label}</span></button>)}
          <button className={activeTool === "cell-select" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "cell-select"} onClick={() => { setActiveTool("cell-select"); setSelectedCellIds([]); setSelectedFeatureIds([]); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>ブラシ</span></button>
        </aside>
        <aside className="world-sidebar" aria-label="世界の構成">
          <div className="sidebar-heading"><h2>世界</h2></div>
          <p>{viewedSnapshot.featureCount === 0 ? "地物はまだありません" : `地物 ${viewedSnapshot.featureCount}件`}</p>
          <label className="feature-search">地物を検索<input type="search" value={featureQuery} onChange={(event) => setFeatureQuery(event.target.value)} disabled={locked} /></label>
          <div className="feature-list" aria-label="地物一覧">{listedFeatures.map((feature) => <button key={feature.id} type="button" className={selectedFeatureIds.includes(feature.id) ? "feature-row feature-row-selected" : "feature-row"} aria-pressed={selectedFeatureIds.includes(feature.id)} onClick={(event) => toggleFeatureSelection(feature.id, event.shiftKey || event.metaKey || event.ctrlKey)} disabled={locked}><strong>{feature.name}</strong><span>{FEATURE_TYPES.find(([type]) => type === feature.featureType)?.[1]}{feature.properties?.locked === true ? "・ロック中" : ""}</span></button>)}</div>
          {matchingFeatures.length > listedFeatures.length ? <p className="feature-list-limit">先頭500件を表示中。検索で絞り込めます。</p> : null}
          {selectedFeatures.length > 1 ? <section className="feature-editor multi-feature-editor" aria-label="複数地物の編集"><strong>{selectedFeatures.length}件を選択中</strong><p>Shiftクリック、または地図上を修飾キーを押しながら囲んで選択できます。</p><div className="feature-transform-actions"><button type="button" onClick={duplicateSelectedFeatures} disabled={locked}>まとめて複製</button><button type="button" onClick={() => transformSelectedFeatures({ scale: 1.25 })} disabled={locked}>まとめて拡大</button><button type="button" onClick={() => transformSelectedFeatures({ scale: 0.8 })} disabled={locked}>まとめて縮小</button><button type="button" onClick={() => transformSelectedFeatures({ rotationRadians: Math.PI / 2 })} disabled={locked}>まとめて90°回転</button><button type="button" onClick={() => transformSelectedFeatures({ flipX: true })} disabled={locked}>まとめて左右反転</button><button type="button" onClick={() => transformSelectedFeatures({ flipY: true })} disabled={locked}>まとめて上下反転</button><button type="button" onClick={() => setSelectedFeaturesLocked(true)} disabled={locked}>まとめてロック</button><button type="button" onClick={() => setSelectedFeaturesLocked(false)} disabled={locked}>まとめてロック解除</button><button type="button" className="danger-action" onClick={deleteSelectedFeatures} disabled={locked}>まとめて削除</button></div></section> : null}
          <section className="feature-editor" aria-label="地物編集">
            <label>地物名<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} disabled={locked} maxLength={200} /></label>
            {selectedFeature?.featureType === "river" || selectedFeature?.featureType === "road" ? <><label>線の太さ<input type="range" min="0.5" max="12" step="0.1" value={featureWidth} onChange={(event) => setFeatureWidth(Number(event.target.value))} disabled={locked} /><output>{featureWidth.toFixed(1)}</output></label><label>線色<input type="color" value={featureStrokeColor} onChange={(event) => setFeatureStrokeColor(event.target.value)} disabled={locked} /></label><label>縁色<input type="color" value={featureCasingColor} onChange={(event) => setFeatureCasingColor(event.target.value)} disabled={locked} /></label><label>線種<CellAttributeSelect value={featureLineStyle} onChange={(event) => setFeatureLineStyle(event.target.value as typeof featureLineStyle)} disabled={locked}><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></CellAttributeSelect></label></> : null}
            {selectedFeature && (selectedFeature.featureType === "country" || selectedFeature.featureType === "region") ? <><label>領域の色<input type="color" value={areaFillColor} onChange={(event) => setAreaFillColor(event.target.value)} disabled={locked || featureLocked} /></label><label>領域の濃さ<input type="range" min="0" max="1" step="0.05" value={areaFillOpacity} onChange={(event) => setAreaFillOpacity(Number(event.target.value))} disabled={locked || featureLocked} /><output>{Math.round(areaFillOpacity * 100)}%</output></label><label>境界の色<input type="color" value={areaBorderColor} onChange={(event) => setAreaBorderColor(event.target.value)} disabled={locked || featureLocked} /></label><label>境界の種類<CellAttributeSelect value={areaBorderStyle} onChange={(event) => setAreaBorderStyle(event.target.value as typeof areaBorderStyle)} disabled={locked || featureLocked}><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></CellAttributeSelect></label></> : null}
            {selectedFeature && ["mountain", "tree", "symbol", "scale"].includes(selectedFeature.featureType) ? <><label>記号サイズ<input type="range" min="0.25" max="4" step="0.05" value={featureScale} onChange={(event) => setFeatureScale(Number(event.target.value))} disabled={locked} /><output>{featureScale.toFixed(2)}</output></label><label>回転<input type="range" min="-180" max="180" step="1" value={featureRotation} onChange={(event) => setFeatureRotation(Number(event.target.value))} disabled={locked} /><output>{Math.round(featureRotation)}°</output></label>{["mountain", "tree", "symbol"].includes(selectedFeature.featureType) ? <label><input type="checkbox" checked={featureFlipX} onChange={(event) => setFeatureFlipX(event.target.checked)} disabled={locked || featureLocked} />左右反転</label> : null}</> : null}
            {selectedFeature?.featureType === "overlay" ? <><label>画像の回転<input type="range" min="-180" max="180" step="1" value={featureRotation} onChange={(event) => setFeatureRotation(Number(event.target.value))} disabled={locked} /><output>{Math.round(featureRotation)}°</output></label><label>画像の合成<CellAttributeSelect value={overlayBlendMode} onChange={(event) => setOverlayBlendMode(event.target.value as typeof overlayBlendMode)} disabled={locked}><option value="source-over">通常</option><option value="multiply">乗算</option><option value="screen">スクリーン</option><option value="overlay">オーバーレイ</option><option value="soft-light">ソフトライト</option></CellAttributeSelect></label><fieldset className="overlay-crop-controls"><legend>画像の切り抜き</legend>{(["left", "top", "right", "bottom"] as const).map((edge) => <label key={edge}>{({ left: "左", top: "上", right: "右", bottom: "下" })[edge]}<input type="range" min="0" max="0.49" step="0.01" value={overlayCrop[edge]} onChange={(event) => setOverlayCrop((current) => ({ ...current, [edge]: Number(event.target.value) }))} disabled={locked} /><output>{Math.round(overlayCrop[edge] * 100)}%</output></label>)}</fieldset><p className="editor-help">頂点編集で四隅を動かすと、参照画像を地図へ合わせて変形できます。</p></> : null}
            {selectedFeature?.featureType === "scale" ? <><label>計測単位<input value={scaleUnit} onChange={(event) => setScaleUnit(event.target.value)} disabled={locked} maxLength={32} /></label><label>1度あたり<input type="number" min="0.0001" max="1000000" step="0.1" value={scaleUnitsPerDegree} onChange={(event) => setScaleUnitsPerDegree(Number(event.target.value))} disabled={locked} /></label><label>縮尺線の長さ<input type="range" min="24" max="640" step="8" value={scaleBarLength} onChange={(event) => setScaleBarLength(Number(event.target.value))} disabled={locked} /><output>{Math.round(scaleBarLength)}px</output></label><label>縮尺線の分割<input type="number" min="1" max="12" step="1" value={scaleSegments} onChange={(event) => setScaleSegments(Number(event.target.value))} disabled={locked} /></label></> : null}
            {selectedFeature?.featureType === "frame" ? <><label>枠線の太さ<input type="range" min="0.5" max="32" step="0.5" value={frameWidth} onChange={(event) => setFrameWidth(Number(event.target.value))} disabled={locked} /><output>{frameWidth.toFixed(1)}px</output></label><label>枠線の色<input type="color" value={frameColor} onChange={(event) => setFrameColor(event.target.value)} disabled={locked} /></label><label>枠線の種類<CellAttributeSelect value={frameStyle} onChange={(event) => setFrameStyle(event.target.value as typeof frameStyle)} disabled={locked}><option value="solid">単線</option><option value="double">二重線</option><option value="dashed">破線</option></CellAttributeSelect></label></> : null}
            {selectedFeature && ["mountain", "tree", "symbol", "overlay"].includes(selectedFeature.featureType) ? <label>カスタム素材<CellAttributeSelect value={featureAssetId} onChange={(event) => setFeatureAssetId(event.target.value)} disabled={locked}><option value="">内蔵表現</option>{viewedSnapshot.assets.map((asset) => <option key={asset.id} value={asset.id}>{typeof asset.metadata.originalName === "string" ? asset.metadata.originalName : asset.id}</option>)}</CellAttributeSelect></label> : null}
            {selectedFeature?.featureType === "label" ? <><label>文字サイズ<input type="range" min="8" max="96" step="1" value={labelFontSize} onChange={(event) => setLabelFontSize(Number(event.target.value))} disabled={locked} /><output>{Math.round(labelFontSize)}px</output></label><label>文字色<input type="color" value={labelTextColor} onChange={(event) => setLabelTextColor(event.target.value)} disabled={locked} /></label><label>縁取り色<input type="color" value={labelHaloColor} onChange={(event) => setLabelHaloColor(event.target.value)} disabled={locked} /></label><label>縁取り幅<input type="range" min="0" max="10" step="0.5" value={labelHaloWidth} onChange={(event) => setLabelHaloWidth(Number(event.target.value))} disabled={locked} /><output>{labelHaloWidth.toFixed(1)}px</output></label><label>回転<input type="range" min="-180" max="180" step="1" value={featureRotation} onChange={(event) => setFeatureRotation(Number(event.target.value))} disabled={locked} /><output>{Math.round(featureRotation)}°</output></label></> : null}
            {selectedFeature && (selectedFeature.featureType === "river" || selectedFeature.featureType === "road") ? <><label>線名の配置<CellAttributeSelect value={labelPlacement} onChange={(event) => setLabelPlacement(event.target.value as typeof labelPlacement)} disabled={locked}><option value="line">線に沿う</option><option value="point">中央に置く</option></CellAttributeSelect></label><label>線名の文字サイズ<input type="range" min="8" max="96" step="1" value={labelFontSize} onChange={(event) => setLabelFontSize(Number(event.target.value))} disabled={locked} /><output>{Math.round(labelFontSize)}px</output></label><label>線名の文字色<input type="color" value={labelTextColor} onChange={(event) => setLabelTextColor(event.target.value)} disabled={locked} /></label><label>線名の縁取り<input type="color" value={labelHaloColor} onChange={(event) => setLabelHaloColor(event.target.value)} disabled={locked} /></label><label>線名の縁取り幅<input type="range" min="0" max="10" step="0.5" value={labelHaloWidth} onChange={(event) => setLabelHaloWidth(Number(event.target.value))} disabled={locked} /><output>{labelHaloWidth.toFixed(1)}px</output></label></> : null}
            {selectedFeature ? <div className="feature-layer-controls" aria-label="地物レイヤー設定"><label><input type="checkbox" checked={featureVisible} onChange={(event) => setFeatureVisible(event.target.checked)} disabled={locked || featureLocked} />表示</label><label><input type="checkbox" checked={featureLocked} onChange={(event) => { const next = event.target.checked; setFeatureLocked(next); setSelectedFeaturesLocked(next); }} disabled={locked} />ロック</label><label className="feature-opacity">不透明度<input type="range" min="0.05" max="1" step="0.05" value={featureOpacity} onChange={(event) => setFeatureOpacity(Number(event.target.value))} disabled={locked || featureLocked} /><output>{Math.round(featureOpacity * 100)}%</output></label><button type="button" onClick={() => setFeatureZIndex((value) => Math.min(1000, value + 1))} disabled={locked || featureLocked}>前面へ</button><button type="button" onClick={() => setFeatureZIndex((value) => Math.max(-1000, value - 1))} disabled={locked || featureLocked}>背面へ</button><output>順序 {featureZIndex}</output></div> : null}
            {selectedFeature ? <><div className="feature-transform-actions" aria-label="地物の変形"><button type="button" onClick={() => duplicateFeature(selectedFeature)} disabled={locked || featureLocked}>複製</button>{selectedFeature.geometry.type !== "Point" ? <><button type="button" onClick={() => transformSelectedFeature(selectedFeature, { scale: 1.25 })} disabled={locked || featureLocked}>拡大</button><button type="button" onClick={() => transformSelectedFeature(selectedFeature, { scale: 0.8 })} disabled={locked || featureLocked}>縮小</button></> : null}<button type="button" onClick={() => transformSelectedFeature(selectedFeature, { rotationRadians: Math.PI / 2 })} disabled={locked || featureLocked}>90°回転</button><button type="button" onClick={() => transformSelectedFeature(selectedFeature, { flipX: true })} disabled={locked || featureLocked}>左右反転</button><button type="button" onClick={() => transformSelectedFeature(selectedFeature, { flipY: true })} disabled={locked || featureLocked}>上下反転</button></div><div className="feature-editor-actions"><button type="button" onClick={() => saveFeatureAppearance(selectedFeature)} disabled={locked || featureLocked}>変更を保存</button><button type="button" className="danger-action" onClick={() => { if (window.confirm("この地物を削除しますか？")) void run(() => backend.deleteFeature({ id: selectedFeature.id }), "地物を削除できませんでした。"); }} disabled={locked || featureLocked}>削除</button></div></> : null}
            {selectedMeasurement ? <p className="feature-measurement"><span>平面計測</span><strong>{selectedMeasurement}</strong><small>最初の縮尺記号の換算値を使用</small></p> : null}
            {selectedFeature && (selectedFeature.featureType === "river" || selectedFeature.featureType === "road") ? <><label>線の描き味<CellAttributeSelect value={lineProfile} onChange={(event) => setLineProfile(event.target.value as typeof lineProfile)} disabled={locked || featureLocked}><option value="smooth">滑らか</option><option value="rough">手描き</option><option value="angular">角張り</option></CellAttributeSelect></label><label>手描きの粗さ<input type="range" min="0" max="1" step="0.05" value={lineRoughness} onChange={(event) => setLineRoughness(Number(event.target.value))} disabled={locked || featureLocked || lineProfile !== "rough"} /><output>{Math.round(lineRoughness * 100)}%</output></label></> : null}
            {selectedFeature && ["label", "river", "road", "country", "region"].includes(selectedFeature.featureType) ? <label>ラベル書体<CellAttributeSelect value={labelFontFamily} onChange={(event) => setLabelFontFamily(event.target.value as MapLabelFontFamily)} disabled={locked || featureLocked}><option value="system">システム</option><option value="serif">古典セリフ</option><option value="handwritten">手書き風</option><option value="condensed">細身</option></CellAttributeSelect></label> : null}
            {selectedFeature?.featureType === "label" ? <div className="label-path-controls"><label>ラベル本文<textarea value={featureName} onChange={(event) => setFeatureName(event.target.value)} rows={3} maxLength={200} disabled={locked || featureLocked} /></label><label>曲線の繰り返し<input type="range" min="0" max="512" step="8" value={labelRepeat} onChange={(event) => setLabelRepeat(Number(event.target.value))} disabled={locked || featureLocked} /><output>{labelRepeat === 0 ? "なし" : `${labelRepeat}px`}</output></label><label>曲がり許容<input type="range" min="15" max="90" step="5" value={labelMaxAngle} onChange={(event) => setLabelMaxAngle(Number(event.target.value))} disabled={locked || featureLocked} /><output>{Math.round(labelMaxAngle)}°</output></label><button type="button" aria-pressed={activeTool === "label-path"} onClick={() => setActiveTool(activeTool === "label-path" ? "pan" : "label-path")} disabled={locked || featureLocked}>{activeTool === "label-path" ? "曲線描画を終了" : "ラベル曲線を描く"}</button>{Array.isArray(selectedFeature.properties?.labelPath) ? <button type="button" onClick={() => clearLabelPath(selectedFeature)} disabled={locked || featureLocked}>曲線を解除</button> : null}</div> : null}
            {selectedFeature?.featureType === "symbol" ? <label>内蔵記号<CellAttributeSelect value={symbolKind} onChange={(event) => setSymbolKind(event.target.value as typeof symbolKind)} disabled={locked || featureLocked || Boolean(featureAssetId)}><option value="marker">目印</option><option value="compass">方位盤</option><option value="north">北向き矢印</option></CellAttributeSelect></label> : null}
            {selectedFeature?.geometry.type === "Polygon" ? <button type="button" aria-pressed={activeTool === "polygon-hole"} onClick={() => setActiveTool(activeTool === "polygon-hole" ? "pan" : "polygon-hole")} disabled={locked || featureLocked}>{activeTool === "polygon-hole" ? "穴の追加を終了" : "領域の内側に穴を追加"}</button> : null}
            {selectedFeature?.geometry.type === "Polygon" ? <div className="feature-spray" aria-label="領域へ記号を散布"><strong>領域内へ散布</strong><label>種類<CellAttributeSelect value={sprayFeatureType} onChange={(event) => setSprayFeatureType(event.target.value as SprayFeatureType)} disabled={locked}><option value="tree">木</option><option value="mountain">山</option><option value="symbol">記号</option></CellAttributeSelect></label><label>個数<input type="number" min="1" max="1000" value={sprayCount} onChange={(event) => setSprayCount(Math.max(1, Math.min(1000, Number(event.target.value))))} disabled={locked} /></label><label>最小間隔<input type="number" min="0" max="90" step="0.25" value={spraySpacing} onChange={(event) => setSpraySpacing(Math.max(0, Math.min(90, Number(event.target.value))))} disabled={locked} /></label><label>seed<input value={spraySeed} onChange={(event) => setSpraySeed(event.target.value)} disabled={locked} maxLength={128} /></label><button type="button" onClick={() => sprayInsideFeature(selectedFeature)} disabled={locked}>この領域へ散布</button></div> : null}
          </section>
          <section className="cell-inspector" aria-label="描画テーマ"><h3>描画テーマ</h3><label>地図の表現<CellAttributeSelect value={themeId} onChange={(event) => persistViewSettings({ themeId: event.target.value as MapThemeId })} disabled={locked}>{MAP_THEME_IDS.map((id) => <option key={id} value={id}>{MAP_THEMES[id].name}</option>)}</CellAttributeSelect></label><label>キャンバス幅<input type="number" min="512" max="8192" step="1" value={canvasWidth} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 512 && value <= 8192) setCanvasWidth(value); }} onBlur={() => persistViewSettings({ canvasWidth })} disabled={locked} /></label><label>キャンバス高さ<input type="number" min="512" max="8192" step="1" value={canvasHeight} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 512 && value <= 8192) setCanvasHeight(value); }} onBlur={() => persistViewSettings({ canvasHeight })} disabled={locked} /></label><label>書き出し範囲<CellAttributeSelect value={exportExtent} onChange={(event) => persistViewSettings({ exportExtent: event.target.value as typeof exportExtent })} disabled={locked}><option value="world">世界全体</option><option value="viewport">現在の表示</option></CellAttributeSelect></label><label>書き出し解像度<CellAttributeSelect value={String(exportScale)} onChange={(event) => persistViewSettings({ exportScale: Number(event.target.value) as 1 | 2 | 4 })} disabled={locked}><option value="1">標準</option><option value="2">2倍</option><option value="4">4倍</option></CellAttributeSelect></label><label><input type="checkbox" checked={showGrid} onChange={(event) => persistViewSettings({ showGrid: event.target.checked })} disabled={locked} />グリッドを表示・出力</label><label>グリッド種類<CellAttributeSelect value={gridKind} onChange={(event) => persistViewSettings({ gridKind: event.target.value as ProjectSettings["gridKind"] })} disabled={locked}><option value="graticule">経緯線</option><option value="square">正方格子</option><option value="hex">六角格子</option></CellAttributeSelect></label><label>グリッド色<input type="color" value={gridColor} onChange={(event) => persistViewSettings({ gridColor: event.target.value })} disabled={locked} /></label><label>グリッド線幅<input type="range" min="0.25" max="4" step="0.25" value={gridWidth} onChange={(event) => persistViewSettings({ gridWidth: Number(event.target.value) })} disabled={locked} /><output>{gridWidth.toFixed(2)}px</output></label><label>グリッド間隔<input type="range" min="2" max="45" step="1" value={gridSpacing} onChange={(event) => persistViewSettings({ gridSpacing: Number(event.target.value) })} disabled={locked} /><output>{Math.round(gridSpacing)}°</output></label></section>
          <section className="cell-inspector theme-customizer" aria-label="テーマ配色"><h3>テーマ配色</h3>{CUSTOM_THEME_COLORS.map(([key, label]) => <label key={key}>{label}<input type="color" value={themeOverrides[key] ?? effectiveTheme[key]} onChange={(event) => persistViewSettings({ themeOverrides: { ...themeOverrides, [key]: event.target.value } })} disabled={locked} /></label>)}<button type="button" onClick={() => persistViewSettings({ themeOverrides: {} })} disabled={locked || Object.keys(themeOverrides).length === 0}>既定の配色に戻す</button></section>
          <section className="layer-inspector" aria-label="表示レイヤー"><h3>表示レイヤー</h3>{FEATURE_TYPES.map(([type, label]) => <label key={type}><input type="checkbox" checked={!hiddenFeatureTypes.has(type)} onChange={() => toggleLayerVisibility(type)} disabled={locked} />{label}</label>)}</section>
          <section className="cell-inspector asset-inspector" aria-label="カスタム素材"><h3>カスタム素材</h3><label>パック名<input value={assetPackName} onChange={(event) => setAssetPackName(event.target.value)} disabled={locked} maxLength={128} /></label><input ref={assetInputRef} className="sr-only" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void importAssetFiles(files); event.currentTarget.value = ""; }} /><button type="button" onClick={() => assetInputRef.current?.click()} disabled={locked}>素材パックを追加</button><label>配置に使う素材<CellAttributeSelect value={featureAssetId} onChange={(event) => setFeatureAssetId(event.target.value)} disabled={locked}><option value="">内蔵記号</option>{viewedSnapshot.assets.map((asset) => <option key={asset.id} value={asset.id}>{typeof asset.metadata.originalName === "string" ? asset.metadata.originalName : `${asset.width}×${asset.height}`}</option>)}</CellAttributeSelect></label>{featureAssetId && assetUrls[featureAssetId] ? <img className="asset-preview" src={assetUrls[featureAssetId]} alt="選択中の素材プレビュー" /> : null}{assetPackGroups.map((pack) => <div className="asset-pack" key={pack.id}><div className="asset-pack-heading"><strong>{pack.name}</strong><span>{pack.assets.length}件</span>{pack.id !== "ungrouped" ? <button type="button" onClick={() => { if (window.confirm(`素材パック「${pack.name}」を削除しますか？`)) void run(() => backend.deleteAssetsBatch({ ids: pack.assets.map(({ id }) => id) }), "素材パックを削除できませんでした。"); }} disabled={locked}>パックを削除</button> : null}</div>{pack.assets.map((asset) => <div className="asset-row" key={asset.id}><span>{typeof asset.metadata.originalName === "string" ? asset.metadata.originalName : `${asset.width}×${asset.height}`}</span><button type="button" onClick={() => { if (window.confirm("この素材を削除しますか？")) void run(() => backend.deleteAsset({ id: asset.id }), "素材を削除できませんでした。"); }} disabled={locked}>削除</button></div>)}</div>)}</section>
          <section className="cell-inspector" aria-label="ブラシ設定"><h3>ブラシ</h3><label>操作<CellAttributeSelect value={cellPaintMode} onChange={(event) => setCellPaintMode(event.target.value as "paint" | "erase")} disabled={locked}><option value="paint">塗る</option><option value="erase">消す</option></CellAttributeSelect></label><label>筆の属性<CellAttributeSelect value={cellAttribute} onChange={(event) => { const attribute = event.target.value as CellAttribute; setCellAttribute(attribute); setCellAttributeValue(attribute); }} disabled={locked}><option value="forest">森林</option><option value="country">国</option><option value="region">地域</option></CellAttributeSelect></label><label>値<input value={cellAttributeValue} onChange={(event) => setCellAttributeValue(event.target.value)} disabled={locked || cellAttribute === "forest" || cellPaintMode === "erase"} /></label><label>筆サイズ<CellAttributeSelect value={String(cellBrushRadius)} onChange={(event) => setCellBrushRadius(Number(event.target.value))} disabled={locked}><option value="1">小</option><option value="2">中</option><option value="4">大</option><option value="8">特大</option></CellAttributeSelect></label></section>
          <section className="cell-inspector" aria-label="線と領域の描き方"><h3>線・領域</h3><label>入力方式<CellAttributeSelect value={drawingGesture} onChange={(event) => setDrawingGesture(event.target.value as DrawingOptions["gesture"])} disabled={locked}><option value="freehand">フリーハンド</option><option value="vertices">点をつないで描く</option></CellAttributeSelect></label><label>滑らかさ<input type="range" min="0" max="4" step="1" value={drawingSmoothingPasses} onChange={(event) => setDrawingSmoothingPasses(Number(event.target.value))} disabled={locked} /><output>{drawingSmoothingPasses}</output></label><label>角度スナップ<CellAttributeSelect value={drawingSnapAngleDegrees === null ? "none" : String(drawingSnapAngleDegrees)} onChange={(event) => setDrawingSnapAngleDegrees(event.target.value === "none" ? null : Number(event.target.value))} disabled={locked || drawingGesture !== "vertices"}><option value="none">なし</option><option value="15">15°</option><option value="30">30°</option><option value="45">45°</option><option value="90">90°</option></CellAttributeSelect></label></section>
        </aside>
        <section className="map-region" aria-label="地図編集領域"><MapCanvas features={viewedSnapshot.features} mode={locked ? "pan" : activeTool} selectedFeatureIds={selectedFeatureIds} selectedCellIds={selectedCellIds} cellAttributes={cellAttributes} cellBrushRadius={cellBrushRadius} drawingOptions={{ gesture: drawingGesture, smoothingPasses: drawingSmoothingPasses, snapAngleDegrees: drawingSnapAngleDegrees }} themeId={themeId} themeOverrides={themeOverrides} showGrid={showGrid} gridOptions={{ kind: gridKind, color: gridColor, width: gridWidth, spacingDegrees: gridSpacing }} assetUrls={assetUrls} layerVisibility={layerVisibility} onDraw={createDrawnFeature} onSelectFeatures={selectFeatures} onCellSelect={(ids) => { const selected = [...ids]; setSelectedCellIds(selected); applyCellAttribute(cellPaintMode === "erase" ? null : cellAttributeValue, selected); }} onModifyFeatures={reviseSelectedFeatures} onEraseFeatures={(ids) => { setSelectedFeatureIds([]); void run(() => backend.deleteFeaturesBatch({ ids: [...ids] }), "地物を削除できませんでした。"); }} onLayerShift={shiftSelectedLayers} onToolWheel={adjustActiveTool} onError={setError} onExporterReady={(exporter) => { mapExporter.current = exporter; }} onZoomChange={setZoom} zoom={zoom} />{nameError ? <p className="save-error" role="alert">{nameError}</p> : error ? <p className="save-error" role="alert">{error}</p> : null}</section>
        <footer className="editor-footer"><MapZoomControls zoom={zoom} onChange={setZoom} /></footer>
      </div>
    </main>
  );
}
