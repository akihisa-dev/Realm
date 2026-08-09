type StartupScreenProps = {
  onCreate: () => void;
  onOpen: () => void;
  busy: boolean;
};

export function StartupScreen({ onCreate, onOpen, busy }: StartupScreenProps) {
  return (
    <main className="startup-screen">
      <section className="startup-panel" aria-labelledby="startup-title">
        <h1 id="startup-title">Realm</h1>
        <p>創作世界の地図と歴史を、ひとつのファイルに。</p>
        <div className="startup-actions">
          <button className="startup-button startup-button-primary" type="button" onClick={onCreate} disabled={busy}>
            新しい世界を作成
          </button>
          <button className="startup-button" type="button" onClick={onOpen} disabled={busy}>
            既存の世界を開く
          </button>
        </div>
      </section>
    </main>
  );
}
