import type { ProjectSummary } from "../backend";

type StartupScreenProps = {
  projects: ProjectSummary[];
  onCreate: () => void;
  onOpen: (libraryId: string) => void;
  onImport: () => void;
  busy: boolean;
};

export function StartupScreen({ projects, onCreate, onOpen, onImport, busy }: StartupScreenProps) {
  return (
    <main className="startup-screen">
      <section className="startup-panel" aria-labelledby="startup-title">
        <h1 id="startup-title">Realm</h1>
        <p>創作世界の地図と歴史を、アプリ内で安全に管理。</p>
        {projects.length > 0 ? (
          <div className="project-library" aria-label="世界ライブラリ">
            {projects.map((project) => (
              <button key={project.libraryId} type="button" onClick={() => onOpen(project.libraryId)} disabled={busy}>
                <strong>{project.name}</strong>
                <span>{project.currentYear}年</span>
              </button>
            ))}
          </div>
        ) : <p className="library-empty">まだ世界がありません。</p>}
        <div className="startup-actions">
          <button className="startup-button startup-button-primary" type="button" onClick={onCreate} disabled={busy}>
            新しい世界を作成
          </button>
          <button className="startup-button" type="button" onClick={onImport} disabled={busy}>
            移行データを読み込む
          </button>
        </div>
      </section>
    </main>
  );
}
