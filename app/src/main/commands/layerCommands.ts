import type { ReplaceRegionLayerInput, ReplaceTerrainLayerInput, RealmSnapshot, GridShape, Region, TerrainShape } from "../../shared/realmContract";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import { invalid } from "../domain/errors";
import { canonicalUuid } from "../domain/identifiers";
import { validateName } from "../domain/geometry";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";

type PreparedTerrainShape = TerrainShape & { layerId: string };
type PreparedRegion = Region & { layerId: string; shapes: Array<Region["shapes"][number] & { layerId: string }> };
const shapeForTerrain = (shape: TerrainShape): GridShape & { geometryVersion: number; snapGridVersion: number } => ({ id: shape.id, layer: "terrain", ...(shape.layerId ? { layerId: shape.layerId } : {}), value: "terrain", geometryVersion: 1, snapGridVersion: 2, geometry: shape.geometry });
const shapeForRegion = (region: Region, shape: Region["shapes"][number]): GridShape & { geometryVersion: number; snapGridVersion: 2 } => ({ id: shape.id, layer: "region", ...(region.layerId ? { layerId: region.layerId } : {}), regionId: region.id, value: region.color, geometryVersion: 1, snapGridVersion: 2, geometry: shape.geometry });
const assertRecord: (input: unknown) => asserts input is Record<string, unknown> = (input) => { if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid."); };

function defaultLeafId(session: OpenProjectSession): string {
  const row = session.database.prepare("SELECT id FROM layer_nodes WHERE kind='leaf' ORDER BY parent_id,sort_order,id LIMIT 1").get() as { id?: unknown } | undefined;
  if (!row?.id) throw invalid("編集可能なleaf layerがありません。");
  return String(row.id);
}

function leafId(session: OpenProjectSession, requested: unknown): string {
  const id = requested === undefined ? defaultLeafId(session) : canonicalUuid(requested as string, "layer");
  const row = session.database.prepare("SELECT kind FROM layer_nodes WHERE id=?").get(id) as { kind?: unknown } | undefined;
  if (!row || row.kind !== "leaf") throw invalid("地物の所属先はleaf layerでなければなりません。");
  return id;
}

function validateLayers(terrain: readonly TerrainShape[], regions: readonly Region[]): void {
  const shapes = [...terrain.map(shapeForTerrain), ...regions.flatMap((region) => region.shapes.map((shape) => shapeForRegion(region, shape)))];
  try { validateMapShapes(shapes); } catch { throw invalid("Terrain or region geometry is invalid or overlaps another shape in its layer."); }
}

export function prepareTerrain(session: OpenProjectSession, input: ReplaceTerrainLayerInput["shapes"]): PreparedTerrainShape[] {
  if (!Array.isArray(input) || input.length > 4096) throw invalid("The terrain layer is invalid.");
  const terrain = input.map((shape) => ({ id: canonicalUuid(shape.id, "terrain shape"), layerId: leafId(session, shape.layerId), geometry: shape.geometry }));
  if (new Set(terrain.map((shape) => shape.id)).size !== terrain.length) throw invalid("Terrain shape identifiers must be unique.");
  return terrain;
}

export function prepareRegions(session: OpenProjectSession, input: ReplaceRegionLayerInput["regions"]): PreparedRegion[] {
  if (!Array.isArray(input) || input.length > 4096) throw invalid("The region layer is invalid.");
  const regions = input.map((region) => {
    const id = canonicalUuid(region.id, "region"); const layerId = leafId(session, region.layerId);
    if (!Array.isArray(region.shapes) || region.shapes.length > 4096) throw invalid("The region shapes are invalid.");
    const shapes = region.shapes.map((shape) => ({ id: canonicalUuid(shape.id, "region shape"), layerId, geometry: shape.geometry }));
    return { id, layerId, name: validateName(region.name), color: region.color, shapes };
  });
  if (new Set(regions.map((region) => region.id)).size !== regions.length) throw invalid("Region identifiers must be unique.");
  if (regions.some((region) => !/^#[\da-f]{6}$/iu.test(region.color))) throw invalid("Region colors are invalid.");
  const shapeIds = regions.flatMap((region) => region.shapes.map((shape) => shape.id));
  if (new Set(shapeIds).size !== shapeIds.length) throw invalid("Region shape identifiers must be unique.");
  return regions;
}

function insertTerrain(session: OpenProjectSession, terrain: readonly PreparedTerrainShape[]): void {
  session.database.exec("DELETE FROM terrain_shapes");
  const statement = session.database.prepare("INSERT INTO terrain_shapes(id,layer_id,geometry_json) VALUES (?,?,?)");
  for (const shape of terrain) statement.run(shape.id, shape.layerId, JSON.stringify(shape.geometry));
}

function insertRegions(session: OpenProjectSession, regions: readonly PreparedRegion[]): void {
  session.database.exec("DELETE FROM region_shapes; DELETE FROM regions;");
  const regionStatement = session.database.prepare("INSERT INTO regions(id,layer_id,name,color) VALUES (?,?,?,?)");
  for (const region of regions) regionStatement.run(region.id, region.layerId, region.name, region.color);
  const shapeStatement = session.database.prepare("INSERT INTO region_shapes(id,region_id,layer_id,geometry_json) VALUES (?,?,?,?)");
  for (const region of regions) for (const shape of region.shapes) shapeStatement.run(shape.id, region.id, region.layerId, JSON.stringify(shape.geometry));
}

export function replaceTerrainLayer(getSession: () => OpenProjectSession, input: ReplaceTerrainLayerInput): RealmSnapshot {
  assertRecord(input); const session = getSession(); const terrain = prepareTerrain(session, input.shapes);
  const current = projectSnapshot(session).layers;
  validateLayers(terrain, current.regions);
  const before = captureState(session.database);
  transaction(session.database, () => insertTerrain(session, terrain));
  session.checkpoint(before, "replace-terrain-layer"); return projectSnapshot(session);
}

export function replaceRegionLayer(getSession: () => OpenProjectSession, input: ReplaceRegionLayerInput): RealmSnapshot {
  assertRecord(input); const session = getSession(); const regions = prepareRegions(session, input.regions);
  const current = projectSnapshot(session).layers;
  validateLayers(current.terrain, regions);
  const before = captureState(session.database);
  transaction(session.database, () => insertRegions(session, regions));
  session.checkpoint(before, "replace-region-layer"); return projectSnapshot(session);
}
