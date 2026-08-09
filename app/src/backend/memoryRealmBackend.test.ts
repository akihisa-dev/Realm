import { MemoryRealmBackend } from "./memoryRealmBackend";

describe("MemoryRealmBackend", () => {
  it("rejects duplicate creation, unknown opens, and saves without an open project", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "browser://world.realmmap", name: "World" });
    await expect(backend.createProject({ path: "browser://world.realmmap", name: "Other" })).rejects.toThrow("すでに");
    await backend.closeProject();
    await expect(backend.saveProject({ name: "World", currentYear: 0, eras: [] })).rejects.toThrow("開かれていません");
    await expect(backend.openProject({ path: "browser://missing.realmmap" })).rejects.toThrow("見つかりません");
    await expect(backend.getOpenProject()).resolves.toBeNull();
  });

  it("returns defensive snapshots and normalizes persisted names", async () => {
    const backend = new MemoryRealmBackend();
    const created = await backend.createProject({ path: "browser://world.realmmap", name: "World" });
    created.world.name = "Changed outside";
    const saved = await backend.saveProject({
      name: "  Saved world  ",
      currentYear: 42,
      eras: [{ id: null, name: "  Era  ", startYear: -1, endYear: 5 }],
    });
    expect(saved.world.name).toBe("Saved world");
    expect(saved.eras[0]).toMatchObject({ name: "Era", startYear: -1, endYear: 5 });
    expect(saved.eras[0]?.id).toBeTruthy();

    await backend.closeProject();
    const reopened = await backend.openProject({ path: "browser://world.realmmap" });
    expect(reopened.world.name).toBe("Saved world");
    expect(reopened.world.id).not.toBe("");
  });
});
