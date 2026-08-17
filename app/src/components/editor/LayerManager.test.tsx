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
    expect(screen.getByRole("button", { name: "レイヤー1" })).toHaveAttribute("aria-current", "true");
    expect(onLayerChange).not.toHaveBeenCalled();
  });

  it("shows object kind operations in the selected leaf panel", () => {
    const onKindChange = vi.fn();
    const onStartObjectDraw = vi.fn();
    const objectProps = { ...props(LEAF_LAYER, vi.fn(), "city"), onObjectKindChange: onKindChange, onStartObjectDraw };
    render(<LayerManager {...objectProps} />);

    const cityRadio = screen.getAllByRole("radio", { name: "都市" }).at(-1)!;
    fireEvent.click(cityRadio);
    expect(cityRadio).toBeChecked();
    fireEvent.click(screen.getAllByRole("radio", { name: "森" }).at(-1)!);
    expect(onKindChange).toHaveBeenCalledWith("forest");
    fireEvent.click(screen.getByRole("button", { name: "キャンバスに配置" }));
    expect(onStartObjectDraw).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "都市を削除" })).toBeInTheDocument();
  });
});
