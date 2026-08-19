import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MapObject, ObjectKind } from "../../backend";
import { ObjectLayerPanel } from "./ObjectLayerPanel";

const baseProps = {
  selectedObjectIds: [] as string[],
  objectKind: "city" as ObjectKind,
  objectLabel: "都市",
  onKindChange: vi.fn(),
  onLabelChange: vi.fn(),
  onStartDraw: vi.fn(),
  onSelect: vi.fn(),
  onDelete: vi.fn(),
};

const object = (overrides: Partial<MapObject> = {}): MapObject => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "city",
  label: "都市",
  geometry: { type: "Point", coordinates: [1, 2] },
  properties: {},
  zIndex: 0,
  locked: false,
  ...overrides,
});

describe("ObjectLayerPanel", () => {
  it("shows only management for already placed objects", () => {
    render(<ObjectLayerPanel {...baseProps} objects={[]} />);
    expect(screen.getByText("キャンバスに配置すると、ここに表示されます。")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ラベル")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "キャンバスに配置" })).not.toBeInTheDocument();
  });

  it("marks selected and locked objects, including an unknown kind label fallback", () => {
    const locked = object({ id: "22222222-2222-4222-8222-222222222222", label: "固定都市", locked: true });
    const unknown = object({ id: "33333333-3333-4333-8333-333333333333", label: "未知", kind: "unknown" as ObjectKind });
    render(<ObjectLayerPanel {...baseProps} objects={[locked, unknown]} selectedObjectIds={[locked.id]} />);

    expect(screen.getByRole("button", { name: "固定都市を選択" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "固定都市を削除" })).toBeDisabled();
    expect(screen.getByText("unknown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "未知を削除" }));
    expect(baseProps.onDelete).toHaveBeenCalledWith(unknown.id);
  });
});
