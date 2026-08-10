import { useCallback, useEffect, useRef, useState } from "react";
import {
  chooseArtifactPath,
  chooseTransferPath,
  defaultBackend,
  errorMessage,
  type ProjectSummary,
  type RealmBackend,
  type RealmSnapshot,
} from "./backend";
import { EditorShell } from "./components/EditorShell";
import { StartupScreen } from "./components/StartupScreen";

type AppProps = {
  backend?: RealmBackend;
  chooseTransfer?: typeof chooseTransferPath;
  chooseArtifact?: typeof chooseArtifactPath;
};

export default function App({
  backend = defaultBackend,
  chooseTransfer = chooseTransferPath,
  chooseArtifact = chooseArtifactPath,
}: AppProps) {
  const [snapshot, setSnapshot] = useState<RealmSnapshot | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const operationSequence = useRef(0);

  const refreshProjects = useCallback(async () => {
    setProjects(await backend.listProjects());
  }, [backend]);

  useEffect(() => {
    const operation = ++operationSequence.current;
    let active = true;
    setBusy(false);
    setRestoring(true);
    setSnapshot(null);
    setError(null);
    void Promise.all([backend.getOpenProject(), backend.listProjects()])
      .then(([openProject, library]) => {
        if (!active || operationSequence.current !== operation) return;
        setSnapshot(openProject);
        setProjects(library);
      })
      .catch((cause: unknown) => {
        if (active && operationSequence.current === operation) {
          setError(errorMessage(cause, "世界ライブラリを読み込めませんでした。"));
        }
      })
      .finally(() => {
        if (active && operationSequence.current === operation) setRestoring(false);
      });
    return () => { active = false; };
  }, [backend]);

  const run = useCallback(async (action: () => Promise<RealmSnapshot>, fallback: string) => {
    const operation = ++operationSequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (operationSequence.current === operation) setSnapshot(result);
      await refreshProjects();
    } catch (cause) {
      if (operationSequence.current === operation) setError(errorMessage(cause, fallback));
    } finally {
      if (operationSequence.current === operation) setBusy(false);
    }
  }, [refreshProjects]);

  const createProject = useCallback(() => run(
    () => backend.createProject({ name: "無題の世界" }),
    "世界を作成できませんでした。",
  ), [backend, run]);

  const openProject = useCallback((libraryId: string) => run(
    () => backend.openProject({ libraryId }),
    "世界を開けませんでした。",
  ), [backend, run]);

  const importProject = useCallback(async () => {
    const path = await chooseTransfer("import");
    if (path) await run(() => backend.importProject({ path }), "移行データを読み込めませんでした。");
  }, [backend, chooseTransfer, run]);

  const closeProject = useCallback(async () => {
    const operation = ++operationSequence.current;
    setBusy(true);
    setError(null);
    try {
      await backend.closeProject();
      if (operationSequence.current === operation) setSnapshot(null);
      await refreshProjects();
    } catch (cause) {
      if (operationSequence.current === operation) setError(errorMessage(cause, "ライブラリへ戻れませんでした。"));
    } finally {
      if (operationSequence.current === operation) setBusy(false);
    }
  }, [backend, refreshProjects]);

  const exportTransfer = useCallback(async () => {
    if (!snapshot) return;
    const path = await chooseTransfer("export", `${snapshot.world.name}.realmmap`);
    if (path) await backend.exportProject({ path });
  }, [backend, chooseTransfer, snapshot]);

  const exportArtifact = useCallback(async (format: "png" | "pdf", bytes: number[]) => {
    if (!snapshot) return;
    const path = await chooseArtifact(format, snapshot.world.name);
    if (path) await backend.writeArtifact({ path, bytes });
  }, [backend, chooseArtifact, snapshot]);

  const unavailable = busy || restoring;
  if (snapshot) {
    return (
      <>
        <EditorShell
          key={`${snapshot.path}:${snapshot.world.id}`}
          snapshot={snapshot}
          backend={backend}
          busy={unavailable}
          onClose={() => { void closeProject(); }}
          onSaved={(next) => { setSnapshot(next); void refreshProjects(); }}
          onExportTransfer={exportTransfer}
          onExportArtifact={exportArtifact}
        />
        {error ? <p className="app-error" role="alert">{error}</p> : null}
      </>
    );
  }

  return (
    <>
      <StartupScreen
        projects={projects}
        onCreate={() => { void createProject(); }}
        onOpen={(libraryId) => { void openProject(libraryId); }}
        onImport={() => { void importProject(); }}
        busy={unavailable}
      />
      {error ? <p className="app-error" role="alert">{error}</p> : null}
    </>
  );
}
