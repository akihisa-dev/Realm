import { useLayoutEffect, useMemo, useState } from "react";
import {
  errorMessage,
  type EraInput,
  type RealmBackend,
  type RealmSnapshot,
} from "../backend";
import { MapCanvas, MapZoomControls } from "./MapCanvas";

type EditableEra = Omit<EraInput, "startYear" | "endYear"> & {
  editorKey: string;
  startYear: string;
  endYear: string;
};

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

export function EditorShell({ snapshot, backend, busy, onCreate, onOpen, onClose, onSaved }: EditorShellProps) {
  const [worldName, setWorldName] = useState(snapshot.world.name);
  const [currentYearDraft, setCurrentYearDraft] = useState(String(snapshot.world.currentYear));
  const [timelineStart, setTimelineStart] = useState(() => timelineWindowStart(snapshot.world.currentYear));
  const [eras, setEras] = useState<EditableEra[]>(() => editableEras(snapshot));
  const [selectedEraKey, setSelectedEraKey] = useState<string | null>(snapshot.eras[0]?.id ?? null);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const nextEras = editableEras(snapshot);
    setWorldName(snapshot.world.name);
    setCurrentYearDraft(String(snapshot.world.currentYear));
    setTimelineStart(timelineWindowStart(snapshot.world.currentYear));
    setEras(nextEras);
    setSelectedEraKey((current) =>
      current && nextEras.some((era) => era.editorKey === current)
        ? current
        : (nextEras[0]?.editorKey ?? null));
  }, [snapshot]);

  const dirty = useMemo(() => {
    if (worldName !== snapshot.world.name || currentYearDraft !== String(snapshot.world.currentYear)) return true;
    if (eras.length !== snapshot.eras.length) return true;
    return eras.some((era, index) => {
      const persisted = snapshot.eras[index];
      return !persisted
        || era.id !== persisted.id
        || era.name !== persisted.name
        || era.startYear !== String(persisted.startYear)
        || era.endYear !== (persisted.endYear === null ? "" : String(persisted.endYear));
    });
  }, [currentYearDraft, eras, snapshot, worldName]);

  const normalizedEraResult = useMemo(() => normalizeEditableEras(eras), [eras]);
  const parsedCurrentYear = parseYear(currentYearDraft);
  const validationError = useMemo(() => {
    if (!worldName.trim()) return "世界の名前を入力してください。";
    if (worldName.trim().length > 200) return "世界の名前は200文字以内にしてください。";
    if (parsedCurrentYear === null) return "表示年を32ビット整数で入力してください。";
    return normalizedEraResult.error;
  }, [normalizedEraResult.error, parsedCurrentYear, worldName]);
  const locked = busy || saving;
  const viewYear = parsedCurrentYear ?? snapshot.world.currentYear;
  const timelineEnd = timelineStart + TIMELINE_SPAN;
  const timelineTicks = Array.from(
    { length: (TIMELINE_SPAN / TIMELINE_STEP) + 1 },
    (_, index) => timelineStart + (index * TIMELINE_STEP),
  );

  const selectedEra = eras.find((era) => era.editorKey === selectedEraKey) ?? null;
  const currentEra = normalizedEraResult.eras.find((era) =>
    era.startYear <= viewYear && (era.endYear === null || viewYear <= era.endYear));

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

  return (
    <main className="editor-shell" aria-label="Realm編集画面">
      <header className="editor-toolbar">
        <div className="app-mark"><span className="traffic-light traffic-red" /><span className="traffic-light traffic-yellow" /><span className="traffic-light traffic-green" /><strong>Realm</strong></div>
        <div className="toolbar-separator" />
        <nav className="document-actions" aria-label="ファイル操作">
          <button type="button" onClick={() => navigate(onCreate)} disabled={locked}><span aria-hidden="true">□</span>新規</button>
          <button type="button" onClick={() => navigate(onOpen)} disabled={locked}><span aria-hidden="true">▱</span>開く</button>
          <button type="button" onClick={() => { void save(); }} disabled={locked || !dirty || validationError !== null}><span aria-hidden="true">▣</span>{saving ? "保存中…" : "保存"}</button>
          <button type="button" onClick={() => navigate(onClose)} disabled={locked}><span aria-hidden="true">×</span>閉じる</button>
        </nav>
        <div className="toolbar-separator" />
        <label className="world-name-input">
          <span className="sr-only">世界の名前</span>
          <input value={worldName} onChange={(event) => setWorldName(event.target.value)} aria-label="世界の名前" disabled={locked} maxLength={200} />
        </label>
        <div className="toolbar-spacer" />
        <span className={`save-state ${dirty ? "save-state-dirty" : ""}`} aria-live="polite">
          {validationError ? "入力を確認" : dirty ? "未保存" : "保存済み"}
        </span>
      </header>

      <div className="editor-body">
        <aside className="left-rail" aria-label="主要ナビゲーション">
          <div className="rail-item rail-item-active" aria-current="page"><span aria-hidden="true">◎</span><span>世界</span></div>
        </aside>
        <aside className="world-sidebar" aria-label="世界の構成">
          <div className="sidebar-heading"><h2>世界</h2><button type="button" aria-label="時代を追加" onClick={addEra} disabled={locked}>＋</button></div>
          <div className="world-tree">
            <div className="world-tree-row"><span aria-hidden="true">⌄</span><span className="globe-symbol" aria-hidden="true">◎</span><strong>{worldName || "名前のない世界"}</strong></div>
            <p>地物 {snapshot.featureCount}件</p>
          </div>
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
        </aside>
        <section className="map-region" aria-label="地図編集領域">
          <MapCanvas onZoomChange={setZoom} zoom={zoom} />
          <div className="map-tools" aria-label="現在の地図操作"><span className="map-tool-active"><span aria-hidden="true">✋</span><span className="sr-only">地図を移動</span></span></div>
          {validationError ? <p className="save-error" role="alert">{validationError}</p> : saveError ? <p className="save-error" role="alert">{saveError}</p> : null}
        </section>
      </div>

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
            />
            <strong>年</strong>
          </label>
          <span>{currentEra?.name ?? "時代未設定"}</span>
        </div>
        <div className="timeline-controls" aria-label="年の移動">
          <button type="button" aria-label="0年へ移動" onClick={() => setViewYear(0)} disabled={locked || parsedCurrentYear === null || viewYear === 0}>◀|</button>
          <button type="button" aria-label="前の年" onClick={() => setViewYear(viewYear - 1)} disabled={locked || parsedCurrentYear === null || viewYear === MIN_YEAR}>◀</button>
          <button type="button" aria-label="次の年" onClick={() => setViewYear(viewYear + 1)} disabled={locked || parsedCurrentYear === null || viewYear === MAX_YEAR}>▶</button>
        </div>
        <div className="timeline-slider-wrap">
          <input type="range" min={timelineStart} max={timelineEnd} value={viewYear} onChange={(event) => setViewYear(Number(event.target.value))} aria-label="年表上の表示年" disabled={locked || parsedCurrentYear === null} />
          <div className="timeline-scale" aria-hidden="true">
            {timelineTicks.map((year) => <span key={year}>{year}</span>)}
          </div>
        </div>
        <MapZoomControls zoom={zoom} onChange={setZoom} />
      </footer>
    </main>
  );
}
