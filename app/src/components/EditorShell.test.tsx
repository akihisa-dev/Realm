import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRealmBackend, type GeoJsonGeometry } from "../backend";
import { EditorShell } from "./EditorShell";

vi.mock("./MapCanvas", () => ({
  MapCanvas: (props: { onDraw?: (geometry: GeoJsonGeometry) => void; onSelectFeatures?: (ids: string[]) => void; onCellSelect?: (ids: string[]) => void; onModifyFeatures?: (changes: { id: string; geometry: GeoJsonGeometry }[]) => void; onExporterReady?: (exporter: ((mime: "image/png" | "image/jpeg") => Promise<{ bytes: number[]; width: number; height: number }>) | null) => void; features?: Array<{ id: string }>; selectedFeatureIds?: readonly string[] }) => <div role="region" aria-label="世界地図">
    <button type="button" onClick={() => props.onDraw?.({ type: "Point", coordinates: [1, 2] })}>テスト描画</button>
    <button type="button" onClick={() => props.onDraw?.({ type: "Polygon", coordinates: [[[2, 2], [4, 2], [4, 4], [2, 2]]] })}>テスト穴描画</button>
    <button type="button" onClick={() => props.onSelectFeatures?.(props.features?.[0]?.id ? [props.features[0].id] : [])}>テスト選択</button>
    <button type="button" onClick={() => props.onSelectFeatures?.(props.features?.slice(0, 2).map(({ id }) => id) ?? [])}>テスト複数選択</button>
    <button type="button" onClick={() => props.onCellSelect?.(["1:2"])}>テストセル</button>
    <button type="button" onClick={() => props.selectedFeatureIds?.[0] && props.onModifyFeatures?.([{ id: props.selectedFeatureIds[0], geometry: { type: "Point", coordinates: [3, 4] } }])}>テスト変形</button>
    <button type="button" onClick={() => props.onExporterReady?.(async () => ({ bytes: [1, 2, 3], width: 2, height: 2 }))}>テストexport準備</button>
  </div>,
  MapZoomControls: () => <div />,
}));

it("adds a drawn inner ring to the selected polygon as one editable feature", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://hole.realmmap", name: "Hole" });
  const snapshot = await backend.createFeature({ featureType: "terrain", name: "大陸", geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } });
  render(<EditorShell snapshot={snapshot} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.click(screen.getByRole("button", { name: "領域の内側に穴を追加" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト穴描画" }));
  await waitFor(async () => {
    const current = await backend.getOpenProject();
    expect(current?.features[0]?.geometry).toMatchObject({ type: "Polygon", coordinates: expect.arrayContaining([expect.arrayContaining([[2, 2]])]) });
  });
});

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
  fireEvent.change(screen.getByRole("combobox", { name: "入力方式" }), { target: { value: "vertices" } });
  expect(screen.getByRole("combobox", { name: "角度スナップ" })).toBeEnabled();
  fireEvent.change(screen.getByRole("combobox", { name: "角度スナップ" }), { target: { value: "45" } });
  fireEvent.change(screen.getByRole("slider", { name: /^滑らかさ/ }), { target: { value: "0" } });
  expect(screen.getByRole("combobox", { name: "角度スナップ" })).toHaveValue("45");
  fireEvent.change(screen.getByRole("textbox", { name: "世界の名前" }), { target: { value: "Renamed" } });
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({ world: { name: "Renamed" } }), { timeout: 1000 });
  fireEvent.change(screen.getByRole("combobox", { name: "地図の表現" }), { target: { value: "atlas" } });
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({ settings: { themeId: "atlas", showGrid: true, exportScale: 1, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule" } }));
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

it("stores curved line-label appearance for roads", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://road-label.realmmap", name: "Road Labels" });
  const initial = await backend.createFeature({ featureType: "road", name: "Old Road", geometry: { type: "LineString", coordinates: [[0, 0], [4, 2], [8, 2]] } });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.change(screen.getByRole("combobox", { name: "線名の配置" }), { target: { value: "line" } });
  fireEvent.change(screen.getByRole("slider", { name: /^線名の文字サイズ/ }), { target: { value: "24" } });
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features[0]?.properties).toMatchObject({
    labelPlacement: "line",
    fontSize: 24,
  }));
});

it("stores trace-image rotation and a bounded canvas blend mode", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://trace.realmmap", name: "Trace" });
  const initial = await backend.createFeature({
    featureType: "overlay",
    name: "Reference",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]]] },
  });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.change(screen.getByRole("slider", { name: /^画像の回転/ }), { target: { value: "30" } });
  fireEvent.change(screen.getByRole("combobox", { name: "画像の合成" }), { target: { value: "multiply" } });
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features[0]?.properties).toMatchObject({
    rotation: Math.PI / 6,
    blendMode: "multiply",
  }));
});

