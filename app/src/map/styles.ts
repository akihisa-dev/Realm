import type { FeatureLike } from "ol/Feature";
import LineString from "ol/geom/LineString";
import Fill from "ol/style/Fill";
import CircleStyle from "ol/style/Circle";
import RegularShape from "ol/style/RegularShape";
import Icon from "ol/style/Icon";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import type { CellAttributeSnapshot, FeatureType } from "../backend";
import { canonicalValueSignature } from "../canonicalValue";
import { DEFAULT_MAP_THEME_ID, mapTheme, type MapThemeId, type ThemeOverrides } from "./themes";

export const MAP_LABEL_FONT = '12px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
export const MAP_LABEL_FONT_FAMILIES = {
  system: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  handwritten: '"Bradley Hand", "Comic Sans MS", cursive',
  condensed: '"Arial Narrow", "Helvetica Neue", sans-serif',
} as const;
export type MapLabelFontFamily = keyof typeof MAP_LABEL_FONT_FAMILIES;

const stringProperty = (feature: FeatureLike, names: readonly string[], fallback: string): string => {
  const properties = feature.get("properties") as Record<string, unknown> | undefined;
  for (const name of names) {
    const value = properties?.[name];
    if (typeof value === "string" && value.trim().length > 0 && value.length <= 128) return value;
  }
  return fallback;
};

const labelNumber = (feature: FeatureLike, names: readonly string[], fallback: number, minimum: number, maximum: number): number => {
  const properties = feature.get("properties") as Record<string, unknown> | undefined;
  for (const name of names) {
    const value = properties?.[name];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(minimum, Math.min(maximum, value));
  }
  return fallback;
};

type LabelOptions = {
  fontSize: number;
  fontFamily: MapLabelFontFamily;
  color: string;
  haloColor: string;
  haloWidth: number;
  rotation: number;
  placement: "point" | "line";
  offsetX: number;
  offsetY: number;
  repeat: number | undefined;
  maxAngle: number;
};

const labelOptions = (feature: FeatureLike, type: FeatureType | undefined, themeId: MapThemeId, overrides: ThemeOverrides = {}): LabelOptions => {
  const theme = mapTheme(themeId, overrides);
  const area = type === "country" || type === "region";
  const properties = feature.get("properties") as Record<string, unknown> | undefined;
  const placementValue = properties?.labelPlacement;
  const fontFamilyValue = properties?.fontFamily;
  const placement = placementValue === "line" || placementValue === "point"
    ? placementValue
    : type === "river" || type === "road" ? "line" : "point";
  return {
    fontSize: labelNumber(feature, ["fontSize", "labelFontSize"], area ? (type === "country" ? 14 : 12) : 12, 6, 96),
    fontFamily: typeof fontFamilyValue === "string" && fontFamilyValue in MAP_LABEL_FONT_FAMILIES ? fontFamilyValue as MapLabelFontFamily : "system",
    color: stringProperty(feature, ["labelColor", "textColor", "color"], theme.label),
    haloColor: stringProperty(feature, ["labelHaloColor", "haloColor"], theme.labelHalo),
    haloWidth: labelNumber(feature, ["labelHaloWidth", "haloWidth"], area ? 4 : 3, 0, 16),
    rotation: labelNumber(feature, ["labelRotation", "rotation"], 0, -Math.PI * 2, Math.PI * 2),
    placement,
    offsetX: labelNumber(feature, ["labelOffsetX", "offsetX"], 0, -256, 256),
    offsetY: labelNumber(feature, ["labelOffsetY", "offsetY"], type === "city" ? -13 : type === "town" ? -11 : 0, -256, 256),
    repeat: labelNumber(feature, ["labelRepeat"], 0, 0, 512) || undefined,
    maxAngle: labelNumber(feature, ["labelMaxAngle"], Math.PI / 4, Math.PI / 12, Math.PI / 2),
  };
};

const labelPathGeometry = (feature: FeatureLike): LineString | undefined => {
  const value = (feature.get("properties") as Record<string, unknown> | undefined)?.labelPath;
  if (!Array.isArray(value) || value.length < 2 || value.length > 4_096) return undefined;
  const coordinates: [number, number][] = [];
  for (const position of value) {
    if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)) return undefined;
    const [longitude, latitude] = position as [number, number];
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return undefined;
    coordinates.push([longitude, latitude]);
  }
  return new LineString(coordinates);
};

