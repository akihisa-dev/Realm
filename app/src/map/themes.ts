export const MAP_THEME_IDS = ["ink", "atlas", "midnight"] as const;
export type MapThemeId = typeof MAP_THEME_IDS[number];

export type MapTheme = {
  id: MapThemeId;
  name: string;
  canvas: string;
  land: string;
  landInk: string;
  coastGlow: string;
  river: string;
  forest: string;
  country: string;
  region: string;
  boundary: string;
  settlement: string;
  label: string;
  labelHalo: string;
  grid: string;
};

export type ThemeColorKey = Exclude<keyof MapTheme, "id" | "name">;
export type ThemeOverrides = Partial<Pick<MapTheme, ThemeColorKey>>;
export const MAP_THEME_COLOR_KEYS: readonly ThemeColorKey[] = [
  "canvas", "land", "landInk", "coastGlow", "river", "forest", "country", "region", "boundary", "settlement", "label", "labelHalo", "grid",
];

const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);

export const validateThemeOverrides = (overrides: ThemeOverrides): ThemeOverrides => {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("Theme overrides must be an object.");
  const keys = Object.keys(overrides);
  if (keys.length > MAP_THEME_COLOR_KEYS.length) throw new Error("Theme overrides contain too many color fields.");
  for (const key of keys) {
    if (!(MAP_THEME_COLOR_KEYS as readonly string[]).includes(key)) throw new Error(`Unknown theme override: ${key}.`);
    if (!isHexColor((overrides as Record<string, unknown>)[key])) throw new Error(`Theme override ${key} must be a #RRGGBB value.`);
  }
  return { ...overrides };
};

export const MAP_THEMES: Record<MapThemeId, MapTheme> = {
  ink: { id: "ink", name: "インク地図", canvas: "#ffffff", land: "#dfd0a8", landInk: "#443a2b", coastGlow: "rgba(245, 239, 216, 0.88)", river: "#4c8d9b", forest: "#426a45", country: "#8a654c", region: "#8e765e", boundary: "#6f4938", settlement: "#50382e", label: "#352d25", labelHalo: "rgba(239, 226, 191, 0.94)", grid: "rgba(61, 69, 66, 0.26)" },
  atlas: { id: "atlas", name: "現代アトラス", canvas: "#dcecf1", land: "#e8ebdf", landInk: "#65715f", coastGlow: "rgba(255, 255, 255, 0.9)", river: "#2e78a6", forest: "#3f7c55", country: "#315f7d", region: "#76568c", boundary: "#915f3d", settlement: "#8a3f58", label: "#26323b", labelHalo: "rgba(255, 255, 255, 0.94)", grid: "rgba(74, 87, 98, 0.24)" },
  midnight: { id: "midnight", name: "夜の航海図", canvas: "#172a35", land: "#35463f", landInk: "#b7aa7c", coastGlow: "rgba(101, 151, 157, 0.72)", river: "#75b6c2", forest: "#86a66f", country: "#d1a86a", region: "#aa91bf", boundary: "#d18a72", settlement: "#e2c38f", label: "#e8dfc8", labelHalo: "rgba(19, 35, 43, 0.94)", grid: "rgba(196, 214, 214, 0.22)" },
};

export const DEFAULT_MAP_THEME_ID: MapThemeId = "ink";
export const mapTheme = (id: MapThemeId, overrides: ThemeOverrides = {}): MapTheme => {
  const valid = validateThemeOverrides(overrides);
  return Object.freeze({ ...MAP_THEMES[id], ...valid });
};
