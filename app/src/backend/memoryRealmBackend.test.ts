import { MemoryRealmBackend } from "./memoryRealmBackend";

describe("MemoryRealmBackend", () => {
  it("rejects duplicate creation, unknown opens, and saves without an open project", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "browser://world.realmmap", name: "World" });
    await expect(backend.createProject({ path: "browser://world.realmmap", name: "Other" })).rejects.toThrow("すでに");
    await backend.closeProject();
    await expect(backend.saveProject({ name: "World", currentYear: 0, eras: [], timelineEvents: [] })).rejects.toThrow("開かれていません");
    await expect(backend.openProject({ path: "browser://missing.realmmap" })).rejects.toThrow("見つかりません");
    await expect(backend.getOpenProject()).resolves.toBeNull();
    await expect(backend.viewProjectYear(0)).rejects.toThrow("開かれていません");
  });

  it("rejects missing feature and empty history operations", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "browser://errors.realmmap", name: "Errors" });
    await expect(backend.reviseFeature({ id: "missing", name: "Missing", validFromYear: 0, geometry: { type: "Point", coordinates: [0, 0] } })).rejects.toThrow("見つかりません");
    await expect(backend.deleteFeature({ id: "missing", validFromYear: 0 })).rejects.toThrow("見つかりません");
    await expect(backend.undoProject()).rejects.toThrow("元に戻す");
    await expect(backend.redoProject()).rejects.toThrow("やり直す");
  });

  it("returns defensive snapshots and normalizes persisted names", async () => {
    const backend = new MemoryRealmBackend();
    const created = await backend.createProject({ path: "browser://world.realmmap", name: "World" });
    created.world.name = "Changed outside";
    const saved = await backend.saveProject({
      name: "  Saved world  ",
      currentYear: 42,
      eras: [{ id: null, name: "  Era  ", startYear: -1, endYear: 5 }],
      timelineEvents: [],
    });
    expect(saved.world.name).toBe("Saved world");
    expect(saved.eras[0]).toMatchObject({ name: "Era", startYear: -1, endYear: 5 });
    expect(saved.eras[0]?.id).toBeTruthy();

    await backend.closeProject();
    const reopened = await backend.openProject({ path: "browser://world.realmmap" });
    expect(reopened.world.name).toBe("Saved world");
    expect(reopened.world.id).not.toBe("");
  });

  it("reconstructs all feature classes by year and supports deletion, undo, redo, and reopen", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "browser://features.realmmap", name: "Features" });
    const featureTypes = ["terrain", "forest", "river", "coastline", "country", "region", "boundary", "city", "town"] as const;
    const geometryFor = (featureType: typeof featureTypes[number]) => featureType === "city" || featureType === "town"
      ? { type: "Point" as const, coordinates: [0, 0] as [number, number] }
      : featureType === "river" || featureType === "coastline" || featureType === "boundary"
        ? { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] as [number, number][] }
        : { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] as [number, number][][] };

    const ids: string[] = [];
    for (const featureType of featureTypes) {
      const created = await backend.createFeature({ featureType, name: `${featureType} old`, validFromYear: -1, geometry: geometryFor(featureType) });
      const id = created.features.find((feature) => feature.featureType === featureType)?.id;
      expect(id).toBeTruthy();
      ids.push(id ?? "");
      await backend.reviseFeature({ id: id ?? "", name: `${featureType} new`, validFromYear: 5, geometry: geometryFor(featureType) });
    }
    expect((await backend.viewProjectYear(-1)).features).toHaveLength(9);
    expect((await backend.viewProjectYear(5)).features.every((feature) => feature.name.endsWith("new"))).toBe(true);

    for (const id of ids) await backend.deleteFeature({ id, validFromYear: 10 });
    expect((await backend.viewProjectYear(10)).features).toHaveLength(0);
    expect((await backend.undoProject()).features).toHaveLength(1);
    expect((await backend.redoProject()).features).toHaveLength(0);
    await backend.closeProject();
    await backend.openProject({ path: "browser://features.realmmap" });
    expect((await backend.viewProjectYear(-1)).features).toHaveLength(9);
    expect((await backend.viewProjectYear(10)).features).toHaveLength(0);
  });

  it("applies sparse cell attributes by layer and keeps grouped undo parity", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "browser://cells.realmmap", name: "Cells" });
    await backend.applyCellAttributes({ year: -10, cellIds: ["1:2", "2:2", "1:2"], attribute: "terrain_kind", value: "mountain" });
    await backend.applyCellAttributes({ year: -10, cellIds: ["1:2"], attribute: "forest", value: "on" });
    await expect(backend.viewCellAttributes({ year: -10 })).resolves.toHaveLength(3);
    await backend.applyCellAttributes({ year: 0, cellIds: ["1:2"], attribute: "terrain_kind", value: null });
    expect(await backend.viewCellAttributes({ year: 0, minX: 1, maxX: 1, minY: 2, maxY: 2 })).toEqual([
      expect.objectContaining({ cellId: "1:2", attribute: "forest", value: "on" }),
    ]);
    await backend.undoProject();
    expect(await backend.viewCellAttributes({ year: 0, minX: 1, maxX: 1, minY: 2, maxY: 2 })).toHaveLength(2);
    await backend.redoProject();
    expect(await backend.viewCellAttributes({ year: 0, minX: 1, maxX: 1, minY: 2, maxY: 2 })).toHaveLength(1);
  });
});
