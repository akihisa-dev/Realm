import type { ReplaceRegionLayerInput, ReplaceTerrainLayerInput, RealmLayers, RealmSnapshot, GridShape, Region, TerrainShape } from "../../shared/realmContract";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import { invalid } from "../domain/errors";
import { canonicalUuid } from "../domain/identifiers";
import { validateName } from "../domain/geometry";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";

const shapeForTerrain = (shape: TerrainShape): GridShape & { geometryVersion: number; snapGridVersion: number } => ({ id: shape.id, layer: "terrain", value: "terrain", geometryVersion: 1, snapGridVersion: 2, geometry: shape.geometry });
const shapeForRegion = (region: Region, shape: Region["shapes"][number]): GridShape & { geometryVersion: number; snapGridVersion: number } => ({ id: shape.id, layer: "region", regionId: region.id, value: region.color, geometryVersion: 1, snapGridVersion: 2, geometry: shape.geometry });
const assertRecord: (input: unknown) => asserts input is Record<string, unknown> = (input) => { if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid."); };

function validateLayers(terrain: readonly TerrainShape[], regions: readonly Region[]): void {
  const shapes = [...terrain.map(shapeForTerrain), ...regions.flatMap((region) => region.shapes.map((shape) => shapeForRegion(region, shape)))];
  try { validateMapShapes(shapes); } catch { throw invalid("Terrain or region geometry is invalid or overlaps another shape in its layer."); }
}

function prepareTerrain(input: ReplaceTerrainLayerInput["shapes"]): TerrainShape[] {
  if (!Array.isArray(input) || input.length > 4096) throw invalid("The terrain layer is invalid.");
  const terrain = input.map((shape) => ({ id: canonicalUuid(shape.id, "terrain shape"), geometry: shape.geometry }));
  if (new Set(terrain.map((shape) => shape.id)).size !== terrain.length) throw invalid("Terrain shape identifiers must be unique.");
  return terrain;
}

function prepareRegions(input: ReplaceRegionLayerInput["regions"]): Region[] {
  if (!Array.isArray(input) || input.length > 4096) throw invalid("The region layer is invalid.");
  const regions = input.map((region) => {
    const id = canonicalUuid(region.id, "region");
    if (!Array.isArray(region.shapes) || region.shapes.length > 4096) throw invalid("The region shapes are invalid.");
    const shapes = region.shapes.map((shape) => ({ id: canonicalUuid(shape.id, "region shape"), geometry: shape.geometry }));
    return { id, name: validateName(region.name), color: region.color, shapes };
  });
  if (new Set(regions.map((region) => region.id)).size !== regions.length) throw invalid("Region identifiers must be unique.");
  if (regions.some((region) => !/^#[\da-f]{6}$/iu.test(region.color))) throw invalid("Region colors are invalid.");
  const shapeIds = regions.flatMap((region) => region.shapes.map((shape) => shape.id));
  if (new Set(shapeIds).size !== shapeIds.length) throw invalid("Region shape identifiers must be unique.");
  return regions;
}

function insertTerrain(session: OpenProjectSession, terrain: readonly TerrainShape[]): void {
  session.database.exec("DELETE FROM terrain_shapes");
  const statement = session.database.prepare("INSERT INTO terrain_shapes(id,geometry_json) VALUES (?,?)");
  for (const shape of terrain) statement.run(shape.id, JSON.stringify(shape.geometry));
}

function insertRegions(session: OpenProjectSession, regions: readonly Region[]): void {
  session.database.exec("DELETE FROM region_shapes; DELETE FROM regions;");
  const regionStatement = session.database.prepare("INSERT INTO regions(id,name,color) VALUES (?,?,?)");
  for (const region of regions) regionStatement.run(region.id, region.name, region.color);
  const shapeStatement = session.database.prepare("INSERT INTO region_shapes(id,region_id,geometry_json) VALUES (?,?,?)");
  for (const region of regions) for (const shape of region.shapes) shapeStatement.run(shape.id, region.id, JSON.stringify(shape.geometry));
}

export function replaceTerrainLayer(getSession: () => OpenProjectSession, input: ReplaceTerrainLayerInput): RealmSnapshot {
  assertRecord(input); const terrain = prepareTerrain(input.shapes);
  const session = getSession(); const current = projectSnapshot(session).layers;
  validateLayers(terrain, current.regions);
  const before = captureState(session.database);
  transaction(session.database, () => insertTerrain(session, terrain));
  session.checkpoint(before, "replace-terrain-layer"); return projectSnapshot(session);
}

export function replaceRegionLayer(getSession: () => OpenProjectSession, input: ReplaceRegionLayerInput): RealmSnapshot {
  assertRecord(input); const regions = prepareRegions(input.regions);
  const session = getSession(); const current = projectSnapshot(session).layers;
  validateLayers(current.terrain, regions);
  const before = captureState(session.database);
  transaction(session.database, () => insertRegions(session, regions));
  session.checkpoint(before, "replace-region-layer"); return projectSnapshot(session);
}

/** Compatibility adapter for the retired combined map-shape API. */
export function replaceTerrainAndRegionLayers(getSession: () => OpenProjectSession, layers: Pick<RealmLayers, "terrain" | "regions">): RealmSnapshot {
  const terrain = prepareTerrain(layers.terrain);
  const regions = prepareRegions(layers.regions);
  const session = getSession();
  validateLayers(terrain, regions);
  const before = captureState(session.database);
  transaction(session.database, () => {
    insertTerrain(session, terrain);
    insertRegions(session, regions);
  });
  session.checkpoint(before, "replace-terrain-region-layers");
  return projectSnapshot(session);
}
