import { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRealmBackend, type RealmSnapshot } from "../backend";
import { EditorShell } from "./EditorShell";

vi.mock("./MapCanvas", () => ({
  MapCanvas: (props: {
    features?: Array<{ id: string; featureType: string }>;
    selectedFeatureIds?: readonly string[];
    selectedCellIds?: readonly string[];
    cellAttributes?: readonly { cellId: string; attribute: string; value: string }[];
    mode?: string;
    showGrid?: boolean;
    showCellGrid?: boolean;
    zoom?: number;
    onCellSelect?: (ids: readonly string[]) => void;
    onToolChange?: (tool: "terrain" | "region" | "erase" | "grab" | "shape") => void;
    onEraseTargetChange?: (target: "terrain" | "region") => void;
    onRegionMove?: (input: { sourceCellIds: string[]; targetCellIds: string[] }) => void;
    onRegionShape?: (input: { cellIds: string[]; attribute: "region"; value: null }) => void;
    onCellResize?: (input: { cellIds: string[]; attribute: "terrain" | "region"; value: string | null; regionId?: string }) => void;
    onRegionColorChange?: (color: string) => void;
    onError?: (code: "drawing_self_intersection") => void;
  }) => {
    const initialCellSelect = useRef(props.onCellSelect);
    return <div role="region" aria-label="世界地図" data-mode={props.mode} data-grid-visible={String(props.showGrid)} data-cell-grid-visible={String(props.showCellGrid)} data-zoom={String(props.zoom)}>
      <output aria-label="描画対象">{props.features?.map(({ featureType }) => featureType).join(",")}</output>
      <output aria-label="表示中の地形セル">{props.cellAttributes?.map(({ cellId }) => cellId).join(",")}</output>
      <output aria-label="選択中の地形セル">{props.selectedCellIds?.join(",")}</output>
      <button type="button" onClick={() => props.onCellSelect?.(["1:1", "1:2"])}>テストセル描画</button>
      <button type="button" onClick={() => initialCellSelect.current?.(["1:1"])}>テスト遅延セル操作</button>
      <button type="button" onClick={() => props.onCellSelect?.([])}>テスト選択解除</button>
      <button type="button" onClick={() => props.onError?.("drawing_self_intersection")}>テスト描画エラー</button>
      <button type="button" onClick={() => props.onToolChange?.("erase")}>テスト消しゴム</button>
      <button type="button" onClick={() => props.onEraseTargetChange?.("region")}>テスト領域削除</button>
      <button type="button" onClick={() => props.onToolChange?.("terrain")}>テスト地形描画</button>
      <button type="button" onClick={() => props.onToolChange?.("region")}>テスト領域</button>
      <button type="button" onClick={() => props.onToolChange?.("grab")}>テストグラブ</button>
      <button type="button" onClick={() => props.onToolChange?.("shape")}>テストシェイピング</button>
      <button type="button" onClick={() => props.onRegionMove?.({ sourceCellIds: ["1:1", "2:1"], targetCellIds: ["4:2", "5:2"] })}>テスト領域移動</button>
      <button type="button" onClick={() => props.onRegionShape?.({ cellIds: ["3:1", "20:20"], attribute: "region", value: null })}>テスト領域シェイピング</button>
      <button type="button" onClick={() => props.onCellResize?.({ cellIds: ["1:2"], attribute: "terrain", value: "terrain" })}>テスト地形境界拡張</button>
      <button type="button" onClick={() => props.onRegionColorChange?.("#2468AC")}>テスト領域色</button>
    </div>;
  },
}));

const renderEditor = (backend: MemoryRealmBackend, snapshot: RealmSnapshot) => render(
  <EditorShell
    snapshot={snapshot}
    backend={backend}
    busy={false}
    onSaved={vi.fn()}
  />,
);

it("removes the duplicate rail while keeping the map editor", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://terrain-only.realmmap", name: "Terrain" });
  renderEditor(backend, snapshot);

  expect(screen.queryByRole("complementary", { name: "地形ツール" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "移動" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "地形を描く" })).not.toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "編集履歴" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "編集履歴" }).closest("header")).toHaveAttribute("data-electron-drag-region", "deep");
  expect(screen.getByRole("button", { name: "戻す" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "戻す" })).not.toHaveAttribute("data-electron-drag-region");
  expect(screen.getByRole("button", { name: "進む" })).toBeDisabled();
  expect(screen.queryByRole("complementary", { name: "地形の構成" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("地形を検索")).not.toBeInTheDocument();
  expect(screen.queryByText("新しい地形")).not.toBeInTheDocument();
  expect(screen.queryByText("描き方")).not.toBeInTheDocument();
  expect(screen.queryByText("地形図の表現")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "ライブラリ" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "PNG" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "現在の地図操作" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "地図のズーム" })).not.toBeInTheDocument();
});

