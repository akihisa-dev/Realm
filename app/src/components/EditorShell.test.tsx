import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRealmBackend, type MapShape, type RealmSnapshot } from "../backend";
import { cellIdsToPolygonGeometries, mapShapeCellIds } from "../shared/mapShapeGeometry";
import { EditorShell } from "./EditorShell";

vi.mock("./MapCanvas", () => ({
  MapCanvas: (props: {
    mapShapes?: readonly MapShape[];
    selectedCellIds?: readonly string[];
    mode?: string;
    onCellSelect?: (ids: readonly string[]) => void;
    onMapShapeEdit?: (edit: { shapes: MapShape[] }) => void;
    onToolChange?: (tool: "terrain" | "region" | "erase" | "grab" | "shape") => void;
    onEraseTargetChange?: (target: "terrain" | "region") => void;
    onRegionColorChange?: (color: string) => void;
  }) => (
    <div role="region" aria-label="世界地図" data-mode={props.mode}>
      <output aria-label="保存中の図形数">{props.mapShapes?.length ?? 0}</output>
      <output aria-label="表示中の地形セル">{props.mapShapes?.flatMap((shape) => [...mapShapeCellIds(shape)]).sort().join(",")}</output>
      <output aria-label="選択中の地形セル">{props.selectedCellIds?.join(",")}</output>
      <button type="button" onClick={() => props.onCellSelect?.(["1:1", "1:2"])}>テストセル描画</button>
      <button type="button" onClick={() => props.onCellSelect?.(["1:1"])}>テスト遅延セル操作</button>
      <button type="button" onClick={() => props.onToolChange?.("erase")}>テスト消しゴム</button>
      <button type="button" onClick={() => props.onEraseTargetChange?.("region")}>テスト領域削除</button>
      <button type="button" onClick={() => props.onToolChange?.("terrain")}>テスト地形描画</button>
      <button type="button" onClick={() => props.onToolChange?.("region")}>テスト領域</button>
      <button type="button" onClick={() => props.onToolChange?.("grab")}>テストグラブ</button>
      <button type="button" onClick={() => props.onToolChange?.("shape")}>テストシェイピング</button>
      <button type="button" onClick={() => props.onRegionColorChange?.("#2468AC")}>テスト領域色</button>
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

it("keeps the editor shell and object manager while rendering map_shapes", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://shell.realmmap", name: "Shell" });
  renderEditor(backend, snapshot);
  expect(screen.getByRole("navigation", { name: "編集履歴" })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "オブジェクトマネージャー" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "世界地図" })).toBeInTheDocument();
});

it("turns a temporary grid selection into one Polygon update", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://paint.realmmap", name: "Paint" });
  renderEditor(backend, snapshot);
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  expect(screen.getByRole("status", { name: "保存中の図形数" })).toHaveTextContent("1");
  await waitFor(async () => {
    const saved = await backend.getOpenProject();
    expect(saved?.mapShapes).toHaveLength(1);
    expect(mapShapeCellIds(saved!.mapShapes[0]!)).toEqual(new Set(["1:1", "1:2"]));
  });
});

it("commits a shape edit once and keeps the shape id", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://shape-commit.realmmap", name: "Shape commit" });
  const original = terrain(["1:1"]);
  const before = await backend.updateMapShapes({ shapes: [original] });
  const update = vi.spyOn(backend, "updateMapShapes");
  renderEditor(backend, before);
  fireEvent.click(screen.getByRole("button", { name: "テスト図形編集コミット" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect((await backend.getOpenProject())?.mapShapes[0]?.id).toBe(original.id);
  expect(mapShapeCellIds((await backend.getOpenProject())!.mapShapes[0]!)).toEqual(new Set(["4:4"]));
});

it("merges and splits logical regions through map_shape updates", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://regions.realmmap", name: "Regions" });
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const first = { ...terrain(["1:1"], "33333333-3333-4333-8333-333333333333"), layer: "region" as const, regionId: firstId, value: "#2468AC" };
  const second = { ...terrain(["8:8"], "44444444-4444-4444-8444-444444444444"), layer: "region" as const, regionId: secondId, value: "#E45756" };
  const snapshot = await backend.updateMapShapes({ shapes: [first, second] });
  renderEditor(backend, snapshot);
  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
  fireEvent.click(screen.getByRole("checkbox", { name: "領域 1を統合対象にする" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "領域 2を統合対象にする" }));
  fireEvent.click(screen.getByRole("button", { name: "選択した領域を統合" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.mapShapes.every((shape) => shape.regionId === firstId)).toBe(true));
});

it("shows optimistic Polygon state while an update is pending and restores it on failure", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://pending.realmmap", name: "Pending" });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const update = backend.updateMapShapes.bind(backend);
  vi.spyOn(backend, "updateMapShapes").mockImplementation(async (input) => { await gate; return update(input); });
  renderEditor(backend, snapshot);
  fireEvent.click(screen.getByRole("button", { name: "テストセル描画" }));
  expect(screen.getByRole("status", { name: "表示中の地形セル" })).toHaveTextContent("1:1,1:2");
  release?.();
  await waitFor(() => expect(screen.getByRole("button", { name: "戻す" })).toBeEnabled());
});
