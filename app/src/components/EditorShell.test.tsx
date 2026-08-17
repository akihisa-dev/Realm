import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRealmBackend, type GeoJsonGeometry, type LayerId, type MapShape, type ObjectKind, type RealmSnapshot } from "../backend";
import { cellIdsToPolygonGeometries, mapShapeCellIds } from "../shared/mapShapeGeometry";
import { mapShapesFromLayers } from "../shared/layerProjection";
import { EditorShell } from "./EditorShell";

vi.mock("./MapCanvas", () => ({
  MapCanvas: (props: {
    mapShapes?: readonly MapShape[];
    activeLayer?: LayerId;
    activeKind?: string;
    selectedCellIds?: readonly string[];
    mode?: string;
    strokeRange?: number;
    onCellSelect?: (ids: readonly string[]) => void;
    onMapShapeEdit?: (edit: { shapes: MapShape[] }) => void;
    onToolChange?: (tool: "grid" | "area" | "terrain" | "region" | "object" | "select" | "erase" | "grab" | "shape") => void;
    onRegionColorChange?: (color: string) => void;
    onCreateProject?: () => void;
    createProjectDisabled?: boolean;
    onDraw?: (geometry: GeoJsonGeometry) => void;
    onObjectKindChange?: (kind: ObjectKind) => void;
    onSelectObjects?: (ids: readonly string[]) => void;
    onModifyObjects?: (changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => void;
    onEraseObjects?: (ids: readonly string[]) => void;
    preview?: boolean;
  }) => (
    <div role="region" aria-label="世界地図" data-mode={props.mode}>
      <output aria-label="アクティブレイヤー">{props.activeLayer ?? "unknown"}</output>
      <output aria-label="保存中の図形数">{props.mapShapes?.length ?? 0}</output>
      <output aria-label="表示中の地形セル">{props.mapShapes?.flatMap((shape) => [...mapShapeCellIds(shape)]).sort().join(",")}</output>
      <output aria-label="選択中の地形セル">{props.selectedCellIds?.join(",")}</output>
      <output aria-label="共有太さ">{props.strokeRange ?? 0}</output>
      {props.activeKind && ["city", "text", "mountain", "forest"].includes(props.activeKind) ? <button type="button" onClick={() => props.onToolChange?.("object")}>描く</button> : <button type="button" onClick={() => props.onToolChange?.("grid")}>描く</button>}
      <button type="button" onClick={() => props.onToolChange?.("grid")}>テストグリッド描画</button>
      <button type="button" onClick={() => props.onToolChange?.("area")}>テスト範囲描画</button>
      <button type="button" onClick={() => props.onToolChange?.("erase")}>消す</button>
      <button type="button" onClick={() => props.onToolChange?.("grab")}>掴む</button>
      <button type="button" onClick={() => props.onCellSelect?.(["1:1", "1:2"])}>テストセル描画</button>
      <button type="button" onClick={() => props.onCellSelect?.(["1:1"])}>テスト遅延セル操作</button>
      <button type="button" onClick={() => props.onToolChange?.("erase")}>テスト消しゴム</button>
      <button type="button" onClick={() => props.onToolChange?.("terrain")}>テスト地形描画</button>
      <button type="button" onClick={() => props.onToolChange?.("region")}>テスト領域</button>
      <button type="button" onClick={() => props.onToolChange?.("grab")}>テストグラブ</button>
      <button type="button" onClick={() => props.onToolChange?.("shape")}>テストシェイピング</button>
      <button type="button" onClick={() => props.onRegionColorChange?.("#2468AC")}>テスト領域色</button>
      <button type="button" aria-label="新規作成" onClick={props.onCreateProject} disabled={props.createProjectDisabled}>新規作成</button>
      <button type="button" onClick={() => props.onObjectKindChange?.("city")}>テスト都市種別</button>
      <button type="button" onClick={() => props.onObjectKindChange?.("text")}>テストテキスト種別</button>
      <button type="button" onClick={() => props.onObjectKindChange?.("forest")}>テスト森種別</button>
      <button type="button" onClick={() => props.onObjectKindChange?.("mountain")}>テスト山種別</button>
      <button type="button" onClick={() => props.onDraw?.({ type: "Point", coordinates: [1, 2] })}>テスト都市配置</button>
      <button type="button" onClick={() => props.onDraw?.({ type: "Point", coordinates: [3, 4] })}>テストテキスト配置</button>
      <button type="button" onClick={() => props.onDraw?.({ type: "Polygon", coordinates: cellIdsToPolygonGeometries(["4:4", "5:4"])[0]!.coordinates })}>テスト森配置</button>
      <button type="button" onClick={() => props.onDraw?.({ type: "Point", coordinates: [10, 20] })}>テスト山配置</button>
      <button type="button" onClick={() => props.onSelectObjects?.(["test-object-id"])}>テストオブジェクト選択</button>
      <button type="button" onClick={() => props.onModifyObjects?.([{ id: "test-object-id", geometry: { type: "Point", coordinates: [11, 21] } }])}>テストオブジェクト移動</button>
      <button type="button" onClick={() => props.onEraseObjects?.(["test-object-id"])}>テストオブジェクト消去</button>
      <button type="button" onClick={() => {
        const current = props.mapShapes?.[0];
        if (!current) return;
        props.onMapShapeEdit?.({ shapes: [{ ...current, geometry: cellIdsToPolygonGeometries(["4:4"])[0]! }, ...(props.mapShapes?.slice(1) ?? [])] });
      }}>テスト図形編集コミット</button>
    </div>
  ),
}));

const renderEditor = (backend: MemoryRealmBackend, snapshot: RealmSnapshot) => render(<EditorShell snapshot={snapshot} backend={backend} busy={false} onSaved={vi.fn()} />);
const terrain = (cells: string[], id = "11111111-1111-4111-8111-111111111111"): MapShape => ({ id, layer: "terrain", value: "terrain", geometryVersion: 1, snapGridVersion: 2, geometry: cellIdsToPolygonGeometries(cells)[0]! });

it("keeps the editor shell and layer manager while rendering the three layers", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://shell.realmmap", name: "Shell" });
  renderEditor(backend, snapshot);
  expect(screen.getByRole("navigation", { name: "編集履歴" })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "レイヤー管理" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "世界地図" })).toBeInTheDocument();
});

