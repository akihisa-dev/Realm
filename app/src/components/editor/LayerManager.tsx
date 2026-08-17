import { ArrowDown } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { Eye } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlash } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { FolderSimple } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { Lock } from "@phosphor-icons/react/dist/csr/Lock";
import { LockOpen } from "@phosphor-icons/react/dist/csr/LockOpen";
import { Stack } from "@phosphor-icons/react/dist/csr/Stack";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { X } from "@phosphor-icons/react/dist/csr/X";
import type { CSSProperties, ReactNode } from "react";
import type { ActiveKind, LayerId, LayerNode, LayerTree, MapObject, ObjectKind } from "../../backend";
import type { RegionComponent, RegionEntry } from "./regionObjects";
import { RegionPanel } from "./RegionPanel";
import { ObjectLayerPanel } from "./ObjectLayerPanel";

type LayerManagerProps = {
  activeLayer: LayerId;
  onLayerChange: (layer: LayerId) => void;
  onClose: () => void;
  disabled?: boolean;
  contentDisabled?: boolean;
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
  layerTree?: LayerTree;
  selectedLeafId?: LayerId;
  activeKind?: ActiveKind;
  onActiveKindChange?: (kind: ActiveKind) => void;
  onLayerTreeChange?: (tree: LayerTree) => void;
  onAddLayerNode?: (kind: "group" | "leaf", parentId: LayerId | null) => void;
  onDeleteLayerNode?: (id: LayerId) => void;
  onShapeSelectedRegion?: () => void;
};

const kindOptions: readonly { id: ActiveKind; label: string }[] = [
  { id: "terrain", label: "地形" },
  { id: "region", label: "領域" },
  { id: "city", label: "都市" },
  { id: "text", label: "テキスト" },
  { id: "forest", label: "森" },
  { id: "mountain", label: "山" },
];

