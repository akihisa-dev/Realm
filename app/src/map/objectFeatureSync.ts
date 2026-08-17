import Feature from "ol/Feature";
import VectorSource from "ol/source/Vector";
import type { ActiveKind, LayerId, LayerTree, MapObject } from "../backend";
import { contentKindOf } from "../backend";
import { flattenLayerTree } from "../shared/layerTree";
import { geometryFromGeoJson } from "./geoJsonGeometry";

export type RenderLayerState = { visible: boolean; locked: boolean; renderOrder: number };

export const renderLayerStates = (tree: LayerTree): Map<string, RenderLayerState> => new Map(
  flattenLayerTree(tree).map((node) => [node.id, { visible: node.effectiveVisible, locked: node.effectiveLocked, renderOrder: node.renderOrder }]),
);

export const applyObjectLayerStates = (source: VectorSource, states: ReadonlyMap<string, RenderLayerState>): void => {
  for (const feature of source.getFeatures()) {
    const state = states.get(String(feature.get("layerId")));
    feature.set("layerVisible", state?.visible !== false, true);
    feature.set("layerLocked", state?.locked === true, true);
  }
};

export const syncObjectFeatures = (source: VectorSource, objects: readonly MapObject[], activeLayer: LayerId, activeKind: ActiveKind, states: ReadonlyMap<string, RenderLayerState>): void => {
  const desiredIds = new Set(objects.map((object) => object.id));
  for (const rendered of source.getFeatures()) {
    const id = rendered.getId();
    if (typeof id !== "string" || !desiredIds.has(id)) source.removeFeature(rendered);
  }
  const additions: Feature[] = [];
  for (const snapshot of objects) {
    const layerId = snapshot.layerId ?? (contentKindOf(activeKind) === "object" ? activeLayer : undefined);
    const state = states.get(layerId ?? "");
    const snapshotKey = JSON.stringify([layerId ?? null, snapshot.kind, snapshot.label, snapshot.geometry, snapshot.properties, snapshot.locked, snapshot.zIndex, snapshot.assetId ?? null, state?.visible, state?.locked]);
    const found = source.getFeatureById(snapshot.id);
    const rendered = Array.isArray(found) ? found[0] : found;
    if (rendered) {
      if (rendered.get("snapshotKey") === snapshotKey) continue;
      rendered.setGeometry(geometryFromGeoJson(snapshot.geometry));
      for (const [key, value] of Object.entries({ kind: snapshot.kind, label: snapshot.label, properties: snapshot.properties, locked: snapshot.locked, zIndex: snapshot.zIndex, assetId: snapshot.assetId, layerId, layerVisible: state?.visible !== false, layerLocked: state?.locked === true, snapshotKey })) rendered.set(key, value, true);
      rendered.changed();
      continue;
    }
    const created = new Feature({ geometry: geometryFromGeoJson(snapshot.geometry), layerId, layerVisible: state?.visible !== false, layerLocked: state?.locked === true, kind: snapshot.kind, label: snapshot.label, properties: snapshot.properties, locked: snapshot.locked, zIndex: snapshot.zIndex, assetId: snapshot.assetId, snapshotKey });
    created.setId(snapshot.id);
    additions.push(created);
  }
  if (additions.length > 0) source.addFeatures(additions);
};
