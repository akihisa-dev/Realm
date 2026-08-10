import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRealmBackend, type RealmSnapshot } from "./backend";
import App from "./App";

const emptySnapshot: RealmSnapshot = {
  formatVersion: 2,
  path: "browser://test.realmmap",
  world: { id: "world-test", name: "テスト世界", currentYear: 0 },
  eras: [],
  features: [],
  timelineEvents: [],
  featureCount: 0,
  canUndo: false,
  canRedo: false,
};

const clickReadyButton = async (name: string | RegExp): Promise<void> => {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};

describe("Realm library workflow", () => {
  it("creates, auto-saves, returns to the library, and reopens a world", async () => {
    const backend = new MemoryRealmBackend();
    render(<App backend={backend} />);

    await clickReadyButton("新しい世界を作成");
    const year = await screen.findByRole("spinbutton", { name: "表示年" });
    fireEvent.change(year, { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "時代を追加" }));
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "碧海時代" } });

    await waitFor(() => expect(backend.getOpenProject()).resolves.toMatchObject({
      world: { currentYear: 1200 },
      eras: [expect.objectContaining({ name: "碧海時代" })],
    }));
    expect(screen.getByText("自動保存済み")).toBeInTheDocument();

    await clickReadyButton("ライブラリ");
    await clickReadyButton(/無題の世界/u);
    expect(await screen.findByRole("spinbutton", { name: "表示年" })).toHaveValue(1200);
    expect(screen.getAllByText("碧海時代")).not.toHaveLength(0);
  });

  it("opens a world from the app-managed library", async () => {
    render(<App backend={new MemoryRealmBackend([emptySnapshot])} />);
    await clickReadyButton(/テスト世界/u);
    expect(await screen.findByRole("textbox", { name: "世界の名前" })).toHaveValue("テスト世界");
  });

  it("imports migration data through the dedicated action", async () => {
    const backend = new MemoryRealmBackend([emptySnapshot]);
    render(<App backend={backend} chooseTransfer={async () => emptySnapshot.path} />);
    await clickReadyButton("移行データを読み込む");
    expect(await screen.findByRole("textbox", { name: "世界の名前" })).toHaveValue("テスト世界");
    expect(await backend.listProjects()).toHaveLength(2);
  });

  it("exports editable transfer data only after a destination is chosen", async () => {
    const backend = new MemoryRealmBackend();
    const exportProject = vi.spyOn(backend, "exportProject");
    render(<App backend={backend} chooseTransfer={async () => "/tmp/World.realmmap"} />);
    await clickReadyButton("新しい世界を作成");
    await clickReadyButton("移行データ");
    await waitFor(() => expect(exportProject).toHaveBeenCalledWith({ path: "/tmp/World.realmmap" }));
  });

  it("keeps the library unchanged when transfer import is cancelled", async () => {
    const backend = new MemoryRealmBackend();
    render(<App backend={backend} chooseTransfer={async () => null} />);
    await clickReadyButton("移行データを読み込む");
    expect(await backend.listProjects()).toHaveLength(0);
    expect(screen.getByText("まだ世界がありません。")).toBeInTheDocument();
  });

  it("surfaces library creation and import errors", async () => {
    const backend = new MemoryRealmBackend();
    backend.createProject = async () => { throw new Error("作成テストエラー"); };
    render(<App backend={backend} />);
    await clickReadyButton("新しい世界を作成");
    expect(await screen.findByRole("alert")).toHaveTextContent("作成テストエラー");
  });

  it("surfaces an initial library read failure", async () => {
    const backend = new MemoryRealmBackend();
    backend.listProjects = async () => { throw new Error("ライブラリ読込テストエラー"); };
    render(<App backend={backend} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ライブラリ読込テストエラー");
    expect(screen.getByRole("button", { name: "新しい世界を作成" })).toBeEnabled();
  });

  it("keeps library actions disabled until restoration finishes", async () => {
    let resolveOpen: ((snapshot: RealmSnapshot | null) => void) | undefined;
    const backend = new MemoryRealmBackend();
    backend.getOpenProject = () => new Promise((resolve) => { resolveOpen = resolve; });
    render(<App backend={backend} />);
    expect(screen.getByRole("button", { name: "新しい世界を作成" })).toBeDisabled();
    await act(async () => { resolveOpen?.(null); });
    await waitFor(() => expect(screen.getByRole("button", { name: "新しい世界を作成" })).toBeEnabled());
  });

  it("shows validation errors and does not auto-save invalid chronology", async () => {
    const backend = new MemoryRealmBackend();
    render(<App backend={backend} />);
    await clickReadyButton("新しい世界を作成");
    const year = await screen.findByRole("spinbutton", { name: "表示年" });
    fireEvent.change(year, { target: { value: "2147483648" } });
    expect(screen.getByRole("alert")).toHaveTextContent("表示年を32ビット整数で入力してください。");
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect((await backend.getOpenProject())?.world.currentYear).toBe(0);
  });
});