it("opens and closes the object manager without removing the map", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://object-manager.realmmap", name: "Object manager" });
  renderEditor(backend, snapshot);

  expect(screen.getByRole("complementary", { name: "オブジェクトマネージャー" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "右パネルを閉じる" }));
  expect(screen.queryByRole("complementary", { name: "オブジェクトマネージャー" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "世界地図" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "オブジェクトマネージャーを開く" }));
  expect(screen.getByRole("complementary", { name: "オブジェクトマネージャー" })).toBeInTheDocument();
});

it("adds a new disconnected chunk to the selected logical region", async () => {
  const backend = new MemoryRealmBackend();
  const regionId = "11111111-1111-4111-8111-111111111111";
  await backend.createProject({ path: "browser://object-add.realmmap", name: "Object add" });
  await backend.applyCellAttributes({ cellIds: ["8:8"], attribute: "region", value: "#2468AC", regionId });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  await waitFor(() => expect(screen.getByRole("button", { name: "領域 1に領域を追加" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "領域 1に領域を追加" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-region");
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    expect.objectContaining({ cellId: "8:8", attribute: "region", regionId }),
    expect.objectContaining({ cellId: "1:1", attribute: "region", regionId }),
    expect.objectContaining({ cellId: "1:2", attribute: "region", regionId }),
  ])));
});

it("merges selected logical regions into the first selected region", async () => {
  const backend = new MemoryRealmBackend();
  const firstRegionId = "11111111-1111-4111-8111-111111111111";
  const secondRegionId = "22222222-2222-4222-8222-222222222222";
  await backend.createProject({ path: "browser://object-merge.realmmap", name: "Object merge" });
  await backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "region", value: "#2468AC", regionId: firstRegionId });
  await backend.applyCellAttributes({ cellIds: ["8:8"], attribute: "region", value: "#E45756", regionId: secondRegionId });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
  fireEvent.click(screen.getByRole("checkbox", { name: "領域 1を統合対象にする" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "領域 2を統合対象にする" }));
  fireEvent.click(screen.getByRole("button", { name: "選択した領域を統合" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([
    { cellId: "1:1", attribute: "region", value: "#2468AC", regionId: firstRegionId },
    { cellId: "8:8", attribute: "region", value: "#2468AC", regionId: firstRegionId },
  ]));
});

it("separates one disconnected chunk into a new logical region", async () => {
  const backend = new MemoryRealmBackend();
  const regionId = "33333333-3333-4333-8333-333333333333";
  await backend.createProject({ path: "browser://object-split.realmmap", name: "Object split" });
  await backend.applyCellAttributes({ cellIds: ["1:1", "2:1", "20:20"], attribute: "region", value: "#2468AC", regionId });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  await waitFor(() => expect(screen.getByText("2個の塊・3セル")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "領域 1の塊を表示する" }));
  fireEvent.click(screen.getByRole("button", { name: "領域 1の塊2を分離" }));

  await waitFor(async () => {
    const attributes = await backend.viewCellAttributes({});
    expect(attributes.find((item) => item.cellId === "1:1")?.regionId).toBe(regionId);
    expect(attributes.find((item) => item.cellId === "20:20")?.regionId).toBeDefined();
    expect(attributes.find((item) => item.cellId === "20:20")?.regionId).not.toBe(regionId);
  });
});

it("applies terrain to selected hex cells", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://draw.realmmap", name: "Draw" });
  renderEditor(backend, snapshot);

  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-select");
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-grid-visible", "false");
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-cell-grid-visible", "true");
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-zoom", "1");
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  expect(screen.getByRole("status", { name: "表示中の地形セル" })).toHaveTextContent("1:1,1:2");

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
    { cellId: "1:2", attribute: "terrain", value: "terrain" },
  ]));
});