const featureLabel = (feature: FeatureLike, type: FeatureType | undefined, value: unknown, themeId: MapThemeId, opacity = 1, overrides: ThemeOverrides = {}): Text | undefined => {
  if (typeof value !== "string" || !value.trim() || type === "terrain" || type === "forest" || type === "coastline" || type === "boundary") return undefined;
  const options = labelOptions(feature, type, themeId, overrides);
  return new Text({
    text: value,
    font: `${type === "country" || type === "region" ? "600 " : ""}${options.fontSize}px ${MAP_LABEL_FONT_FAMILIES[options.fontFamily]}`,
    placement: options.placement,
    overflow: true,
    offsetX: options.offsetX,
    offsetY: options.offsetY,
    rotation: options.rotation,
    rotateWithView: false,
    repeat: options.repeat,
    maxAngle: options.maxAngle,
    keepUpright: true,
    fill: new Fill({ color: colorWithOpacity(options.color, opacity) }),
    stroke: new Stroke({ color: colorWithOpacity(options.haloColor, opacity), width: options.haloWidth }),
  });
};

const numericProperty = (feature: FeatureLike, name: string, fallback: number, minimum: number, maximum: number): number => {
  const properties = feature.get("properties") as Record<string, unknown> | undefined;
  const value = properties?.[name];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
};

const featureOpacity = (feature: FeatureLike): number => numericProperty(feature, "opacity", 1, 0, 1);

type OverlayBlendMode = "source-over" | "multiply" | "screen" | "overlay" | "soft-light";
const overlayBlendMode = (feature: FeatureLike): OverlayBlendMode => {
  const value = (feature.get("properties") as Record<string, unknown> | undefined)?.blendMode;
  return value === "multiply" || value === "screen" || value === "overlay" || value === "soft-light" ? value : "source-over";
};

/**
 * Keep asset resolution local-only.  The resolver is still the sole source of
 * URLs; this guard prevents a malformed/project property from turning into a
 * network request during map rendering.
 */
const localImageUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return value.startsWith("blob:") || value.startsWith("data:image/") ? value : undefined;
};

