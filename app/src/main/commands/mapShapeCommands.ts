import type { CreateMapShapesInput, DeleteMapShapesInput, MapShape, RealmSnapshot, UpdateMapShapesInput } from "../../shared/realmContract";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import { RealmError, invalid } from "../domain/errors";
import { canonicalUuid } from "../domain/identifiers";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";

const MAX_MAP_SHAPE_BATCH = 4096;

function assertRecord(input: unknown): asserts input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid.");
}

function persistMapShapes(getSession: () => OpenProjectSession, shapes: readonly MapShape[], label: string): RealmSnapshot {
  try { validateMapShapes(shapes); } catch { throw invalid("The map shape geometry is invalid or overlaps another shape."); }
  const session = getSession();
  const before = captureState(session.database);
  transaction(session.database, () => {
    session.database.exec("DELETE FROM map_shapes");
    const statement = session.database.prepare("INSERT INTO map_shapes(id,layer,region_id,value,geometry_version,snap_grid_version,geometry_json) VALUES (?,?,?,?,?,?,?)");
    for (const shape of shapes) statement.run(shape.id, shape.layer, shape.regionId ?? null, shape.value, shape.geometryVersion, shape.snapGridVersion, JSON.stringify(shape.geometry));
  });
  session.checkpoint(before, label);
  return projectSnapshot(session);
}

export function createMapShapes(getSession: () => OpenProjectSession, input: CreateMapShapesInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.shapes)) throw invalid("The map shape batch is invalid.");
  const session = getSession();
  const current = projectSnapshot(session).mapShapes;
  const ids = new Set(current.map((shape) => shape.id));
  if (input.shapes.some((shape) => ids.has(shape.id))) throw invalid("A map shape identifier already exists.");
  return persistMapShapes(getSession, [...current, ...input.shapes], "map-shapes-create");
}

export function updateMapShapes(getSession: () => OpenProjectSession, input: UpdateMapShapesInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.shapes)) throw invalid("The map shape batch is invalid.");
  return persistMapShapes(getSession, input.shapes, "map-shapes-update");
}

export function deleteMapShapes(getSession: () => OpenProjectSession, input: DeleteMapShapesInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > MAX_MAP_SHAPE_BATCH || input.ids.some((id) => typeof id !== "string")) throw invalid("The map shape identifier batch is invalid.");
  const ids = input.ids.map((id) => canonicalUuid(id, "map shape"));
  if (new Set(ids).size !== ids.length) throw invalid("The map shape identifiers must be unique.");
  const session = getSession();
  const current = projectSnapshot(session).mapShapes;
  if (ids.some((id) => !current.some((shape) => shape.id === id))) throw new RealmError("not_found", "The map shape was not found.");
  return persistMapShapes(getSession, current.filter((shape) => !ids.includes(shape.id)), "map-shapes-delete");
}
