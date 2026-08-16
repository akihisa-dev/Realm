import type { MapObject, ReplaceObjectLayerInput, RealmSnapshot } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { validateObjectGeometry, validateName, validateProperties } from "../domain/geometry";
import { canonicalUuid } from "../domain/identifiers";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";

const MAX_OBJECTS = 4096;
const assertRecord: (input: unknown) => asserts input is Record<string, unknown> = (input) => { if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid."); };

export function replaceObjectLayer(getSession: () => OpenProjectSession, input: ReplaceObjectLayerInput): RealmSnapshot {
  assertRecord(input); if (!Array.isArray(input.objects) || input.objects.length > MAX_OBJECTS) throw invalid("The object layer is invalid.");
  const session = getSession();
  const prepared = input.objects.map((object): MapObject => {
    assertRecord(object);
    const id = canonicalUuid(object.id, "object");
    if (!["city", "text", "mountain", "forest"].includes(object.kind)) throw invalid("The object kind is invalid.");
    const label = validateName(object.label);
    const properties = validateProperties(object.properties ?? {});
    const geometry = object.geometry;
    try { validateObjectGeometry(object.kind, geometry, true); } catch { throw invalid("The object geometry is invalid for its kind."); }
    if (!Number.isSafeInteger(object.zIndex) || object.zIndex < -1000000 || object.zIndex > 1000000) throw invalid("The object order is invalid.");
    if (typeof object.locked !== "boolean") throw invalid("The object lock state is invalid.");
    const assetId = object.assetId === undefined ? undefined : canonicalUuid(object.assetId, "asset");
    if (assetId && !session.database.prepare("SELECT 1 FROM assets WHERE id=?").get(assetId)) throw new RealmError("not_found", "The object asset was not found.");
    return { id, kind: object.kind, label, geometry, properties, zIndex: object.zIndex, locked: object.locked, ...(assetId ? { assetId } : {}) };
  });
  if (new Set(prepared.map((object) => object.id)).size !== prepared.length) throw invalid("Object identifiers must be unique.");
  const before = captureState(session.database);
  transaction(session.database, () => {
    session.database.exec("DELETE FROM objects");
    const statement = session.database.prepare("INSERT INTO objects(id,kind,label,geometry_json,properties_json,z_index,locked,asset_id) VALUES (?,?,?,?,?,?,?,?)");
    for (const object of prepared) statement.run(object.id, object.kind, object.label, JSON.stringify(object.geometry), JSON.stringify(object.properties), object.zIndex, object.locked ? 1 : 0, object.assetId ?? null);
  });
  session.checkpoint(before, "replace-object-layer"); return projectSnapshot(session);
}
