import type { ProjectSettings } from "../../shared/realmContract";
import { invalid, corrupt } from "./errors";

const OVERRIDE_KEYS = new Set(["canvas", "land", "landInk", "coastGlow", "river", "forest", "country", "region", "boundary", "settlement", "label", "labelHalo", "grid"]);
export const DEFAULT_SETTINGS: ProjectSettings = { themeId: "ink", showGrid: true, exportScale: 1, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} };

export function validateSettings(value: unknown): ProjectSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Project settings must be an object.");
  const object = value as Record<string, unknown>;
  const keys = ["themeId", "showGrid", "exportScale", "exportExtent", "canvasWidth", "canvasHeight", "gridKind", "gridColor", "gridWidth", "gridSpacing", "themeOverrides"];
  if (Object.keys(object).length !== keys.length || keys.some((key) => !(key in object))) throw invalid("Project settings contain an unknown or missing key.");
  if (!(["ink", "atlas", "midnight"] as const).includes(object.themeId as never)) throw invalid("Project settings themeId is invalid.");
  if (typeof object.showGrid !== "boolean" || !([1, 2, 4] as number[]).includes(object.exportScale as number) || !(["world", "viewport"] as string[]).includes(object.exportExtent as string)) throw invalid("Project settings export options are invalid.");
  if (!Number.isSafeInteger(object.canvasWidth) || (object.canvasWidth as number) < 512 || (object.canvasWidth as number) > 8192 || !Number.isSafeInteger(object.canvasHeight) || (object.canvasHeight as number) < 512 || (object.canvasHeight as number) > 8192) throw invalid("Project canvas dimensions are invalid.");
  if (!(typeof object.gridKind === "string" && ["graticule", "square", "hex"].includes(object.gridKind)) || typeof object.gridColor !== "string" || !/^#[\da-f]{6}$/iu.test(object.gridColor) || typeof object.gridWidth !== "number" || !Number.isFinite(object.gridWidth) || object.gridWidth < .25 || object.gridWidth > 4 || typeof object.gridSpacing !== "number" || !Number.isFinite(object.gridSpacing) || object.gridSpacing < 2 || object.gridSpacing > 45) throw invalid("Project grid settings are invalid.");
  const overrides = object.themeOverrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.keys(overrides).some((key) => !OVERRIDE_KEYS.has(key) || typeof (overrides as Record<string, unknown>)[key] !== "string" || !/^#[\da-f]{6}$/iu.test((overrides as Record<string, unknown>)[key] as string))) throw invalid("Project theme overrides are invalid.");
  let encoded: string;
  try {
    encoded = JSON.stringify(value, (_key, nested) => {
      if (nested === undefined || typeof nested === "bigint" || typeof nested === "function" || typeof nested === "symbol") throw invalid("Project settings must contain JSON values.");
      return nested;
    });
  } catch (error) {
    if (error instanceof Error && error.name === "RealmError") throw error;
    throw invalid("Project settings must contain JSON values.");
  }
  if (new TextEncoder().encode(encoded).length > 32 * 1024) throw invalid("Project settings are too large.");
  try { return structuredClone(value) as ProjectSettings; } catch { throw invalid("Project settings must contain JSON values."); }
}

export function parseStoredSettings(value: string): ProjectSettings { try { return validateSettings(JSON.parse(value)); } catch (error) { if (error instanceof Error && error.name === "RealmError") throw corrupt("Project settings are invalid."); throw corrupt("Project settings are invalid."); } }
