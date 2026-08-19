import { useState } from "react";
import { ArrowsMerge } from "@phosphor-icons/react/dist/csr/ArrowsMerge";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { PlusCircle } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { Scissors } from "@phosphor-icons/react/dist/csr/Scissors";
import { Magnet } from "@phosphor-icons/react/dist/csr/Magnet";
import { X } from "@phosphor-icons/react/dist/csr/X";
import type { RegionComponent, RegionEntry } from "./regionObjects";

export type RegionPanelProps = {
  regions: readonly RegionEntry[];
  selectedRegionIds: readonly string[];
  selectedComponentId: string | null;
  regionPaintTargetId: string | null;
  disabled?: boolean;
  onSelectRegion: (region: RegionEntry) => void;
  onSelectionChange: (regionIds: readonly string[]) => void;
  onSelectComponent: (region: RegionEntry, component: RegionComponent) => void;
  onStartNewRegion: () => void;
  onAddToRegion: (region: RegionEntry) => void;
  onMergeRegions: () => void;
  onSplitComponent: (region: RegionEntry, component: RegionComponent) => void;
  onShapeSelectedRegion?: () => void;
  onClose: () => void;
  embedded?: boolean;
};

export function RegionPanel({
  regions,
  selectedRegionIds,
  selectedComponentId,
  regionPaintTargetId,
  disabled = false,
  onSelectRegion,
  onSelectionChange,
  onSelectComponent,
  onStartNewRegion,
  onAddToRegion,
  onMergeRegions,
  onSplitComponent,
  onShapeSelectedRegion,
  onClose,
  embedded = false,
}: RegionPanelProps) {
  const [expandedRegionIds, setExpandedRegionIds] = useState<Set<string>>(() => new Set());
  const selected = new Set(selectedRegionIds);
  const toggleSelection = (regionId: string) => {
    const next = new Set(selected);
    if (next.has(regionId)) next.delete(regionId);
    else next.add(regionId);
    onSelectionChange([...next]);
  };
  const toggleExpanded = (regionId: string) => {
    setExpandedRegionIds((current) => {
      const next = new Set(current);
      if (next.has(regionId)) next.delete(regionId);
      else next.add(regionId);
      return next;
    });
  };

  return (
    <section className="object-manager region-panel" aria-label="領域レイヤー管理">
      {!embedded ? <header className="object-manager-header">
        <div>
          <p className="object-manager-kicker">領域レイヤー</p>
          <h2>領域管理</h2>
        </div>
        <div className="object-manager-header-actions">
          <span className="object-manager-count" aria-label={`領域${regions.length}個`}>{regions.length}</span>
          <button className="object-manager-close" type="button" aria-label="右パネルを閉じる" title="右パネルを閉じる" onClick={onClose}><X aria-hidden="true" size={17} weight="bold" /></button>
        </div>
      </header> : null}

      <div className="object-manager-target" role="status" aria-label="領域の描画先">
        <span>描画先</span>
        <strong>{regionPaintTargetId ? regions.find((region) => region.id === regionPaintTargetId)?.label ?? "既存領域" : "新しい領域"}</strong>
      </div>

      <div className="object-manager-actions">
        {!embedded ? <button type="button" aria-label="新しい領域" title="新しい領域" onClick={onStartNewRegion} disabled={disabled}><PlusCircle aria-hidden="true" size={18} weight="bold" /></button> : null}
        <button type="button" aria-label="選択した領域を統合" title="選択した領域を統合" onClick={onMergeRegions} disabled={disabled || selectedRegionIds.length < 2}><ArrowsMerge aria-hidden="true" size={18} weight="bold" /></button>
        <button type="button" aria-label="選択した領域を地形に合わせる" title="選択した領域を地形に合わせる" onClick={onShapeSelectedRegion} disabled={disabled || selectedRegionIds.length === 0}><Magnet aria-hidden="true" size={18} weight="bold" /></button>
      </div>

      <section className="object-manager-section" aria-labelledby="region-panel-heading">
        <div className="object-manager-section-heading">
          <h3 id="region-panel-heading">領域</h3>
          <span>{regions.length}個</span>
        </div>
        {regions.length === 0 ? (
          <p className="object-manager-empty">地図で領域を描くと、ここで一塊として管理できます。</p>
        ) : (
          <ul className="object-manager-list">
            {regions.map((region) => {
              const isSelected = selected.has(region.id);
              const isExpanded = expandedRegionIds.has(region.id);
              const canManage = region.persistentId !== null;
              return (
                <li className={`object-manager-item${isSelected ? " is-selected" : ""}${regionPaintTargetId === region.id ? " is-target" : ""}`} key={region.id}>
                  <div className="object-manager-row">
                    <input type="checkbox" checked={isSelected} aria-label={`${region.label}を統合対象にする`} onChange={() => toggleSelection(region.id)} disabled={disabled} />
                    <button className="object-manager-object" type="button" aria-pressed={isSelected} onClick={() => onSelectRegion(region)} disabled={disabled}>
                      <span className="object-manager-color" aria-hidden="true" style={{ backgroundColor: region.color }} />
                      <span className="object-manager-object-copy"><strong>{region.label}</strong><small>{region.components.length}個の塊・{region.cellIds.length}セル</small></span>
                    </button>
                    <button className="object-manager-expand" type="button" aria-label={`${region.label}の塊を${isExpanded ? "隠す" : "表示する"}`} title={`${region.label}の塊を${isExpanded ? "隠す" : "表示する"}`} aria-expanded={isExpanded} onClick={() => toggleExpanded(region.id)} disabled={disabled}>
                      {isExpanded ? <CaretDown aria-hidden="true" size={16} weight="bold" /> : <CaretRight aria-hidden="true" size={16} weight="bold" />}
                    </button>
                    <button type="button" aria-label={`${region.label}に領域を追加`} onClick={() => onAddToRegion(region)} disabled={disabled || !canManage} title={canManage ? `${region.label}に領域を追加` : "永続IDのない領域は、いったん描き直して管理できます。"}>
                      <Plus aria-hidden="true" size={16} weight="bold" />
                    </button>
                  </div>
                  {isExpanded ? <ul className="object-manager-components">
                    {region.components.map((component, index) => <li key={component.id} className="object-manager-component-row">
                      <button className="object-manager-component" type="button" aria-pressed={selectedComponentId === component.id} onClick={() => onSelectComponent(region, component)} disabled={disabled}><span>塊 {index + 1}</span><small>{component.cellIds.length}セル</small></button>
                      <button type="button" aria-label={`${region.label}の塊${index + 1}を分離`} onClick={() => onSplitComponent(region, component)} disabled={disabled || !canManage || region.components.length < 2} title={region.components.length < 2 ? "複数の塊がある領域で使えます。" : `${region.label}の塊${index + 1}を分離`}><Scissors aria-hidden="true" size={16} weight="bold" /></button>
                    </li>)}
                  </ul> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="object-manager-help">同じ領域に複数の離れた塊をまとめられます。2つ以上を選ぶと、1つの領域として統合できます。</p>
    </section>
  );
}
