import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, type MapShape, type RealmBackend, type RealmSnapshot } from "../../backend";
import { normalizeMapShapes } from "../../shared/mapShapeGeometry";

type RunOptions = {
  recover?: (identity: string) => Promise<void>;
  isCurrent?: () => boolean;
};

type CommitMapShapesOptions = {
  normalize?: boolean;
};

type PendingMapShapeSave = {
  identity: string;
  generation: number;
  shapes: MapShape[];
  fallback: string;
};

export type EditorPersistenceOptions = {
  snapshot: RealmSnapshot;
  backend: RealmBackend;
  busy: boolean;
  onSaved: (snapshot: RealmSnapshot) => void;
  onProjectChanged?: () => void;
  onOperationSettled?: () => void;
};

const enqueueSerial = <T,>(tail: { current: Promise<void> }, action: () => Promise<T>): Promise<T> => {
  const result = tail.current.then(action, action);
  tail.current = result.then(() => undefined, () => undefined);
  return result;
};

/**
 * Owns editor persistence ordering and stale-project protection.  The shell
 * remains responsible for selection and presentation state, while every
 * backend operation crosses this one serialized boundary.
 */
export function useEditorPersistence({
  snapshot,
  backend,
  busy,
  onSaved,
  onProjectChanged,
  onOperationSettled,
}: EditorPersistenceOptions) {
  const projectIdentity = `${snapshot.path}:${snapshot.world.id}`;
  const [viewedSnapshot, setViewedSnapshot] = useState(snapshot);
  const [mapShapes, setMapShapes] = useState<MapShape[]>(snapshot.mapShapes ?? []);
  const [operating, setOperating] = useState(false);
  const [savingMapShapes, setSavingMapShapes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewedIdentity = useRef(projectIdentity);
  const mounted = useRef(true);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const mapShapeSavePending = useRef<PendingMapShapeSave | null>(null);
  const mapShapeSaveRunning = useRef(false);
  const mapShapeSaveGeneration = useRef(0);
  const onProjectChangedRef = useRef(onProjectChanged);
  const onOperationSettledRef = useRef(onOperationSettled);
  onProjectChangedRef.current = onProjectChanged;
  onOperationSettledRef.current = onOperationSettled;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    const identityChanged = viewedIdentity.current !== projectIdentity;
    viewedIdentity.current = projectIdentity;
    setViewedSnapshot(snapshot);
    if (identityChanged) {
      mapShapeSaveGeneration.current += 1;
      mapShapeSavePending.current = null;
      setMapShapes(snapshot.mapShapes ?? []);
      setError(null);
      onProjectChangedRef.current?.();
    }
  }, [projectIdentity, snapshot]);

  const recoverMapShapes = useCallback(async (identity: string): Promise<void> => {
    const openSnapshot = await backend.getOpenProject();
    if (mounted.current && viewedIdentity.current === identity && openSnapshot) setMapShapes(openSnapshot.mapShapes ?? []);
  }, [backend]);

  /**
   * Saves only the latest optimistic map state after the current write ends.
   * Pointer edits stay local and responsive while SQLite/IPC work is in flight;
   * intermediate states are safe to skip because each request replaces the
   * complete current map-shape set.
   */
  const flushMapShapeSaves = useCallback(async (): Promise<void> => {
    if (mapShapeSaveRunning.current) return;
    mapShapeSaveRunning.current = true;
    setSavingMapShapes(true);
    try {
      while (mounted.current) {
        const pending = mapShapeSavePending.current;
        if (!pending) break;
        mapShapeSavePending.current = null;
        if (pending.identity !== viewedIdentity.current) continue;
        const isLatest = (): boolean => mounted.current
          && viewedIdentity.current === pending.identity
          && mapShapeSaveGeneration.current === pending.generation;
        try {
          const next = await backend.updateMapShapes({ shapes: pending.shapes });
          if (!isLatest()) continue;
          setViewedSnapshot(next);
          // The optimistic state is already visible. Avoid replacing it with
          // an equivalent array and triggering a second renderer pass.
          onSaved(next);
          onOperationSettledRef.current?.();
        } catch (cause) {
          if (!isLatest()) continue;
          await recoverMapShapes(pending.identity);
          if (isLatest()) setError(errorMessage(cause, pending.fallback));
        }
      }
    } finally {
      mapShapeSaveRunning.current = false;
      if (mounted.current) setSavingMapShapes(false);
      if (mounted.current && mapShapeSavePending.current !== null) void flushMapShapeSaves();
    }
  }, [backend, onSaved, recoverMapShapes]);

  const run = useCallback(async (
    action: () => Promise<RealmSnapshot>,
    fallback: string,
    options: RunOptions = {},
  ): Promise<void> => {
    await enqueueSerial(commandTail, async () => {
      const identity = viewedIdentity.current;
      setOperating(true);
      setError(null);
      try {
        if (!mounted.current || viewedIdentity.current !== identity) return;
        const next = await action();
        if (!mounted.current || viewedIdentity.current !== identity) return;
        setViewedSnapshot(next);
        setMapShapes(next.mapShapes ?? []);
        onSaved(next);
        if (!options.isCurrent || options.isCurrent()) onOperationSettledRef.current?.();
      } catch (cause) {
        if (mounted.current && viewedIdentity.current === identity) {
          if (options.recover) await options.recover(identity);
          if (mounted.current && viewedIdentity.current === identity && (!options.isCurrent || options.isCurrent())) setError(errorMessage(cause, fallback));
        }
      } finally {
        if (mounted.current) setOperating(false);
      }
    });
  }, [onSaved]);

  const commitMapShapes = useCallback((next: readonly MapShape[], fallback: string, options: CommitMapShapesOptions = {}): void => {
    if (busy || operating) return;
    let shapes: MapShape[];
    try {
      const copied = next.map((shape) => ({
        ...shape,
        geometry: {
          type: "Polygon" as const,
          coordinates: shape.geometry.coordinates.map((ring) => ring.map(([x, y]) => [x, y] as [number, number])),
        },
      }));
      shapes = options.normalize === false ? copied : normalizeMapShapes(copied);
    } catch (cause) {
      setError(errorMessage(cause, fallback));
      return;
    }
    const identity = viewedIdentity.current;
    const generation = mapShapeSaveGeneration.current + 1;
    mapShapeSaveGeneration.current = generation;
    mapShapeSavePending.current = { identity, generation, shapes, fallback };
    setError(null);
    setMapShapes(shapes);
    void flushMapShapeSaves();
  }, [busy, flushMapShapeSaves, operating]);

  return {
    viewedSnapshot,
    mapShapes,
    setMapShapes,
    operating,
    saving: savingMapShapes,
    error,
    setError,
    locked: busy || operating || savingMapShapes,
    editingLocked: busy || operating,
    run,
    commitMapShapes,
  };
}
