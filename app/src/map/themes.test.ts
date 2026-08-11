import { DEFAULT_MAP_THEME_ID, MAP_THEMES, mapTheme, validateThemeOverrides } from "./themes";

describe("map theme overrides", () => {
  it("leaves the default ink canvas white until terrain is painted", () => {
    expect(mapTheme(DEFAULT_MAP_THEME_ID).canvas).toBe("#ffffff");
  });

  it("immutably merges valid color overrides without mutating the base theme", () => {
    const base = MAP_THEMES[DEFAULT_MAP_THEME_ID];
    const merged = mapTheme(DEFAULT_MAP_THEME_ID, { canvas: "#010203", river: "#aabbcc" });
    expect(merged.canvas).toBe("#010203");
    expect(merged.river).toBe("#aabbcc");
    expect(base.canvas).not.toBe(merged.canvas);
    expect(MAP_THEMES[DEFAULT_MAP_THEME_ID].river).not.toBe("#aabbcc");
    expect(Object.isFrozen(merged)).toBe(true);
  });

  it("rejects non-hex and unknown runtime override keys", () => {
    expect(() => validateThemeOverrides({ canvas: "red" })).toThrow(/RRGGBB/);
    expect(() => validateThemeOverrides({ canvas: "#12345" })).toThrow(/RRGGBB/);
    expect(() => validateThemeOverrides({ unknown: "#010203" } as never)).toThrow(/Unknown theme override/);
    expect(() => validateThemeOverrides(Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`x${index}`, "#010203"])) as never)).toThrow(/too many/);
  });
});
