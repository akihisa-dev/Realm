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
  const [error, setError] = useState<string | null>(null);
  const viewedIdentity = useRef(projectIdentity);
  const mounted = useRef(true);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
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
      setMapShapes(snapshot.mapShapes ?? []);
      setError(null);
      onProjectChangedRef.current?.();
    }
  }, [projectIdentity, snapshot]);

  const recoverMapShapes = useCallback(async (identity: string): Promise<void> => {
    const openSnapshot = await backend.getOpenProject();
    if (mounted.current && viewedIdentity.current === identity && openSnapshot) setMapShapes(openSnapshot.mapShapes ?? []);
  }, [backend]);

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
    setMapShapes(shapes);
    void run(
      () => backend.updateMapShapes({ shapes }),
      fallback,
      { recover: recoverMapShapes },
    );
  }, [backend, busy, operating, recoverMapShapes, run]);

  return {
    viewedSnapshot,
    mapShapes,
    setMapShapes,
    operating,
    error,
    setError,
    locked: busy || operating,
    run,
    commitMapShapes,
  };
}
