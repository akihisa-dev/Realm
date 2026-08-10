import type { FeatureLike } from "ol/Feature";
import Fill from "ol/style/Fill";
import CircleStyle from "ol/style/Circle";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import type { CellAttributeSnapshot, FeatureType } from "../backend";

export const MAP_LABEL_FONT = '12px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';

export const createFeatureStyle = (): ((feature: FeatureLike) => Style) => {
  const featureStyles = new Map<string, Style>();
  return (feature: FeatureLike): Style => {
    const type = feature.get("featureType") as FeatureType | undefined;
    const areaName = type === "country" || type === "region" ? feature.get("name") : null;
    const name = typeof areaName === "string" ? areaName : "";
    const key = `${type ?? "unknown"}\u0000${name}`;
    const cached = featureStyles.get(key);
    if (cached) return cached;
    const presentation = type === "terrain" ? { color: "#8b7754", fillAlpha: "28", zIndex: 10 }
      : type === "forest" ? { color: "#3f7c55", fillAlpha: "28", zIndex: 20 }
        : type === "country" ? { color: "#315f7d", fillAlpha: "24", zIndex: 30 }
          : type === "region" ? { color: "#76568c", fillAlpha: "1c", zIndex: 40 }
            : type === "river" || type === "coastline" ? { color: "#2e78a6", fillAlpha: "28", zIndex: 50 }
              : type === "boundary" ? { color: "#915f3d", fillAlpha: "28", zIndex: 60 }
                : { color: "#8a3f58", fillAlpha: "28", zIndex: 70 };
    const style = new Style({
      fill: new Fill({ color: `${presentation.color}${presentation.fillAlpha}` }),
      stroke: new Stroke({ color: presentation.color, width: type === "region" ? 1.75 : type === "boundary" ? 2 : 2.5, lineDash: type === "region" ? [5, 4] : undefined }),
      image: new CircleStyle({ radius: type === "city" ? 6 : 4.5, fill: new Fill({ color: presentation.color }), stroke: new Stroke({ color: "#fff", width: 1.5 }) }),
      text: name ? new Text({ text: name, font: type === "country" ? `600 ${MAP_LABEL_FONT}` : MAP_LABEL_FONT, overflow: true, fill: new Fill({ color: "#26323b" }), stroke: new Stroke({ color: "rgba(255, 255, 255, 0.92)", width: 3 }) }) : undefined,
      zIndex: presentation.zIndex,
    });
    featureStyles.set(key, style);
    return style;
  };
};

export const featureStyle = createFeatureStyle();

export const createCellStyle = (): ((feature: FeatureLike) => Style | Style[] | undefined) => {
  const cellStyles = new Map<number, Style | Style[]>();
  return (feature: FeatureLike): Style | Style[] | undefined => {
    const attributes = feature.get("attributes") as CellAttributeSnapshot[] | undefined;
    const has = (attribute: CellAttributeSnapshot["attribute"]): boolean => attributes?.some((item) => item.attribute === attribute) ?? false;
    const selected = feature.get("selected") === true;
    const showGrid = feature.get("showGrid") === true;
    const hasPhysical = has("forest");
    const hasCountry = has("country");
    const hasRegion = has("region");
    if (!showGrid && !hasPhysical && !hasCountry && !hasRegion && !selected) return undefined;
    const key = (showGrid ? 1 : 0) | (hasPhysical ? 2 : 0) | (hasCountry ? 4 : 0) | (hasRegion ? 8 : 0) | (selected ? 16 : 0);
    const cached = cellStyles.get(key);
    if (cached) return cached;
    const styles: Style[] = [new Style({ image: new CircleStyle({ radius: hasPhysical ? 2 : 1.25, fill: new Fill({ color: hasPhysical ? "#3f7c55" : "rgba(74, 87, 98, 0.24)" }) }), zIndex: 5 })];
    if (hasCountry) styles.push(new Style({ image: new CircleStyle({ radius: 3.4, fill: new Fill({ color: "rgba(49, 95, 125, 0.08)" }), stroke: new Stroke({ color: "#315f7d", width: 1.1 }) }), zIndex: 6 }));
    if (hasRegion) styles.push(new Style({ image: new CircleStyle({ radius: 4.4, fill: new Fill({ color: "rgba(118, 86, 140, 0.05)" }), stroke: new Stroke({ color: "#76568c", width: 1.1, lineDash: [3, 2] }) }), zIndex: 7 }));
    if (selected) styles.push(new Style({ image: new CircleStyle({ radius: 5.3, fill: new Fill({ color: "rgba(7, 140, 152, 0.08)" }), stroke: new Stroke({ color: "#078c98", width: 1.2 }) }), zIndex: 85 }));
    cellStyles.set(key, styles);
    return styles;
  };
};

export const cellStyle = createCellStyle();