it("saves a colored region without changing terrain cells and supports undo", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://region.realmmap", name: "Region" });
  await backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "terrain", value: "terrain" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト領域" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-region");
  fireEvent.click(screen.getByRole("button", { name: "テスト領域色" }));
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
    expect.objectContaining({ cellId: "1:1", attribute: "region", value: "#2468AC" }),
    expect.objectContaining({ cellId: "1:2", attribute: "region", value: "#2468AC" }),
  ]));
  expect((await backend.getOpenProject())?.features).toEqual([]);
  expect(screen.getByRole("status", { name: "描画対象" })).toHaveTextContent("");

  fireEvent.click(screen.getByRole("button", { name: "戻す" }));
  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
  ]));
});

it("shapes a clicked region to terrain and supports undo", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://shape-region.realmmap", name: "Shape region" });
  const regionId = "33333333-3333-4333-8333-333333333333";
  await backend.applyCellAttributes({ cellIds: ["1:1", "2:1"], attribute: "terrain", value: "terrain" });
  await backend.applyCellAttributes({ cellIds: ["1:1", "2:1", "3:1", "20:20"], attribute: "region", value: "#2468AC", regionId });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テストシェイピング" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "shape");
  fireEvent.click(screen.getByRole("button", { name: "テスト領域シェイピング" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
    { cellId: "2:1", attribute: "terrain", value: "terrain" },
    expect.objectContaining({ cellId: "1:1", attribute: "region", value: "#2468AC", regionId }),
    expect.objectContaining({ cellId: "2:1", attribute: "region", value: "#2468AC", regionId }),
  ])));
  expect(await backend.viewCellAttributes({})).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ cellId: "3:1", attribute: "region" }),
    expect.objectContaining({ cellId: "20:20", attribute: "region" }),
  ]));

  fireEvent.click(screen.getByRole("button", { name: "戻す" }));
  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    expect.objectContaining({ cellId: "3:1", attribute: "region", value: "#2468AC", regionId }),
    expect.objectContaining({ cellId: "20:20", attribute: "region", value: "#2468AC", regionId }),
  ])));
});

it("keeps a grabbed region's hidden overhang at the destination", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://grab-editor.realmmap", name: "Grab editor" });
  await backend.applyCellAttributes({ cellIds: ["1:1", "4:2"], attribute: "terrain", value: "terrain" });
  await backend.applyCellAttributes({ cellIds: ["1:1", "2:1"], attribute: "region", value: "#2468AC" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テストグラブ" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "grab");
  fireEvent.click(screen.getByRole("button", { name: "テスト領域移動" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
    expect.objectContaining({ cellId: "4:2", attribute: "region", value: "#2468AC" }),
    { cellId: "4:2", attribute: "terrain", value: "terrain" },
  ])));
  expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([expect.objectContaining({ cellId: "5:2", attribute: "region", value: "#2468AC" })]));
  expect(await backend.viewCellAttributes({})).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ cellId: "1:1", attribute: "region", value: "#2468AC" }),
    expect.objectContaining({ cellId: "2:1", attribute: "region", value: "#2468AC" }),
  ]));
});

it("saves a terrain boundary expansion through the grab callback", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://terrain-grab.realmmap", name: "Terrain grab" });
  await backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "terrain", value: "terrain" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テストグラブ" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト地形境界拡張" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
    { cellId: "1:2", attribute: "terrain", value: "terrain" },
  ])));
});

it("rejects a grabbed region when it overlaps another region", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://grab-overlap-editor.realmmap", name: "Grab overlap editor" });
  const movingRegionId = "77777777-7777-4777-8777-777777777777";
  const stationaryRegionId = "88888888-8888-4888-8888-888888888888";
  await backend.applyCellAttributes({ cellIds: ["1:1", "2:1"], attribute: "region", value: "#2468AC", regionId: movingRegionId });
  await backend.applyCellAttributes({ cellIds: ["4:2"], attribute: "region", value: "#AA0000", regionId: stationaryRegionId });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テストグラブ" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト領域移動" }));

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("移動先に別の領域があるため移動できません。"));
  expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "1:1", attribute: "region", value: "#2468AC", regionId: movingRegionId },
    { cellId: "2:1", attribute: "region", value: "#2468AC", regionId: movingRegionId },
    { cellId: "4:2", attribute: "region", value: "#AA0000", regionId: stationaryRegionId },
  ]));
});

