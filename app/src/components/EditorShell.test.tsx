import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRealmBackend, type FeatureType, type GeoJsonGeometry, type RealmSnapshot } from "../backend";

vi.mock("./MapCanvas", () => ({
  MapCanvas: ({
    mode,
    features,
    selectedFeatureId,
    onDraw,
    onSelect,
    onModify,
  }: {
    mode: "pan" | FeatureType;
    features: RealmSnapshot["features"];
    selectedFeatureId: string | null;
    onDraw: (geometry: GeoJsonGeometry) => void;
    onSelect: (id: string | null) => void;
    onModify: (id: string, geometry: GeoJsonGeometry) => void;
  }) => {
    const geometry = mode === "city" || mode === "town"
      ? { type: "Point" as const, coordinates: [1, 2] as [number, number] }
      : mode === "river" || mode === "coastline" || mode === "boundary"
        ? { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] as [number, number][] }
        : { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] as [number, number][][] };
    return <div role="region" aria-label="世界地図">
      <button type="button" onClick={() => onDraw(geometry)}>テスト描画</button>
      <button type="button" onClick={() => onSelect(features[0]?.id ?? null)}>テスト選択</button>
      <button type="button" onClick={() => { if (selectedFeatureId) onModify(selectedFeatureId, geometry); }}>テスト変形</button>
    </div>;
  },
  MapZoomControls: () => <div>ズーム</div>,
}));

import { EditorShell } from "./EditorShell";

function Harness({ backend, initial }: { backend: MemoryRealmBackend; initial: RealmSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  return <EditorShell snapshot={snapshot} backend={backend} busy={false} onCreate={vi.fn()} onOpen={vi.fn()} onClose={vi.fn()} onSaved={setSnapshot} />;
}

describe("EditorShell feature workflow", () => {
  it("creates, selects, renames, reshapes, deletes, undoes, and redoes a feature", async () => {
    const backend = new MemoryRealmBackend();
    const initial = await backend.createProject({ path: "browser://editor.realmmap", name: "Editor" });
    render(<Harness backend={backend} initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "都市" }));
    fireEvent.click(screen.getByRole("button", { name: "テスト描画" }));
    await waitFor(() => expect(screen.getByText("地物 1件")).toBeInTheDocument());
    expect((await backend.getOpenProject())?.features[0]?.featureType).toBe("city");

    fireEvent.click(screen.getByRole("button", { name: "テスト選択" }));
    const name = screen.getByRole("textbox", { name: "地物名" });
    fireEvent.change(name, { target: { value: "王都" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を保存" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /王都/u })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "テスト変形" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "元に戻す" })).toBeEnabled());

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() => expect(screen.getByText("地物はまだありません")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /王都/u })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    await waitFor(() => expect(screen.getByText("地物はまだありません")).toBeInTheDocument());
    confirm.mockRestore();
  });

  it("validates, saves, and removes chronology forms", async () => {
    const backend = new MemoryRealmBackend();
    const initial = await backend.createProject({ path: "browser://chronology.realmmap", name: "Chronology" });
    render(<Harness backend={backend} initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "時代を追加" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "開始年" }), { target: { value: "10" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "終了年" }), { target: { value: "9" } });
    expect(screen.getByRole("alert")).toHaveTextContent("時代の終了年");
    fireEvent.change(screen.getByRole("spinbutton", { name: "終了年" }), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "出来事を追加" }));
    const eventStarts = screen.getAllByRole("spinbutton", { name: "開始年" });
    const eventEnds = screen.getAllByRole("spinbutton", { name: "終了年" });
    fireEvent.change(eventStarts[1]!, { target: { value: "15" } });
    fireEvent.change(eventEnds[1]!, { target: { value: "14" } });
    expect(screen.getByRole("alert")).toHaveTextContent("出来事の終了年");
    fireEvent.change(eventEnds[1]!, { target: { value: "16" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("保存済み")).toBeInTheDocument());
    expect((await backend.getOpenProject())?.timelineEvents).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "この時代を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "この出来事を削除" }));
    expect(screen.getByText("時代はまだありません")).toBeInTheDocument();
    expect(screen.getByText("出来事はまだありません")).toBeInTheDocument();
  });
});
