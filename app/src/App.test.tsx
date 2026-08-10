import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRealmBackend, type RealmSnapshot } from "./backend";
import App from "./App";

const emptySnapshot: RealmSnapshot = { formatVersion: 7, path: "browser://test.realmmap", world: { id: "world-test", name: "テスト世界" }, features: [], assets: [], settings: { themeId: "ink", showGrid: true, exportScale: 2, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} }, featureCount: 0, canUndo: false, canRedo: false };

describe("Realm library workflow", () => {
  it("creates a world and opens the terrain editor", async () => {
    const backend = new MemoryRealmBackend(); render(<App backend={backend} />);
    const create = await screen.findByRole("button", { name: "新しい世界を作成" }); await waitFor(() => expect(create).toBeEnabled()); fireEvent.click(create);
    expect(await screen.findByRole("main", { name: "Realm地形編集画面" })).toBeInTheDocument();
    expect((await backend.getOpenProject())?.world.name).toBe("無題の世界");
  });

  it("keeps the startup surface available as a native window drag region", async () => {
    const backend = new MemoryRealmBackend(); render(<App backend={backend} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "新しい世界を作成" })).toBeEnabled());
    expect(screen.getByRole("main")).toHaveAttribute("data-tauri-drag-region", "deep");
    expect(screen.getByRole("button", { name: "新しい世界を作成" })).not.toHaveAttribute("data-tauri-drag-region");
  });

  it("opens a library project", async () => {
    const backend = new MemoryRealmBackend([emptySnapshot]); render(<App backend={backend} />);
    fireEvent.click(await screen.findByRole("button", { name: /テスト世界/u }));
    expect(await screen.findByRole("main", { name: "Realm地形編集画面" })).toBeInTheDocument();
    expect((await backend.getOpenProject())?.world.name).toBe("テスト世界");
  });

  it("imports a transfer project from the startup screen", async () => {
    const backend = new MemoryRealmBackend([emptySnapshot]); render(<App backend={backend} chooseTransfer={async () => emptySnapshot.path} />);
    fireEvent.click(await screen.findByRole("button", { name: "移行データを読み込む" }));
    expect(await screen.findByRole("main", { name: "Realm地形編集画面" })).toBeInTheDocument();
  });

  it("handles create/import/export cancellation and failures", async () => {
    const backend = new MemoryRealmBackend();
    backend.createProject = async () => { throw new Error("作成失敗"); };
    render(<App backend={backend} chooseTransfer={async () => null} />);
    fireEvent.click(await screen.findByRole("button", { name: "新しい世界を作成" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("作成失敗");
    expect(screen.getByText("まだ世界がありません。")).toBeInTheDocument();
  });

  it("keeps startup disabled during restoration and reports library read errors", async () => {
    let resolveOpen: ((value: RealmSnapshot | null) => void) | undefined;
    const backend = new MemoryRealmBackend(); backend.getOpenProject = () => new Promise((resolve) => { resolveOpen = resolve; });
    render(<App backend={backend} />); expect(screen.getByRole("button", { name: "新しい世界を作成" })).toBeDisabled();
    resolveOpen?.(null); await waitFor(() => expect(screen.getByRole("button", { name: "新しい世界を作成" })).toBeEnabled());
  });

  it("surfaces initial library errors", async () => {
    const backend = new MemoryRealmBackend(); backend.listProjects = async () => { throw new Error("ライブラリ失敗"); };
    render(<App backend={backend} />); expect(await screen.findByRole("alert")).toHaveTextContent("ライブラリ失敗"); cleanup();
  });
});
