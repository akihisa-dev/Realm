import { useCallback } from "react";
import {
  chooseArtifactPath,
  chooseTransferPath,
  defaultBackend,
  type RealmBackend,
} from "./backend";
import { EditorShell } from "./components/EditorShell";
import { StartupScreen } from "./components/StartupScreen";
import { useRealmOperations } from "./state";

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
  const { snapshot, projects, busy, restoring, error, commitSnapshot, run, closeProject } = useRealmOperations({ backend });

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
          onClose={closeProject}
          onSaved={commitSnapshot}
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
