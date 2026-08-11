import { defaultBackend, type RealmBackend } from "./backend";
import { EditorShell } from "./components/EditorShell";
import { useRealmOperations } from "./state";

type AppProps = {
  backend?: RealmBackend;
};

export default function App({
  backend = defaultBackend,
}: AppProps) {
  const { snapshot, restoring, error, commitSnapshot } = useRealmOperations({ backend });

  if (snapshot) {
    return (
      <>
        <EditorShell
          key={`${snapshot.path}:${snapshot.world.id}`}
          snapshot={snapshot}
          backend={backend}
          busy={restoring}
          onSaved={commitSnapshot}
        />
        {error ? <p className="app-error" role="alert">{error}</p> : null}
      </>
    );
  }

  return (
    <>
      {restoring ? <p className="sr-only" role="status">世界を開いています。</p> : null}
      {error ? <p className="app-error" role="alert">{error}</p> : null}
    </>
  );
}
