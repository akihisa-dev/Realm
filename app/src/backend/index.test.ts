import { chooseArtifactPath, chooseTransferPath, errorMessage } from "./index";

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
});
