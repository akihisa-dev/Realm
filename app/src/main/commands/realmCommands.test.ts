// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RealmCommands } from "./realmCommands";
import { RealmError } from "../domain/errors";
import { cellIdsToPolygonGeometries, mapShapeCellIds } from "../../shared/mapShapeGeometry";
import type { MapShape } from "../../shared/realmContract";

const directory = (): string => mkdtempSync(join(tmpdir(), "realm-commands-"));
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0];
const point: { type: "Point"; coordinates: [number, number] } = { type: "Point", coordinates: [1, 2] };
const terrain = (cells: string[], id = "11111111-1111-4111-8111-111111111111"): MapShape => ({ id, layer: "terrain", value: "terrain", geometryVersion: 1, snapGridVersion: 2, geometry: cellIdsToPolygonGeometries(cells)[0]! });
const region = (cells: string[], regionId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333"): MapShape => ({ id, layer: "region", regionId, value: "#2468AC", geometryVersion: 1, snapGridVersion: 2, geometry: cellIdsToPolygonGeometries(cells)[0]! });

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

  it("stores shape edits as one transaction and preserves IDs through undo/redo", async () => {
    const commands = new RealmCommands({ libraryDirectory: directory() }); await commands.createProject({ name: "Shapes" });
    const first = terrain(["2:2"]); const second = region(["5:5"]);
    let snapshot = await commands.createMapShapes({ shapes: [first, second] });
    expect(snapshot.mapShapes.map(({ id }) => id)).toEqual(expect.arrayContaining([first.id, second.id]));
    const expanded = { ...first, geometry: cellIdsToPolygonGeometries(["2:2", "3:2"])[0]! };
    snapshot = await commands.updateMapShapes({ shapes: [expanded, second] });
    const expandedSnapshot = snapshot.mapShapes.find(({ id }) => id === first.id);
    expect(expandedSnapshot && mapShapeCellIds(expandedSnapshot)).toEqual(new Set(["2:2", "3:2"]));
    expect(expandedSnapshot?.id).toBe(first.id);
    snapshot = await commands.undoProject();
    const undone = snapshot.mapShapes.find(({ id }) => id === first.id);
    expect(undone && mapShapeCellIds(undone)).toEqual(new Set(["2:2"]));
    snapshot = await commands.redoProject();
    const redone = snapshot.mapShapes.find(({ id }) => id === first.id);
    expect(redone && mapShapeCellIds(redone)).toEqual(new Set(["2:2", "3:2"]));
    snapshot = await commands.deleteMapShapes({ ids: [second.id] }); expect(snapshot.mapShapes).toHaveLength(1);
  });

  it("rejects invalid or overlapping shapes without changing the database", async () => {
    const commands = new RealmCommands({ libraryDirectory: directory() }); await commands.createProject({ name: "Reject" });
    const first = terrain(["2:2"]); await commands.createMapShapes({ shapes: [first] });
    const before = await commands.getOpenProject();
    const overlapping = terrain(["2:2"], "44444444-4444-4444-8444-444444444444");
    await expect(commands.updateMapShapes({ shapes: [first, overlapping] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await commands.getOpenProject()).toEqual(before);
  });

  it("keeps the existing feature and artifact boundaries separate from map_shapes", async () => {
    const dir = directory(); const commands = new RealmCommands({ libraryDirectory: dir }); await commands.createProject({ name: "Other data" });
    let snapshot = await commands.createFeature({ featureType: "city", name: "City", geometry: point });
    expect(snapshot.features).toHaveLength(1);
    snapshot = await commands.importAsset({ mime: "image/png", bytes: png, width: 4, height: 5 });
    expect(snapshot.mapShapes).toEqual([]); expect(snapshot.assets).toHaveLength(1);
    const path = join(dir, "artifact.png"); await commands.writeArtifact({ path, bytes: png });
    await expect(commands.writeArtifact({ path: join(dir, "bad.png"), bytes: [1, 2] })).rejects.toBeInstanceOf(RealmError);
  });
});
