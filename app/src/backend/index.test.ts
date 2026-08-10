import {
  chooseArtifactPath,
  chooseTransferPath,
  defaultBackend,
  errorMessage,
  MemoryRealmBackend,
} from "./index";

describe("browser backend routing", () => {
  it("uses the deterministic memory backend without opening native dialogs", async () => {
    expect(defaultBackend).toBeInstanceOf(MemoryRealmBackend);
    await expect(chooseTransferPath("import")).resolves.toBeNull();
    await expect(chooseTransferPath("export", "World.realmmap")).resolves.toBeNull();
    await expect(chooseArtifactPath("png", "World")).resolves.toBeNull();
    await expect(chooseArtifactPath("pdf", "World")).resolves.toBeNull();
  });

  it("prefers structured error messages and otherwise uses the fallback", () => {
    expect(errorMessage(new Error("native failure"), "fallback")).toBe("native failure");
    expect(errorMessage({ message: "structured failure" }, "fallback")).toBe("structured failure");
    expect(errorMessage({ message: "  " }, "fallback")).toBe("fallback");
    expect(errorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(errorMessage("plain failure", "fallback")).toBe("fallback");
    expect(errorMessage(null, "fallback")).toBe("fallback");
  });
});
