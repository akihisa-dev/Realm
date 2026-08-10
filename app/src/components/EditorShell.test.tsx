import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRealmBackend, type GeoJsonGeometry } from "../backend";
import { EditorShell } from "./EditorShell";

vi.mock("./MapCanvas", () => ({
  MapCanvas: (props: { onDraw?: (geometry: GeoJsonGeometry) => void; onSelect?: (id: string | null) => void; onCellSelect?: (ids: string[]) => void; onModify?: (id: string, geometry: GeoJsonGeometry) => void; onExporterReady?: (exporter: ((mime: "image/png" | "image/jpeg") => Promise<{ bytes: number[]; width: number; height: number }>) | null) => void; features?: Array<{ id: string }>; selectedFeatureId?: string | null }) => <div role="region" aria-label="世界地図">
    <button type="button" onClick={() => props.onDraw?.({ type: "Point", coordinates: [1, 2] })}>テスト描画</button>
    <button type="button" onClick={() => props.onSelect?.(props.features?.[0]?.id ?? null)}>テスト選択</button>
    <button type="button" onClick={() => props.onCellSelect?.(["1:2"])}>テストセル</button>
    <button type="button" onClick={() => props.selectedFeatureId && props.onModify?.(props.selectedFeatureId, { type: "Point", coordinates: [3, 4] })}>テスト変形</button>
    <button type="button" onClick={() => props.onExporterReady?.(async () => ({ bytes: [1, 2, 3], width: 2, height: 2 }))}>テストexport準備</button>
  </div>,
  MapZoomControls: () => <div />,
}));

it("renders single-state editor without chronology controls", async () => {
  const backend = new MemoryRealmBackend(); const snapshot = await backend.createProject({ path: "browser://editor.realmmap", name: "Editor" });
  render(<EditorShell snapshot={snapshot} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: "世界の名前" })).toHaveValue("Editor");
  expect(screen.queryByLabelText("表示年")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "やり直す" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "値" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "筆の属性" }), { target: { value: "country" } });
  expect(screen.getByRole("textbox", { name: "値" })).toBeEnabled();
  fireEvent.change(screen.getByRole("textbox", { name: "値" }), { target: { value: "王国" } });
  expect(screen.getByRole("combobox", { name: "筆の属性" })).toHaveValue("country");
  fireEvent.change(screen.getByRole("textbox", { name: "世界の名前" }), { target: { value: "Renamed" } });
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({ world: { name: "Renamed" } }), { timeout: 1000 });
  fireEvent.change(screen.getByRole("combobox", { name: "地図の表現" }), { target: { value: "atlas" } });
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({ settings: { themeId: "atlas", showGrid: true, exportScale: 2, exportExtent: "world" } }));
});

it("runs feature, cell, history, and export actions", async () => {
  const backend = new MemoryRealmBackend(); const initial = await backend.createProject({ path: "browser://actions.realmmap", name: "Actions" });
  const onClose = vi.fn(); const onTransfer = vi.fn(async () => undefined); const onArtifact = vi.fn(async () => undefined);
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={onClose} onSaved={vi.fn()} onExportTransfer={onTransfer} onExportArtifact={onArtifact} />);
  fireEvent.click(screen.getByRole("button", { name: "都市" })); fireEvent.click(screen.getByRole("button", { name: "テスト描画" }));
  await waitFor(() => expect(screen.getByText("地物 1件")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" })); fireEvent.change(screen.getByRole("textbox", { name: "地物名" }), { target: { value: "王都" } }); fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /王都/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "テスト変形" }));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true); fireEvent.click(screen.getByRole("button", { name: "削除" })); await waitFor(() => expect(screen.getByText("地物はまだありません")).toBeInTheDocument()); confirm.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "元に戻す" })); await waitFor(() => expect(screen.getByText("地物 1件")).toBeInTheDocument()); fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
  fireEvent.click(screen.getByRole("button", { name: "テストセル" })); await waitFor(() => expect(backend.viewCellAttributes({})).resolves.toEqual([]));
  fireEvent.click(screen.getByRole("button", { name: "テストexport準備" })); fireEvent.click(screen.getByRole("button", { name: "PNG" })); await waitFor(() => expect(onArtifact).toHaveBeenCalledWith("png", [1, 2, 3])); fireEvent.click(screen.getByRole("button", { name: "JPEG" })); await waitFor(() => expect(onArtifact).toHaveBeenCalledWith("jpg", [1, 2, 3])); fireEvent.click(screen.getByRole("button", { name: "移行データ" })); await waitFor(() => expect(onTransfer).toHaveBeenCalled()); fireEvent.click(screen.getByRole("button", { name: "ライブラリ" })); await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("refreshes cell attributes only for cell-affecting operations", async () => {
  const backend = new MemoryRealmBackend(); const initial = await backend.createProject({ path: "browser://refresh.realmmap", name: "Refresh" });
  const viewCells = vi.spyOn(backend, "viewCellAttributes");
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  await waitFor(() => expect(viewCells).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("textbox", { name: "世界の名前" }), { target: { value: "Renamed" } });
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({ world: { name: "Renamed" } }));
  expect(viewCells).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "都市" })); fireEvent.click(screen.getByRole("button", { name: "テスト描画" }));
  await waitFor(() => expect(screen.getByText("地物 1件")).toBeInTheDocument());
  expect(viewCells).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "テストセル" }));
  await waitFor(() => expect(viewCells).toHaveBeenCalledTimes(2));
});