it("restores persisted region cells after a grab save fails", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://grab-failure.realmmap", name: "Grab failure" });
  await backend.applyCellAttributes({ cellIds: ["1:1", "2:1"], attribute: "region", value: "#2468AC" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  vi.spyOn(backend, "moveRegionCells").mockRejectedValue(new Error("save failed"));
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テストグラブ" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト領域移動" }));

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("領域を移動できませんでした。"));
  expect(await backend.viewCellAttributes({})).toEqual([
    expect.objectContaining({ cellId: "1:1", attribute: "region", value: "#2468AC" }),
    expect.objectContaining({ cellId: "2:1", attribute: "region", value: "#2468AC" }),
  ]);
});

it("shows painted terrain while the save IPC is still pending", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://draw-pending.realmmap", name: "Draw pending" });
  const apply = backend.applyCellAttributes.bind(backend);
  let releaseSave: (() => void) | undefined;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  vi.spyOn(backend, "applyCellAttributes").mockImplementation(async (input) => {
    await saveGate;
    return apply(input);
  });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  expect(screen.getByRole("status", { name: "表示中の地形セル" })).toHaveTextContent("1:1,1:2");
  expect(screen.getByRole("status", { name: "選択中の地形セル" })).toHaveTextContent("");
  releaseSave?.();
  await waitFor(async () => expect(await backend.viewCellAttributes({})).toHaveLength(2));
});

it("ignores an older cell read after a newer optimistic paint", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://draw-stale-read.realmmap", name: "Draw stale read" });
  const view = backend.viewCellAttributes.bind(backend);
  let releaseInitialRead: ((attributes: []) => void) | undefined;
  const initialRead = new Promise<[]>(resolve => { releaseInitialRead = resolve; });
  vi.spyOn(backend, "viewCellAttributes")
    .mockImplementationOnce(() => initialRead)
    .mockImplementation((input) => view(input));
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  const visibleCells = screen.getByRole("status", { name: "表示中の地形セル" });
  expect(visibleCells).toHaveTextContent("1:1,1:2");
  releaseInitialRead?.([]);
  await waitFor(() => expect(visibleCells).toHaveTextContent("1:1,1:2"));
});

it("shows a localized drawing error from the message catalog", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://error.realmmap", name: "Error" });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト描画エラー" }));
  expect(screen.getByRole("alert")).toHaveTextContent("地形の輪郭が交差しています。線が交差しないように描き直してください。");
  expect(screen.getByRole("alert")).not.toHaveTextContent("self-intersect");
});

it("does not describe a cell-region failure as an invalid freehand boundary", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://region-error.realmmap", name: "Region error" });
  renderEditor(backend, snapshot);
  fireEvent.click(screen.getByRole("button", { name: "テスト領域" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト描画エラー" }));
  expect(screen.getByRole("alert")).toHaveTextContent("セルの領域属性を更新できませんでした。");
  expect(screen.getByRole("alert")).not.toHaveTextContent("輪郭が交差");
});

it("edits terrain directly on the canvas while hiding legacy objects", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://legacy.realmmap", name: "Legacy" });
  await backend.createFeature({ featureType: "city", name: "旧都市", geometry: { type: "Point", coordinates: [0, 0] } });
  const snapshot = await backend.createFeature({ featureType: "terrain", name: "大陸", geometry: { type: "Polygon", coordinates: [[[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]]] } });
  renderEditor(backend, snapshot);

  expect(screen.queryByText("旧都市")).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "描画対象" })).toHaveTextContent("");

  await waitFor(async () => {
    const current = await backend.getOpenProject();
    expect(current?.features.find(({ featureType }) => featureType === "city")).toMatchObject({ name: "旧都市" });
    expect(current?.features.find(({ featureType }) => featureType === "terrain")).toBeDefined();
  });
});

it("erases terrain cells through an already registered map callback without deleting legacy polygons", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://erase.realmmap", name: "Erase" });
  await backend.createFeature({ featureType: "city", name: "旧都市", geometry: { type: "Point", coordinates: [0, 0] } });
  await backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "terrain", value: "terrain" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト消しゴム" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-erase");
  fireEvent.click(screen.getByRole("button", { name: "テスト遅延セル操作" }));
  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([]));
  expect((await backend.getOpenProject())?.features).toEqual([expect.objectContaining({ featureType: "city", name: "旧都市" })]);
});