const colorWithOpacity = (color: string, opacity: number): string => {
  const alpha = Math.max(0, Math.min(1, opacity));
  if (alpha >= 1) return color;
  if (alpha <= 0) return "rgba(0, 0, 0, 0)";
  const hex = color.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 || hex.length === 4 ? [...hex].map((part) => `${part}${part}`).join("") : hex;
    if (expanded.length === 6 || expanded.length === 8) {
      const red = Number.parseInt(expanded.slice(0, 2), 16);
      const green = Number.parseInt(expanded.slice(2, 4), 16);
      const blue = Number.parseInt(expanded.slice(4, 6), 16);
      const sourceAlpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
      return `rgba(${red}, ${green}, ${blue}, ${sourceAlpha * alpha})`;
    }
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (rgb) {
    const sourceAlpha = rgb[4] ? (rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number.parseFloat(rgb[4])) : 1;
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${sourceAlpha * alpha})`;
  }
  // Unknown CSS names cannot be parsed without a browser; retain the color
  // rather than injecting a network-dependent lookup or invalid CSS.
  return color;
};

const pixelBounds = (coordinates: unknown): [number, number, number, number] | undefined => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      const x = value[0];
      const y = value[1];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return;
    }
    for (const child of value) visit(child);
  };
  visit(coordinates);
  return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
    ? [minX, minY, maxX, maxY]
    : undefined;
};

type PixelPoint = [number, number];
const firstPixelRing = (coordinates: unknown): PixelPoint[] | undefined => {
  if (!Array.isArray(coordinates)) return undefined;
  if (coordinates.length >= 4 && coordinates.every((value) => Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number")) {
    const points = (coordinates as number[][]).filter((value) => Number.isFinite(value[0]) && Number.isFinite(value[1])).map((value) => [value[0]!, value[1]!] as PixelPoint);
    if (points.length > 1 && points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1]) points.pop();
    return points.length === 4 ? points : undefined;
  }
  for (const child of coordinates) {
    const ring = firstPixelRing(child);
    if (ring) return ring;
  }
  return undefined;
};

const rotatePixelPoint = (point: PixelPoint, center: PixelPoint, radians: number): PixelPoint => {
  if (radians === 0) return point;
  const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const x = point[0] - center[0]; const y = point[1] - center[1];
  return [center[0] + x * cosine - y * sine, center[1] + x * sine + y * cosine];
};

const drawImageTriangle = (context: CanvasRenderingContext2D, image: CanvasImageSource, source: readonly [PixelPoint, PixelPoint, PixelPoint], destination: readonly [PixelPoint, PixelPoint, PixelPoint], sourceRect: readonly [number, number, number, number]): void => {
  const [a, b, c] = source; const [x, y, z] = destination;
  const denominator = a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]);
  if (Math.abs(denominator) < 1e-9) return;
  const linearX = (first: number, second: number, third: number) => (first * (b[1] - c[1]) + second * (c[1] - a[1]) + third * (a[1] - b[1])) / denominator;
  const linearY = (first: number, second: number, third: number) => (first * (c[0] - b[0]) + second * (a[0] - c[0]) + third * (b[0] - a[0])) / denominator;
  const translate = (first: number, second: number, third: number) => (first * (b[0] * c[1] - c[0] * b[1]) + second * (c[0] * a[1] - a[0] * c[1]) + third * (a[0] * b[1] - b[0] * a[1])) / denominator;
  context.save();
  context.beginPath(); context.moveTo(x[0], x[1]); context.lineTo(y[0], y[1]); context.lineTo(z[0], z[1]); context.closePath(); context.clip();
  context.transform(linearX(x[0], y[0], z[0]), linearX(x[1], y[1], z[1]), linearY(x[0], y[0], z[0]), linearY(x[1], y[1], z[1]), translate(x[0], y[0], z[0]), translate(x[1], y[1], z[1]));
  const [sourceX, sourceY, sourceWidth, sourceHeight] = sourceRect;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, sourceX, sourceY, sourceWidth, sourceHeight);
  context.restore();
};

type OverlayCrop = { left: number; top: number; right: number; bottom: number };

const overlayImageRenderer = (image: Icon, opacity: number, rotation: number, blendMode: OverlayBlendMode, placeholder: string, crop: OverlayCrop) => (coordinates: unknown, state: { context: CanvasRenderingContext2D; pixelRatio: number }): void => {
  const bounds = pixelBounds(coordinates);
  if (!bounds) return;
  const [minX, minY, maxX, maxY] = bounds;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const context = state.context;
  context.save();
  context.globalAlpha *= opacity;
  context.globalCompositeOperation = blendMode;
  context.translate(minX + width / 2, minY + height / 2);
  context.rotate(rotation);
  let drawn = false;
  try {
    const size = image.getImageSize();
    const imageElement = image.getImage(state.pixelRatio);
    const imageWidth = size?.[0] ?? 0;
    const imageHeight = size?.[1] ?? 0;
    if (imageWidth > 0 && imageHeight > 0 && imageElement) {
      const ring = firstPixelRing(coordinates);
      if (ring) {
        context.restore();
        const center: PixelPoint = [minX + width / 2, minY + height / 2];
        const destination = ring.map((point) => rotatePixelPoint(point, center, rotation)) as [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
        const sourceX = imageWidth * crop.left; const sourceY = imageHeight * crop.top;
        const sourceWidth = imageWidth * (1 - crop.left - crop.right); const sourceHeight = imageHeight * (1 - crop.top - crop.bottom);
        const source: [PixelPoint, PixelPoint, PixelPoint, PixelPoint] = [[sourceX, sourceY], [sourceX + sourceWidth, sourceY], [sourceX + sourceWidth, sourceY + sourceHeight], [sourceX, sourceY + sourceHeight]];
        context.save(); context.globalAlpha *= opacity; context.globalCompositeOperation = blendMode;
        drawImageTriangle(context, imageElement, [source[0], source[1], source[2]], [destination[0], destination[1], destination[2]], [sourceX, sourceY, sourceWidth, sourceHeight]);
        drawImageTriangle(context, imageElement, [source[0], source[2], source[3]], [destination[0], destination[2], destination[3]], [sourceX, sourceY, sourceWidth, sourceHeight]);
      } else context.drawImage(imageElement, -width / 2, -height / 2, width, height);
      drawn = true;
    }
  } catch {
    // Image decoding is asynchronous and can fail in a worker/test context.
  }
  if (!drawn) {
    context.fillStyle = colorWithOpacity(placeholder, 0.28);
    context.fillRect(-width / 2, -height / 2, width, height);
    context.strokeStyle = colorWithOpacity(placeholder, 0.8);
    context.lineWidth = 1;
    context.setLineDash([5, 4]);
    context.strokeRect(-width / 2, -height / 2, width, height);
  }
  context.restore();
};

const applyFeatureOpacity = (styles: Style | Style[], opacity: number): void => {
  if (opacity >= 1) return;
  for (const style of Array.isArray(styles) ? styles : [styles]) {
    const fill = style.getFill();
    const fillColor = fill?.getColor();
    if (fill && typeof fillColor === "string") fill.setColor(colorWithOpacity(fillColor, opacity));
    const stroke = style.getStroke();
    const strokeColor = stroke?.getColor();
    if (stroke && typeof strokeColor === "string") stroke.setColor(colorWithOpacity(strokeColor, opacity));
    const image = style.getImage();
    if (image) image.setOpacity(image.getOpacity() * opacity);
  }
};

const lineDashProperty = (feature: FeatureLike): number[] | undefined => {
  const style = (feature.get("properties") as Record<string, unknown> | undefined)?.lineStyle;
  if (style === "dashed") return [9, 6];
  if (style === "dotted") return [2, 5];
  const profile = lineProfileProperty(feature);
  if (profile !== "rough") return undefined;
  const roughness = numericProperty(feature, "roughness", 0.55, 0, 1);
  return [Math.max(2.5, 7 - roughness * 3), 0.8 + roughness * 2.2, 1.2, 0.8 + roughness * 1.4];
};

type LineProfile = "smooth" | "rough" | "angular";
const lineProfileProperty = (feature: FeatureLike): LineProfile => {
  const value = (feature.get("properties") as Record<string, unknown> | undefined)?.lineProfile;
  return value === "rough" || value === "angular" ? value : "smooth";
};

type FrameStyle = "solid" | "double" | "dashed";

const frameStyleProperty = (feature: FeatureLike): FrameStyle => {
  const value = (feature.get("properties") as Record<string, unknown> | undefined)?.frameStyle;
  return value === "double" || value === "dashed" ? value : "solid";
};

const pixelPoint = (coordinates: unknown): [number, number] | undefined => {
  if (!Array.isArray(coordinates)) return undefined;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number"
    && Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1])) return [coordinates[0], coordinates[1]];
  for (const child of coordinates) {
    const point = pixelPoint(child);
    if (point) return point;
  }
  return undefined;
};

const scaleBarRenderer = (
  barLengthPx: number,
  segments: number,
  unit: string,
  unitsPerDegree: number,
  color: string,
  opacity: number,
  rotation: number,
) => (coordinates: unknown, state: { context: CanvasRenderingContext2D; pixelRatio: number }): void => {
  const point = pixelPoint(coordinates);
  if (!point) return;
  const context = state.context;
  const pixelRatio = Number.isFinite(state.pixelRatio) && state.pixelRatio > 0 ? state.pixelRatio : 1;
  const length = barLengthPx * pixelRatio;
  const segmentLength = length / segments;
  const tickHeight = 8 * pixelRatio;
  const lineWidth = Math.max(1, 2 * pixelRatio);
  const value = Number(unitsPerDegree.toPrecision(6));
  const label = `${value} ${unit}/°`;
  context.save();
  context.globalAlpha *= opacity;
  context.translate(point[0], point[1]);
  context.rotate(rotation);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lineWidth;
  context.beginPath();
  context.moveTo(-length / 2, 0);
  context.lineTo(length / 2, 0);
  for (let index = 0; index <= segments; index += 1) {
    const x = -length / 2 + segmentLength * index;
    context.moveTo(x, -tickHeight / 2);
    context.lineTo(x, tickHeight / 2);
  }
  context.stroke();
  context.font = `${11 * pixelRatio}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(label, 0, tickHeight / 2 + 3 * pixelRatio);
  context.restore();
};