it("maps the shared grid and area rail tools to both cell modes", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://shared-cell-tools.realmmap", name: "Shared cell tools" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト範囲描画" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-region");
  fireEvent.click(screen.getByRole("button", { name: "テスト領域" }));
  fireEvent.click(screen.getByRole("button", { name: "テストグリッド描画" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-select");
});

it("creates a new empty world from the rail and keeps the previous world", async () => {
  const backend = new MemoryRealmBackend();
  const initial = await backend.createProject({ path: "browser://existing.realmmap", name: "Existing" });
  const saved = await backend.replaceTerrainLayer({ shapes: [{ id: "11111111-1111-4111-8111-111111111111", geometry: cellIdsToPolygonGeometries(["1:1"])[0]! }] });
  renderEditor(backend, saved);

  fireEvent.click(screen.getByRole("button", { name: "新規作成" }));

  await waitFor(async () => expect((await backend.getOpenProject())?.world.name).toBe("無題の世界"));
  const current = await backend.getOpenProject();
  expect(current?.path).not.toBe(initial.path);
  expect(current?.layers).toEqual({ terrain: [], regions: [], objects: [] });
  expect(current?.assets).toEqual([]);
  expect(await backend.listProjects()).toEqual([
    { libraryId: initial.path, name: "Existing" },
    { libraryId: current!.path, name: "無題の世界" },
  ]);
  expect(screen.getByRole("status", { name: "保存中の図形数" })).toHaveTextContent("0");
});

it("keeps the current world when creating a new world fails", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://failure.realmmap", name: "Failure" });
  const createProject = vi.spyOn(backend, "createProject").mockRejectedValue(new Error("作成失敗"));
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "新規作成" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("作成失敗");
  expect(createProject).toHaveBeenCalledWith({ name: "無題の世界" });
  expect((await backend.getOpenProject())?.path).toBe(snapshot.path);
});

it("switches the active layer and keeps object operations on the object layer", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://layer-operations.realmmap", name: "Layer operations" });
  renderEditor(backend, snapshot);

  expect(screen.getByRole("button", { name: "描く" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "消す" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "テスト領域" }));
  expect(screen.getByRole("button", { name: "描く" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "消す" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "テスト都市種別" }));
  expect(screen.getByRole("button", { name: "描く" })).toBeInTheDocument();
  expect(screen.getByLabelText("ラベル")).toHaveValue("");
  const cityRadio = screen.getAllByRole("radio", { name: "都市" }).at(-1)!;
  fireEvent.click(cityRadio);
  expect(cityRadio).toBeChecked();
  fireEvent.change(screen.getByLabelText("ラベル"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "キャンバスに配置" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト都市配置" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.objects).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "テストテキスト種別" }));
  fireEvent.click(screen.getByRole("button", { name: "テストテキスト配置" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.objects).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "テスト森種別" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト森配置" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.objects).toHaveLength(3));
  fireEvent.click(screen.getByRole("button", { name: "テスト山種別" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト山配置" }));

  await waitFor(async () => expect((await backend.getOpenProject())?.layers.objects.map(({ kind }) => kind)).toEqual(["city", "text", "forest", "mountain"]));
  expect(screen.getAllByText("都市").length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "都市を選択" }));
  fireEvent.click(screen.getByRole("button", { name: "都市を削除" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.objects.map(({ kind }) => kind)).toEqual(["text", "forest", "mountain"]));

  fireEvent.click(screen.getByRole("button", { name: "テスト地形描画" }));
  const countBefore = (await backend.getOpenProject())?.layers.objects.length;
  fireEvent.click(screen.getByRole("button", { name: "テスト都市配置" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((await backend.getOpenProject())?.layers.objects.length).toBe(countBefore);
});

it("keeps one header thickness control shared by drawing and erasing", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://thickness.realmmap", name: "Thickness" });
  renderEditor(backend, snapshot);
  const slider = screen.getByRole("slider", { name: "描画と削除の太さ" });
  expect(slider).toHaveValue("1");
  expect(screen.getByRole("status", { name: "共有太さ" })).toHaveTextContent("1");
  fireEvent.change(slider, { target: { value: "4" } });
  expect(slider).toHaveValue("4");
  expect(screen.getByRole("status", { name: "共有太さ" })).toHaveTextContent("4");
});

it("disables editing controls while the map preview is open", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://preview.realmmap", name: "Preview" });
  renderEditor(backend, snapshot);
  fireEvent.click(screen.getByRole("button", { name: "テスト領域" }));

  const previewButton = screen.getByRole("button", { name: "レンダリングプレビューを表示" });
  expect(previewButton).toHaveAttribute("aria-pressed", "false");
  expect(previewButton.nextElementSibling).toHaveAttribute("aria-label", "戻す");
  fireEvent.click(previewButton);

  expect(previewButton).toHaveAttribute("aria-label", "編集画面に戻る");
  expect(previewButton).toHaveAttribute("title", "編集画面に戻る");
  expect(previewButton).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "戻す" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "新しい領域" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "新規作成" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "編集画面に戻る" }));
  expect(screen.getByRole("button", { name: "レンダリングプレビューを表示" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "新しい領域" })).toBeEnabled();
});

it("turns a temporary grid selection into one Polygon update", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://paint.realmmap", name: "Paint" });
  renderEditor(backend, snapshot);
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  expect(screen.getByRole("status", { name: "保存中の図形数" })).toHaveTextContent("1");
  await waitFor(async () => {
    const saved = await backend.getOpenProject();
    const shapes = mapShapesFromLayers(saved!.layers);
    expect(shapes).toHaveLength(1);
    expect(mapShapeCellIds(shapes[0]!)).toEqual(new Set(["1:1", "1:2"]));
  });
});

it("commits a shape edit once and keeps the shape id", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://shape-commit.realmmap", name: "Shape commit" });
  const original = terrain(["1:1"]);
  const before = await backend.replaceTerrainLayer({ shapes: [{ id: original.id, geometry: original.geometry }] });
  const update = vi.spyOn(backend, "replaceTerrainLayer");
  renderEditor(backend, before);
  fireEvent.click(screen.getByRole("button", { name: "テスト図形編集コミット" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  const saved = await backend.getOpenProject();
  const shapes = mapShapesFromLayers(saved!.layers);
  expect(shapes[0]?.id).toBe(original.id);
  expect(mapShapeCellIds(shapes[0]!)).toEqual(new Set(["4:4"]));
});

it("uses the active layer for region drawing and terrain erasing", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://layer-cell-operations.realmmap", name: "Layer cells" });
  const initialTerrain = terrain(["1:1"]);
  const initialRegion = { ...terrain(["8:8"], "33333333-3333-4333-8333-333333333333"), layer: "region" as const, regionId: "22222222-2222-4222-8222-222222222222", value: "#2468AC" };
  let snapshot = await backend.replaceTerrainLayer({ shapes: [{ id: initialTerrain.id, geometry: initialTerrain.geometry }] });
  snapshot = await backend.replaceRegionLayer({ regions: [{ id: initialRegion.regionId, name: "領域", color: initialRegion.value, shapes: [{ id: initialRegion.id, geometry: initialRegion.geometry }] }] });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト領域" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト領域色" }));
  fireEvent.click(screen.getByRole("button", { name: "新しい領域" }));
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.regions.length).toBe(2));

  const newRegion = screen.getByRole("button", { name: /領域 2に領域を追加/ });
  fireEvent.click(newRegion);
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.regions).toHaveLength(1));

  fireEvent.click(screen.getByRole("button", { name: "テスト消しゴム" }));
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.regions).toHaveLength(1));

  fireEvent.click(screen.getByRole("button", { name: "テスト地形描画" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト消しゴム" }));
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.terrain).toHaveLength(0));

  fireEvent.click(screen.getByRole("button", { name: "レイヤー管理パネルを閉じる" }));
  expect(screen.queryByRole("complementary", { name: "レイヤー管理" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "レイヤー管理パネルを開く" }));
  expect(screen.getByRole("complementary", { name: "レイヤー管理" })).toBeInTheDocument();
});

