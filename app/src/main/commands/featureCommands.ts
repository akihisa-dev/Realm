import { randomUUID } from "node:crypto";
import type { CreateFeatureInput, CreateFeaturesBatchInput, DeleteFeaturesBatchInput, FeatureProperties, RealmSnapshot, ReviseFeaturesBatchInput, SetFeaturesLockedInput } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { validateGeometry, validateName, validateProperties } from "../domain/geometry";
import { canonicalUuid } from "../domain/identifiers";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";

const MAX_FEATURE_BATCH = 2048;

function assertRecord(input: unknown): asserts input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid.");
}

function ensureBatch(count: number, message: string): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_FEATURE_BATCH) throw invalid(message);
}

const canonicalFeatureId = (raw: string): string => canonicalUuid(raw, "feature");

export function createFeaturesBatch(getSession: () => OpenProjectSession, input: CreateFeaturesBatchInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.features)) throw invalid("The feature batch size is invalid.");
  ensureBatch(input.features.length, "The feature batch size is invalid.");
  input.features.forEach(assertRecord);
  const prepared = input.features.map((feature) => ({
    ...feature,
    name: validateName(feature.name),
    geometryJson: validateGeometry(feature.featureType, feature.geometry),
    propertiesJson: JSON.stringify(validateProperties(feature.properties === undefined ? {} : feature.properties)),
  }));
  const session = getSession();
  const before = captureState(session.database);
  transaction(session.database, () => {
    const statement = session.database.prepare("INSERT INTO features(id,feature_type,name,geometry_json,properties_json) VALUES (?,?,?,?,?)");
    for (const feature of prepared) statement.run(randomUUID(), feature.featureType, feature.name, feature.geometryJson, feature.propertiesJson);
  });
  session.checkpoint(before, "create-features");
  return projectSnapshot(session);
}

export function reviseFeaturesBatch(getSession: () => OpenProjectSession, input: ReviseFeaturesBatchInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.features)) throw invalid("The feature batch size is invalid.");
  ensureBatch(input.features.length, "The feature batch size is invalid.");
  input.features.forEach(assertRecord);
  const preparedIds = input.features.map((item) => canonicalFeatureId(item.id));
  if (new Set(preparedIds).size !== input.features.length) throw invalid("Feature identifiers must be unique.");
  const session = getSession();
  const prepared = input.features.map((feature, index) => {
    const id = preparedIds[index]!;
    const current = session.database.prepare("SELECT feature_type AS featureType,properties_json AS propertiesJson FROM features WHERE id=?").get(id) as { featureType: string; propertiesJson: string } | undefined;
    if (!current) throw new RealmError("not_found", "The feature was not found.");
    const props = JSON.parse(current.propertiesJson) as FeatureProperties;
    if (props.locked === true) throw new RealmError("feature_locked", "The feature is locked and cannot be changed.");
    return {
      ...feature,
      id,
      name: validateName(feature.name),
      geometryJson: validateGeometry(current.featureType as CreateFeatureInput["featureType"], feature.geometry),
      propertiesJson: JSON.stringify(validateProperties(feature.properties === undefined ? {} : feature.properties)),
    };
  });
  const before = captureState(session.database);
  transaction(session.database, () => {
    const statement = session.database.prepare("UPDATE features SET name=?,geometry_json=?,properties_json=? WHERE id=?");
    for (const feature of prepared) if (statement.run(feature.name, feature.geometryJson, feature.propertiesJson, feature.id).changes !== 1) throw new RealmError("not_found", "The feature was not found.");
  });
  session.checkpoint(before, "revise-features");
  return projectSnapshot(session);
}

export function deleteFeaturesBatch(getSession: () => OpenProjectSession, input: DeleteFeaturesBatchInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.ids)) throw invalid("The feature batch size is invalid.");
  ensureBatch(input.ids.length, "The feature batch size is invalid.");
  const ids = input.ids.map(canonicalFeatureId);
  if (new Set(ids).size !== ids.length) throw invalid("Feature identifiers must be unique.");
  const session = getSession();
  const rows = ids.map((id) => session.database.prepare("SELECT properties_json AS propertiesJson FROM features WHERE id=?").get(id) as { propertiesJson: string } | undefined);
  if (rows.some((row) => !row)) throw new RealmError("not_found", "The feature was not found.");
  let locked = false;
  try { locked = rows.some((row) => JSON.parse(row!.propertiesJson).locked === true); } catch { throw new RealmError("corrupt_project", "A feature contains invalid properties."); }
  if (locked) throw new RealmError("feature_locked", "The feature is locked and cannot be changed.");
  const before = captureState(session.database);
  transaction(session.database, () => {
    const statement = session.database.prepare("DELETE FROM features WHERE id=?");
    for (const id of ids) statement.run(id);
  });
  session.checkpoint(before, "delete-features");
  return projectSnapshot(session);
}

export function setFeaturesLocked(getSession: () => OpenProjectSession, input: SetFeaturesLockedInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.ids)) throw invalid("The feature batch size is invalid.");
  ensureBatch(input.ids.length, "The feature batch size is invalid.");
  const ids = input.ids.map(canonicalFeatureId);
  if (new Set(ids).size !== ids.length) throw invalid("Feature identifiers must be unique.");
  if (typeof input.locked !== "boolean") throw invalid("The feature lock value is invalid.");
  const session = getSession();
  const before = captureState(session.database);
  transaction(session.database, () => {
    const statement = session.database.prepare("UPDATE features SET properties_json=json_set(properties_json,'$.locked',json(?)) WHERE id=?");
    for (const id of ids) if (statement.run(input.locked ? "true" : "false", id).changes !== 1) throw new RealmError("not_found", "The feature was not found.");
  });
  session.checkpoint(before, "lock-features");
  return projectSnapshot(session);
}
