import { useCallback } from "react";
import {
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
};

export default function App({
  backend = defaultBackend,
  chooseTransfer = chooseTransferPath,
}: AppProps) {
  const { snapshot, projects, busy, restoring, error, commitSnapshot, run } = useRealmOperations({ backend });

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

  const unavailable = busy || restoring;
  if (snapshot) {
    return (
      <>
        <EditorShell
          key={`${snapshot.path}:${snapshot.world.id}`}
          snapshot={snapshot}
          backend={backend}
          busy={unavailable}
          onSaved={commitSnapshot}
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