it("keeps logical regions separate and selects them from the panel", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://regions.realmmap", name: "Regions" });
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const first = { ...terrain(["1:1"], "33333333-3333-4333-8333-333333333333"), layer: "region" as const, regionId: firstId, value: "#2468AC" };
  const second = { ...terrain(["8:8"], "44444444-4444-4444-8444-444444444444"), layer: "region" as const, regionId: secondId, value: "#E45756" };
  const snapshot = await backend.replaceRegionLayer({ regions: [
    { id: firstId, name: "領域 1", color: first.value, shapes: [{ id: first.id, geometry: first.geometry }] },
    { id: secondId, name: "領域 2", color: second.value, shapes: [{ id: second.id, geometry: second.geometry }] },
  ] });
  renderEditor(backend, snapshot);
  fireEvent.click(screen.getByRole("button", { name: "テスト領域" }));
  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
  fireEvent.click(screen.getByRole("checkbox", { name: "領域 1を統合対象にする" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "領域 2を統合対象にする" }));
  fireEvent.click(screen.getByRole("button", { name: "選択した領域を統合" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.layers.regions.every((region) => region.id === firstId)).toBe(true));
});

it("shows optimistic Polygon state while an update is pending and restores it on failure", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://pending.realmmap", name: "Pending" });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const update = backend.replaceTerrainLayer.bind(backend);
  vi.spyOn(backend, "replaceTerrainLayer").mockImplementation(async (input) => { await gate; return update(input); });
  renderEditor(backend, snapshot);
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  expect(screen.getByRole("status", { name: "表示中の地形セル" })).toHaveTextContent("1:1,1:2");
  release?.();
  await waitFor(() => expect(screen.getByRole("button", { name: "戻す" })).toBeEnabled());
});