it("keeps a selected feature when the parent receives a same-project snapshot", async () => {
  const backend = new MemoryRealmBackend(); const initial = await backend.createProject({ path: "browser://selection.realmmap", name: "Selection" });
  let current = initial;
  let rerender: ReturnType<typeof render>["rerender"];
  const renderEditor = () => <EditorShell snapshot={current} backend={backend} busy={false} onClose={vi.fn()} onSaved={(next) => { current = next; rerender(renderEditor()); }} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />;
  const view = render(renderEditor()); rerender = view.rerender;
  fireEvent.click(screen.getByRole("button", { name: "都市" })); fireEvent.click(screen.getByRole("button", { name: "テスト描画" }));
  await waitFor(() => expect(screen.getByText("地物 1件")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "地物名" }), { target: { value: "王都" } }); fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /王都/ })).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
});

it("stores editable label appearance as feature properties", async () => {
  const backend = new MemoryRealmBackend();
  const initial = await backend.createProject({ path: "browser://label.realmmap", name: "Labels" });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "ラベル" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト描画" }));
  await waitFor(() => expect(screen.getByText("地物 1件")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.change(screen.getByRole("slider", { name: /^文字サイズ/ }), { target: { value: "32" } });
  fireEvent.change(screen.getByLabelText("文字色"), { target: { value: "#123456" } });
  fireEvent.change(screen.getByRole("slider", { name: /^回転/ }), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(async () => {
    const snapshot = await backend.getOpenProject();
    expect(snapshot?.features[0]?.properties).toMatchObject({ fontSize: 32, textColor: "#123456", rotation: Math.PI / 12 });
  });
});

it("persists map presentation settings and supports keyboard history", async () => {
  const backend = new MemoryRealmBackend();
  const initial = await backend.createProject({ path: "browser://presentation.realmmap", name: "Presentation" });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);

  fireEvent.change(screen.getByRole("combobox", { name: "書き出し範囲" }), { target: { value: "viewport" } });
  fireEvent.change(screen.getByRole("combobox", { name: "書き出し解像度" }), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "経緯線を表示・出力" }));
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({
    settings: { themeId: "ink", showGrid: false, exportScale: 4, exportExtent: "viewport" },
  }));

  fireEvent.keyDown(window, { key: "z", metaKey: true });
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({ settings: { showGrid: true } }));
  fireEvent.keyDown(window, { key: "Z", metaKey: true, shiftKey: true });
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({ settings: { showGrid: false } }));

  const terrainLayer = screen.getByRole("checkbox", { name: "地形" });
  expect(terrainLayer).toBeChecked();
  fireEvent.click(terrainLayer);
  expect(terrainLayer).not.toBeChecked();
});

