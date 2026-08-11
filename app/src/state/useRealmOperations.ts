import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, type RealmBackend, type RealmSnapshot } from "../backend";

type RealmOperationsOptions = { backend: RealmBackend };

export function useRealmOperations({ backend }: RealmOperationsOptions) {
  const [snapshot, setSnapshot] = useState<RealmSnapshot | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let active = true;
    setRestoring(true);
    setSnapshot(null);
    setError(null);
    void (async () => {
      const openProject = await backend.getOpenProject();
      if (openProject) return openProject;
      const projects = await backend.listProjects();
      const firstProject = projects[0];
      return firstProject
        ? backend.openProject({ libraryId: firstProject.libraryId })
        : backend.createProject({ name: "無題の世界" });
    })()
      .then((openProject) => {
        if (!active || generation.current !== currentGeneration) return;
        setSnapshot(openProject);
      })
      .catch((cause: unknown) => {
        if (active && generation.current === currentGeneration) {
          setError(errorMessage(cause, "世界を開けませんでした。"));
        }
      })
      .finally(() => {
        if (active && generation.current === currentGeneration) setRestoring(false);
      });
    return () => { active = false; };
  }, [backend]);

  const commitSnapshot = useCallback((next: RealmSnapshot) => {
    ++generation.current;
    setSnapshot(next);
    setError(null);
  }, []);

  return { snapshot, restoring, error, commitSnapshot };
}