export function LayerManager({ activeLayer, onLayerChange, onClose, disabled = false, contentDisabled = disabled, terrainCount, regions, selectedRegionIds, selectedComponentId, regionPaintTargetId, onSelectRegion, onSelectionChange, onSelectComponent, onStartNewRegion, onAddToRegion, onMergeRegions, onSplitComponent, objects, selectedObjectIds, objectKind, objectLabel, onObjectKindChange, onObjectLabelChange, onStartObjectDraw, onSelectObject, onDeleteObject, layerTree, selectedLeafId, activeKind = "terrain", onActiveKindChange, onLayerTreeChange, onAddLayerNode, onDeleteLayerNode, onShapeSelectedRegion }: LayerManagerProps) {
  const treeNodes = layerTree?.nodes ?? [];
  const children = (parentId: LayerId | null): LayerNode[] => treeNodes.filter((node) => node.parentId === parentId).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const updateNode = (id: LayerId, changes: Partial<LayerNode>): void => {
    if (!layerTree || !onLayerTreeChange) return;
    onLayerTreeChange({ nodes: layerTree.nodes.map((node) => node.id === id ? { ...node, ...changes } : node) });
  };
  const shiftNode = (node: LayerNode, direction: -1 | 1): void => {
    const siblings = children(node.parentId); const index = siblings.findIndex((candidate) => candidate.id === node.id); const other = siblings[index + direction];
    if (!other) return;
    if (!layerTree || !onLayerTreeChange) return;
    onLayerTreeChange({ nodes: layerTree.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, order: other.order } : candidate.id === other.id ? { ...candidate, order: node.order } : candidate) });
  };
  const renderNode = (node: LayerNode, depth: number): ReactNode => {
    const nodeChildren = children(node.id);
    const siblings = children(node.parentId);
    const nodeIndex = siblings.findIndex((candidate) => candidate.id === node.id);
    const indentTarget = siblings.slice(0, nodeIndex).reverse().find((candidate) => candidate.kind === "group");
    return <div className="layer-tree-node" key={node.id} data-layer-id={node.id} role="treeitem" aria-level={depth + 1} aria-selected={selectedLeafId === node.id} style={{ "--layer-depth": depth } as CSSProperties}>
      <div className={`layer-tree-row${selectedLeafId === node.id ? " is-selected" : ""}${node.kind === "group" ? " is-group" : " is-leaf"}`}>
        <span className="layer-tree-kind" aria-hidden="true">{node.kind === "group" ? <FolderSimple size={16} weight="duotone" /> : <span className="layer-tree-leaf-mark" />}</span>
        <input className="layer-tree-name" aria-label={`${node.name}の名前`} title={`${node.name}の名前`} defaultValue={node.name} disabled={disabled} onFocus={() => node.kind === "leaf" && onLayerChange(node.id)} onBlur={(event) => { const name = event.target.value.trim() || node.name; event.target.value = name; updateNode(node.id, { name }); }} />
        <div className="layer-tree-controls" aria-label={`${node.name}の操作`}>
          <button type="button" className="layer-tree-icon-button" aria-label={`${node.name}を${node.visible ? "非表示" : "表示"}`} title={`${node.name}を${node.visible ? "非表示" : "表示"}`} aria-pressed={node.visible} onClick={() => updateNode(node.id, { visible: !node.visible })} disabled={disabled}>{node.visible ? <Eye aria-hidden="true" size={15} /> : <EyeSlash aria-hidden="true" size={15} />}</button>
          <button type="button" className="layer-tree-icon-button" aria-label={`${node.name}を${node.locked ? "編集可能" : "ロック"}`} title={`${node.name}を${node.locked ? "編集可能" : "ロック"}`} aria-pressed={node.locked} onClick={() => updateNode(node.id, { locked: !node.locked })} disabled={disabled}>{node.locked ? <Lock aria-hidden="true" size={15} /> : <LockOpen aria-hidden="true" size={15} />}</button>
          <button type="button" className="layer-tree-icon-button" aria-label={`${node.name}を上へ`} title={`${node.name}を上へ`} onClick={() => shiftNode(node, -1)} disabled={disabled}><ArrowUp aria-hidden="true" size={15} /></button>
          <button type="button" className="layer-tree-icon-button" aria-label={`${node.name}を下へ`} title={`${node.name}を下へ`} onClick={() => shiftNode(node, 1)} disabled={disabled}><ArrowDown aria-hidden="true" size={15} /></button>
          {node.parentId !== null ? <button type="button" className="layer-tree-icon-button" aria-label={`${node.name}を階層の外へ移動`} title={`${node.name}を階層の外へ移動`} onClick={() => { const parent = treeNodes.find((candidate) => candidate.id === node.parentId); const parentId = parent?.parentId ?? null; const order = Math.max(-1, ...children(parentId).map((candidate) => candidate.order)) + 1; updateNode(node.id, { parentId, order }); }} disabled={disabled}><ArrowLeft aria-hidden="true" size={15} /></button> : null}
          <button type="button" className="layer-tree-icon-button" aria-label={`${node.name}をグループ内へ移動`} title={`${node.name}をグループ内へ移動`} onClick={() => { if (!indentTarget) return; const order = Math.max(-1, ...children(indentTarget.id).map((candidate) => candidate.order)) + 1; updateNode(node.id, { parentId: indentTarget.id, order }); }} disabled={disabled || !indentTarget}><ArrowRight aria-hidden="true" size={15} /></button>
          {onDeleteLayerNode ? <button type="button" className="layer-tree-icon-button is-danger" aria-label={`${node.name}を削除`} title={`${node.name}を削除`} onClick={() => onDeleteLayerNode(node.id)} disabled={disabled}><Trash aria-hidden="true" size={15} /></button> : null}
        </div>
      </div>
      {nodeChildren.map((child) => renderNode(child, depth + 1))}
    </div>;
  };
  return (
    <aside className="layer-manager" aria-label="レイヤー管理">
      <header className="layer-manager-header"><div><p className="layer-manager-kicker">編集対象</p><h2>レイヤー</h2></div><button type="button" aria-label="右パネルを閉じる" title="右パネルを閉じる" onClick={onClose}><X aria-hidden="true" size={17} weight="bold" /></button></header>
      {layerTree ? <>
        <div className="layer-tree-actions"><button type="button" onClick={() => onAddLayerNode?.("group", selectedLeafId ?? null)} disabled={disabled}><FolderSimple aria-hidden="true" size={15} />グループ追加</button><button type="button" onClick={() => onAddLayerNode?.("leaf", selectedLeafId ?? null)} disabled={disabled}><Stack aria-hidden="true" size={15} />レイヤー追加</button></div>
        <div className="layer-tree" role="tree" aria-label="レイヤー階層">{children(null).map((node) => renderNode(node, 0))}</div>
      </> : <p className="layer-panel-empty">レイヤー階層を読み込めません。</p>}
      <div id={`layer-panel-${activeLayer}`} className="layer-manager-content" aria-label="選択レイヤーの内容">
        {layerTree ? <section className="layer-panel" aria-labelledby="selected-layer-heading"><div className="layer-panel-section-heading"><h3 id="selected-layer-heading">{layerTree.nodes.find((node) => node.id === selectedLeafId)?.name ?? "レイヤー"}</h3></div><p className="layer-panel-help">選択した末端レイヤーだけが新しい地物の保存先です。表示中の他のレイヤーは編集対象になりません。</p><div className="object-kind-options" role="radiogroup" aria-label="描く地物の種類">{kindOptions.map((option) => <button key={option.id} type="button" role="radio" aria-checked={activeKind === option.id} className={activeKind === option.id ? "is-active" : ""} onClick={() => onActiveKindChange?.(option.id)} disabled={contentDisabled}>{option.label}</button>)}</div></section> : null}
        {activeKind === "terrain" ? <section className="layer-panel" aria-labelledby="terrain-layer-heading"><div className="layer-panel-section-heading"><h3 id="terrain-layer-heading">地形</h3><span>{terrainCount}個</span></div><p className="layer-panel-help">選択した末端レイヤー内の地形を管理します。</p><p className="layer-panel-empty">「描く」の設定でグリッドまたは範囲を選べます。</p></section> : null}
        {activeKind === "region" ? <RegionPanel regions={regions} selectedRegionIds={selectedRegionIds} selectedComponentId={selectedComponentId} regionPaintTargetId={regionPaintTargetId} disabled={contentDisabled} onSelectRegion={onSelectRegion} onSelectionChange={onSelectionChange} onSelectComponent={onSelectComponent} onStartNewRegion={onStartNewRegion} onAddToRegion={onAddToRegion} onMergeRegions={onMergeRegions} onSplitComponent={onSplitComponent} onShapeSelectedRegion={onShapeSelectedRegion ?? (() => undefined)} onClose={() => undefined} embedded /> : null}
        {activeKind !== "terrain" && activeKind !== "region" ? <ObjectLayerPanel objects={objects} selectedObjectIds={selectedObjectIds} objectKind={objectKind} objectLabel={objectLabel} disabled={contentDisabled} onKindChange={onObjectKindChange} onLabelChange={onObjectLabelChange} onStartDraw={onStartObjectDraw} onSelect={onSelectObject} onDelete={onDeleteObject} /> : null}
      </div>
    </aside>
  );
}
