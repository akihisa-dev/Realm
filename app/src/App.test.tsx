import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRealmBackend, type RealmSnapshot } from "./backend";
import App from "./App";

const emptySnapshot: RealmSnapshot = { formatVersion: 3, path: "browser://test.realmmap", world: { id: "world-test", name: "テスト世界" }, features: [], featureCount: 0, canUndo: false, canRedo: false };

describe("Realm library workflow", () => {
  it("creates and reopens a world", async () => {
    const backend = new MemoryRealmBackend(); render(<App backend={backend} />);
    const create = await screen.findByRole("button", { name: "新しい世界を作成" }); await waitFor(() => expect(create).toBeEnabled()); fireEvent.click(create);
    expect(await screen.findByRole("textbox", { name: "世界の名前" })).toHaveValue("無題の世界");
    fireEvent.click(screen.getByRole("button", { name: "ライブラリ" }));
    expect(await screen.findByRole("button", { name: /無題の世界/u })).toBeInTheDocument();
  });
  it("opens and imports library projects", async () => {
    const backend = new MemoryRealmBackend([emptySnapshot]); render(<App backend={backend} chooseTransfer={async () => emptySnapshot.path} />);
    fireEvent.click(await screen.findByRole("button", { name: /テスト世界/u })); expect(await screen.findByRole("textbox", { name: "世界の名前" })).toHaveValue("テスト世界");
    fireEvent.click(screen.getByRole("button", { name: "ライブラリ" })); fireEvent.click(await screen.findByRole("button", { name: "移行データを読み込む" }));
    expect(await screen.findByRole("textbox", { name: "世界の名前" })).toHaveValue("テスト世界");
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

  it("surfaces initial library and close errors", async () => {
    const backend = new MemoryRealmBackend(); backend.listProjects = async () => { throw new Error("ライブラリ失敗"); };
    render(<App backend={backend} />); expect(await screen.findByRole("alert")).toHaveTextContent("ライブラリ失敗"); cleanup();
    const working = new MemoryRealmBackend(); render(<App backend={working} />);
    fireEvent.click(await screen.findByRole("button", { name: "新しい世界を作成" }));
    working.closeProject = async () => { throw new Error("終了失敗"); };
    fireEvent.click(await screen.findByRole("button", { name: "ライブラリ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("終了失敗");
  });

  it("exports transfer data and returns to library successfully", async () => {
    const backend = new MemoryRealmBackend(); const exportProject = vi.spyOn(backend, "exportProject");
    render(<App backend={backend} chooseTransfer={async (mode) => mode === "export" ? "/tmp/world.realmmap" : null} />);
    fireEvent.click(await screen.findByRole("button", { name: "新しい世界を作成" }));
    fireEvent.click(await screen.findByRole("button", { name: "移行データ" })); await waitFor(() => expect(exportProject).toHaveBeenCalledWith({ path: "/tmp/world.realmmap" }));
    fireEvent.click(screen.getByRole("button", { name: "ライブラリ" })); expect(await screen.findByRole("button", { name: /無題の世界/u })).toBeInTheDocument();
  });
});
