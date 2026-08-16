import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import type { MapObject, ObjectKind } from "../../backend";

const kinds: readonly { id: ObjectKind; label: string }[] = [
  { id: "city", label: "都市" },
  { id: "text", label: "テキスト" },
  { id: "forest", label: "森" },
  { id: "mountain", label: "山" },
];

type ObjectLayerPanelProps = {
  objects: readonly MapObject[];
  selectedObjectIds: readonly string[];
  objectKind: ObjectKind;
  objectLabel: string;
  disabled?: boolean;
  onKindChange: (kind: ObjectKind) => void;
  onLabelChange: (label: string) => void;
  onStartDraw: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

export function ObjectLayerPanel({ objects, selectedObjectIds, objectKind, objectLabel, disabled = false, onKindChange, onLabelChange, onStartDraw, onSelect, onDelete }: ObjectLayerPanelProps) {
  const selected = new Set(selectedObjectIds);
  return (
    <section className="layer-panel object-layer-panel" aria-labelledby="object-layer-heading">
      <div className="layer-panel-section-heading"><h3 id="object-layer-heading">オブジェクト</h3><span>{objects.length}個</span></div>
      <p className="layer-panel-help">地形や領域の上に置く都市、テキスト、森、山を管理します。オブジェクト同士の重なりは許可されます。</p>
      <div className="object-kind-options" role="radiogroup" aria-label="配置するオブジェクトの種類">
        {kinds.map((kind) => <button key={kind.id} type="button" role="radio" aria-checked={objectKind === kind.id} className={objectKind === kind.id ? "is-active" : ""} onClick={() => onKindChange(kind.id)} disabled={disabled}>{kind.label}</button>)}
      </div>
      <label className="object-label-field" htmlFor="object-layer-label">ラベル<input id="object-layer-label" value={objectLabel} onChange={(event) => onLabelChange(event.target.value)} disabled={disabled} /></label>
      <button className="layer-primary-action" type="button" onClick={onStartDraw} disabled={disabled}>キャンバスに配置</button>
      <div className="layer-panel-section-heading"><h4>配置済み</h4><span>{objects.length}個</span></div>
      {objects.length === 0 ? <p className="layer-panel-empty">キャンバスに配置すると、ここに表示されます。</p> : (
        <ul className="layer-object-list">
          {objects.map((object) => <li key={object.id} className={selected.has(object.id) ? "is-selected" : ""}>
            <button type="button" onClick={() => onSelect(object.id)} aria-label={`${object.label}を選択`} aria-pressed={selected.has(object.id)} disabled={disabled}><strong>{object.label}</strong><small>{kinds.find((kind) => kind.id === object.kind)?.label ?? object.kind}</small></button>
            <button type="button" aria-label={`${object.label}を削除`} onClick={() => onDelete(object.id)} disabled={disabled || object.locked}><Trash aria-hidden="true" size={16} weight="bold" /></button>
          </li>)}
        </ul>
      )}
    </section>
  );
}