const presentationPropertiesKey = (feature: FeatureLike, type: FeatureType | undefined, themeId: MapThemeId, overrides: ThemeOverrides = {}): Record<string, unknown> => {
  const options = labelOptions(feature, type, themeId, overrides);
  return {
    width: numericProperty(feature, "width", type === "road" ? 2.2 : 2.4, 0.5, 24),
    scale: numericProperty(feature, "scale", 1, 0.25, 8),
    rotation: numericProperty(feature, "rotation", 0, -Math.PI * 2, Math.PI * 2),
    strokeColor: stringProperty(feature, ["strokeColor"], ""),
    fillColor: stringProperty(feature, ["fillColor"], ""),
    fillOpacity: numericProperty(feature, "fillOpacity", 0.18, 0, 1),
    casingColor: stringProperty(feature, ["casingColor"], ""),
    lineDash: lineDashProperty(feature),
    lineProfile: lineProfileProperty(feature),
    roughness: numericProperty(feature, "roughness", 0.55, 0, 1),
    frameWidth: numericProperty(feature, "frameWidth", 3, 0.5, 32),
    frameColor: stringProperty(feature, ["frameColor"], ""),
    frameStyle: frameStyleProperty(feature),
    barLengthPx: numericProperty(feature, "barLengthPx", 120, 24, 640),
    segments: Math.round(numericProperty(feature, "segments", 4, 1, 12)),
    unit: stringProperty(feature, ["unit"], "単位"),
    symbolKind: stringProperty(feature, ["symbolKind"], "marker"),
    flipX: (feature.get("properties") as Record<string, unknown> | undefined)?.flipX === true,
    unitsPerDegree: numericProperty(feature, "unitsPerDegree", 1, 0.0001, 1_000_000),
    zIndex: numericProperty(feature, "zIndex", 0, -1000, 1000),
    visible: (feature.get("properties") as Record<string, unknown> | undefined)?.visible !== false,
    opacity: featureOpacity(feature),
    blendMode: overlayBlendMode(feature),
    cropLeft: numericProperty(feature, "cropLeft", 0, 0, 0.49),
    cropTop: numericProperty(feature, "cropTop", 0, 0, 0.49),
    cropRight: numericProperty(feature, "cropRight", 0, 0, 0.49),
    cropBottom: numericProperty(feature, "cropBottom", 0, 0, 0.49),
    label: options,
    labelPath: labelPathGeometry(feature)?.getCoordinates() ?? null,
  };
};

