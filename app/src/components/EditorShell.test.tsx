import { useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRealmBackend, type RealmSnapshot } from "../backend";
import { EditorShell } from "./EditorShell";

vi.mock("./MapCanvas", () => ({
  MapCanvas: (props: {
    features?: Array<{ id: string; featureType: string }>;
    selectedFeatureIds?: readonly string[];
    selectedCellIds?: readonly string[];
    mode?: string;
    showGrid?: boolean;
    showCellGrid?: boolean;
    zoom?: number;
    onCellSelect?: (ids: readonly string[]) => void;
    onError?: (code: "drawing_self_intersection") => void;
  }) => {
    const initialCellSelect = useRef(props.onCellSelect);
    return <div role="region" aria-label="世界地図" data-mode={props.mode} data-grid-visible={String(props.showGrid)} data-cell-grid-visible={String(props.showCellGrid)} data-zoom={String(props.zoom)}>
      <output aria-label="描画対象">{props.features?.map(({ featureType }) => featureType).join(",")}</output>
      <button type="button" onClick={() => props.onCellSelect?.(["1:1", "1:2"])}>テストセル描画</button>
      <button type="button" onClick={() => initialCellSelect.current?.(["1:1"])}>テスト遅延セル操作</button>
      <button type="button" onClick={() => props.onError?.("drawing_self_intersection")}>テスト描画エラー</button>
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

it("shows exactly the three requested terrain tools and no sidebar", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://terrain-only.realmmap", name: "Terrain" });
  renderEditor(backend, snapshot);

  const tools = screen.getByRole("complementary", { name: "地形ツール" });
  expect(within(tools).getAllByRole("button").map((button) => button.textContent)).toEqual(["移動", "地形を描く", "地形を消す"]);
  expect(tools.querySelectorAll("svg")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "地形を描く" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("navigation", { name: "編集履歴" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "編集履歴" }).closest("header")).toHaveAttribute("data-tauri-drag-region", "deep");
  expect(screen.getByRole("button", { name: "戻す" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "戻す" })).not.toHaveAttribute("data-tauri-drag-region");
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

it("applies terrain to selected hex cells", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://draw.realmmap", name: "Draw" });
  renderEditor(backend, snapshot);

  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "cell-select");
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-grid-visible", "false");
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-cell-grid-visible", "true");
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-zoom", "4");
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));

  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([
    { cellId: "1:1", attribute: "terrain", value: "terrain" },
    { cellId: "1:2", attribute: "terrain", value: "terrain" },
  ]));
});

it("shows a localized drawing error from the message catalog", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://error.realmmap", name: "Error" });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "テスト描画エラー" }));
  expect(screen.getByRole("alert")).toHaveTextContent("地形の輪郭が交差しています。線が交差しないように描き直してください。");
  expect(screen.getByRole("alert")).not.toHaveTextContent("self-intersect");
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

  fireEvent.click(screen.getByRole("button", { name: "地形を消す" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト遅延セル操作" }));
  await waitFor(async () => expect(await backend.viewCellAttributes({})).toEqual([]));
  expect((await backend.getOpenProject())?.features).toEqual([expect.objectContaining({ featureType: "city", name: "旧都市" })]);
});

it("keeps the three terrain tool shortcuts", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://shortcuts.realmmap", name: "Shortcuts" });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "移動" }));
  expect(screen.getByRole("button", { name: "移動" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(window, { key: "c" });
  expect(screen.getByRole("button", { name: "地形を描く" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(window, { key: "e" });
  expect(screen.getByRole("button", { name: "地形を消す" })).toHaveAttribute("aria-pressed", "true");
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
