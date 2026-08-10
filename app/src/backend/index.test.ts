import { chooseArtifactPath, chooseTransferPath, errorMessage } from "./index";

describe("backend helpers", () => {
  it("handles browser paths and error shapes", async () => {
    await expect(chooseTransferPath("import")).resolves.toBeNull();
    await expect(chooseArtifactPath("png", "World")).resolves.toBeNull();
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
    expect(errorMessage({ message: "object" }, "fallback")).toBe("object");
    expect(errorMessage({ message: " " }, "fallback")).toBe("fallback");
    expect(errorMessage("unknown", "fallback")).toBe("fallback");
  });
});