export const createFeatureStyle = (
  getThemeId: () => MapThemeId = () => DEFAULT_MAP_THEME_ID,
  isVisible: (featureType: FeatureType | undefined) => boolean = () => true,
  getAssetUrl: (assetId: string) => string | undefined = () => undefined,
  getThemeOverrides: () => ThemeOverrides = () => ({}),
): ((feature: FeatureLike) => Style | Style[] | undefined) => {
  type CachedStyle = { key: string; styles: Style | Style[] };
  // Keep only the latest style for each live OpenLayers feature. A feature can
  // change presentation properties during an edit, so a global key cache would
  // retain every historical Style/Canvas/Icon instance for the session.
  const featureStyles = new WeakMap<object, CachedStyle>();
  return (feature: FeatureLike): Style | Style[] | undefined => {
    const type = feature.get("featureType") as FeatureType | undefined;
    if (!isVisible(type)) return undefined;
    if ((feature.get("properties") as Record<string, unknown> | undefined)?.visible === false) return undefined;
    const rawName = feature.get("name");
    const name = typeof rawName === "string" ? rawName : "";
    const themeId = getThemeId();
    const overrides = getThemeOverrides();
    const theme = mapTheme(themeId, overrides);
    const assetId = stringProperty(feature, ["assetId"], "");
    const assetUrl = assetId ? localImageUrl(getAssetUrl(assetId)) : undefined;
    const key = canonicalValueSignature({
      themeId,
      overrides,
      type: type ?? null,
      name,
      presentation: presentationPropertiesKey(feature, type, themeId, overrides),
      assetId,
      assetUrl: assetUrl ?? null,
    });
    const cached = featureStyles.get(feature as object);
    if (cached?.key === key) return cached.styles;
    const opacity = featureOpacity(feature);
    const label = featureLabel(feature, type, name, themeId, opacity, overrides);
    let styles: Style | Style[];
    if (type === "terrain") {
      styles = [new Style({ fill: new Fill({ color: theme.land }), stroke: new Stroke({ color: theme.coastGlow, width: 7 }), zIndex: 10 }), new Style({ stroke: new Stroke({ color: theme.landInk, width: 1.6 }), zIndex: 11 })];
    } else if (type === "forest") {
      styles = new Style({ fill: new Fill({ color: `${theme.forest}26` }), stroke: new Stroke({ color: theme.forest, width: 1.2 }), zIndex: 20 });
    } else if (type === "river") {
      const width = numericProperty(feature, "width", 2.4, 0.5, 24);
      const dash = lineDashProperty(feature);
      const angular = lineProfileProperty(feature) === "angular";
      styles = [new Style({ stroke: new Stroke({ color: stringProperty(feature, ["casingColor"], theme.labelHalo), width: width + 2.6, lineCap: angular ? "butt" : "round", lineJoin: angular ? "bevel" : "round", lineDash: dash }), zIndex: 51 }), new Style({ stroke: new Stroke({ color: stringProperty(feature, ["strokeColor"], theme.river), width, lineCap: angular ? "butt" : "round", lineJoin: angular ? "bevel" : "round", lineDash: dash }), text: label, zIndex: 52 })];
    } else if (type === "coastline") {
      styles = [new Style({ stroke: new Stroke({ color: theme.coastGlow, width: 6, lineCap: "round", lineJoin: "round" }), zIndex: 49 }), new Style({ stroke: new Stroke({ color: theme.landInk, width: 1.5, lineCap: "round", lineJoin: "round" }), zIndex: 50 })];
    } else if (type === "road") {
      const width = numericProperty(feature, "width", 2.2, 0.5, 24);
      const dash = lineDashProperty(feature);
      const angular = lineProfileProperty(feature) === "angular";
      styles = [new Style({ stroke: new Stroke({ color: stringProperty(feature, ["casingColor"], theme.labelHalo), width: width + 3, lineCap: angular ? "butt" : "round", lineJoin: angular ? "bevel" : "round", lineDash: dash }), zIndex: 53 }), new Style({ stroke: new Stroke({ color: stringProperty(feature, ["strokeColor"], theme.boundary), width, lineCap: angular ? "butt" : "round", lineJoin: angular ? "bevel" : "round", lineDash: dash }), text: label, zIndex: 54 })];
    } else if (type === "lake") {
      styles = [new Style({ fill: new Fill({ color: theme.canvas }), stroke: new Stroke({ color: theme.coastGlow, width: 5 }), zIndex: 21 }), new Style({ stroke: new Stroke({ color: theme.river, width: 1.5 }), text: label, zIndex: 22 })];
    } else if (type === "scale") {
      const barLengthPx = numericProperty(feature, "barLengthPx", 120, 24, 640);
      const segments = Math.round(numericProperty(feature, "segments", 4, 1, 12));
      const unit = stringProperty(feature, ["unit"], "単位");
      const unitsPerDegree = numericProperty(feature, "unitsPerDegree", 1, 0.0001, 1_000_000);
      const rotation = numericProperty(feature, "rotation", 0, -Math.PI * 2, Math.PI * 2);
      styles = new Style({
        renderer: scaleBarRenderer(barLengthPx, segments, unit, unitsPerDegree, theme.landInk, opacity, rotation),
        zIndex: 75,
      });
    } else if (type === "mountain" || type === "tree" || type === "symbol" || type === "label") {
      const scale = numericProperty(feature, "scale", 1, 0.25, 8);
      const rotation = numericProperty(feature, "rotation", 0, -Math.PI * 2, Math.PI * 2);
      const flipX = (feature.get("properties") as Record<string, unknown> | undefined)?.flipX === true;
      const symbolKind = stringProperty(feature, ["symbolKind"], "marker");
      const image = assetUrl && (type === "mountain" || type === "tree" || type === "symbol")
        ? new Icon({ src: assetUrl, scale: [flipX ? -scale : scale, scale], rotation })
        : type === "mountain"
        ? new RegularShape({ points: 3, radius: 9 * scale, angle: rotation, fill: new Fill({ color: theme.land }), stroke: new Stroke({ color: theme.landInk, width: 1.6 }) })
        : type === "tree"
          ? new RegularShape({ points: 3, radius: 6 * scale, angle: rotation, fill: new Fill({ color: theme.forest }), stroke: new Stroke({ color: theme.labelHalo, width: 0.8 }) })
          : type === "symbol"
            ? symbolKind === "compass"
              ? new RegularShape({ points: 8, radius: 10 * scale, radius2: 3.2 * scale, angle: rotation, fill: new Fill({ color: theme.settlement }), stroke: new Stroke({ color: theme.labelHalo, width: 1 }) })
              : symbolKind === "north"
                ? new RegularShape({ points: 3, radius: 10 * scale, angle: rotation, fill: new Fill({ color: theme.settlement }), stroke: new Stroke({ color: theme.labelHalo, width: 1 }) })
                : new RegularShape({ points: 5, radius: 6 * scale, radius2: 2.8 * scale, angle: rotation, fill: new Fill({ color: theme.settlement }), stroke: new Stroke({ color: theme.labelHalo, width: 1 }) })
            : new CircleStyle({ radius: 1, fill: new Fill({ color: "rgba(0,0,0,0)" }) });
      styles = new Style({ geometry: type === "label" ? labelPathGeometry(feature) : undefined, image, text: type === "label" ? featureLabel(feature, "label", name, themeId, opacity, overrides) : label, zIndex: type === "label" ? 82 : 75 });
    } else if (type === "overlay") {
      const overlayStroke = theme.country;
      const overlayFill = `${theme.country}12`;
      if (assetUrl) {
        // Keep the polygon as the source geometry while the custom renderer
        // paints the embedded image into its pixel-space bounding rectangle.
        // The Icon is intentionally retained on the style so OpenLayers owns
        // image loading and schedules a redraw when decoding completes.
        const image = new Icon({ src: assetUrl, opacity: 1 });
        const blendMode = overlayBlendMode(feature);
        const crop: OverlayCrop = {
          left: numericProperty(feature, "cropLeft", 0, 0, 0.49), top: numericProperty(feature, "cropTop", 0, 0, 0.49),
          right: numericProperty(feature, "cropRight", 0, 0, 0.49), bottom: numericProperty(feature, "cropBottom", 0, 0, 0.49),
        };
        styles = new Style({
          image,
          renderer: overlayImageRenderer(image, opacity, numericProperty(feature, "rotation", 0, -Math.PI * 2, Math.PI * 2), blendMode, theme.country, crop),
          hitDetectionRenderer: overlayImageRenderer(image, opacity, numericProperty(feature, "rotation", 0, -Math.PI * 2, Math.PI * 2), "source-over", theme.country, crop),
          zIndex: 24,
        });
      } else {
        // Missing or non-local assets never become a blank/remote request;
        // retain a visible bounded placeholder instead.
        styles = new Style({ fill: new Fill({ color: overlayFill }), stroke: new Stroke({ color: overlayStroke, width: 1.5, lineDash: [6, 4] }), zIndex: 24 });
      }
    } else if (type === "frame") {
      const width = numericProperty(feature, "frameWidth", 3, 0.5, 32);
      const color = stringProperty(feature, ["frameColor"], theme.landInk);
      const style = frameStyleProperty(feature);
      if (style === "double") {
        styles = [
          new Style({ stroke: new Stroke({ color: theme.canvas, width: width + 5 }), zIndex: 90 }),
          new Style({ stroke: new Stroke({ color, width }), zIndex: 91 }),
        ];
      } else {
        styles = new Style({ stroke: new Stroke({ color, width, lineDash: style === "dashed" ? [12, 8] : undefined }), zIndex: 90 });
      }
    } else {
      const area = type === "country" || type === "region";
      const color = type === "country" ? theme.country : type === "region" ? theme.region : type === "boundary" ? theme.boundary : theme.settlement;
      const strokeColor = area ? stringProperty(feature, ["strokeColor"], color) : color;
      const fillColor = area ? stringProperty(feature, ["fillColor"], color) : color;
      const fillOpacity = numericProperty(feature, "fillOpacity", type === "country" ? 0.18 : 0.12, 0, 1);
      const zIndex = type === "country" ? 30 : type === "region" ? 40 : type === "boundary" ? 60 : 70;
      styles = new Style({
        fill: area ? new Fill({ color: colorWithOpacity(fillColor, fillOpacity) }) : undefined,
        stroke: new Stroke({ color: strokeColor, width: type === "region" ? 1.5 : type === "boundary" ? 2 : 2.2, lineDash: area ? lineDashProperty(feature) ?? (type === "region" ? [5, 4] : undefined) : type === "boundary" ? [8, 4] : undefined }),
        image: new CircleStyle({ radius: type === "city" ? 6 : 4.5, fill: new Fill({ color }), stroke: new Stroke({ color: theme.labelHalo, width: 1.5 }) }),
        text: label,
        zIndex,
      });
    }
    applyFeatureOpacity(styles, opacity);
    const zOffset = numericProperty(feature, "zIndex", 0, -1000, 1000);
    for (const style of Array.isArray(styles) ? styles : [styles]) style.setZIndex((style.getZIndex() ?? 0) + zOffset);
    featureStyles.set(feature as object, { key, styles });
    return styles;
  };
};