it("deletes only region cells after switching the eraser target", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://erase-region.realmmap", name: "Erase region" });
  await backend.applyCellAttributes({ cellIds: ["1:1", "1:2"], attribute: "terrain", value: "terrain" });
  await backend.applyCellAttributes({ cellIds: ["1:1", "1:2"], attribute: "region", value: "#2468AC" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト領域削除" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト消しゴム" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-erase");
  fireEvent.click(screen.getByRole("button", { name: "テスト遅延セル操作" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
    { cellId: "1:2", attribute: "terrain", value: "terrain" },
    expect.objectContaining({ cellId: "1:2", attribute: "region", value: "#2468AC" }),
  ]));
});

it("erases terrain and its region together as one undoable operation", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://erase-terrain-region.realmmap", name: "Erase terrain and region" });
  await backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "terrain", value: "terrain" });
  await backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "region", value: "#2468AC" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト消しゴム" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト遅延セル操作" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([]));
  expect((await backend.getOpenProject())?.canUndo).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "戻す" }));
  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
    expect.objectContaining({ cellId: "1:1", attribute: "region", value: "#2468AC" }),
  ])));
  expect(await backend.viewCellAttributes({})).toHaveLength(2);
});

it("removes an erased cell from the map before save completes and restores it on failure", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://erase-optimistic.realmmap", name: "Erase optimistic" });
  await backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "terrain", value: "terrain" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  const visibleCells = screen.getByRole("status", { name: "表示中の地形セル" });
  await waitFor(() => expect(visibleCells).toHaveTextContent("1:1"));
  let rejectSave: (cause: Error) => void = () => undefined;
  const saveFailure = new Promise<RealmSnapshot>((_resolve, reject) => { rejectSave = reject; });
  vi.spyOn(backend, "applyCellAttributes").mockReturnValue(saveFailure);

  fireEvent.click(screen.getByRole("button", { name: "テスト消しゴム" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト遅延セル操作" }));
  expect(visibleCells).not.toHaveTextContent("1:1");

  rejectSave(new Error("save failed"));
  await waitFor(() => expect(visibleCells).toHaveTextContent("1:1"));
  expect(screen.getByRole("alert")).toHaveTextContent("セルの地形属性を更新できませんでした。");
});

it("restores persisted terrain after a painted save fails", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://draw-failure.realmmap", name: "Draw failure" });
  await backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "terrain", value: "terrain" });
  const snapshot = await backend.getOpenProject();
  if (!snapshot) throw new Error("snapshot missing");
  renderEditor(backend, snapshot);

  const visibleCells = screen.getByRole("status", { name: "表示中の地形セル" });
  await waitFor(() => expect(visibleCells).toHaveTextContent("1:1"));
  vi.spyOn(backend, "applyCellAttributes").mockRejectedValue(new Error("save failed"));
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  expect(visibleCells).toHaveTextContent("1:1,1:2");
  await waitFor(() => expect(visibleCells).toHaveTextContent("1:1"));
  expect(screen.getByRole("alert")).toHaveTextContent("セルの地形属性を更新できませんでした。");
  expect(await backend.viewCellAttributes({})).toEqual([{ cellId: "1:1", attribute: "terrain", value: "terrain" }]);
});

it("keeps completed paint out of controlled selection", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://empty-selection.realmmap", name: "Empty selection" });
  renderEditor(backend, snapshot);
  vi.spyOn(backend, "applyCellAttributes").mockRejectedValue(new Error("save failed"));

  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  expect(screen.getByRole("status", { name: "選択中の地形セル" })).toHaveTextContent("");
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("セルの地形属性を更新できませんでした。"));

  fireEvent.click(screen.getByRole("button", { name: "テスト選択解除" }));
  expect(screen.getByRole("status", { name: "選択中の地形セル" })).toHaveTextContent("");
});

it("keeps terrain and eraser keyboard shortcuts without a rail", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://shortcuts.realmmap", name: "Shortcuts" });
  renderEditor(backend, snapshot);

  fireEvent.keyDown(window, { key: "c" });
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-select");
  fireEvent.keyDown(window, { key: "e" });
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-erase");
  fireEvent.click(screen.getByRole("button", { name: "テスト地形描画" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-select");
});

it("returns and reapplies the latest terrain edit", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://history.realmmap", name: "History" });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "戻す" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "戻す" }));
  await waitFor(async () => expect(await backend.viewCellAttributes({})).toHaveLength(0));
  expect(screen.getByRole("button", { name: "進む" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "進む" }));
  await waitFor(async () => expect(await backend.viewCellAttributes({})).toHaveLength(2));
});
