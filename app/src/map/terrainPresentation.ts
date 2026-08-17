import type { FeatureLike } from "ol/Feature";
import Style, { type RenderFunction } from "ol/style/Style";
import type { MapTheme } from "./themes";

type Pixel = [number, number];
type PixelRing = Pixel[];

const asPixel = (value: unknown): Pixel | undefined => {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const x = value[0];
  const y = value[1];
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
};

/** Normalises Polygon/MultiPolygon renderer coordinates into closed pixel rings. */
const pixelRings = (coordinates: unknown): PixelRing[] => {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return [];
  if (coordinates.every((value) => asPixel(value) !== undefined)) {
    const ring = coordinates.map((value) => asPixel(value)!).map(([x, y]) => [x, y] as Pixel);
    return ring.length >= 3 ? [ring] : [];
  }
  return coordinates.flatMap((value) => pixelRings(value));
};

const colorChannels = (color: string): [number, number, number] | undefined => {
  const hex = color.match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((value) => Math.max(0, Math.min(255, value))) as [number, number, number];
  return undefined;
};

const rgba = (color: string, alpha: number): string => {
  const channels = colorChannels(color);
  if (!channels) return color;
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Math.max(0, Math.min(1, alpha))})`;
};

const stableSeed = (feature: FeatureLike): number => {
  const value = String(feature.get("terrainIdentity") ?? "terrain");
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const nextRandom = (state: { value: number }): number => {
  state.value ^= state.value << 13;
  state.value ^= state.value >>> 17;
  state.value ^= state.value << 5;
  state.value >>>= 0;
  return state.value / 0x1_0000_0000;
};

const boundsOf = (rings: readonly PixelRing[]): [number, number, number, number] | undefined => {
  const points = rings.flat();
  if (points.length === 0) return undefined;
  let minX = points[0]![0]; let maxX = minX; let minY = points[0]![1]; let maxY = minY;
  for (const [x, y] of points.slice(1)) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
};

const drawRings = (context: CanvasRenderingContext2D, rings: readonly PixelRing[]): void => {
  context.beginPath();
  for (const ring of rings) {
    const first = ring[0];
    if (!first) continue;
    context.moveTo(first[0], first[1]);
    for (const [x, y] of ring.slice(1)) context.lineTo(x, y);
    context.closePath();
  }
};

/**
 * Draws the presentation-only land surface. The exact source remains a
 * separate outline layer; this renderer only receives already-smoothed pixel
 * rings and clips a bounded gradient and quiet light/shadow patches into them.
 */
const renderTerrainPresentationWithTheme = (coordinates: Parameters<RenderFunction>[0], state: Parameters<RenderFunction>[1], theme: MapTheme): void => {
  const rings = pixelRings(coordinates);
  const bounds = boundsOf(rings);
  if (!bounds) return;
  const [minX, minY, maxX, maxY] = bounds;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const context = state.context;
  const seed = stableSeed(state.feature);
  const direction = seed % 2 === 0;
  const gradient = direction
    ? context.createLinearGradient(minX, minY, maxX, maxY)
    : context.createLinearGradient(maxX, minY, minX, maxY);
  gradient.addColorStop(0, rgba(theme.land, 0.76));
  gradient.addColorStop(0.52, rgba(theme.land, 0.61));
  gradient.addColorStop(1, rgba(theme.landInk, 0.12));

  context.save();
  drawRings(context, rings);
  context.clip("evenodd");
  context.fillStyle = gradient;
  context.fillRect(minX, minY, width, height);

  // Soft terrain patches supply depth without introducing visible linework.
  // The count is deliberately bounded for world-sized features and exports.
  const randomState = { value: seed || 1 };
  const patchCount = Math.min(18, Math.max(5, Math.round(Math.sqrt(width * height) / 90)));
  const patchRadius = Math.max(18, Math.min(Math.max(width, height) * 0.24, Math.min(width, height) * 0.42));
  for (let index = 0; index < patchCount; index += 1) {
    const centerX = minX + nextRandom(randomState) * width;
    const centerY = minY + nextRandom(randomState) * height;
    const radius = patchRadius * (0.58 + nextRandom(randomState) * 0.42);
    const light = index % 3 === 1;
    const patch = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    patch.addColorStop(0, rgba(light ? theme.coastGlow : theme.landInk, light ? 0.075 : 0.052));
    patch.addColorStop(0.62, rgba(light ? theme.coastGlow : theme.landInk, light ? 0.028 : 0.019));
    patch.addColorStop(1, rgba(light ? theme.coastGlow : theme.landInk, 0));
    context.fillStyle = patch;
    context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  }
  context.restore();
};

export const renderTerrainPresentation: RenderFunction = (coordinates, state): void => {
  const theme = state.feature.get("terrainTheme") as MapTheme | undefined;
  if (theme) renderTerrainPresentationWithTheme(coordinates, state, theme);
};

export const createTerrainPresentationStyle = (theme: MapTheme): Style => new Style({
  renderer: (coordinates, state) => renderTerrainPresentationWithTheme(coordinates, state, theme),
  zIndex: 6,
});
