import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRealmBackend, type FeatureType, type GeoJsonGeometry, type RealmSnapshot } from "../backend";

vi.mock("./MapCanvas", () => ({
  MapCanvas: ({
    mode,
    features,
    selectedFeatureId,
    onDraw,
    onSelect,
    onCellSelect,
    onModify,
    onExporterReady,
  }: {
    mode: "pan" | "cell-select" | FeatureType;
    features: RealmSnapshot["features"];
    selectedFeatureId: string | null;
    onDraw: (geometry: GeoJsonGeometry) => void;
    onSelect: (id: string | null) => void;
    onCellSelect: (ids: readonly string[]) => void;
    onModify: (id: string, geometry: GeoJsonGeometry) => void;
    onExporterReady?: (exporter: ((mimeType: "image/png" | "image/jpeg") => Promise<{ bytes: number[]; width: number; height: number }>) | null) => void;
  }) => {
    useEffect(() => {
      onExporterReady?.(async (mimeType) => ({
        bytes: mimeType === "image/png" ? [1, 2, 3] : [0xff, 0xd8, 0xff, 0xd9],
        width: 16,
        height: 9,
      }));
      return () => onExporterReady?.(null);
    }, [onExporterReady]);
    const geometry = mode === "city" || mode === "town"
      ? { type: "Point" as const, coordinates: [1, 2] as [number, number] }
      : mode === "river" || mode === "coastline" || mode === "boundary"
        ? { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] as [number, number][] }
        : { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] as [number, number][][] };
    return <div role="region" aria-label="世界地図">
      <button type="button" onClick={() => onDraw(geometry)}>テスト描画</button>
      <button type="button" onClick={() => onSelect(features[0]?.id ?? null)}>テスト選択</button>
      <button type="button" onClick={() => onCellSelect(["256:128", "257:128"])}>テストセル選択</button>
      <button type="button" onClick={() => { if (selectedFeatureId) onModify(selectedFeatureId, geometry); }}>テスト変形</button>
    </div>;
  },
  MapZoomControls: () => <div>ズーム</div>,
}));

import { EditorShell } from "./EditorShell";

function Harness({
  backend,
  initial,
  onExportTransfer = vi.fn(),
  onExportArtifact = vi.fn(),
}: {
  backend: MemoryRealmBackend;
  initial: RealmSnapshot;
  onExportTransfer?: () => Promise<void>;
  onExportArtifact?: (format: "png" | "pdf", bytes: number[]) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  return <EditorShell snapshot={snapshot} backend={backend} busy={false} onClose={vi.fn()} onSaved={setSnapshot} onExportTransfer={onExportTransfer} onExportArtifact={onExportArtifact} />;
}

describe("EditorShell feature workflow", () => {
  it("creates, selects, renames, reshapes, deletes, undoes, and redoes a feature", async () => {
    const backend = new MemoryRealmBackend();
    const initial = await backend.createProject({ path: "browser://editor.realmmap", name: "Editor" });
    render(<Harness backend={backend} initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "都市" }));
    expect(screen.getByText("地図上をクリックして都市を配置してください。")).toBeInTheDocument();
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

  it("selects cells and sends explicit attribute apply/clear commands", async () => {
    const backend = new MemoryRealmBackend();
    const initial = await backend.createProject({ path: "browser://cells.realmmap", name: "Cells" });
    const applyCellAttributes = vi.fn(async () => backend.getOpenProject().then((next) => next!));
    const cellBackend = Object.assign(backend, { applyCellAttributes });
    render(<Harness backend={cellBackend} initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "セル選択" }));
    fireEvent.click(screen.getByRole("button", { name: "テストセル選択" }));
    expect(screen.getByText("2件")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "適用" }));
    await waitFor(() => expect(applyCellAttributes).toHaveBeenCalledWith({
      year: 0,
      cellIds: ["256:128", "257:128"],
      attribute: "terrain_kind",
      value: "mountain",
    }));
    expect(screen.getByText("2件")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "解除" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "解除" }));
    await waitFor(() => expect(applyCellAttributes).toHaveBeenLastCalledWith({
      year: 0,
      cellIds: ["256:128", "257:128"],
      attribute: "terrain_kind",
      value: null,
    }));
  });

  it("explains drag drawing for line and area tools", async () => {
    const backend = new MemoryRealmBackend();
    const initial = await backend.createProject({ path: "browser://drag-help.realmmap", name: "Drag help" });
    render(<Harness backend={backend} initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "河川" }));
    expect(screen.getByText("地図上で押したままドラッグして河川を描いてください。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "地形" }));
    expect(screen.getByText("地図上で押したままドラッグして地形を描いてください。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "国" }));
    expect(screen.getByText("地形の上で押したままドラッグして国の領域を描いてください。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "地域" }));
    expect(screen.getByText("地形の上で押したままドラッグして地域の領域を描いてください。")).toBeInTheDocument();
  });

  it("exports the current map as PNG, PDF, and editable transfer data", async () => {
    const backend = new MemoryRealmBackend();
    const initial = await backend.createProject({ path: "browser://exports.realmmap", name: "Exports" });
    const onExportTransfer = vi.fn(async () => undefined);
    const onExportArtifact = vi.fn(async () => undefined);
    render(<Harness backend={backend} initial={initial} onExportTransfer={onExportTransfer} onExportArtifact={onExportArtifact} />);

    fireEvent.click(screen.getByRole("button", { name: "PNG" }));
    await waitFor(() => expect(onExportArtifact).toHaveBeenCalledWith("png", [1, 2, 3]));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(onExportArtifact).toHaveBeenCalledWith("pdf", expect.arrayContaining([0xff, 0xd8, 0xd9])));
    fireEvent.click(screen.getByRole("button", { name: "移行データ" }));
    await waitFor(() => expect(onExportTransfer).toHaveBeenCalledOnce());
  });

  it("reports export failures without discarding the open world", async () => {
    const backend = new MemoryRealmBackend();
    const initial = await backend.createProject({ path: "browser://export-error.realmmap", name: "Export error" });
    render(<Harness backend={backend} initial={initial} onExportTransfer={async () => { throw new Error("書き出しテストエラー"); }} />);
    fireEvent.click(screen.getByRole("button", { name: "移行データ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("書き出しテストエラー");
    expect(screen.getByRole("region", { name: "世界地図" })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("自動保存済み")).toBeInTheDocument());
    expect((await backend.getOpenProject())?.timelineEvents).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "この時代を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "この出来事を削除" }));
    expect(screen.getByText("時代はまだありません")).toBeInTheDocument();
    expect(screen.getByText("出来事はまだありません")).toBeInTheDocument();
  });
});
