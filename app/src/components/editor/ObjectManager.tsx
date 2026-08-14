import { useState } from "react";
import type { RegionComponent, RegionObject } from "./regionObjects";

type ObjectManagerProps = {
  regions: readonly RegionObject[];
  selectedRegionIds: readonly string[];
  selectedComponentId: string | null;
  regionPaintTargetId: string | null;
  disabled?: boolean;
  onSelectRegion: (region: RegionObject) => void;
  onSelectionChange: (regionIds: readonly string[]) => void;
  onSelectComponent: (region: RegionObject, component: RegionComponent) => void;
  onStartNewRegion: () => void;
  onAddToRegion: (region: RegionObject) => void;
  onMergeRegions: () => void;
  onSplitComponent: (region: RegionObject, component: RegionComponent) => void;
  onClose: () => void;
};

export function ObjectManager({
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
  onClose,
}: ObjectManagerProps) {
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
    <aside className="object-manager" aria-label="オブジェクトマネージャー">
      <header className="object-manager-header">
        <div>
          <p className="object-manager-kicker">オブジェクト</p>
          <h2>オブジェクトマネージャー</h2>
        </div>
        <div className="object-manager-header-actions">
          <span className="object-manager-count" aria-label={`領域${regions.length}個`}>{regions.length}</span>
          <button className="object-manager-close" type="button" aria-label="右パネルを閉じる" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="object-manager-target" role="status" aria-label="領域の描画先">
        <span>描画先</span>
        <strong>{regionPaintTargetId ? regions.find((region) => region.id === regionPaintTargetId)?.label ?? "既存領域" : "新しい領域"}</strong>
      </div>

      <div className="object-manager-actions">
        <button type="button" onClick={onStartNewRegion} disabled={disabled}>新しい領域</button>
        <button type="button" onClick={onMergeRegions} disabled={disabled || selectedRegionIds.length < 2}>選択した領域を統合</button>
      </div>

      <section className="object-manager-section" aria-labelledby="object-manager-regions-heading">
        <div className="object-manager-section-heading">
          <h3 id="object-manager-regions-heading">領域</h3>
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
                    <input
                      type="checkbox"
                      checked={isSelected}
                      aria-label={`${region.label}を統合対象にする`}
                      onChange={() => toggleSelection(region.id)}
                      disabled={disabled}
                    />
                    <button className="object-manager-object" type="button" aria-pressed={isSelected} onClick={() => onSelectRegion(region)}>
                      <span className="object-manager-color" aria-hidden="true" style={{ backgroundColor: region.color }} />
                      <span className="object-manager-object-copy">
                        <strong>{region.label}</strong>
                        <small>{region.components.length}個の塊・{region.cellIds.length}セル</small>
                      </span>
                    </button>
                    <button
                      className="object-manager-expand"
                      type="button"
                      aria-label={`${region.label}の塊を${isExpanded ? "隠す" : "表示する"}`}
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpanded(region.id)}
                    >
                      {isExpanded ? "−" : "+"}
                    </button>
                    <button type="button" aria-label={`${region.label}に領域を追加`} onClick={() => onAddToRegion(region)} disabled={disabled || !canManage} title={canManage ? undefined : "永続IDのない旧形式の領域は、いったん描き直して管理できます。"}>
                      追加
                    </button>
                  </div>
                  {isExpanded ? (
                    <ul className="object-manager-components">
                      {region.components.map((component, index) => (
                        <li key={component.id} className="object-manager-component-row">
                          <button className="object-manager-component" type="button" aria-pressed={selectedComponentId === component.id} onClick={() => onSelectComponent(region, component)}>
                            <span>塊 {index + 1}</span>
                            <small>{component.cellIds.length}セル</small>
                          </button>
                          <button type="button" aria-label={`${region.label}の塊${index + 1}を分離`} onClick={() => onSplitComponent(region, component)} disabled={disabled || !canManage || region.components.length < 2} title={region.components.length < 2 ? "複数の塊がある領域で使えます。" : undefined}>
                            分離
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="object-manager-help">同じ領域に複数の離れた塊をまとめられます。2つ以上を選ぶと、1つの領域として統合できます。</p>
    </aside>
  );
}
