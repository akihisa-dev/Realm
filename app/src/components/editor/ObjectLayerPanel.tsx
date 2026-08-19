import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import type { MapObject } from "../../backend";

type ObjectLayerPanelProps = {
  objects: readonly MapObject[];
  selectedObjectIds: readonly string[];
  disabled?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

export function ObjectLayerPanel({ objects, selectedObjectIds, disabled = false, onSelect, onDelete }: ObjectLayerPanelProps) {
  const selected = new Set(selectedObjectIds);
  return (
    <section className="layer-panel object-layer-panel" aria-labelledby="object-layer-heading">
      <div className="layer-panel-section-heading"><h3 id="object-layer-heading">オブジェクト</h3><span>{objects.length}個</span></div>
      <p className="layer-panel-help">地形や領域の上に置く都市、テキスト、森、山を管理します。オブジェクト同士の重なりは許可されます。</p>
      <div className="layer-panel-section-heading"><h4>配置済み</h4><span>{objects.length}個</span></div>
      {objects.length === 0 ? <p className="layer-panel-empty">キャンバスに配置すると、ここに表示されます。</p> : (
        <ul className="layer-object-list">
          {objects.map((object) => <li key={object.id} className={selected.has(object.id) ? "is-selected" : ""}>
            <button type="button" onClick={() => onSelect(object.id)} aria-label={`${object.label}を選択`} aria-pressed={selected.has(object.id)} disabled={disabled}><strong>{object.label}</strong><small>{({ city: "都市", text: "テキスト", forest: "森", mountain: "山" } as Record<string, string>)[object.kind] ?? object.kind}</small></button>
            <button type="button" aria-label={`${object.label}を削除`} onClick={() => onDelete(object.id)} disabled={disabled || object.locked}><Trash aria-hidden="true" size={16} weight="bold" /></button>
          </li>)}
        </ul>
      )}
    </section>
  );
}