export const featureStyle = createFeatureStyle();

const stableVariant = (value: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export const createCellStyle = (getThemeId: () => MapThemeId = () => DEFAULT_MAP_THEME_ID, getThemeOverrides: () => ThemeOverrides = () => ({})): ((feature: FeatureLike) => Style | Style[] | undefined) => {
  type CachedStyle = { key: string; styles: Style | Style[] };
  const cellStyles = new WeakMap<object, CachedStyle>();
  return (feature: FeatureLike): Style | Style[] | undefined => {
    const attributes = feature.get("attributes") as CellAttributeSnapshot[] | undefined;
    const has = (attribute: CellAttributeSnapshot["attribute"]): boolean => attributes?.some((item) => item.attribute === attribute) ?? false;
    const selected = feature.get("selected") === true;
    const preview = feature.get("preview") === true;
    const paintPreview = feature.get("paintPreview") === true;
    if (feature.get("erasePreview") === true) return undefined;
    const hasTerrain = has("terrain");
    const hasPhysical = has("forest");
    const hasCountry = has("country");
    const hasRegion = has("region");
    if (!hasTerrain && !hasPhysical && !hasCountry && !hasRegion && !selected && !preview && !paintPreview) return undefined;
    const themeId = getThemeId();
    const overrides = getThemeOverrides();
    const theme = mapTheme(themeId, overrides);
    const variant = stableVariant(String(feature.getId() ?? "")) % 7;
    const flags = (hasPhysical ? 2 : 0) | (hasCountry ? 4 : 0) | (hasRegion ? 8 : 0) | (selected ? 16 : 0) | (hasTerrain ? 32 : 0) | (preview ? 64 : 0) | (paintPreview ? 128 : 0);
    const key = canonicalValueSignature({
      themeId,
      overrides,
      flags,
      variant: hasPhysical ? variant : 0,
    });
    const cached = cellStyles.get(feature as object);
    if (cached?.key === key) return cached.styles;
    const styles: Style[] = [];
    if (hasTerrain) styles.push(new Style({ fill: new Fill({ color: theme.land }), stroke: new Stroke({ color: theme.landInk, width: 0.7 }), zIndex: 6 }));
    if (hasPhysical) styles.push(new Style({ fill: new Fill({ color: theme.forest }), stroke: new Stroke({ color: theme.labelHalo, width: 0.55 + variant * 0.03 }), zIndex: 8 }));
    if (hasCountry) styles.push(new Style({ fill: new Fill({ color: `${theme.country}14` }), stroke: new Stroke({ color: theme.country, width: 1.1 }), zIndex: 9 }));
    if (hasRegion) styles.push(new Style({ fill: new Fill({ color: `${theme.region}0d` }), stroke: new Stroke({ color: theme.region, width: 1.1, lineDash: [3, 2] }), zIndex: 10 }));
    if (selected) styles.push(new Style({ fill: new Fill({ color: paintPreview ? theme.land : "rgba(7, 140, 152, 0.16)" }), stroke: new Stroke({ color: paintPreview ? theme.landInk : "#078c98", width: 1.4 }), zIndex: 85 }));
    if (preview) styles.push(new Style({ fill: new Fill({ color: "rgba(7, 140, 152, 0.08)" }), stroke: new Stroke({ color: "#078c98", width: 1.2, lineDash: [3, 2] }), zIndex: 84 }));
    cellStyles.set(feature as object, { key, styles });
    return styles;
  };
};

export const cellStyle = createCellStyle();
