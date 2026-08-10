import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRealmBackend, type GeoJsonGeometry, type RealmSnapshot } from "../backend";
import { EditorShell } from "./EditorShell";

vi.mock("./MapCanvas", () => ({
  MapCanvas: (props: {
    features?: Array<{ id: string; featureType: string }>;
    selectedFeatureIds?: readonly string[];
    mode?: string;
    onDraw?: (geometry: GeoJsonGeometry) => void;
    onSelectFeatures?: (ids: string[]) => void;
    onModifyFeatures?: (changes: { id: string; geometry: GeoJsonGeometry }[]) => void;
    onEraseFeatures?: (ids: string[]) => void;
    onLayerShift?: (direction: -1 | 1) => void;
    onExporterReady?: (exporter: ((mime: "image/png" | "image/jpeg") => Promise<{ bytes: number[]; width: number; height: number }>) | null) => void;
  }) => <div role="region" aria-label="世界地図" data-mode={props.mode}>
    <output aria-label="描画対象">{props.features?.map(({ featureType }) => featureType).join(",")}</output>
    <button type="button" onClick={() => props.onDraw?.({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] })}>テスト地形描画</button>
    <button type="button" onClick={() => props.onDraw?.({ type: "Polygon", coordinates: [[[2, 2], [4, 2], [4, 4], [2, 2]]] })}>テスト穴描画</button>
    <button type="button" onClick={() => props.onSelectFeatures?.(props.features?.[0]?.id ? [props.features[0].id] : [])}>テスト選択</button>
    <button type="button" onClick={() => props.onSelectFeatures?.(props.features?.slice(0, 2).map(({ id }) => id) ?? [])}>テスト複数選択</button>
    <button type="button" onClick={() => props.selectedFeatureIds?.[0] && props.onModifyFeatures?.([{ id: props.selectedFeatureIds[0], geometry: { type: "Polygon", coordinates: [[[1, 1], [11, 1], [11, 11], [1, 11], [1, 1]]] } }])}>テスト変形</button>
    <button type="button" onClick={() => props.features?.[0] && props.onEraseFeatures?.([props.features[0].id])}>テスト消去</button>
    <button type="button" onClick={() => props.onLayerShift?.(1)}>テスト前面</button>
    <button type="button" onClick={() => props.onExporterReady?.(async () => ({ bytes: [1, 2, 3], width: 2, height: 2 }))}>テストexport準備</button>
  </div>,
  MapZoomControls: () => <div />,
}));

const terrainGeometry = (offset = 0): GeoJsonGeometry => ({
  type: "Polygon",
  coordinates: [[[offset, 0], [offset + 8, 0], [offset + 8, 8], [offset, 8], [offset, 0]]],
});

const renderEditor = (backend: MemoryRealmBackend, snapshot: RealmSnapshot, overrides: Partial<Parameters<typeof EditorShell>[0]> = {}) => render(
  <EditorShell
    snapshot={snapshot}
    backend={backend}
    busy={false}
    onClose={vi.fn()}
    onSaved={vi.fn()}
    onExportTransfer={vi.fn()}
    onExportArtifact={vi.fn()}
    {...overrides}
  />,
);

it("offers only terrain drawing tools", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://terrain-only.realmmap", name: "Terrain" });
  renderEditor(backend, snapshot);

  expect(screen.getByRole("button", { name: "地形を描く" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "地形を消す" })).toBeInTheDocument();
  for (const removed of ["森林", "河川", "海岸線", "国", "地域", "境界", "都市", "町", "道路", "湖", "山", "木", "記号", "ラベル", "参照領域", "枠", "縮尺記号", "ブラシ"]) {
    expect(screen.queryByRole("button", { name: removed })).not.toBeInTheDocument();
  }
  expect(screen.queryByLabelText("カスタム素材")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("ブラシ設定")).not.toBeInTheDocument();
});

it("creates only a terrain polygon from the draw tool", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://draw.realmmap", name: "Draw" });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "地形を描く" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "terrain");
  fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "大陸" } });
  fireEvent.click(screen.getByRole("button", { name: "テスト地形描画" }));

  await waitFor(async () => expect((await backend.getOpenProject())?.features).toEqual([
    expect.objectContaining({ featureType: "terrain", name: "大陸", geometry: expect.objectContaining({ type: "Polygon" }) }),
  ]));
  expect(screen.getByText("地形 1件")).toBeInTheDocument();
});

