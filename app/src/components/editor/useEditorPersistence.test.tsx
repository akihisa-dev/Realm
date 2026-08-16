import { act, renderHook, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRealmBackend, type MapShape, type RealmSnapshot } from "../../backend";
import { cellIdsToPolygonGeometries } from "../../shared/mapShapeGeometry";
import { useEditorPersistence, type EditorPersistenceOptions } from "./useEditorPersistence";

const terrain = (cells: string[], id = "11111111-1111-4111-8111-111111111111"): MapShape => ({
  id,
  layer: "terrain",
  value: "terrain",
  geometryVersion: 1,
  snapGridVersion: 2,
  geometry: cellIdsToPolygonGeometries(cells)[0]!,
});

const hookProps = (snapshot: RealmSnapshot, backend: MemoryRealmBackend, onSaved = vi.fn(), onProjectChanged = vi.fn(), onOperationSettled = vi.fn()): EditorPersistenceOptions => ({
  snapshot,
  backend,
  busy: false,
  onSaved,
  onProjectChanged,
  onOperationSettled,
});

describe("useEditorPersistence", () => {
  it("serializes operations, reports saved snapshots, and resets on project changes", async () => {
    const backend = new MemoryRealmBackend();
    const first = await backend.createProject({ path: "browser://first.realmmap", name: "First" });
    const second = await backend.createProject({ path: "browser://second.realmmap", name: "Second" });
    const onSaved = vi.fn();
    const onProjectChanged = vi.fn();
    const onOperationSettled = vi.fn();
    const { result, rerender } = renderHook((props: EditorPersistenceOptions) => useEditorPersistence(props), { initialProps: hookProps(first, backend, onSaved, onProjectChanged, onOperationSettled) });
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstResult: RealmSnapshot | undefined;
    await act(async () => {
      const firstOperation = result.current.run(async () => {
        order.push("first:start");
        await firstGate;
        order.push("first:end");
        firstResult = { ...first, world: { ...first.world, name: "Saved" } };
        return firstResult;
      }, "保存に失敗しました。");
      const secondOperation = result.current.run(async () => {
        order.push("second");
        return { ...first, world: { ...first.world, name: "Second save" } };
      }, "保存に失敗しました。");
      await Promise.resolve();
      expect(order).toEqual(["first:start"]);
      releaseFirst?.();
      await Promise.all([firstOperation, secondOperation]);
    });
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(onOperationSettled).toHaveBeenCalledTimes(2);
    expect(result.current.viewedSnapshot.world.name).toBe("Second save");
    expect(firstResult).toBeDefined();

    act(() => { rerender(hookProps(second, backend, onSaved, onProjectChanged, onOperationSettled)); });
    expect(result.current.viewedSnapshot.path).toBe(second.path);
    expect(result.current.mapShapes).toEqual(second.mapShapes);
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
  });

  it("optimistically commits shapes, recovers a failed save, and reports local normalization errors", async () => {
    const backend = new MemoryRealmBackend();
    const snapshot = await backend.createProject({ path: "browser://failure.realmmap", name: "Failure" });
    const update = vi.spyOn(backend, "updateMapShapes").mockRejectedValue(new Error("synthetic failure"));
    const { result } = renderHook((props: EditorPersistenceOptions) => useEditorPersistence(props), { initialProps: hookProps(snapshot, backend) });
    const shape = terrain(["1:1", "1:2"]);

    act(() => { result.current.commitMapShapes([shape], "図形保存に失敗しました。"); });
    expect(result.current.mapShapes).toHaveLength(1);
    await waitFor(() => expect(result.current.error).toBe("図形保存に失敗しました。"));
    expect(result.current.mapShapes).toEqual([]);
    expect(result.current.locked).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);

    const invalid = { ...shape, geometry: { type: "Polygon" as const, coordinates: [] } };
    act(() => { result.current.commitMapShapes([invalid], "図形を正規化できませんでした。"); });
    expect(result.current.error).toBe("形状にグリッドセルがありません。");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("accepts the next map edit while saving and persists only the latest queued state", async () => {
    const backend = new MemoryRealmBackend();
    const snapshot = await backend.createProject({ path: "browser://queued.realmmap", name: "Queued" });
    const firstShape = terrain(["1:1"]);
    const secondShape = terrain(["2:2"]);
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const onSaved = vi.fn();
    const update = vi.spyOn(backend, "updateMapShapes").mockImplementation(async ({ shapes }) => {
      if (update.mock.calls.length === 1) await firstGate;
      return { ...snapshot, mapShapes: shapes };
    });
    const { result } = renderHook((props: EditorPersistenceOptions) => useEditorPersistence(props), { initialProps: hookProps(snapshot, backend, onSaved) });

    act(() => { result.current.commitMapShapes([firstShape], "保存に失敗しました。", { normalize: false }); });
    await waitFor(() => expect(result.current.saving).toBe(true));
    expect(result.current.editingLocked).toBe(false);

    act(() => { result.current.commitMapShapes([secondShape], "保存に失敗しました。", { normalize: false }); });
    expect(result.current.mapShapes).toEqual([secondShape]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.locked).toBe(true);

    releaseFirst?.();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(update.mock.calls[1]?.[0].shapes).toEqual([secondShape]);
    expect(result.current.viewedSnapshot.mapShapes).toEqual([secondShape]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("keeps stale failures from changing the current error and respects a busy editor", async () => {
    const backend = new MemoryRealmBackend();
    const snapshot = await backend.createProject({ path: "browser://stale.realmmap", name: "Stale" });
    const onOperationSettled = vi.fn();
    const { result, rerender } = renderHook((props: EditorPersistenceOptions) => useEditorPersistence(props), { initialProps: hookProps(snapshot, backend, vi.fn(), vi.fn(), onOperationSettled) });

    await act(async () => {
      await result.current.run(async () => { throw new Error("stale failure"); }, "現在の操作に失敗しました。", { isCurrent: () => false, recover: async () => undefined });
    });
    expect(result.current.error).toBeNull();
    expect(onOperationSettled).not.toHaveBeenCalled();

    act(() => { rerender({ ...hookProps(snapshot, backend), busy: true }); });
    expect(result.current.locked).toBe(true);
    act(() => { result.current.commitMapShapes([terrain(["2:2"])], "保存に失敗しました。"); });
    expect(result.current.mapShapes).toEqual([]);
  });
});
