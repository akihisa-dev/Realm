import { render, screen } from "@testing-library/react";
import { MemoryRealmBackend, type RealmSnapshot } from "./backend";
import App from "./App";

const emptySnapshot: RealmSnapshot = { formatVersion: 12, path: "browser://test.realmmap", world: { id: "world-test", name: "テスト世界" }, layers: { terrain: [], regions: [], objects: [] }, features: [], mapShapes: [], assets: [], settings: { themeId: "ink", showGrid: true, exportScale: 2, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} }, featureCount: 0, canUndo: false, canRedo: false };

describe("Realm editor bootstrap", () => {
  it("creates the first world and enters the editor without a startup screen", async () => {
    const backend = new MemoryRealmBackend();
    render(<App backend={backend} />);

    expect(await screen.findByRole("main", { name: "Realm地形編集画面" })).toBeInTheDocument();
    expect((await backend.getOpenProject())?.world.name).toBe("無題の世界");
    expect(screen.queryByText("新しい世界を作成")).not.toBeInTheDocument();
    expect(screen.queryByText("移行データを読み込む")).not.toBeInTheDocument();
  });

  it("opens an existing library world automatically", async () => {
    const backend = new MemoryRealmBackend([emptySnapshot]);
    render(<App backend={backend} />);

    expect(await screen.findByRole("main", { name: "Realm地形編集画面" })).toBeInTheDocument();
    expect((await backend.getOpenProject())?.world.name).toBe("テスト世界");
  });

  it("restores an already open world without reading the library", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ name: "作業中の世界" });
    backend.listProjects = async () => { throw new Error("呼び出されるべきではありません"); };
    render(<App backend={backend} />);

    expect(await screen.findByRole("main", { name: "Realm地形編集画面" })).toBeInTheDocument();
    expect((await backend.getOpenProject())?.world.name).toBe("作業中の世界");
  });

  it("exposes only an accessible status while restoration is pending", async () => {
    let resolveOpen: ((value: RealmSnapshot | null) => void) | undefined;
    const backend = new MemoryRealmBackend();
    backend.getOpenProject = () => new Promise((resolve) => { resolveOpen = resolve; });
    render(<App backend={backend} />);

    expect(screen.getByRole("status")).toHaveTextContent("世界を開いています。");
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    resolveOpen?.(null);
    expect(await screen.findByRole("main", { name: "Realm地形編集画面" })).toBeInTheDocument();
  });

  it("reports library and automatic creation failures", async () => {
    const libraryBackend = new MemoryRealmBackend();
    libraryBackend.listProjects = async () => { throw new Error("ライブラリ失敗"); };
    const { unmount } = render(<App backend={libraryBackend} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ライブラリ失敗");
    unmount();

    const createBackend = new MemoryRealmBackend();
    createBackend.createProject = async () => { throw new Error("作成失敗"); };
    render(<App backend={createBackend} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("作成失敗");
  });
});