it("stores editable frame presentation", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://frame.realmmap", name: "Frame" });
  const initial = await backend.createFeature({ featureType: "frame", name: "Border", geometry: { type: "Polygon", coordinates: [[[-10, -5], [10, -5], [10, 5], [-10, 5], [-10, -5]]] } });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.change(screen.getByRole("slider", { name: /^枠線の太さ/ }), { target: { value: "6" } });
  fireEvent.change(screen.getByRole("combobox", { name: "枠線の種類" }), { target: { value: "double" } });
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features[0]?.properties).toMatchObject({ frameWidth: 6, frameStyle: "double" }));
});

it("groups embedded assets by pack and deletes the complete pack", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://pack-ui.realmmap", name: "Pack UI" });
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const initial = await backend.importAssetsBatch({ packName: "Own Trees", assets: [
    { mime: "image/png", bytes: [...png, 1], width: 1, height: 1, metadata: { originalName: "oak.png" } },
    { mime: "image/png", bytes: [...png, 2], width: 1, height: 1, metadata: { originalName: "pine.png" } },
  ] });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  expect(screen.getByText("Own Trees")).toBeInTheDocument();
  expect(screen.getByText("2件")).toBeInTheDocument();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "パックを削除" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.assets).toHaveLength(0));
  expect((await backend.undoProject()).assets).toHaveLength(2);
  confirm.mockRestore();
});

it("persists map presentation settings and supports keyboard history", async () => {
  const backend = new MemoryRealmBackend();
  const initial = await backend.createProject({ path: "browser://presentation.realmmap", name: "Presentation" });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);

  fireEvent.change(screen.getByRole("combobox", { name: "書き出し範囲" }), { target: { value: "viewport" } });
  fireEvent.change(screen.getByRole("combobox", { name: "書き出し解像度" }), { target: { value: "4" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "キャンバス幅" }), { target: { value: "4096" } });
  fireEvent.blur(screen.getByRole("spinbutton", { name: "キャンバス幅" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "キャンバス高さ" }), { target: { value: "2048" } });
  fireEvent.blur(screen.getByRole("spinbutton", { name: "キャンバス高さ" }));
  fireEvent.change(screen.getByRole("combobox", { name: "グリッド種類" }), { target: { value: "hex" } });
  fireEvent.change(screen.getByLabelText("陸地"), { target: { value: "#aabbcc" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "グリッドを表示・出力" }));
  await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({
    settings: { themeId: "ink", showGrid: false, exportScale: 4, exportExtent: "viewport", canvasWidth: 4096, canvasHeight: 2048, gridKind: "hex", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: { land: "#aabbcc" } },
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
  const beforeScale = (await backend.getOpenProject())?.features[0]?.geometry;
  fireEvent.click(screen.getByRole("button", { name: "拡大" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features[0]?.geometry).not.toEqual(beforeScale));
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

it("edits a lasso-style multi-selection as atomic operations", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://multi-editor.realmmap", name: "Multi Editor" });
  const initial = await backend.createFeaturesBatch({ features: [
    { featureType: "city", name: "West", geometry: { type: "Point", coordinates: [0, 0] } },
    { featureType: "city", name: "East", geometry: { type: "Point", coordinates: [4, 0] } },
  ] });
  render(<EditorShell snapshot={initial} backend={backend} busy={false} onClose={vi.fn()} onSaved={vi.fn()} onExportTransfer={vi.fn()} onExportArtifact={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "テスト複数選択" }));
  expect(screen.getByText("2件を選択中")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "まとめて90°回転" }));
  await waitFor(async () => {
    const points = (await backend.getOpenProject())?.features.map(({ geometry }) => geometry.type === "Point" ? geometry.coordinates : null);
    expect(points?.[0]?.[0]).toBeCloseTo(2);
    expect(points?.[0]?.[1]).toBeCloseTo(-2);
    expect(points?.[1]?.[0]).toBeCloseTo(2);
    expect(points?.[1]?.[1]).toBeCloseTo(2);
  });
  expect((await backend.undoProject()).features.map(({ geometry }) => geometry)).toEqual(initial.features.map(({ geometry }) => geometry));
  await backend.redoProject();

  fireEvent.click(screen.getByRole("button", { name: "まとめて拡大" }));
  await waitFor(async () => {
    const points = (await backend.getOpenProject())?.features.map(({ geometry }) => geometry.type === "Point" ? geometry.coordinates : null);
    expect(points?.[0]?.[1]).toBeCloseTo(-2.5);
    expect(points?.[1]?.[1]).toBeCloseTo(2.5);
  });
  await backend.undoProject();

  fireEvent.click(screen.getByRole("button", { name: "まとめて複製" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features).toHaveLength(4));
  expect((await backend.undoProject()).features).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "まとめてロック" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features.every((feature) => feature.properties?.locked === true)).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "まとめてロック解除" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features.every((feature) => feature.properties?.locked === false)).toBe(true));

  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "まとめて削除" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features).toHaveLength(0));
  expect((await backend.undoProject()).features).toHaveLength(2);
  confirm.mockRestore();
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
