import type { MapThemeId } from "./themes";

export type MapTextureDot = Readonly<{ x: number; y: number; radius: number; light: boolean }>;

const TEXTURE_DENSITY: Record<MapThemeId, number> = { ink: 1 / 1_600, atlas: 1 / 2_500, midnight: 1 / 2_000 };
const TEXTURE_SEED: Record<MapThemeId, number> = { ink: 0x2f6e2b1, atlas: 0x51a7a5, midnight: 0x61d17e };

export const mapTextureDots = (width: number, height: number, themeId: MapThemeId): readonly MapTextureDot[] => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const count = Math.min(12_000, Math.max(24, Math.round(width * height * TEXTURE_DENSITY[themeId])));
  let state = TEXTURE_SEED[themeId] >>> 0;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    return state / 0x1_0000_0000;
  };
  return Array.from({ length: count }, () => ({
    x: random() * width,
    y: random() * height,
    radius: 0.35 + random() * 1.15,
    light: random() > 0.78,
  }));
};

export const paintMapTexture = (context: CanvasRenderingContext2D, width: number, height: number, themeId: MapThemeId): void => {
  const dots = mapTextureDots(width, height, themeId);
  const dark = themeId === "midnight" ? "rgba(0,0,0,0.10)" : "rgba(52,42,28,0.075)";
  const light = themeId === "midnight" ? "rgba(235,226,189,0.10)" : "rgba(255,255,255,0.12)";
  for (const dot of dots) {
    context.fillStyle = dot.light ? light : dark;
    context.beginPath();
    context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
    context.fill();
  }
};
