import { randomUUID } from "node:crypto";
import type { AssetRead, DeleteAssetsBatchInput, Properties, ImportAssetInput, ImportAssetsBatchInput, RealmSnapshot } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { canonicalUuid } from "../domain/identifiers";
import { MAX_ASSET_BYTES, sha256Hex, validateAsset } from "../domain/assets";
import { validateName } from "../domain/geometry";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";

const MAX_ASSET_BATCH = 256;
const assetKeys = new Set(["assetId", "assetIds", "asset_id", "asset_ids", "asset"]);
const containsAsset = (value: unknown, id: string, key?: string): boolean => typeof value === "string" ? Boolean(key && assetKeys.has(key) && value === id) : Array.isArray(value) ? value.some((item) => containsAsset(item, id, key)) : Boolean(value && typeof value === "object" && Object.entries(value as Record<string, unknown>).some(([nestedKey, nestedValue]) => containsAsset(nestedValue, id, nestedKey)));

function assertRecord(input: unknown): asserts input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid.");
}

const canonicalAssetId = (raw: string): string => canonicalUuid(raw, "asset");

export function importAsset(getSession: () => OpenProjectSession, input: ImportAssetInput): RealmSnapshot {
  const prepared = validateAsset(input);
  const session = getSession();
  const existing = session.database.prepare("SELECT id FROM assets WHERE sha256=?").get(prepared.sha256);
  if (existing) return projectSnapshot(session);
  session.mutate("import-asset", (store) => store.importAsset(randomUUID(), { sha256: prepared.sha256, mime: prepared.mime, bytes: prepared.bytes, width: prepared.width, height: prepared.height, metadataJson: JSON.stringify(prepared.metadata) }));
  return projectSnapshot(session);
}

export function importAssetsBatch(getSession: () => OpenProjectSession, input: ImportAssetsBatchInput): RealmSnapshot {
  assertRecord(input);
  if (typeof input.packName !== "string" || !Array.isArray(input.assets)) throw invalid("The asset pack is invalid.");
  const packName = validateName(input.packName);
  if ([...packName].length > 128 || input.assets.length < 1 || input.assets.length > MAX_ASSET_BATCH || input.assets.reduce((sum, asset) => sum + (Array.isArray(asset?.bytes) ? asset.bytes.length : Number.POSITIVE_INFINITY), 0) > 64 * 1024 * 1024) throw invalid("The asset pack is invalid.");
  const prepared = input.assets.map((asset, ordinal) => ({ ordinal, asset: validateAsset(asset) }));
  if (prepared.some(({ asset }) => Object.keys(asset.metadata).some((key) => ["packId", "packName", "packOrdinal"].includes(key)))) throw invalid("Asset metadata contains reserved pack fields.");
  const session = getSession();
  const known = new Set((session.database.prepare("SELECT sha256 FROM assets").all() as Record<string, unknown>[]).map((row) => String(row.sha256)));
  const additions = prepared.filter(({ asset }) => { if (known.has(asset.sha256)) return false; known.add(asset.sha256); return true; });
  if (!additions.length) return projectSnapshot(session);
  const packId = randomUUID();
  session.mutate("import-assets", (store) => store.importAssets(additions.map(({ ordinal, asset }) => ({ id: randomUUID(), sha256: asset.sha256, mime: asset.mime, bytes: asset.bytes, width: asset.width, height: asset.height, metadataJson: JSON.stringify({ ...asset.metadata, packId, packName, packOrdinal: ordinal }) }))));
  return projectSnapshot(session);
}

export function readAsset(getSession: () => OpenProjectSession, input: { id: string }): AssetRead {
  const id = canonicalAssetId(input.id);
  const session = getSession();
  const row = session.readConsistent(() => session.store.readAsset(id));
  if (!row) throw new RealmError("not_found", "The asset was not found.");
  const bytes = row.bytes instanceof Uint8Array ? [...row.bytes] : Array.isArray(row.bytes) ? row.bytes : [];
  const sha256 = String(row.sha256).toLowerCase();
  if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) || !/^[0-9a-f]{64}$/u.test(sha256) || sha256Hex(Uint8Array.from(bytes)) !== sha256) throw new RealmError("corrupt_project", "The asset hash or size is invalid.");
  let metadata: Properties;
  try { metadata = JSON.parse(String(row.metadata)) as Properties; validateAsset({ sha256, mime: String(row.mime), bytes, width: Number(row.width), height: Number(row.height), metadata }); } catch { throw new RealmError("corrupt_project", "The asset contents are invalid."); }
  return { manifest: { id, sha256, mime: String(row.mime), byteLength: bytes.length, width: Number(row.width), height: Number(row.height), metadata }, bytes };
}

export function deleteAssetsBatch(getSession: () => OpenProjectSession, input: DeleteAssetsBatchInput): RealmSnapshot {
  assertRecord(input);
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > MAX_ASSET_BATCH) throw invalid("The asset batch is invalid.");
  const ids = input.ids.map(canonicalAssetId);
  if (new Set(ids).size !== ids.length) throw invalid("An asset batch cannot contain duplicate identifiers.");
  const session = getSession();
  const rows = ids.map((id) => session.database.prepare("SELECT id FROM assets WHERE id=?").get(id));
  if (rows.some((row) => !row)) throw new RealmError("not_found", "The asset was not found.");
  const objects = session.database.prepare("SELECT asset_id AS assetId,properties_json AS propertiesJson FROM objects").all() as Record<string, unknown>[];
  try {
    if (ids.some((id) => objects.some((row) => String(row.assetId ?? "") === id || containsAsset(JSON.parse(String(row.propertiesJson)), id)))) throw new RealmError("asset_in_use", "The asset is still referenced by an object.");
  } catch (error) {
    if (error instanceof RealmError) throw error;
    throw new RealmError("corrupt_project", "An object contains invalid properties.");
  }
  session.mutate("delete-assets", (store) => store.deleteAssets(ids), { assetBytesFor: ids });
  return projectSnapshot(session);
}
