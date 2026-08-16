import { createHash } from "node:crypto";
import type { ImportAssetInput, Properties } from "../../shared/realmContract";
import { validateProperties } from "./geometry";
import { invalid } from "./errors";
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_ASSET_DIMENSION = 32_768;
export function sha256Hex(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function validateAsset(input: ImportAssetInput): { mime: string; bytes: Uint8Array; width: number; height: number; metadata: Properties; sha256: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The asset input is invalid.");
  if (typeof input.mime !== "string" || !Array.isArray(input.bytes)) throw invalid("The asset format or size is invalid.");
  const mime = input.mime.trim().toLowerCase(); const bytes = Uint8Array.from(input.bytes);
  if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(mime) || !bytes.length || bytes.length > MAX_ASSET_BYTES || input.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw invalid("The asset format or size is invalid.");
  const valid = mime === "image/png" ? bytes.length >= 8 && bytes.slice(0, 8).every((byte, i) => byte === [137, 80, 78, 71, 13, 10, 26, 10][i]) : mime === "image/jpeg" ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!valid || !Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width < 1 || input.height < 1 || input.width > MAX_ASSET_DIMENSION || input.height > MAX_ASSET_DIMENSION) throw invalid("The asset content or dimensions are invalid.");
  const metadata = validateProperties(input.metadata === undefined ? {} : input.metadata); const sha256 = sha256Hex(bytes);
  if (input.sha256 !== undefined && (typeof input.sha256 !== "string" || input.sha256.trim().length !== 64 || !/^[0-9a-f]{64}$/iu.test(input.sha256.trim()) || input.sha256.trim().toLowerCase() !== sha256)) throw invalid("The asset SHA-256 does not match its bytes.");
  return { mime, bytes, width: input.width, height: input.height, metadata, sha256 };
}
