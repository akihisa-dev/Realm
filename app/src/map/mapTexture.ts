import type { MapThemeId } from "./themes";

const TEXTURE_SEED: Record<MapThemeId, number> = { ink: 0x2f6e2b1, atlas: 0x51a7a5, midnight: 0x61d17e };

export const paintMapTexture = (context: CanvasRenderingContext2D, width: number, height: number, themeId: MapThemeId): void => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  const dark = themeId === "midnight" ? "rgba(0,0,0,0.035)" : themeId === "atlas" ? "rgba(43,106,130,0.026)" : "rgba(52,42,28,0.025)";
  const light = themeId === "midnight" ? "rgba(235,226,189,0.05)" : "rgba(255,255,255,0.055)";
  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, light);
  base.addColorStop(0.48, "rgba(255,255,255,0)");
  base.addColorStop(1, dark);
  context.save();
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  // A small, deterministic set of broad patches keeps the surface continuous.
  let state = TEXTURE_SEED[themeId] >>> 0;
  const random = (): number => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    return state / 0x1_0000_0000;
  };
  const patchCount = Math.min(16, Math.max(6, Math.round(Math.sqrt(width * height) / 220)));
  const radiusBase = Math.max(32, Math.min(Math.max(width, height) * 0.22, Math.min(width, height) * 0.45));
  for (let index = 0; index < patchCount; index += 1) {
    const centerX = random() * width;
    const centerY = random() * height;
    const radius = radiusBase * (0.65 + random() * 0.35);
    const patch = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    const color = index % 3 === 1 ? light : dark;
    patch.addColorStop(0, color);
    patch.addColorStop(0.65, color);
    patch.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = patch;
    context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  }
  context.restore();
};
