import { chooseArtifactPath, chooseTransferPath, errorMessage } from "./index";
import type { ElectronRealmApi } from "../shared/realmContract";
import { vi } from "vitest";

describe("backend helpers", () => {
  it("handles browser paths and error shapes", async () => {
    await expect(chooseTransferPath("import")).resolves.toBeNull();
    await expect(chooseArtifactPath("png", "World")).resolves.toBeNull();
    expect(errorMessage(new Error("boom"), "代替メッセージ")).toBe("代替メッセージ");
    expect(errorMessage({ code: "corrupt_project", message: "internal detail" }, "代替メッセージ")).toBe("世界データが壊れているか、Realmのデータではありません。");
    expect(errorMessage({ message: "日本語の詳細" }, "代替メッセージ")).toBe("日本語の詳細");
    expect(errorMessage({ message: " " }, "fallback")).toBe("fallback");
    expect(errorMessage("unknown", "fallback")).toBe("fallback");
  });

  it("forwards transfer and artifact chooser calls through the Electron bridge", async () => {
    const previous = (window as Window & { realmApi?: ElectronRealmApi }).realmApi;
    const api = {
      chooseTransferPath: vi.fn().mockResolvedValue("/tmp/example.realmmap"),
      chooseArtifactPath: vi.fn().mockResolvedValue("/tmp/example.png"),
    } as unknown as ElectronRealmApi;
    Object.defineProperty(window, "realmApi", { configurable: true, value: api });
    try {
      await expect(chooseTransferPath("export", "example.realmmap")).resolves.toBe("/tmp/example.realmmap");
      await expect(chooseArtifactPath("png", "example")).resolves.toBe("/tmp/example.png");
      expect(api.chooseTransferPath).toHaveBeenCalledWith({ mode: "export", suggestedName: "example.realmmap" });
      expect(api.chooseArtifactPath).toHaveBeenCalledWith({ format: "png", suggestedName: "example" });
    } finally {
      if (previous) Object.defineProperty(window, "realmApi", { configurable: true, value: previous });
      else delete (window as Window & { realmApi?: ElectronRealmApi }).realmApi;
    }
  });
});
