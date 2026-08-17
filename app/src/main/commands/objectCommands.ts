import type { MapObject, ReplaceObjectLayerInput, RealmSnapshot } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { validateObjectGeometry, validateName, validateProperties } from "../domain/geometry";
import { canonicalUuid } from "../domain/identifiers";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";

const MAX_OBJECTS = 4096;
type PreparedObject = MapObject & { layerId: string };
const assertRecord: (input: unknown) => asserts input is Record<string, unknown> = (input) => { if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid."); };
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};

function leafId(session: OpenProjectSession, requested: unknown): string {
  const fallback = (session.database.prepare("SELECT id FROM layer_nodes WHERE kind='leaf' ORDER BY parent_id,sort_order,id LIMIT 1").get() as { id?: unknown } | undefined)?.id;
  const id = requested === undefined ? String(fallback ?? "") : canonicalUuid(requested as string, "layer");
  const row = session.database.prepare("SELECT kind FROM layer_nodes WHERE id=?").get(id) as { kind?: unknown } | undefined;
  if (!row || row.kind !== "leaf") throw invalid("オブジェクトの所属先はleaf layerでなければなりません。");
  return id;
}

function assertLockedObjectsUnchanged(current: readonly MapObject[], next: readonly MapObject[]): void {
  const nextById = new Map(next.map((object) => [object.id, object]));
  for (const locked of current.filter((object) => object.locked)) {
    const replacement = nextById.get(locked.id);
    if (!replacement || stableJson(locked) !== stableJson(replacement)) throw new RealmError("object_locked", "A locked object cannot be changed or removed.");
  }
}

export function replaceObjectLayer(getSession: () => OpenProjectSession, input: ReplaceObjectLayerInput): RealmSnapshot {
  assertRecord(input); if (!Array.isArray(input.objects) || input.objects.length > MAX_OBJECTS) throw invalid("The object layer is invalid.");
  const session = getSession();
  const prepared = prepareObjects(session, input.objects);
  if (new Set(prepared.map((object) => object.id)).size !== prepared.length) throw invalid("Object identifiers must be unique.");
  assertLockedObjectsUnchanged(projectSnapshot(session).layers.objects, prepared);
  const before = captureState(session.database);
  transaction(session.database, () => {
    session.database.exec("DELETE FROM objects");
    const statement = session.database.prepare("INSERT INTO objects(id,layer_id,kind,label,geometry_json,properties_json,z_index,locked,asset_id) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const object of prepared) statement.run(object.id, object.layerId, object.kind, object.label, JSON.stringify(object.geometry), JSON.stringify(object.properties), object.zIndex, object.locked ? 1 : 0, object.assetId ?? null);
  });
  session.checkpoint(before, "replace-object-layer"); return projectSnapshot(session);
}

export function prepareObjects(session: OpenProjectSession, objects: readonly MapObject[]): PreparedObject[] {
  if (!Array.isArray(objects) || objects.length > MAX_OBJECTS) throw invalid("The object layer is invalid.");
  return objects.map((object): PreparedObject => {
    const id = canonicalUuid(object.id, "object");
    const layerId = leafId(session, object.layerId);
    if (!["city", "text", "mountain", "forest"].includes(object.kind)) throw invalid("The object kind is invalid.");
    const label = validateName(object.label);
    const properties = validateProperties(object.properties ?? {});
    const geometry = object.geometry;
    try { validateObjectGeometry(object.kind, geometry, true); } catch { throw invalid("The object geometry is invalid for its kind."); }
    if (!Number.isSafeInteger(object.zIndex) || object.zIndex < -1000000 || object.zIndex > 1000000) throw invalid("The object order is invalid.");
    if (typeof object.locked !== "boolean") throw invalid("The object lock state is invalid.");
    const assetId = object.assetId === undefined ? undefined : canonicalUuid(object.assetId, "asset");
    if (assetId && !session.database.prepare("SELECT 1 FROM assets WHERE id=?").get(assetId)) throw new RealmError("not_found", "The object asset was not found.");
    return { id, layerId, kind: object.kind, label, geometry, properties, zIndex: object.zIndex, locked: object.locked, ...(assetId ? { assetId } : {}) };
  });
}
