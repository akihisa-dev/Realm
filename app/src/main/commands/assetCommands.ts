import { randomUUID } from "node:crypto";
import type { AssetRead, DeleteAssetsBatchInput, FeatureProperties, ImportAssetInput, ImportAssetsBatchInput, RealmSnapshot } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { canonicalUuid } from "../domain/identifiers";
import { MAX_ASSET_BYTES, sha256Hex, validateAsset } from "../domain/assets";
import { validateName } from "../domain/geometry";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";

const MAX_ASSET_BATCH = 256;
const assetKeys = new Set(["assetId", "assetIds", "asset_id", "asset_ids", "asset"]);
const containsAsset = (value: unknown, id: string, key?: string): boolean => typeof value === "string" ? Boolean(key && assetKeys.has(key) && value === id) : Array.isArray(value) ? value.some((item) => containsAsset(item, id, key)) : Boolean(value && typeof value === "object" && Object.entries(value as Record<string, unknown>).some(([nestedKey, nestedValue]) => containsAsset(nestedValue, id, nestedKey)));

function assertRecord(input: unknown): asserts input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid.");
}

const canonicalAssetId = (raw: string): string => canonicalUuid(raw, "asset");

export function importAsset(session: OpenProjectSession, input: ImportAssetInput): RealmSnapshot {
  const prepared = validateAsset(input);
  const existing = session.database.prepare("SELECT id FROM assets WHERE sha256=?").get(prepared.sha256);
  if (existing) return projectSnapshot(session);
  const before = captureState(session.database);
  transaction(session.database, () => {
    session.database.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), prepared.sha256, prepared.mime, prepared.bytes, prepared.width, prepared.height, JSON.stringify(prepared.metadata));
  });
  session.checkpoint(before, "import-asset");
  return projectSnapshot(session);
}

export function importAssetsBatch(session: OpenProjectSession, input: ImportAssetsBatchInput): RealmSnapshot {
  assertRecord(input);
  if (typeof input.packName !== "string" || !Array.isArray(input.assets)) throw invalid("The asset pack is invalid.");
  const packName = validateName(input.packName);
  if ([...packName].length > 128 || input.assets.length < 1 || input.assets.length > MAX_ASSET_BATCH || input.assets.reduce((sum, asset) => sum + (Array.isArray(asset?.bytes) ? asset.bytes.length : Number.POSITIVE_INFINITY), 0) > 64 * 1024 * 1024) throw invalid("The asset pack is invalid.");
  const prepared = input.assets.map((asset, ordinal) => ({ ordinal, asset: validateAsset(asset) }));
  if (prepared.some(({ asset }) => Object.keys(asset.metadata).some((key) => ["packId", "packName", "packOrdinal"].includes(key)))) throw invalid("Asset metadata contains reserved pack fields.");
  const known = new Set((session.database.prepare("SELECT sha256 FROM assets").all() as Record<string, unknown>[]).map((row) => String(row.sha256)));
  const additions = prepared.filter(({ asset }) => { if (known.has(asset.sha256)) return false; known.add(asset.sha256); return true; });
  if (!additions.length) return projectSnapshot(session);
  const before = captureState(session.database);
  const packId = randomUUID();
  transaction(session.database, () => {
    const statement = session.database.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)");
    additions.forEach(({ ordinal, asset }) => statement.run(randomUUID(), asset.sha256, asset.mime, asset.bytes, asset.width, asset.height, JSON.stringify({ ...asset.metadata, packId, packName, packOrdinal: ordinal })));
  });
  session.checkpoint(before, "import-assets");
  return projectSnapshot(session);
}

export function readAsset(session: OpenProjectSession, input: { id: string }): AssetRead {
  const id = canonicalAssetId(input.id);
  const row = session.database.prepare("SELECT id,sha256,mime,length(bytes) AS byteLength,bytes,width,height,metadata_json AS metadata FROM assets WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new RealmError("not_found", "The asset was not found.");
  const bytes = row.bytes instanceof Uint8Array ? [...row.bytes] : Array.isArray(row.bytes) ? row.bytes : [];
  const sha256 = String(row.sha256).toLowerCase();
  if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) || !/^[0-9a-f]{64}$/u.test(sha256) || sha256Hex(Uint8Array.from(bytes)) !== sha256) throw new RealmError("corrupt_project", "The asset hash or size is invalid.");
  let metadata: FeatureProperties;
  try { metadata = JSON.parse(String(row.metadata)) as FeatureProperties; validateAsset({ sha256, mime: String(row.mime), bytes, width: Number(row.width), height: Number(row.height), metadata }); } catch { throw new RealmError("corrupt_project", "The asset contents are invalid."); }
  return { manifest: { id, sha256, mime: String(row.mime), byteLength: bytes.length, width: Number(row.width), height: Number(row.height), metadata }, bytes };
}

export function deleteAssetsBatch(session: OpenProjectSession, input: DeleteAssetsBatchInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > MAX_ASSET_BATCH) throw invalid("The asset batch is invalid.");
  const ids = input.ids.map(canonicalAssetId);
  if (new Set(ids).size !== ids.length) throw invalid("An asset batch cannot contain duplicate identifiers.");
  const rows = ids.map((id) => session.database.prepare("SELECT id FROM assets WHERE id=?").get(id));
  if (rows.some((row) => !row)) throw new RealmError("not_found", "The asset was not found.");
  const features = session.database.prepare("SELECT properties_json AS propertiesJson FROM features").all() as Record<string, unknown>[];
  try {
    if (ids.some((id) => features.some((row) => containsAsset(JSON.parse(String(row.propertiesJson)), id)))) throw new RealmError("asset_in_use", "The asset is still referenced by a feature.");
  } catch (error) {
    if (error instanceof RealmError) throw error;
    throw new RealmError("corrupt_project", "A feature contains invalid properties.");
  }
  const before = captureState(session.database, { assetBytesFor: ids });
  transaction(session.database, () => {
    const statement = session.database.prepare("DELETE FROM assets WHERE id=?");
    for (const id of ids) statement.run(id);
  });
  session.checkpoint(before, "delete-assets");
  return projectSnapshot(session);
}
