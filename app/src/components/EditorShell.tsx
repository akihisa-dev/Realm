import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  errorMessage,
  type EraInput,
  type FeatureType,
  type GeoJsonGeometry,
  type RealmBackend,
  type RealmFeature,
  type RealmSnapshot,
  type TimelineEventInput,
} from "../backend";
import { MapCanvas, MapZoomControls } from "./MapCanvas";
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { File } from "@phosphor-icons/react/dist/csr/File";
import { FloppyDisk } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GlobeHemisphereWest } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { SkipBack } from "@phosphor-icons/react/dist/csr/SkipBack";
import { X } from "@phosphor-icons/react/dist/csr/X";

type EditableEra = Omit<EraInput, "startYear" | "endYear"> & {
  editorKey: string;
  startYear: string;
  endYear: string;
};

type EditableTimelineEvent = Omit<TimelineEventInput, "startYear" | "endYear"> & {
  editorKey: string;
  startYear: string;
  endYear: string;
};

const FEATURE_TYPES: readonly { type: FeatureType; label: string }[] = [
  { type: "terrain", label: "地形" },
  { type: "forest", label: "森林" },
  { type: "river", label: "河川" },
  { type: "coastline", label: "海岸線" },
  { type: "country", label: "国" },
  { type: "region", label: "地域" },
  { type: "boundary", label: "境界" },
  { type: "city", label: "都市" },
  { type: "town", label: "町" },
];

const MIN_YEAR = -2_147_483_648;
const MAX_YEAR = 2_147_483_647;
const TIMELINE_SPAN = 5_000;
const TIMELINE_STEP = 1_000;
const INTEGER_YEAR = /^-?\d+$/;

const parseYear = (value: string): number | null => {
  const trimmed = value.trim();
  if (!INTEGER_YEAR.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= MIN_YEAR && parsed <= MAX_YEAR ? parsed : null;
};

const timelineWindowStart = (year: number): number => {
  if (year >= 0 && year <= TIMELINE_SPAN) return 0;
  const centered = year - Math.floor(TIMELINE_SPAN / 2);
  return Math.min(MAX_YEAR - TIMELINE_SPAN, Math.max(MIN_YEAR, centered));
};

const normalizeEditableEras = (eras: EditableEra[]): { eras: EraInput[]; error: string | null } => {
  const normalized: EraInput[] = [];
  for (const era of eras) {
    const name = era.name.trim();
    if (!name) return { eras: [], error: "時代の名前を入力してください。" };
    if (name.length > 200) return { eras: [], error: "時代の名前は200文字以内にしてください。" };
    const startYear = parseYear(era.startYear);
    if (startYear === null) return { eras: [], error: "時代の開始年を整数で入力してください。" };
    const endYear = era.endYear.trim() === "" ? null : parseYear(era.endYear);
    if (era.endYear.trim() !== "" && endYear === null) {
      return { eras: [], error: "時代の終了年を整数で入力してください。" };
    }
    if (endYear !== null && endYear < startYear) {
      return { eras: [], error: "時代の終了年は開始年以降にしてください。" };
    }
    normalized.push({ id: era.id, name, startYear, endYear });
  }
  return { eras: normalized, error: null };
};

const normalizeEditableEvents = (events: EditableTimelineEvent[]): { events: TimelineEventInput[]; error: string | null } => {
  const normalized: TimelineEventInput[] = [];
  for (const event of events) {
    const title = event.title.trim();
    if (!title) return { events: [], error: "出来事のタイトルを入力してください。" };
    if (title.length > 200) return { events: [], error: "出来事のタイトルは200文字以内にしてください。" };
    if (event.description.length > 10_000) return { events: [], error: "出来事の説明が長すぎます。" };
    const startYear = parseYear(event.startYear);
    if (startYear === null) return { events: [], error: "出来事の開始年を整数で入力してください。" };
    const endYear = event.endYear.trim() === "" ? null : parseYear(event.endYear);
    if (event.endYear.trim() !== "" && endYear === null) return { events: [], error: "出来事の終了年を整数で入力してください。" };
    if (endYear !== null && endYear < startYear) return { events: [], error: "出来事の終了年は開始年以降にしてください。" };
    normalized.push({ id: event.id, title, description: event.description.trim(), startYear, endYear });
  }
  return { events: normalized, error: null };
};

type EditorShellProps = {
  snapshot: RealmSnapshot;
  backend: RealmBackend;
  busy: boolean;
  onCreate: () => void;
  onOpen: () => void;
  onClose: () => void;
  onSaved: (snapshot: RealmSnapshot) => void;
};

const editableEras = (snapshot: RealmSnapshot): EditableEra[] =>
  snapshot.eras.map((era) => ({
    id: era.id,
    name: era.name,
    startYear: String(era.startYear),
    endYear: era.endYear === null ? "" : String(era.endYear),
    editorKey: era.id,
  }));

const editableEvents = (snapshot: RealmSnapshot): EditableTimelineEvent[] =>
  snapshot.timelineEvents.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
    startYear: String(event.startYear),
    endYear: event.endYear === null ? "" : String(event.endYear),
    editorKey: event.id,
  }));

