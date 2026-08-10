import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    onExporterReady?: (exporter: ((mime: "image/png" | "image/jpeg") => Promise<{ bytes: number[]; width: number; height: number }>) | null) => void;
  }) => <div role="region" aria-label="世界地図" data-mode={props.mode}>
    <output aria-label="描画対象">{props.features?.map(({ featureType }) => featureType).join(",")}</output>
    <button type="button" onClick={() => props.onDraw?.({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] })}>テスト地形描画</button>
    <button type="button" onClick={() => props.onSelectFeatures?.(props.features?.[0]?.id ? [props.features[0].id] : [])}>テスト選択</button>
    <button type="button" onClick={() => props.selectedFeatureIds?.[0] && props.onModifyFeatures?.([{ id: props.selectedFeatureIds[0], geometry: { type: "Polygon", coordinates: [[[1, 1], [11, 1], [11, 11], [1, 11], [1, 1]]] } }])}>テスト変形</button>
    <button type="button" onClick={() => props.features?.[0] && props.onEraseFeatures?.([props.features[0].id])}>テスト消去</button>
    <button type="button" onClick={() => props.onExporterReady?.(async () => ({ bytes: [1, 2, 3], width: 2, height: 2 }))}>テストexport準備</button>
  </div>,
  MapZoomControls: () => <div />,
}));

const terrainGeometry = (): GeoJsonGeometry => ({
  type: "Polygon",
  coordinates: [[[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]]],
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

it("shows exactly the three requested terrain tools and no sidebar", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://terrain-only.realmmap", name: "Terrain" });
  renderEditor(backend, snapshot);

  const tools = screen.getByRole("complementary", { name: "地形ツール" });
  expect(within(tools).getAllByRole("button").map((button) => button.textContent)).toEqual(["移動", "地形を描く", "地形を消す"]);
  expect(screen.queryByRole("complementary", { name: "地形の構成" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("地形を検索")).not.toBeInTheDocument();
  expect(screen.queryByText("新しい地形")).not.toBeInTheDocument();
  expect(screen.queryByText("描き方")).not.toBeInTheDocument();
  expect(screen.queryByText("地形図の表現")).not.toBeInTheDocument();
});

it("creates a terrain polygon with the fixed terrain name", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://draw.realmmap", name: "Draw" });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "地形を描く" }));
  expect(screen.getByRole("region", { name: "世界地図" })).toHaveAttribute("data-mode", "terrain");
  fireEvent.click(screen.getByRole("button", { name: "テスト地形描画" }));

  await waitFor(async () => expect((await backend.getOpenProject())?.features).toEqual([
    expect.objectContaining({ featureType: "terrain", name: "地形", geometry: expect.objectContaining({ type: "Polygon" }) }),
  ]));
});

it("edits terrain directly on the canvas while hiding legacy objects", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://legacy.realmmap", name: "Legacy" });
  await backend.createFeature({ featureType: "city", name: "旧都市", geometry: { type: "Point", coordinates: [0, 0] } });
  const snapshot = await backend.createFeature({ featureType: "terrain", name: "大陸", geometry: terrainGeometry() });
  renderEditor(backend, snapshot);

  expect(screen.queryByText("旧都市")).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "描画対象" })).toHaveTextContent("terrain");
  fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト変形" }));

  await waitFor(async () => {
    const current = await backend.getOpenProject();
    expect(current?.features.find(({ featureType }) => featureType === "city")).toMatchObject({ name: "旧都市" });
    expect(current?.features.find(({ featureType }) => featureType === "terrain")?.geometry).toEqual({
      type: "Polygon",
      coordinates: [[[1, 1], [11, 1], [11, 11], [1, 11], [1, 1]]],
    });
  });
});

it("erases only terrain through the erase tool", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://erase.realmmap", name: "Erase" });
  await backend.createFeature({ featureType: "city", name: "旧都市", geometry: { type: "Point", coordinates: [0, 0] } });
  const snapshot = await backend.createFeature({ featureType: "terrain", name: "島", geometry: terrainGeometry() });
  renderEditor(backend, snapshot);

  fireEvent.click(screen.getByRole("button", { name: "地形を消す" }));
  fireEvent.click(screen.getByRole("button", { name: "テスト消去" }));
  await waitFor(async () => expect((await backend.getOpenProject())?.features).toEqual([
    expect.objectContaining({ featureType: "city", name: "旧都市" }),
  ]));
});

it("keeps terrain shortcuts and project-name autosave", async () => {
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

it("still exports terrain artifacts from the file toolbar", async () => {
  const backend = new MemoryRealmBackend();
  const snapshot = await backend.createProject({ path: "browser://export.realmmap", name: "Export" });
  const onArtifact = vi.fn(async () => undefined);
  renderEditor(backend, snapshot, { onExportArtifact: onArtifact });

  fireEvent.click(screen.getByRole("button", { name: "テストexport準備" }));
  fireEvent.click(screen.getByRole("button", { name: "PNG" }));
  await waitFor(() => expect(onArtifact).toHaveBeenCalledWith("png", [1, 2, 3]));
});
