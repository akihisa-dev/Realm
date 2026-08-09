import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRealmBackend, type RealmBackend, type RealmSnapshot } from "./backend";
import App from "./App";

const emptySnapshot: RealmSnapshot = {
  formatVersion: 1,
  path: "browser://test.realmmap",
  world: { id: "world-test", name: "テスト世界", currentYear: 0 },
  eras: [],
  features: [],
  timelineEvents: [],
  featureCount: 0,
  canUndo: false,
  canRedo: false,
};

const clickReadyButton = async (name: string): Promise<void> => {
  const button = screen.getByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};

describe("Realm start and editor workflow", () => {
  it("creates, saves, closes, and reopens world, year, and era data", async () => {
    const backend = new MemoryRealmBackend();
    const choosePath = async () => "browser://history.realmmap";
    render(<App backend={backend} choosePath={choosePath} />);

    await clickReadyButton("新しい世界を作成");
    expect(await screen.findByRole("region", { name: "世界地図" })).toBeInTheDocument();

    const yearSlider = screen.getByRole("slider", { name: "年表上の表示年" });
    fireEvent.change(yearSlider, { target: { value: "1200" } });
    expect(screen.getByRole("spinbutton", { name: "表示年" })).toHaveValue(1200);

    fireEvent.click(screen.getByRole("button", { name: "時代を追加" }));
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "碧海時代" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "終了年" }), { target: { value: "1400" } });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("保存済み")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "世界地図" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(await screen.findByRole("button", { name: "新しい世界を作成" })).toBeInTheDocument();

    await clickReadyButton("既存の世界を開く");
    expect(await screen.findByRole("spinbutton", { name: "表示年" })).toHaveValue(1200);
    expect(screen.getAllByText("碧海時代")).not.toHaveLength(0);
    expect((await backend.getOpenProject())?.eras[0]?.endYear).toBe(1400);
  });

  it("surfaces structured backend errors on start and editor screens", async () => {
    const backend: RealmBackend = {
      createProject: async () => { throw { code: "invalid_path", message: "テスト用エラー" }; },
      openProject: async () => emptySnapshot,
      saveProject: async () => { throw { code: "storage_error", message: "保存テスト用エラー" }; },
      viewProjectYear: async () => emptySnapshot,
      createFeature: async () => emptySnapshot,
      reviseFeature: async () => emptySnapshot,
      deleteFeature: async () => emptySnapshot,
      undoProject: async () => emptySnapshot,
      redoProject: async () => emptySnapshot,
      closeProject: async () => undefined,
      getOpenProject: async () => null,
    };
    const { rerender } = render(<App backend={backend} />);

    await clickReadyButton("新しい世界を作成");
    expect(await screen.findByRole("alert")).toHaveTextContent("テスト用エラー");

    const openBackend: RealmBackend = { ...backend, createProject: async () => emptySnapshot };
    rerender(<App backend={openBackend} />);
    await clickReadyButton("新しい世界を作成");
    await screen.findByRole("region", { name: "世界地図" });
    fireEvent.change(screen.getByRole("slider", { name: "年表上の表示年" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存テスト用エラー");
  });

  it("asks before replacing an unsaved project", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const backend = new MemoryRealmBackend();
    render(<App backend={backend} />);
    await clickReadyButton("新しい世界を作成");
    await screen.findByRole("region", { name: "世界地図" });
    fireEvent.change(screen.getByRole("slider", { name: "年表上の表示年" }), { target: { value: "42" } });

    fireEvent.click(screen.getByRole("button", { name: "新規" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("spinbutton", { name: "表示年" })).toHaveValue(42);
    confirm.mockRestore();
  });

  it("opens an existing browser project", async () => {
    render(<App backend={new MemoryRealmBackend([emptySnapshot])} choosePath={async () => emptySnapshot.path} />);
    await clickReadyButton("既存の世界を開く");
    await waitFor(() => expect(screen.getByRole("heading", { name: "世界" })).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "世界の名前" })).toHaveValue("テスト世界");
  });

  it("disables project actions until open-project restoration finishes", async () => {
    let resolveOpenProject: ((snapshot: RealmSnapshot | null) => void) | undefined;
    const backend: RealmBackend = {
      createProject: async () => emptySnapshot,
      openProject: async () => emptySnapshot,
      saveProject: async () => emptySnapshot,
      viewProjectYear: async () => emptySnapshot,
      createFeature: async () => emptySnapshot,
      reviseFeature: async () => emptySnapshot,
      deleteFeature: async () => emptySnapshot,
      undoProject: async () => emptySnapshot,
      redoProject: async () => emptySnapshot,
      closeProject: async () => undefined,
      getOpenProject: async () => new Promise((resolve) => { resolveOpenProject = resolve; }),
    };
    render(<App backend={backend} />);

    expect(screen.getByRole("button", { name: "新しい世界を作成" })).toBeDisabled();
    await act(async () => { resolveOpenProject?.(emptySnapshot); });
    expect(await screen.findByRole("region", { name: "世界地図" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "世界の名前" })).toHaveValue("テスト世界");
  });

  it("rejects empty and inverted era input before persistence", async () => {
    render(<App backend={new MemoryRealmBackend()} />);
    await clickReadyButton("新しい世界を作成");
    await screen.findByRole("region", { name: "世界地図" });

    const yearInput = screen.getByRole("spinbutton", { name: "表示年" });
    fireEvent.change(yearInput, { target: { value: "2147483648" } });
    expect(screen.getByRole("alert")).toHaveTextContent("表示年を32ビット整数で入力してください。");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.change(yearInput, { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: "時代を追加" }));
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("時代の名前を入力してください。");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "黎明期" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "開始年" }), { target: { value: "100" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "終了年" }), { target: { value: "99" } });
    expect(screen.getByRole("alert")).toHaveTextContent("時代の終了年は開始年以降にしてください。");

    fireEvent.change(screen.getByRole("spinbutton", { name: "終了年" }), { target: { value: "120" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("round-trips years outside the initial timeline window without clamping", async () => {
    const extremeSnapshot: RealmSnapshot = {
      ...emptySnapshot,
      path: "browser://extreme.realmmap",
      world: { ...emptySnapshot.world, currentYear: -12_000 },
    };
    const backend = new MemoryRealmBackend([extremeSnapshot]);
    render(<App backend={backend} choosePath={async () => extremeSnapshot.path} />);

    await clickReadyButton("既存の世界を開く");
    const yearInput = await screen.findByRole("spinbutton", { name: "表示年" });
    const yearSlider = screen.getByRole("slider", { name: "年表上の表示年" });
    expect(yearInput).toHaveValue(-12_000);
    expect(Number(yearSlider.getAttribute("min"))).toBeLessThanOrEqual(-12_000);
    expect(Number(yearSlider.getAttribute("max"))).toBeGreaterThanOrEqual(-12_000);

    fireEvent.change(yearInput, { target: { value: "-2147483648" } });
    expect(yearInput).toHaveStyle({ width: "11ch" });
    fireEvent.change(yearInput, { target: { value: "2147483647" } });
    expect(yearInput).toHaveValue(2_147_483_647);
    expect(yearSlider).toHaveAttribute("max", "2147483647");
    expect(screen.getByRole("button", { name: "次の年" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("保存済み")).toBeInTheDocument());
    expect((await backend.getOpenProject())?.world.currentYear).toBe(2_147_483_647);
  });

  it("exposes all manual feature tools and persists timeline events", async () => {
    const backend = new MemoryRealmBackend();
    render(<App backend={backend} />);
    await clickReadyButton("新しい世界を作成");
    await screen.findByRole("region", { name: "世界地図" });

    for (const label of ["地形", "森林", "河川", "海岸線", "国", "地域", "境界", "都市", "町"]) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "出来事を追加" }));
    fireEvent.change(screen.getByRole("textbox", { name: "タイトル" }), { target: { value: "建国" } });
    fireEvent.change(screen.getByRole("textbox", { name: "説明" }), { target: { value: "合成テスト用の出来事" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("保存済み")).toBeInTheDocument());
    expect((await backend.getOpenProject())?.timelineEvents[0]).toMatchObject({ title: "建国", description: "合成テスト用の出来事" });
  });
});