it("edits terrain geometry, appearance, holes, order, and history", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://edit.realmmap", name: "Edit" });
  const snapshot = await backend.createFeature({ featureType: "terrain", name: "島", geometry: terrainGeometry() });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト変形" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features[0]?.geometry).toEqual({
    type: "Polygon",
    coordinates: [[[1, 1], [11, 1], [11, 11], [1, 11], [1, 1]]],
  }));

  fireEvent.change(screen.getByRole("slider", { name: /^不透明度/ }), { target: { value: "0.6" } });
  fireEvent.click(screen.getByRole("button", { name: "テスト前面" }));
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features[0]?.properties).toMatchObject({ opacity: 0.6, zIndex: 1 }));

  fireEvent.click(screen.getByRole("button", { name: "地形の内側に穴を追加" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト穴描画" }));
  await waitFor(async () => expect(((await backend.getOpenProject())?.features[0]?.geometry as Extract<GeoJsonGeometry, { type: "Polygon" }>).coordinates).toHaveLength(2));

  fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
  await waitFor(async () => expect(((await backend.getOpenProject())?.features[0]?.geometry as Extract<GeoJsonGeometry, { type: "Polygon" }>).coordinates).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
  await waitFor(async () => expect(((await backend.getOpenProject())?.features[0]?.geometry as Extract<GeoJsonGeometry, { type: "Polygon" }>).coordinates).toHaveLength(2));
});

it("keeps legacy non-terrain data but never displays or selects it", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://legacy.realmmap", name: "Legacy" });
  await backend.createFeature({ featureType: "city", name: "旧都市", geometry: { type: "Point", coordinates: [0, 0] } });
  const snapshot = await backend.createFeature({ featureType: "terrain", name: "大陸", geometry: terrainGeometry() });
  renderEditor(backend, snapshot);

  expect(screen.queryByText("旧都市")).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "描画対象" })).toHaveTextContent("terrain");
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "更新した大陸" } });
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

  await waitFor(async () => {
    const current = await backend.getOpenProject();
    expect(current?.features).toHaveLength(2);
    expect(current?.features.find(({ featureType }) => featureType === "city")).toMatchObject({ name: "旧都市" });
    expect(current?.features.find(({ featureType }) => featureType === "terrain")).toMatchObject({ name: "更新した大陸" });
  });
});

it("copies, pastes, and cuts only selected terrain as atomic operations", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://clipboard.realmmap", name: "Clipboard" });
  const snapshot = await backend.createFeaturesBatch({ features: [
    { featureType: "terrain", name: "西", geometry: terrainGeometry(-20) },
    { featureType: "terrain", name: "東", geometry: terrainGeometry(20) },
  ] });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト複数選択" }));
  fireEvent.keyDown(window, { key: "c", metaKey: true });
  fireEvent.keyDown(window, { key: "v", metaKey: true });
  await waitFor(async () => expect((await backend.getOpenProject())?.features).toHaveLength(4));
  expect((await backend.undoProject()).features).toHaveLength(2);

  fireEvent.keyDown(window, { key: "x", metaKey: true });
  await waitFor(async () => expect((await backend.getOpenProject())?.features).toHaveLength(0));
  expect((await backend.undoProject()).features).toHaveLength(2);
});

it("persists terrain presentation settings and exports artifacts", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://settings.realmmap", name: "Settings" });
  const onArtifact = vi.fn(async () => undefined);
  const onTransfer = vi.fn(async () => undefined);
  renderEditor(backend, snapshot, { onExportArtifact: onArtifact, onExportTransfer: onTransfer });

  fireEvent.change(screen.getByRole("combobox", { name: "テーマ" }), { target: { value: "atlas" } });
  fireEvent.change(screen.getByRole("combobox", { name: "グリッド種類" }), { target: { value: "hex" } });
  await waitFor(async () => expect((await backend.getOpenProject())?.settings).toMatchObject({ themeId: "atlas", gridKind: "hex" }));

  fireEvent.click(screen.getByRole("button", { name: "テストexport準備" }));
  fireEvent.click(screen.getByRole("button", { name: "PNG" }));
  await waitFor(() => expect(onArtifact).toHaveBeenCalledWith("png", [1, 2, 3]));
  fireEvent.click(screen.getByRole("button", { name: "JPEG" }));
  await waitFor(() => expect(onArtifact).toHaveBeenCalledWith("jpg", [1, 2, 3]));
  fireEvent.click(screen.getByRole("button", { name: "移行データ" }));
  await waitFor(() => expect(onTransfer).toHaveBeenCalledOnce());
});

it("supports terrain shortcuts and project-name autosave", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://shortcuts.realmmap", name: "Before" });
  renderEditor(backend, snapshot);

  fireEvent.keyDown(window, { key: "c" });
  expect(screen.getByRole("button", { name: "地形を描く" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(window, { key: "e" });
  expect(screen.getByRole("button", { name: "地形を消す" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(screen.getByRole("textbox", { name: "世界の名前" }), { target: { value: "After" } });
  await waitFor(async () => expect((await backend.getOpenProject())?.world.name).toBe("After"), { timeout: 1000 });
});

it("deletes only terrain through the erase callback", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://erase.realmmap", name: "Erase" });
  await backend.createFeature({ featureType: "city", name: "旧都市", geometry: { type: "Point", coordinates: [0, 0] } });
  const snapshot = await backend.createFeature({ featureType: "terrain", name: "島", geometry: terrainGeometry() });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "地形を消す" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト消去" }));
  await waitFor(async () => {
    const current = await backend.getOpenProject();
    expect(current?.features).toHaveLength(1);
    expect(current?.features[0]).toMatchObject({ featureType: "city", name: "旧都市" });
  });
});
