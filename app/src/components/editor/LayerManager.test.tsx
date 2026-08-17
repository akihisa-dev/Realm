import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LayerId, MapObject, ObjectKind } from "../../backend";
import { LayerManager } from "./LayerManager";

const object: MapObject = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "city",
  label: "都市",
  geometry: { type: "Point", coordinates: [1, 2] },
  properties: {},
  zIndex: 0,
  locked: false,
};

const props = (activeLayer: LayerId, onLayerChange = vi.fn()) => ({
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
});

describe("LayerManager", () => {
  it("exposes three layer tabs and routes the active tab change", () => {
    const onLayerChange = vi.fn();
    render(<LayerManager {...props("terrain", onLayerChange)} />);

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("現在の地形そのもの");
    fireEvent.click(screen.getByRole("tab", { name: "オブジェクト" }));
    expect(onLayerChange).toHaveBeenCalledWith("object");
  });

  it("shows object operations only in the object tab", () => {
    const onKindChange = vi.fn();
    const onStartObjectDraw = vi.fn();
    const objectProps = { ...props("object"), onObjectKindChange: onKindChange, onStartObjectDraw };
    render(<LayerManager {...objectProps} />);

    expect(screen.getByRole("radio", { name: "都市" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "森" }));
    expect(onKindChange).toHaveBeenCalledWith("forest");
    fireEvent.click(screen.getByRole("button", { name: "キャンバスに配置" }));
    expect(onStartObjectDraw).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "都市を削除" })).toBeInTheDocument();
  });
});
