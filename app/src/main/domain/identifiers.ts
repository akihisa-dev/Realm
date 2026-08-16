import { invalid } from "./errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function canonicalUuid(raw: string, label: string): string {
  if (typeof raw !== "string") throw invalid(`The ${label} identifier is invalid.`);
  const value = raw.trim();
  if (value.length > 128 || !UUID_PATTERN.test(value)) throw invalid(`The ${label} identifier is invalid.`);
  return value.toLowerCase();
}