export function EditorShell({ snapshot, backend, busy, onCreate, onOpen, onClose, onSaved }: EditorShellProps) {
  const [viewedSnapshot, setViewedSnapshot] = useState(snapshot);
  const [worldName, setWorldName] = useState(snapshot.world.name);
  const [currentYearDraft, setCurrentYearDraft] = useState(String(snapshot.world.currentYear));
  const [timelineStart, setTimelineStart] = useState(() => timelineWindowStart(snapshot.world.currentYear));
  const [eras, setEras] = useState<EditableEra[]>(() => editableEras(snapshot));
  const [selectedEraKey, setSelectedEraKey] = useState<string | null>(snapshot.eras[0]?.id ?? null);
  const [timelineEvents, setTimelineEvents] = useState<EditableTimelineEvent[]>(() => editableEvents(snapshot));
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(snapshot.timelineEvents[0]?.id ?? null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<"pan" | FeatureType>("pan");
  const [featureName, setFeatureName] = useState("新しい地物");
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [operating, setOperating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const viewSequence = useRef(0);

  useLayoutEffect(() => {
    const nextEras = editableEras(snapshot);
    const nextEvents = editableEvents(snapshot);
    setViewedSnapshot(snapshot);
    setWorldName(snapshot.world.name);
    setCurrentYearDraft(String(snapshot.world.currentYear));
    setTimelineStart(timelineWindowStart(snapshot.world.currentYear));
    setEras(nextEras);
    setTimelineEvents(nextEvents);
    setSelectedEraKey((current) =>
      current && nextEras.some((era) => era.editorKey === current)
        ? current
        : (nextEras[0]?.editorKey ?? null));
    setSelectedEventKey((current) =>
      current && nextEvents.some((event) => event.editorKey === current)
        ? current
        : (nextEvents[0]?.editorKey ?? null));
    setSelectedFeatureId((current) => snapshot.features.some((feature) => feature.id === current) ? current : null);
  }, [snapshot]);

  const dirty = useMemo(() => {
    if (worldName !== snapshot.world.name || currentYearDraft !== String(snapshot.world.currentYear)) return true;
    if (eras.length !== snapshot.eras.length) return true;
    const erasChanged = eras.some((era, index) => {
      const persisted = snapshot.eras[index];
      return !persisted
        || era.id !== persisted.id
        || era.name !== persisted.name
        || era.startYear !== String(persisted.startYear)
        || era.endYear !== (persisted.endYear === null ? "" : String(persisted.endYear));
    });
    if (erasChanged || timelineEvents.length !== snapshot.timelineEvents.length) return true;
    return timelineEvents.some((event, index) => {
      const persisted = snapshot.timelineEvents[index];
      return !persisted
        || event.id !== persisted.id
        || event.title !== persisted.title
        || event.description !== persisted.description
        || event.startYear !== String(persisted.startYear)
        || event.endYear !== (persisted.endYear === null ? "" : String(persisted.endYear));
    });
  }, [currentYearDraft, eras, snapshot, timelineEvents, worldName]);

  const normalizedEraResult = useMemo(() => normalizeEditableEras(eras), [eras]);
  const normalizedEventResult = useMemo(() => normalizeEditableEvents(timelineEvents), [timelineEvents]);
  const parsedCurrentYear = parseYear(currentYearDraft);
  const validationError = useMemo(() => {
    if (!worldName.trim()) return "世界の名前を入力してください。";
    if (worldName.trim().length > 200) return "世界の名前は200文字以内にしてください。";
    if (parsedCurrentYear === null) return "表示年を32ビット整数で入力してください。";
    return normalizedEraResult.error ?? normalizedEventResult.error;
  }, [normalizedEraResult.error, normalizedEventResult.error, parsedCurrentYear, worldName]);
  const locked = busy || saving || operating;
  const viewYear = parsedCurrentYear ?? snapshot.world.currentYear;
  const timelineEnd = timelineStart + TIMELINE_SPAN;
  const timelineTicks = Array.from(
    { length: (TIMELINE_SPAN / TIMELINE_STEP) + 1 },
    (_, index) => timelineStart + (index * TIMELINE_STEP),
  );

  const selectedEra = eras.find((era) => era.editorKey === selectedEraKey) ?? null;
  const selectedEvent = timelineEvents.find((event) => event.editorKey === selectedEventKey) ?? null;
  const selectedFeature = viewedSnapshot.features.find((feature) => feature.id === selectedFeatureId) ?? null;
  const currentEra = normalizedEraResult.eras.find((era) =>
    era.startYear <= viewYear && (era.endYear === null || viewYear <= era.endYear));

  useEffect(() => {
    if (parsedCurrentYear === null) return undefined;
    const operation = ++viewSequence.current;
    let active = true;
    void backend.viewProjectYear(parsedCurrentYear)
      .then((next) => {
        if (active && viewSequence.current === operation) {
          setViewedSnapshot(next);
          setSelectedFeatureId((current) => next.features.some((feature) => feature.id === current) ? current : null);
        }
      })
      .catch((cause: unknown) => {
        if (active && viewSequence.current === operation) setSaveError(errorMessage(cause, "この年の地図を読み込めませんでした。"));
      });
    return () => { active = false; };
  }, [backend, parsedCurrentYear]);

  const setViewYear = (year: number) => {
    const nextYear = Math.min(MAX_YEAR, Math.max(MIN_YEAR, year));
    setCurrentYearDraft(String(nextYear));
    setTimelineStart((currentStart) =>
      nextYear < currentStart || nextYear > currentStart + TIMELINE_SPAN
        ? timelineWindowStart(nextYear)
        : currentStart);
  };

  const setViewYearDraft = (value: string) => {
    setCurrentYearDraft(value);
    const year = parseYear(value);
    if (year !== null) {
      setTimelineStart((currentStart) =>
        year < currentStart || year > currentStart + TIMELINE_SPAN
          ? timelineWindowStart(year)
          : currentStart);
    }
  };

  const confirmDiscard = (): boolean =>
    !dirty || window.confirm("保存していない変更を破棄しますか？");

  const navigate = (action: () => void) => {
    if (confirmDiscard()) action();
  };

  const save = async () => {
    if (validationError || parsedCurrentYear === null) {
      setSaveError(validationError ?? "表示年を確認してください。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await backend.saveProject({
        name: worldName,
        currentYear: parsedCurrentYear,
        eras: normalizedEraResult.eras,
        timelineEvents: normalizedEventResult.events,
      });
      onSaved(saved);
    } catch (cause) {
      setSaveError(errorMessage(cause, "保存に失敗しました。"));
    } finally {
      setSaving(false);
    }
  };

  const addEra = () => {
    const editorKey = crypto.randomUUID();
    setEras((current) => [...current, {
      id: null,
      editorKey,
      name: "新しい時代",
      startYear: String(viewYear),
      endYear: "",
    }]);
    setSelectedEraKey(editorKey);
  };

  const updateSelectedEra = (update: Partial<EditableEra>) => {
    if (!selectedEraKey) return;
    setEras((current) => current.map((era) =>
      era.editorKey === selectedEraKey ? { ...era, ...update } : era));
  };

  const removeSelectedEra = () => {
    if (!selectedEraKey) return;
    setEras((current) => current.filter((era) => era.editorKey !== selectedEraKey));
    setSelectedEraKey(null);
  };

  const addTimelineEvent = () => {
    const editorKey = crypto.randomUUID();
    setTimelineEvents((current) => [...current, {
      id: null,
      editorKey,
      title: "新しい出来事",
      description: "",
      startYear: String(viewYear),
      endYear: "",
    }]);
    setSelectedEventKey(editorKey);
  };

  const updateSelectedEvent = (update: Partial<EditableTimelineEvent>) => {
    if (!selectedEventKey) return;
    setTimelineEvents((current) => current.map((event) =>
      event.editorKey === selectedEventKey ? { ...event, ...update } : event));
  };

  const removeSelectedEvent = () => {
    if (!selectedEventKey) return;
    setTimelineEvents((current) => current.filter((event) => event.editorKey !== selectedEventKey));
    setSelectedEventKey(null);
  };

  const commitBackendSnapshot = (next: RealmSnapshot) => {
    viewSequence.current += 1;
    setViewedSnapshot(next);
    onSaved(next);
  };

  const runMutation = async (action: () => Promise<RealmSnapshot>, fallback: string) => {
    setOperating(true);
    setSaveError(null);
    try {
      commitBackendSnapshot(await action());
    } catch (cause) {
      setViewedSnapshot((current) => structuredClone(current));
      setSaveError(errorMessage(cause, fallback));
    } finally {
      setOperating(false);
    }
  };

  const createDrawnFeature = (geometry: GeoJsonGeometry) => {
    if (activeTool === "pan" || parsedCurrentYear === null) return;
    if (dirty) {
      setSaveError("地物を編集する前に世界と年表の変更を保存してください。");
      return;
    }
    const name = featureName.trim();
    if (!name) {
      setSaveError("地物の名前を入力してください。");
      return;
    }
    void runMutation(async () => {
      const next = await backend.createFeature({
        featureType: activeTool,
        name,
        validFromYear: parsedCurrentYear,
        geometry,
      });
      const created = next.features.find((feature) => !viewedSnapshot.features.some((current) => current.id === feature.id));
      setSelectedFeatureId(created?.id ?? null);
      setActiveTool("pan");
      return next;
    }, "地物を作成できませんでした。");
  };

  const reviseFeature = (feature: RealmFeature, geometry = feature.geometry) => {
    if (parsedCurrentYear === null || dirty) return;
    const name = featureName.trim();
    if (!name) {
      setSaveError("地物の名前を入力してください。");
      return;
    }
    void runMutation(() => backend.reviseFeature({
      id: feature.id,
      name,
      validFromYear: parsedCurrentYear,
      geometry,
    }), "地物を変更できませんでした。");
  };

  const selectFeature = (featureId: string | null) => {
    setSelectedFeatureId(featureId);
    const feature = viewedSnapshot.features.find((candidate) => candidate.id === featureId);
    if (feature) setFeatureName(feature.name);
  };

  const undo = () => {
    if (dirty) return;
    void runMutation(() => backend.undoProject(), "操作を元に戻せませんでした。");
  };

  const redo = () => {
    if (dirty) return;
    void runMutation(() => backend.redoProject(), "操作をやり直せませんでした。");
  };

  return (
    <main className="editor-shell" aria-label="Realm編集画面">
      <header className="editor-toolbar">
        <div className="app-mark" data-tauri-drag-region><strong>Realm</strong></div>
        <div className="toolbar-separator" data-tauri-drag-region />
        <nav className="document-actions" aria-label="ファイル操作">
          <button type="button" onClick={() => navigate(onCreate)} disabled={locked}><File aria-hidden="true" size={21} weight="regular" /><span>新規</span></button>
          <button type="button" onClick={() => navigate(onOpen)} disabled={locked}><FolderOpen aria-hidden="true" size={21} weight="regular" /><span>開く</span></button>
          <button type="button" onClick={() => { void save(); }} disabled={locked || !dirty || validationError !== null}><FloppyDisk aria-hidden="true" size={21} weight="regular" /><span>{saving ? "保存中…" : "保存"}</span></button>
          <button type="button" onClick={() => navigate(onClose)} disabled={locked}><X aria-hidden="true" size={20} weight="regular" /><span>閉じる</span></button>
        </nav>
        <nav className="history-actions" aria-label="編集履歴">
          <button type="button" onClick={undo} disabled={locked || dirty || !viewedSnapshot.canUndo}>元に戻す</button>
          <button type="button" onClick={redo} disabled={locked || dirty || !viewedSnapshot.canRedo}>やり直す</button>
        </nav>
        <div className="toolbar-separator" data-tauri-drag-region />
        <label className="world-name-input">
          <span className="sr-only">世界の名前</span>
          <input value={worldName} onChange={(event) => setWorldName(event.target.value)} aria-label="世界の名前" disabled={locked} maxLength={200} />
          <PencilSimple aria-hidden="true" size={17} weight="regular" />
        </label>
        <div className="toolbar-spacer" data-tauri-drag-region />
        <span className={`save-state ${dirty ? "save-state-dirty" : ""}`} aria-live="polite">
          {validationError ? "入力を確認" : dirty ? "未保存" : "保存済み"}
        </span>
      </header>

      <div className="editor-body">
        <aside className="left-rail" aria-label="主要ナビゲーション">
          <button className={activeTool === "pan" ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === "pan"} onClick={() => setActiveTool("pan")} disabled={locked}><GlobeHemisphereWest aria-hidden="true" size={25} weight="regular" /><span>移動</span></button>
          {FEATURE_TYPES.map(({ type, label }) => (
            <button key={type} className={activeTool === type ? "rail-item rail-item-active" : "rail-item"} type="button" aria-pressed={activeTool === type} onClick={() => { setActiveTool(type); setFeatureName(`新しい${label}`); setSelectedFeatureId(null); }} disabled={locked || dirty}><span className="feature-tool-mark" aria-hidden="true" /> <span>{label}</span></button>
          ))}
        </aside>
        <aside className="world-sidebar" aria-label="世界の構成">
          <div className="sidebar-heading"><h2>世界</h2><button type="button" aria-label="時代を追加" onClick={addEra} disabled={locked}><Plus aria-hidden="true" size={21} weight="regular" /></button></div>
          <div className="world-tree">
            <p>{viewedSnapshot.featureCount === 0 ? "地物はまだありません" : `地物 ${viewedSnapshot.featureCount}件`}</p>
            <div className="feature-list" aria-label="表示年の地物">
              {viewedSnapshot.features.map((feature) => (
                <button key={feature.id} type="button" className={feature.id === selectedFeatureId ? "feature-row feature-row-selected" : "feature-row"} aria-pressed={feature.id === selectedFeatureId} onClick={() => selectFeature(feature.id)} disabled={locked}>
                  <strong>{feature.name}</strong><span>{FEATURE_TYPES.find((item) => item.type === feature.featureType)?.label}</span>
                </button>
              ))}
            </div>
          </div>
          <section className="feature-editor" aria-label="地物編集">
            <label>地物名<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} disabled={locked} maxLength={200} /></label>
            {activeTool !== "pan" ? (
              <p>{activeTool === "city" || activeTool === "town"
                ? `地図上をクリックして${FEATURE_TYPES.find((item) => item.type === activeTool)?.label}を配置してください。`
                : `地図上で押したままドラッグして${FEATURE_TYPES.find((item) => item.type === activeTool)?.label}を描いてください。`}</p>
            ) : null}
            {selectedFeature ? <div className="feature-editor-actions"><button type="button" onClick={() => reviseFeature(selectedFeature)} disabled={locked || dirty}>名前を保存</button><button type="button" className="danger-action" onClick={() => { if (parsedCurrentYear !== null && window.confirm("この年以降から地物を削除しますか？")) void runMutation(() => backend.deleteFeature({ id: selectedFeature.id, validFromYear: parsedCurrentYear }), "地物を削除できませんでした。"); }} disabled={locked || dirty}>削除</button></div> : null}
          </section>
          <section className="era-list" aria-labelledby="era-list-title">
            <h3 id="era-list-title">時代</h3>
            {eras.length === 0 ? <p>時代はまだありません</p> : eras.map((era) => (
              <button
                className={era.editorKey === selectedEraKey ? "era-row era-row-selected" : "era-row"}
                key={era.editorKey}
                type="button"
                aria-pressed={era.editorKey === selectedEraKey}
                onClick={() => setSelectedEraKey(era.editorKey)}
                disabled={locked}
              >
                <strong>{era.name || "名前のない時代"}</strong>
                <span>{era.startYear}–{era.endYear || "継続中"}</span>
              </button>
            ))}
          </section>
          {selectedEra ? (
            <section className="era-editor" aria-label="選択した時代を編集">
              <label>名前<input value={selectedEra.name} onChange={(event) => updateSelectedEra({ name: event.target.value })} disabled={locked} maxLength={200} /></label>
              <div className="era-years">
                <label>開始年<input type="number" value={selectedEra.startYear} min={MIN_YEAR} max={MAX_YEAR} step="1" onChange={(event) => updateSelectedEra({ startYear: event.target.value })} disabled={locked} /></label>
                <label>終了年<input type="number" value={selectedEra.endYear} min={MIN_YEAR} max={MAX_YEAR} step="1" placeholder="継続中" onChange={(event) => updateSelectedEra({ endYear: event.target.value })} disabled={locked} /></label>
              </div>
              <button className="remove-era" type="button" onClick={removeSelectedEra} disabled={locked}>この時代を削除</button>
            </section>
          ) : null}
          <section className="event-list" aria-labelledby="event-list-title">
            <div className="section-heading"><h3 id="event-list-title">出来事</h3><button type="button" onClick={addTimelineEvent} aria-label="出来事を追加" disabled={locked}>＋</button></div>
            {timelineEvents.length === 0 ? <p>出来事はまだありません</p> : timelineEvents.map((event) => (
              <button key={event.editorKey} type="button" className={event.editorKey === selectedEventKey ? "event-row event-row-selected" : "event-row"} aria-pressed={event.editorKey === selectedEventKey} onClick={() => setSelectedEventKey(event.editorKey)} disabled={locked}><strong>{event.title || "タイトルのない出来事"}</strong><span>{event.startYear}{event.endYear ? `–${event.endYear}` : ""}</span></button>
            ))}
          </section>
          {selectedEvent ? <section className="event-editor" aria-label="選択した出来事を編集">
            <label>タイトル<input value={selectedEvent.title} onChange={(event) => updateSelectedEvent({ title: event.target.value })} disabled={locked} maxLength={200} /></label>
            <label>説明<textarea value={selectedEvent.description} onChange={(event) => updateSelectedEvent({ description: event.target.value })} disabled={locked} maxLength={10_000} /></label>
            <div className="era-years"><label>開始年<input type="number" value={selectedEvent.startYear} min={MIN_YEAR} max={MAX_YEAR} onChange={(event) => updateSelectedEvent({ startYear: event.target.value })} disabled={locked} /></label><label>終了年<input type="number" value={selectedEvent.endYear} min={MIN_YEAR} max={MAX_YEAR} placeholder="単年" onChange={(event) => updateSelectedEvent({ endYear: event.target.value })} disabled={locked} /></label></div>
            <button className="remove-era" type="button" onClick={removeSelectedEvent} disabled={locked}>この出来事を削除</button>
          </section> : null}
        </aside>
        <section className="map-region" aria-label="地図編集領域">
          <MapCanvas
            onZoomChange={setZoom}
            zoom={zoom}
            features={viewedSnapshot.features}
            mode={dirty ? "pan" : activeTool}
            selectedFeatureId={selectedFeatureId}
            onDraw={createDrawnFeature}
            onSelect={selectFeature}
            onModify={(featureId, geometry) => {
              const feature = viewedSnapshot.features.find((candidate) => candidate.id === featureId);
              if (feature) reviseFeature(feature, geometry);
            }}
          />
          {validationError ? <p className="save-error" role="alert">{validationError}</p> : saveError ? <p className="save-error" role="alert">{saveError}</p> : null}
        </section>

        <footer className="timeline-bar">
          <div className="timeline-status">
            <label className="timeline-year-field">
              <span className="sr-only">表示年</span>
              <input
                type="number"
                value={currentYearDraft}
                min={MIN_YEAR}
                max={MAX_YEAR}
                step="1"
                onChange={(event) => setViewYearDraft(event.target.value)}
                aria-label="表示年"
                disabled={locked}
                style={{ width: `${Math.min(Math.max(currentYearDraft.length, 1), 11)}ch` }}
              />
              <strong>年</strong>
            </label>
            <span>{currentEra?.name ?? "時代未設定"}</span>
          </div>
          <div className="timeline-controls" role="group" aria-label="年の移動">
            <button type="button" aria-label="0年へ移動" onClick={() => setViewYear(0)} disabled={locked || parsedCurrentYear === null || viewYear === 0}><SkipBack aria-hidden="true" size={18} weight="regular" /></button>
            <button type="button" aria-label="前の年" onClick={() => setViewYear(viewYear - 1)} disabled={locked || parsedCurrentYear === null || viewYear === MIN_YEAR}><CaretLeft aria-hidden="true" size={19} weight="bold" /></button>
            <button type="button" aria-label="次の年" onClick={() => setViewYear(viewYear + 1)} disabled={locked || parsedCurrentYear === null || viewYear === MAX_YEAR}><CaretRight aria-hidden="true" size={19} weight="bold" /></button>
          </div>
          <div className="timeline-slider-wrap">
            <input type="range" min={timelineStart} max={timelineEnd} value={viewYear} onChange={(event) => setViewYear(Number(event.target.value))} aria-label="年表上の表示年" disabled={locked || parsedCurrentYear === null} />
            <div className="timeline-scale" aria-hidden="true">
              {timelineTicks.map((year) => <span key={year}>{year}</span>)}
            </div>
          </div>
          <MapZoomControls zoom={zoom} onChange={setZoom} />
        </footer>
      </div>
    </main>
  );
}