it("edits layer properties and applies geometry transforms", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://transform.realmmap", name: "Transforms" });
  const initial = await backend.createFeature({
    featureType: "terrain",
    name: "Island",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]]] },
  });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));

  fireEvent.click(screen.getByRole("button", { name: "前面へ" }));
  fireEvent.click(screen.getByRole("button", { name: "背面へ" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "表示" }));
  fireEvent.change(screen.getByRole("slider", { name: /^不透明度/ }), { target: { value: "0.5" } });
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({ features: [{ properties: { visible: false, opacity: 0.5, zIndex: 0 } }] }));

  fireEvent.click(screen.getByRole("button", { name: "90°回転" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features[0]?.geometry).not.toEqual(initial.features[0]?.geometry));
  fireEvent.click(screen.getByRole("button", { name: "左右反転" }));
  fireEvent.click(screen.getByRole("button", { name: "上下反転" }));
  fireEvent.click(screen.getByRole("button", { name: "複製" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features).toHaveLength(2));

  fireEvent.change(screen.getByRole("searchbox", { name: "地物を検索" }), { target: { value: "Island" } });
  expect(screen.getAllByRole("button", { name: /Island/ })).toHaveLength(2);
});

it("sprays editable symbols inside a selected polygon as one undoable batch", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://spray.realmmap", name: "Spray" });
  const initial = await backend.createFeature({ featureType: "terrain", name: "Island", geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "個数" }), { target: { value: "6" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "最小間隔" }), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "この領域へ散布" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features).toHaveLength(7));
  expect((await backend.undoProject()).features).toHaveLength(1);
});

it("keeps newer name input when an older automatic save finishes", async () => {
  const backend = new MemoryRealmBackend();
  const initial = await backend.createProject({ path: "browser://autosave.realmmap", name: "Initial" });
  const saveNormally = backend.saveProject.bind(backend);
  let finishFirst: ((snapshot: typeof initial) => void) | undefined;
  const saveProject = vi.spyOn(backend, "saveProject").mockImplementation((input) => {
    if (input.name === "First") return new Promise((resolve) => { finishFirst = resolve; });
    return saveNormally(input);
  });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  const nameInput = screen.getByRole("textbox", { name: "世界の名前" });

  fireEvent.change(nameInput, { target: { value: "First" } });
  await waitFor(() => expect(saveProject).toHaveBeenCalledWith({ name: "First" }), { timeout: 1000 });
  fireEvent.change(nameInput, { target: { value: "Second" } });
  finishFirst?.({ ...initial, world: { ...initial.world, name: "First" } });

  await waitFor(() => expect(saveProject).toHaveBeenCalledWith({ name: "Second" }), { timeout: 1000 });
  await waitFor(() => expect(nameInput).toHaveValue("Second"));
  expect(await backend.getOpenProject()).toMatchObject({ world: { name: "Second" } });
});

it("shows validation and operation failures without losing the editor", async () => {
  const backend = new MemoryRealmBackend(); const initial = await backend.createProject({ path: "browser://errors.realmmap", name: "Errors" });
  backend.saveProject = async () => { throw new Error("保存失敗"); };
  const onTransfer = vi.fn(async () => { throw new Error("移行失敗"); });
  const onArtifact = vi.fn(async () => { throw new Error("画像失敗"); });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={onTransfer} onExportArtifact={onArtifact} />);
  fireEvent.change(screen.getByRole("textbox", { name: "世界の名前" }), { target: { value: "" } }); expect(await screen.findByRole("alert")).toHaveTextContent("名前");
  fireEvent.change(screen.getByRole("textbox", { name: "世界の名前" }), { target: { value: "Valid" } }); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保存失敗"));
  backend.saveProject = async (input) => { const current = await backend.getOpenProject(); return { ...current!, world: { ...current!.world, name: input.name } }; };
  fireEvent.click(screen.getByRole("button", { name: "移行データ" })); expect(await screen.findByRole("alert")).toHaveTextContent("移行失敗");
  fireEvent.click(screen.getByRole("button", { name: "テストexport準備" })); fireEvent.click(screen.getByRole("button", { name: "PNG" })); expect(await screen.findByRole("alert")).toHaveTextContent("画像失敗");
});
