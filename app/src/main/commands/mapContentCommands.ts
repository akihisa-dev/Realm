import type { RealmLayers, RealmSnapshot, ReplaceMapContentInput } from "../../shared/realmContract";
import { mapShapesFromLayers } from "../../shared/layerProjection";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import { invalid, RealmError } from "../domain/errors";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";
import { prepareObjects } from "./objectCommands";
import { prepareRegions, prepareTerrain } from "./layerCommands";

const assertRecord: (input: unknown) => asserts input is Record<string, unknown> = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid.");
};
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};

export function replaceMapContent(getSession: () => OpenProjectSession, input: ReplaceMapContentInput): RealmSnapshot {
  assertRecord(input);
  assertRecord(input.layers);
  const session = getSession();
  const terrain = prepareTerrain(session, input.layers.terrain);
  const regions = prepareRegions(session, input.layers.regions);
  const objects = prepareObjects(session, input.layers.objects);
  const layers: RealmLayers = { terrain, regions, objects };
  try { validateMapShapes(mapShapesFromLayers(layers)); } catch { throw invalid("地形または領域の形状が不正です。同じleaf layer内の重なりも許可されません。"); }
  const current = projectSnapshot(session).layers;
  const nextById = new Map(objects.map((object) => [object.id, object]));
  for (const locked of current.objects.filter((object) => object.locked)) {
    const replacement = nextById.get(locked.id);
    if (!replacement || stableJson(locked) !== stableJson(replacement)) throw new RealmError("object_locked", "A locked object cannot be changed or removed.");
  }
  const before = captureState(session.database);
  transaction(session.database, () => {
    session.database.exec("DELETE FROM objects; DELETE FROM region_shapes; DELETE FROM regions; DELETE FROM terrain_shapes;");
    const terrainStatement = session.database.prepare("INSERT INTO terrain_shapes(id,layer_id,geometry_json) VALUES (?,?,?)");
    for (const shape of terrain) terrainStatement.run(shape.id, shape.layerId, JSON.stringify(shape.geometry));
    const regionStatement = session.database.prepare("INSERT INTO regions(id,layer_id,name,color) VALUES (?,?,?,?)");
    for (const region of regions) regionStatement.run(region.id, region.layerId, region.name, region.color);
    const regionShapeStatement = session.database.prepare("INSERT INTO region_shapes(id,region_id,layer_id,geometry_json) VALUES (?,?,?,?)");
    for (const region of regions) for (const shape of region.shapes) regionShapeStatement.run(shape.id, region.id, region.layerId, JSON.stringify(shape.geometry));
    const objectStatement = session.database.prepare("INSERT INTO objects(id,layer_id,kind,label,geometry_json,properties_json,z_index,locked,asset_id) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const object of objects) objectStatement.run(object.id, object.layerId, object.kind, object.label, JSON.stringify(object.geometry), JSON.stringify(object.properties), object.zIndex, object.locked ? 1 : 0, object.assetId ?? null);
  });
  session.checkpoint(before, "replace-map-content");
  return projectSnapshot(session);
}
