import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  errorMessage,
  type CellAttribute,
  type CellAttributeSnapshot,
  type GeoJsonGeometry,
  type RealmBackend,
  type RealmFeature,
  type RealmSnapshot,
} from "../backend";
import { MapCanvas, MapZoomControls } from "./MapCanvas";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GlobeHemisphereWest } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { pdfFromJpeg, type MapRaster } from "../exportArtifacts";

const FEATURE_TYPES = [
  ["terrain", "地形"], ["forest", "森林"], ["river", "河川"], ["coastline", "海岸線"],
  ["country", "国"], ["region", "地域"], ["boundary", "境界"], ["city", "都市"], ["town", "町"],
] as const;
const CellAttributeSelect = "select";
type Tool = "pan" | "cell-select" | typeof FEATURE_TYPES[number][0];
type EditorShellProps = {
  snapshot: RealmSnapshot;
  backend: RealmBackend;
  busy: boolean;
  onClose: () => void | Promise<void>;
  onSaved: (snapshot: RealmSnapshot) => void;
  onExportTransfer: () => Promise<void>;
  onExportArtifact: (format: "png" | "pdf", bytes: number[]) => Promise<void>;
};

const validateWorldName = (value: string): string | null => {
  if (!value.trim()) return "世界の名前を入力してください。";
  if (value.trim().length > 200) return "世界の名前は200文字以内にしてください。";
  return null;
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
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [operating, setOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const worldNameRef = useRef(worldName);
  const mapExporter = useRef<((mimeType: "image/png" | "image/jpeg") => Promise<MapRaster>) | null>(null);
  const saveTimer = useRef<number | null>(null);
  const cellRequest = useRef(0);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const projectIdentity = `${snapshot.path}:${snapshot.world.id}`;
  const viewedIdentity = useRef(projectIdentity);
  const mounted = useRef(true);

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

  const locked = busy || saving || operating;
  const selectedFeature = viewedSnapshot.features.find((feature) => feature.id === selectedFeatureId) ?? null;
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

  const createDrawnFeature = (geometry: GeoJsonGeometry) => {
    if (activeTool === "pan" || activeTool === "cell-select") return;
    void run(() => backend.createFeature({ featureType: activeTool, name: featureName.trim() || "新しい地物", geometry }), "地物を作成できませんでした。");
    setActiveTool("pan");
  };
  const applyCellAttribute = (value: string | null, ids = selectedCellIds) => {
    if (!ids.length) return;
    void run(() => backend.applyCellAttributes({ cellIds: ids, attribute: cellAttribute, value }), "セル属性を変更できませんでした。", true);
  };
  const selectFeature = (id: string | null) => {
    setSelectedFeatureId(id);
    const feature = viewedSnapshot.features.find((item) => item.id === id);
    if (feature) setFeatureName(feature.name);
  };
  const reviseFeature = (feature: RealmFeature, geometry = feature.geometry) => {
    void run(() => backend.reviseFeature({ id: feature.id, name: featureName.trim() || feature.name, geometry }), "地物を変更できませんでした。");
  };
  const exportMap = async (format: "png" | "pdf") => {
    if (!(await flushSave()) || !mapExporter.current) return;
    await enqueueSerial(commandTail, async () => {
      setOperating(true); setError(null);
      try { const raster = await mapExporter.current!(format === "png" ? "image/png" : "image/jpeg"); await onExportArtifact(format, format === "png" ? raster.bytes : pdfFromJpeg(raster)); }
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

  return (
    <main className="editor-shell" aria-label="Realm編集画面">
      <header className="editor-toolbar">
        <div className="app-mark"><strong>Realm</strong></div>
        <nav className="document-actions" aria-label="ファイル操作">
          <button type="button" onClick={() => { void close(); }} disabled={locked}><FolderOpen aria-hidden="true" size={21} /><span>ライブラリ</span></button>
          <button type="button" onClick={() => { void exportMap("png"); }} disabled={locked}>PNG</button>
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
          {FEATURE_TYPES.map(([type, label]) => <button key={type} className={activeTool === type ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === type} onClick={() => { setActiveTool(type); setSelectedCellIds([]); setSelectedFeatureId(null); setFeatureName(`新しい${label}`); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>{label}</span></button>)}
          <button className={activeTool === "cell-select" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "cell-select"} onClick={() => { setActiveTool("cell-select"); setSelectedCellIds([]); setSelectedFeatureId(null); }} disabled={locked}><span className="feature-tool-mark" aria-hidden="true" /><span>ブラシ</span></button>
        </aside>
        <aside className="world-sidebar" aria-label="世界の構成">
          <div className="sidebar-heading"><h2>世界</h2></div>
          <p>{viewedSnapshot.featureCount === 0 ? "地物はまだありません" : `地物 ${viewedSnapshot.featureCount}件`}</p>
          <div className="feature-list" aria-label="地物一覧">{viewedSnapshot.features.map((feature) => <button key={feature.id} type="button" className={feature.id === selectedFeatureId ? "feature-row feature-row-selected" : "feature-row"} aria-pressed={feature.id === selectedFeatureId} onClick={() => selectFeature(feature.id)} disabled={locked}><strong>{feature.name}</strong><span>{FEATURE_TYPES.find(([type]) => type === feature.featureType)?.[1]}</span></button>)}</div>
          <section className="feature-editor" aria-label="地物編集"><label>地物名<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} disabled={locked} maxLength={200} /></label>{selectedFeature ? <div className="feature-editor-actions"><button type="button" onClick={() => reviseFeature(selectedFeature)} disabled={locked}>名前を保存</button><button type="button" className="danger-action" onClick={() => { if (window.confirm("この地物を削除しますか？")) void run(() => backend.deleteFeature({ id: selectedFeature.id }), "地物を削除できませんでした。"); }} disabled={locked}>削除</button></div> : null}</section>
          <section className="cell-inspector" aria-label="ブラシ設定"><h3>ブラシ</h3><label>操作<CellAttributeSelect value={cellPaintMode} onChange={(event) => setCellPaintMode(event.target.value as "paint" | "erase")} disabled={locked}><option value="paint">塗る</option><option value="erase">消す</option></CellAttributeSelect></label><label>筆の属性<CellAttributeSelect value={cellAttribute} onChange={(event) => { const attribute = event.target.value as CellAttribute; setCellAttribute(attribute); setCellAttributeValue(attribute); }} disabled={locked}><option value="forest">森林</option><option value="country">国</option><option value="region">地域</option></CellAttributeSelect></label><label>値<input value={cellAttributeValue} onChange={(event) => setCellAttributeValue(event.target.value)} disabled={locked || cellAttribute === "forest" || cellPaintMode === "erase"} /></label><label>筆サイズ<CellAttributeSelect value={String(cellBrushRadius)} onChange={(event) => setCellBrushRadius(Number(event.target.value))} disabled={locked}><option value="1">小</option><option value="2">中</option><option value="4">大</option></CellAttributeSelect></label></section>
        </aside>
        <section className="map-region" aria-label="地図編集領域"><MapCanvas features={viewedSnapshot.features} mode={locked ? "pan" : activeTool} selectedFeatureId={selectedFeatureId} selectedCellIds={selectedCellIds} cellAttributes={cellAttributes} cellBrushRadius={cellBrushRadius} onDraw={createDrawnFeature} onSelect={selectFeature} onCellSelect={(ids) => { const selected = [...ids]; setSelectedCellIds(selected); applyCellAttribute(cellPaintMode === "erase" ? null : cellAttributeValue, selected); }} onModify={(id, geometry) => { const feature = viewedSnapshot.features.find((item) => item.id === id); if (feature) reviseFeature(feature, geometry); }} onExporterReady={(exporter) => { mapExporter.current = exporter; }} onZoomChange={setZoom} zoom={zoom} />{nameError ? <p className="save-error" role="alert">{nameError}</p> : error ? <p className="save-error" role="alert">{error}</p> : null}</section>
        <footer className="editor-footer"><MapZoomControls zoom={zoom} onChange={setZoom} /></footer>
      </div>
    </main>
  );
}
