import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, type ProjectSummary, type RealmBackend, type RealmSnapshot } from "../backend";

type RealmOperationsOptions = { backend: RealmBackend };

export function useRealmOperations({ backend }: RealmOperationsOptions) {
  const [snapshot, setSnapshot] = useState<RealmSnapshot | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refreshProjects = useCallback(async (expectedGeneration = generation.current): Promise<boolean> => {
    const library = await backend.listProjects();
    if (generation.current !== expectedGeneration) return false;
    setProjects(library);
    return true;
  }, [backend]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let active = true;
    setBusy(false);
    setRestoring(true);
    setSnapshot(null);
    setError(null);
    void Promise.all([backend.getOpenProject(), backend.listProjects()])
      .then(([openProject, library]) => {
        if (!active || generation.current !== currentGeneration) return;
        setSnapshot(openProject);
        setProjects(library);
      })
      .catch((cause: unknown) => {
        if (active && generation.current === currentGeneration) {
          setError(errorMessage(cause, "世界ライブラリを読み込めませんでした。"));
        }
      })
      .finally(() => {
        if (active && generation.current === currentGeneration) setRestoring(false);
      });
    return () => { active = false; };
  }, [backend]);

  const commitSnapshot = useCallback((next: RealmSnapshot) => {
    const currentGeneration = ++generation.current;
    setSnapshot(next);
    void refreshProjects(currentGeneration).catch((cause: unknown) => {
      if (generation.current === currentGeneration) setError(errorMessage(cause, "世界ライブラリを更新できませんでした。"));
    });
  }, [refreshProjects]);

  const run = useCallback(async (action: () => Promise<RealmSnapshot>, fallback: string) => {
    const currentGeneration = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (generation.current !== currentGeneration) return;
      setSnapshot(result);
      try {
        await refreshProjects(currentGeneration);
      } catch (cause: unknown) {
        if (generation.current === currentGeneration) setError(errorMessage(cause, "世界ライブラリを更新できませんでした。"));
      }
    } catch (cause: unknown) {
      if (generation.current === currentGeneration) setError(errorMessage(cause, fallback));
    } finally {
      if (generation.current === currentGeneration) setBusy(false);
    }
  }, [refreshProjects]);

  const closeProject = useCallback(async () => {
    const currentGeneration = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      await backend.closeProject();
      if (generation.current !== currentGeneration) return;
      setSnapshot(null);
      try {
        await refreshProjects(currentGeneration);
      } catch (cause: unknown) {
        if (generation.current === currentGeneration) setError(errorMessage(cause, "世界ライブラリを更新できませんでした。"));
      }
    } catch (cause: unknown) {
      if (generation.current === currentGeneration) setError(errorMessage(cause, "ライブラリへ戻れませんでした。"));
    } finally {
      if (generation.current === currentGeneration) setBusy(false);
    }
  }, [backend, refreshProjects]);

  return { snapshot, projects, busy, restoring, error, commitSnapshot, run, closeProject };
}
