import type { FeatureLike } from "ol/Feature";
import LineString from "ol/geom/LineString";
import Fill from "ol/style/Fill";
import CircleStyle from "ol/style/Circle";
import RegularShape from "ol/style/RegularShape";
import Icon from "ol/style/Icon";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import type { CellAttributeSnapshot, ObjectKind } from "../backend";
import { canonicalValueSignature } from "../canonicalValue";
import { cellAttributeLayer } from "../shared/realmContract";
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

type StyleKind = ObjectKind | "terrain" | "region";

const labelOptions = (feature: FeatureLike, type: StyleKind | undefined, themeId: MapThemeId, overrides: ThemeOverrides = {}): LabelOptions => {
  const theme = mapTheme(themeId, overrides);
  const area = type === "region";
  const properties = feature.get("properties") as Record<string, unknown> | undefined;
  const placementValue = properties?.labelPlacement;
  const fontFamilyValue = properties?.fontFamily;
  const placement = placementValue === "line" || placementValue === "point"
    ? placementValue
    : "point";
  return {
    fontSize: labelNumber(feature, ["fontSize", "labelFontSize"], area ? 14 : 12, 6, 96),
    fontFamily: typeof fontFamilyValue === "string" && fontFamilyValue in MAP_LABEL_FONT_FAMILIES ? fontFamilyValue as MapLabelFontFamily : "system",
    color: stringProperty(feature, ["labelColor", "textColor", "color"], theme.label),
    haloColor: stringProperty(feature, ["labelHaloColor", "haloColor"], theme.labelHalo),
    haloWidth: labelNumber(feature, ["labelHaloWidth", "haloWidth"], area ? 4 : 3, 0, 16),
    rotation: labelNumber(feature, ["labelRotation", "rotation"], 0, -Math.PI * 2, Math.PI * 2),
    placement,
    offsetX: labelNumber(feature, ["labelOffsetX", "offsetX"], 0, -256, 256),
    offsetY: labelNumber(feature, ["labelOffsetY", "offsetY"], type === "city" ? -13 : 0, -256, 256),
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

const objectLabel = (feature: FeatureLike, type: StyleKind | undefined, value: unknown, themeId: MapThemeId, opacity = 1, overrides: ThemeOverrides = {}): Text | undefined => {
  if (typeof value !== "string" || !value.trim() || type === "terrain" || type === "region" || type === "forest") return undefined;
  const options = labelOptions(feature, type, themeId, overrides);
  return new Text({
    text: value,
    font: `${type === "text" ? "600 " : ""}${options.fontSize}px ${MAP_LABEL_FONT_FAMILIES[options.fontFamily]}`,
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

const featureOpacity = (feature: FeatureLike): number => {
  const animation = feature.get("regionAnimationOpacity");
  if (typeof animation === "number" && Number.isFinite(animation)) return Math.max(0, Math.min(1, animation));
  return numericProperty(feature, "opacity", 1, 0, 1);
};

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

const presentationPropertiesKey = (feature: FeatureLike, type: StyleKind | undefined, themeId: MapThemeId, overrides: ThemeOverrides = {}): Record<string, unknown> => {
  const options = labelOptions(feature, type, themeId, overrides);
  return {
    width: numericProperty(feature, "width", 2.4, 0.5, 24),
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

export const createObjectStyle = (
  getThemeId: () => MapThemeId = () => DEFAULT_MAP_THEME_ID,
  isVisible: (kind: StyleKind | undefined) => boolean = () => true,
  getAssetUrl: (assetId: string) => string | undefined = () => undefined,
  getThemeOverrides: () => ThemeOverrides = () => ({}),
): ((feature: FeatureLike) => Style | Style[] | undefined) => {
  type CachedStyle = { key: string; styles: Style | Style[] };
  // Keep only the latest style for each live OpenLayers feature. A feature can
  // change presentation properties during an edit, so a global key cache would
  // retain every historical Style/Canvas/Icon instance for the session.
  const featureStyles = new WeakMap<object, CachedStyle>();
  return (feature: FeatureLike): Style | Style[] | undefined => {
    const type = feature.get("kind") as StyleKind | undefined;
    if (!isVisible(type)) return undefined;
    if ((feature.get("properties") as Record<string, unknown> | undefined)?.visible === false) return undefined;
    const rawName = feature.get("label");
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
    const label = objectLabel(feature, type, name, themeId, opacity, overrides);
    let styles: Style | Style[];
    if (type === "terrain") {
      styles = [new Style({ fill: new Fill({ color: theme.land }), stroke: new Stroke({ color: theme.coastGlow, width: 7 }), zIndex: 10 }), new Style({ stroke: new Stroke({ color: theme.landInk, width: 1.6 }), zIndex: 11 })];
    } else if (type === "region") {
      const color = stringProperty(feature, ["fillColor", "color"], theme.region);
      styles = new Style({ fill: new Fill({ color: colorWithOpacity(color, 0.18) }), stroke: new Stroke({ color, width: 1.2 }), zIndex: 40 });
    } else if (type === "forest") {
      styles = new Style({ fill: new Fill({ color: `${theme.forest}26` }), stroke: new Stroke({ color: theme.forest, width: 1.2 }), zIndex: 20 });
    } else if (type === "mountain") {
      const scale = numericProperty(feature, "scale", 1, 0.25, 8);
      const rotation = numericProperty(feature, "rotation", 0, -Math.PI * 2, Math.PI * 2);
      const flipX = (feature.get("properties") as Record<string, unknown> | undefined)?.flipX === true;
      if (assetUrl) {
        styles = new Style({ image: new Icon({ src: assetUrl, scale: [flipX ? -scale : scale, scale], rotation }), text: label, zIndex: 75 });
      } else {
        const peak = (radius: number, displacementX: number, displacementY: number): Style => new Style({
          image: new RegularShape({
            points: 3,
            radius: radius * scale,
            angle: rotation,
            displacement: [displacementX * scale, displacementY * scale],
            fill: new Fill({ color: theme.land }),
            stroke: new Stroke({ color: theme.landInk, width: 1.6 }),
          }),
          zIndex: 75,
        });
        const side = flipX ? -1 : 1;
        styles = [
          peak(7, -side * 6, 2),
          peak(7, side * 6, 2),
          new Style({
            image: new RegularShape({ points: 3, radius: 10 * scale, angle: rotation, fill: new Fill({ color: theme.land }), stroke: new Stroke({ color: theme.landInk, width: 1.6 }) }),
            text: label,
            zIndex: 75,
          }),
        ];
      }
    } else if (type === "city") {
      styles = new Style({ image: new CircleStyle({ radius: 6, fill: new Fill({ color: theme.settlement }), stroke: new Stroke({ color: theme.labelHalo, width: 1.5 }) }), text: label, zIndex: 70 });
    } else if (type === "text") {
      styles = new Style({ image: new CircleStyle({ radius: 1, fill: new Fill({ color: "rgba(0,0,0,0)" }) }), text: label, zIndex: 80 });
    } else {
      styles = new Style({ image: new CircleStyle({ radius: 4.5, fill: new Fill({ color: theme.settlement }), stroke: new Stroke({ color: theme.labelHalo, width: 1.5 }) }), text: label, zIndex: 70 });
    }
    applyFeatureOpacity(styles, opacity);
    const zOffset = numericProperty(feature, "zIndex", 0, -1000, 1000);
    for (const style of Array.isArray(styles) ? styles : [styles]) style.setZIndex((style.getZIndex() ?? 0) + zOffset);
    featureStyles.set(feature as object, { key, styles });
    return styles;
  };
};

export const objectStyle = createObjectStyle();

export const createCellStyle = (getThemeId: () => MapThemeId = () => DEFAULT_MAP_THEME_ID, getThemeOverrides: () => ThemeOverrides = () => ({})): ((feature: FeatureLike) => Style | Style[] | undefined) => {
  type CachedStyle = { key: string; styles: Style | Style[] };
  const cellStyles = new WeakMap<object, CachedStyle>();
  return (feature: FeatureLike): Style | Style[] | undefined => {
    const attributes = feature.get("attributes") as CellAttributeSnapshot[] | undefined;
    const has = (attribute: CellAttributeSnapshot["attribute"]): boolean => attributes?.some((item) => cellAttributeLayer(item) === attribute) ?? false;
    const selected = feature.get("selected") === true;
    const preview = feature.get("preview") === true;
    const paintPreview = feature.get("paintPreview") === true;
    const erasePreview = feature.get("erasePreview") === true;
    const grabPreview = feature.get("grabPreview") === true;
    const grabSourceHidden = feature.get("grabSourceHidden") === true;
    const grabHover = feature.get("grabHover") === true;
    const hasTerrain = has("terrain");
    const hasRegion = has("region");
    if (!hasTerrain && !hasRegion && !selected && !preview && !paintPreview && !erasePreview && !grabPreview && !grabHover) return undefined;
    const themeId = getThemeId();
    const overrides = getThemeOverrides();
    const theme = mapTheme(themeId, overrides);
    const regionValue = attributes?.find((item) => cellAttributeLayer(item) === "region")?.value;
    const persistedRegionColor = typeof regionValue === "string" && /^#[\da-f]{6}$/i.test(regionValue) ? regionValue : theme.region;
    const regionAnimationOpacity = typeof feature.get("regionAnimationOpacity") === "number" && Number.isFinite(feature.get("regionAnimationOpacity"))
      ? Math.max(0, Math.min(1, feature.get("regionAnimationOpacity"))) : 1;
    const flags = (hasRegion ? 8 : 0) | (selected ? 16 : 0) | (hasTerrain ? 32 : 0) | (preview ? 64 : 0) | (paintPreview ? 128 : 0) | (erasePreview ? 256 : 0) | (grabPreview ? 512 : 0) | (grabSourceHidden ? 1024 : 0) | (grabHover ? 2048 : 0);
    const key = canonicalValueSignature({
      themeId,
      overrides,
      flags,
      regionValue: persistedRegionColor,
      regionAnimationOpacity,
    });
    const cached = cellStyles.get(feature as object);
    if (cached?.key === key) return cached.styles;
    const styles: Style[] = [];
    // Persisted terrain is rendered by MapAdapter as one derived, unfilled
    // outline. Cell features remain here for transient paint/erase feedback.
    if (!grabSourceHidden && hasRegion && (regionAnimationOpacity < 1 || grabPreview)) styles.push(new Style({ fill: new Fill({ color: colorWithOpacity(persistedRegionColor, 0.2 * regionAnimationOpacity) }), stroke: new Stroke({ color: colorWithOpacity(persistedRegionColor, 0.78 * regionAnimationOpacity), width: 1.1 }), zIndex: 10 }));
    if (grabPreview && hasRegion) styles.push(new Style({ fill: new Fill({ color: colorWithOpacity(persistedRegionColor, 0.28) }), stroke: new Stroke({ color: colorWithOpacity(persistedRegionColor, 0.95), width: 1.5, lineDash: [4, 2] }), zIndex: 88 }));
    if (grabPreview && hasTerrain && !hasRegion) styles.push(new Style({ fill: new Fill({ color: colorWithOpacity(theme.land, 0.2) }), stroke: new Stroke({ color: colorWithOpacity(theme.landInk, 0.95), width: 1.5, lineDash: [4, 2] }), zIndex: 88 }));
    if (grabHover) styles.push(new Style({ fill: new Fill({ color: "rgba(7, 140, 152, 0.08)" }), stroke: new Stroke({ color: "#078c98", width: 2, lineDash: [5, 3] }), zIndex: 87 }));
    if (selected) styles.push(new Style({ fill: new Fill({ color: paintPreview ? theme.land : "rgba(7, 140, 152, 0.16)" }), stroke: new Stroke({ color: paintPreview ? theme.landInk : "#078c98", width: 1.4 }), zIndex: 85 }));
    if (preview) styles.push(new Style({ fill: new Fill({ color: "rgba(7, 140, 152, 0.08)" }), stroke: new Stroke({ color: "#078c98", width: 1.2, lineDash: [3, 2] }), zIndex: 84 }));
    if (erasePreview) styles.push(new Style({ fill: new Fill({ color: "rgba(190, 66, 66, 0.14)" }), stroke: new Stroke({ color: "#be4242", width: 1.4, lineDash: [3, 2] }), zIndex: 86 }));
    if (styles.length === 0) return undefined;
    cellStyles.set(feature as object, { key, styles });
    return styles;
  };
};

export const cellStyle = createCellStyle();
