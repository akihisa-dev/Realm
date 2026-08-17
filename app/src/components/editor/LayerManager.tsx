import { X } from "@phosphor-icons/react/dist/csr/X";
import type { LayerId, MapObject, ObjectKind } from "../../backend";
import type { RegionComponent, RegionEntry } from "./regionObjects";
import { RegionPanel } from "./RegionPanel";
import { ObjectLayerPanel } from "./ObjectLayerPanel";

type LayerManagerProps = {
  activeLayer: LayerId;
  onLayerChange: (layer: LayerId) => void;
  onClose: () => void;
  disabled?: boolean;
  terrainCount: number;
  regions: readonly RegionEntry[];
  selectedRegionIds: readonly string[];
  selectedComponentId: string | null;
  regionPaintTargetId: string | null;
  onSelectRegion: (region: RegionEntry) => void;
  onSelectionChange: (ids: readonly string[]) => void;
  onSelectComponent: (region: RegionEntry, component: RegionComponent) => void;
  onStartNewRegion: () => void;
  onAddToRegion: (region: RegionEntry) => void;
  onMergeRegions: () => void;
  onSplitComponent: (region: RegionEntry, component: RegionComponent) => void;
  objects: readonly MapObject[];
  selectedObjectIds: readonly string[];
  objectKind: ObjectKind;
  objectLabel: string;
  onObjectKindChange: (kind: ObjectKind) => void;
  onObjectLabelChange: (label: string) => void;
  onStartObjectDraw: () => void;
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
};

const tabs: readonly { id: LayerId; label: string }[] = [{ id: "terrain", label: "地形" }, { id: "region", label: "領域" }, { id: "object", label: "オブジェクト" }];

export function LayerManager({ activeLayer, onLayerChange, onClose, disabled = false, terrainCount, regions, selectedRegionIds, selectedComponentId, regionPaintTargetId, onSelectRegion, onSelectionChange, onSelectComponent, onStartNewRegion, onAddToRegion, onMergeRegions, onSplitComponent, objects, selectedObjectIds, objectKind, objectLabel, onObjectKindChange, onObjectLabelChange, onStartObjectDraw, onSelectObject, onDeleteObject }: LayerManagerProps) {
  return (
    <aside className="layer-manager" aria-label="レイヤー管理">
      <header className="layer-manager-header"><div><p className="layer-manager-kicker">編集対象</p><h2>レイヤー</h2></div><button type="button" aria-label="右パネルを閉じる" title="右パネルを閉じる" onClick={onClose}><X aria-hidden="true" size={17} weight="bold" /></button></header>
      <div className="layer-tabs" role="tablist" aria-label="編集レイヤー">
        {tabs.map((tab) => <button key={tab.id} id={`layer-tab-${tab.id}`} type="button" role="tab" aria-selected={activeLayer === tab.id} aria-controls={`layer-panel-${tab.id}`} className={activeLayer === tab.id ? "is-active" : ""} onClick={() => onLayerChange(tab.id)} disabled={disabled}>{tab.label}</button>)}
      </div>
      <div id={`layer-panel-${activeLayer}`} role="tabpanel" aria-labelledby={`layer-tab-${activeLayer}`} className="layer-manager-content">
        {activeLayer === "terrain" ? <section className="layer-panel" aria-labelledby="terrain-layer-heading"><div className="layer-panel-section-heading"><h3 id="terrain-layer-heading">地形</h3><span>{terrainCount}個</span></div><p className="layer-panel-help">現在の地形そのものを編集します。六角グリッドへ吸着した地形ポリゴンを管理します。</p><p className="layer-panel-empty">左のレールの「グリッド描画」または「範囲描画」で編集できます。</p></section> : null}
        {activeLayer === "region" ? <RegionPanel regions={regions} selectedRegionIds={selectedRegionIds} selectedComponentId={selectedComponentId} regionPaintTargetId={regionPaintTargetId} disabled={disabled} onSelectRegion={onSelectRegion} onSelectionChange={onSelectionChange} onSelectComponent={onSelectComponent} onStartNewRegion={onStartNewRegion} onAddToRegion={onAddToRegion} onMergeRegions={onMergeRegions} onSplitComponent={onSplitComponent} onClose={() => undefined} embedded /> : null}
        {activeLayer === "object" ? <ObjectLayerPanel objects={objects} selectedObjectIds={selectedObjectIds} objectKind={objectKind} objectLabel={objectLabel} disabled={disabled} onKindChange={onObjectKindChange} onLabelChange={onObjectLabelChange} onStartDraw={onStartObjectDraw} onSelect={onSelectObject} onDelete={onDeleteObject} /> : null}
      </div>
    </aside>
  );
}
