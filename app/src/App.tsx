import { useCallback, useEffect, useRef, useState } from "react";
import {
  chooseProjectPath,
  defaultBackend,
  errorMessage,
  projectNameFromPath,
  type RealmBackend,
  type RealmSnapshot,
} from "./backend";
import { EditorShell } from "./components/EditorShell";
import { StartupScreen } from "./components/StartupScreen";

type AppProps = { backend?: RealmBackend; choosePath?: typeof chooseProjectPath };

export default function App({ backend = defaultBackend, choosePath = chooseProjectPath }: AppProps) {
  const [snapshot, setSnapshot] = useState<RealmSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const operationSequence = useRef(0);

  useEffect(() => {
    const operation = ++operationSequence.current;
    let active = true;
    setBusy(false);
    setRestoring(true);
    setSnapshot(null);
    setError(null);
    void backend.getOpenProject()
      .then((openProject) => {
        if (active && operationSequence.current === operation && openProject) {
          setSnapshot(openProject);
        }
      })
      .catch((cause: unknown) => {
        if (active && operationSequence.current === operation) {
          setError(errorMessage(cause, "開いていた世界を復元できませんでした。"));
        }
      })
      .finally(() => {
        if (active && operationSequence.current === operation) setRestoring(false);
      });
    return () => { active = false; };
  }, [backend]);

  const runProjectAction = useCallback(async (action: "create" | "open") => {
    const operation = ++operationSequence.current;
    setRestoring(false);
    setBusy(true);
    setError(null);
    try {
      const path = await choosePath(action);
      if (!path) return;
      const result = action === "create"
        ? await backend.createProject({ path, name: projectNameFromPath(path) })
        : await backend.openProject({ path });
      if (operationSequence.current === operation) setSnapshot(result);
    } catch (cause) {
      if (operationSequence.current === operation) {
        setError(errorMessage(cause, "世界を開けませんでした。"));
      }
    } finally {
      if (operationSequence.current === operation) setBusy(false);
    }
  }, [backend, choosePath]);

  const closeProject = useCallback(async () => {
    const operation = ++operationSequence.current;
    setBusy(true);
    setError(null);
    try {
      await backend.closeProject();
      if (operationSequence.current === operation) setSnapshot(null);
    } catch (cause) {
      if (operationSequence.current === operation) {
        setError(errorMessage(cause, "世界を閉じられませんでした。"));
      }
    } finally {
      if (operationSequence.current === operation) setBusy(false);
    }
  }, [backend]);

  const unavailable = busy || restoring;

  if (snapshot) {
    return (
      <>
        <EditorShell
          key={`${snapshot.path}:${snapshot.world.id}`}
          snapshot={snapshot}
          backend={backend}
          busy={unavailable}
          onCreate={() => { void runProjectAction("create"); }}
          onOpen={() => { void runProjectAction("open"); }}
          onClose={() => { void closeProject(); }}
          onSaved={setSnapshot}
        />
        {error ? <p className="app-error" role="alert">{error}</p> : null}
      </>
    );
  }

  return (
    <>
      <StartupScreen onCreate={() => { void runProjectAction("create"); }} onOpen={() => { void runProjectAction("open"); }} busy={unavailable} />
      {error ? <p className="app-error" role="alert">{error}</p> : null}
    </>
  );
}
