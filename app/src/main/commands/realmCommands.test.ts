// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RealmCommands } from "./realmCommands";
import { RealmError } from "../domain/errors";
import { cellIdsToPolygonGeometries } from "../../shared/mapShapeGeometry";
import { mapShapesFromLayers } from "../../shared/layerProjection";
import type { MapObject } from "../../shared/realmContract";

const directory = (): string => mkdtempSync(join(tmpdir(), "realm-commands-"));
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0];
const point: MapObject["geometry"] = { type: "Point", coordinates: [1, 2] };
const polygon = (cells: string[]) => cellIdsToPolygonGeometries(cells)[0]!;
const object = (kind: MapObject["kind"], id: string, geometry: MapObject["geometry"], label: string = kind): MapObject => ({ id, kind, label, geometry, properties: {}, zIndex: 0, locked: false });

describe("RealmCommands user-visible operations", () => {
  it("creates, lists, saves, updates settings, and closes projects", async () => {
    const dir = directory(); const commands = new RealmCommands({ libraryDirectory: dir });
    let snapshot = await commands.createProject({ name: "  World  " });
    const path = snapshot.path; const libraryId = basename(path, ".realmmap");
    expect(snapshot.world.name).toBe("World");
    snapshot = await commands.saveProject({ name: "Renamed" }); expect(snapshot.world.name).toBe("Renamed");
    await commands.closeProject(); expect(await commands.getOpenProject()).toBeNull();
    expect(await commands.listProjects()).toEqual([{ libraryId, name: "Renamed" }]);
    writeFileSync(join(dir, "ignored.realmmap"), "not sqlite");
    await expect(commands.openProject({ libraryId: path })).rejects.toMatchObject({ code: "invalid_input" });
    await commands.openProject({ libraryId });
    await commands.closeProject();
  });

  it("rejects symlinked managed project files", async () => {
    const dir = directory(); const sourceCommands = new RealmCommands({ libraryDirectory: join(dir, "outside") });
    const source = await sourceCommands.createProject({ name: "Source" }); const id = "11111111-1111-4111-8111-111111111111"; await sourceCommands.closeProject();
    const commands = new RealmCommands({ libraryDirectory: dir });
    symlinkSync(source.path, join(dir, id + ".realmmap"));
    await expect(commands.openProject({ libraryId: id })).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("stores terrain, regions, and objects independently and preserves them through undo/redo and reopen", async () => {
    const commands = new RealmCommands({ libraryDirectory: directory() }); await commands.createProject({ name: "Three layers" });
    const terrain = { id: "11111111-1111-4111-8111-111111111111", geometry: polygon(["2:2"]) };
    const region = { id: "22222222-2222-4222-8222-222222222222", name: "Blue region", color: "#2468AC", shapes: [{ id: "33333333-3333-4333-8333-333333333333", geometry: polygon(["2:2"]) }] };
    let snapshot = await commands.replaceTerrainLayer({ shapes: [terrain] });
    snapshot = await commands.replaceRegionLayer({ regions: [region] });
    const objects = [
      object("city", "44444444-4444-4444-8444-444444444444", point, "City"),
      object("text", "55555555-5555-4555-8555-555555555555", point, "Text"),
      object("mountain", "66666666-6666-4666-8666-666666666666", { type: "Point", coordinates: [10, 20] }, "Mountain"),
      object("forest", "77777777-7777-4777-8777-777777777777", polygon(["8:8", "9:8"]), "Forest"),
    ];
    snapshot = await commands.replaceObjectLayer({ objects });
    expect(snapshot.layers.objects).toHaveLength(4);
    expect(mapShapesFromLayers(snapshot.layers)).toHaveLength(2);
    const movedCity = { ...objects[0]!, geometry: { type: "Point" as const, coordinates: [11, 21] as [number, number] } };
    snapshot = await commands.replaceObjectLayer({ objects: [movedCity, ...objects.slice(1)] });
    expect(snapshot.layers.objects[0]?.geometry).toEqual(movedCity.geometry);
    snapshot = await commands.undoProject();
    expect(snapshot.layers.objects).toHaveLength(4);
    snapshot = await commands.redoProject();
    expect(snapshot.layers.objects[0]?.geometry).toEqual(movedCity.geometry);
    await expect(commands.replaceTerrainLayer({ shapes: [terrain, { id: "88888888-8888-4888-8888-888888888888", geometry: terrain.geometry }] })).rejects.toMatchObject({ code: "invalid_input" });
    const libraryId = basename(snapshot.path, ".realmmap");
    await commands.closeProject();
    snapshot = await commands.openProject({ libraryId });
    expect(snapshot.layers.terrain).toHaveLength(1);
    expect(snapshot.layers.regions[0]?.name).toBe("Blue region");
    expect(snapshot.layers.objects).toHaveLength(4);
  });

  it("rejects invalid layer replacements without changing the database", async () => {
    const commands = new RealmCommands({ libraryDirectory: directory() }); await commands.createProject({ name: "Reject" });
    const terrain = { id: "11111111-1111-4111-8111-111111111111", geometry: polygon(["2:2"]) };
    await commands.replaceTerrainLayer({ shapes: [terrain] });
    const before = await commands.getOpenProject();
    await expect(commands.replaceTerrainLayer({ shapes: [terrain, { id: "44444444-4444-4444-8444-444444444444", geometry: terrain.geometry }] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await commands.getOpenProject()).toEqual(before);
    await expect(commands.replaceRegionLayer({ regions: [{ id: "55555555-5555-4555-8555-555555555555", name: "領域", color: "not-a-color", shapes: [] }] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await commands.getOpenProject()).toEqual(before);
  });

  it("does not allow a locked object to be changed or removed", async () => {
    const commands = new RealmCommands({ libraryDirectory: directory() }); await commands.createProject({ name: "Locked" });
    const locked = { ...object("city", "99999999-9999-4999-8999-999999999999", point, "固定都市"), locked: true };
    await commands.replaceObjectLayer({ objects: [locked] });
    await expect(commands.replaceObjectLayer({ objects: [{ ...locked, label: "変更" }] })).rejects.toMatchObject({ code: "object_locked" });
    await expect(commands.replaceObjectLayer({ objects: [] })).rejects.toMatchObject({ code: "object_locked" });
    await expect(commands.replaceObjectLayer({ objects: [locked] })).resolves.toBeDefined();
  });

  it("keeps assets and artifacts separate from the three layer records", async () => {
    const dir = directory(); const commands = new RealmCommands({ libraryDirectory: dir }); await commands.createProject({ name: "Other data" });
    let snapshot = await commands.importAsset({ mime: "image/png", bytes: png, width: 4, height: 5 });
    expect(snapshot.layers).toEqual({ terrain: [], regions: [], objects: [] }); expect(snapshot.assets).toHaveLength(1);
    const path = join(dir, "artifact.png"); await commands.writeArtifact({ path, bytes: png });
    await expect(commands.writeArtifact({ path: join(dir, "bad.png"), bytes: [1, 2] })).rejects.toBeInstanceOf(RealmError);
  });
});
