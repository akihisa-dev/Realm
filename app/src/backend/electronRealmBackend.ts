import type { ElectronRealmApi, RealmBackend } from "../shared/realmContract";

declare global { interface Window { realmApi?: ElectronRealmApi } }
const unavailable = (): never => { throw new Error("Realm Electron bridge is unavailable."); };
export const electronRealmBackend: RealmBackend = new Proxy({} as RealmBackend, {
  get(_target, property: string): unknown {
    const api = typeof window !== "undefined" ? window.realmApi : undefined;
    const method = api?.[property as keyof RealmBackend];
    return typeof method === "function" ? method.bind(api) : unavailable;
  },
});

export function getElectronRealmBackend(): RealmBackend { return electronRealmBackend; }
