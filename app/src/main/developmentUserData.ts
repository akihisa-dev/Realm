import path from "node:path";

interface UserDataApp { setPath(name: "userData", value: string): void; }

export function configureDevelopmentUserDataPath(app: UserDataApp, devServerUrl: string | undefined, configuredPath: string | undefined): boolean {
  if (!devServerUrl || !configuredPath) return false;
  if (!path.isAbsolute(configuredPath)) throw new Error("REALM_DEV_USER_DATA_DIR must be an absolute path.");
  app.setPath("userData", path.resolve(configuredPath));
  return true;
}
