import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActiveKind, LayerId, MapObject, ObjectKind } from "../../backend";
import { LayerManager } from "./LayerManager";

const object: MapObject = {
  id: "11111111-1111-4111-8111-111111111111",
  layerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "city",
  label: "都市",
  geometry: { type: "Point", coordinates: [1, 2] },
  properties: {},
  zIndex: 0,
  locked: false,
};

const LEAF_LAYER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const layerTree = { nodes: [{ id: LEAF_LAYER, parentId: null, kind: "leaf" as const, name: "レイヤー1", order: 0, visible: true, locked: false }] };
const props = (activeLayer: LayerId, onLayerChange = vi.fn(), activeKind: ActiveKind = "terrain") => ({
  activeLayer,
  onLayerChange,
  onClose: vi.fn(),
  terrainCount: 1,
  regions: [],
  selectedRegionIds: [],
  selectedComponentId: null,
  regionPaintTargetId: null,
  onSelectRegion: vi.fn(),
  onSelectionChange: vi.fn(),
  onSelectComponent: vi.fn(),
  onStartNewRegion: vi.fn(),
  onAddToRegion: vi.fn(),
  onMergeRegions: vi.fn(),
  onSplitComponent: vi.fn(),
  objects: [object],
  selectedObjectIds: [],
  objectKind: "city" as ObjectKind,
  objectLabel: "",
  onObjectKindChange: vi.fn(),
  onObjectLabelChange: vi.fn(),
  onStartObjectDraw: vi.fn(),
  onSelectObject: vi.fn(),
  onDeleteObject: vi.fn(),
  layerTree,
  selectedLeafId: activeLayer,
  activeKind,
});

describe("LayerManager", () => {
  it("exposes the hierarchical tree and selected leaf content", () => {
    const onLayerChange = vi.fn();
    render(<LayerManager {...props(LEAF_LAYER, onLayerChange)} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("tree", { name: "レイヤー階層" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "レイヤー1の名前" })).toHaveValue("レイヤー1");
    expect(screen.getByRole("treeitem")).toHaveAttribute("aria-selected", "true");
    expect(onLayerChange).not.toHaveBeenCalled();
  });

  it("keeps each layer name in one editable row and exposes compact actions", () => {
    const onLayerChange = vi.fn();
    const onDeleteLayerNode = vi.fn();
    render(<LayerManager {...props(LEAF_LAYER, onLayerChange)} onDeleteLayerNode={onDeleteLayerNode} />);

    fireEvent.focus(screen.getByRole("textbox", { name: "レイヤー1の名前" }));
    expect(onLayerChange).toHaveBeenCalledWith(LEAF_LAYER);
    expect(screen.getAllByDisplayValue("レイヤー1")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "レイヤー1を非表示" })).toHaveAttribute("title", "レイヤー1を非表示");
    fireEvent.click(screen.getByRole("button", { name: "レイヤー1を削除" }));
    expect(onDeleteLayerNode).toHaveBeenCalledWith(LEAF_LAYER);
  });

  it("distinguishes group rows from leaf rows", () => {
    const groupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const tree = { nodes: [
      { id: groupId, parentId: null, kind: "group" as const, name: "地形グループ", order: 0, visible: true, locked: false },
      { id: LEAF_LAYER, parentId: groupId, kind: "leaf" as const, name: "レイヤー1", order: 0, visible: true, locked: false },
    ] };
    render(<LayerManager {...props(LEAF_LAYER)} layerTree={tree} />);

    const treeItems = screen.getAllByRole("treeitem");
    expect(treeItems[0]).toHaveAttribute("aria-level", "1");
    expect(treeItems[1]).toHaveAttribute("aria-level", "2");
    expect(screen.getByRole("textbox", { name: "地形グループの名前" })).toHaveValue("地形グループ");
  });

  it("shows all selected-leaf content without classification controls", () => {
    render(<LayerManager {...props(LEAF_LAYER)} />);
    expect(screen.getByRole("heading", { name: "地形" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "領域" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "オブジェクト" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "都市" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "キャンバスに配置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "都市を削除" })).toBeInTheDocument();
  });
});
