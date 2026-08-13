import { describe, expect, it, vi } from "vitest";
import { configureElectronSmokeUserDataPath, resolveElectronSmokeConfig } from "./electronSmoke";

describe("electron smoke configuration", () => {
  it("requires all absolute smoke paths", () => {
    expect(resolveElectronSmokeConfig({})).toBeNull();
    expect(resolveElectronSmokeConfig({ REALM_ELECTRON_SMOKE_KIND: "development", REALM_ELECTRON_SMOKE_REPORT_PATH: "/tmp/report.json", REALM_ELECTRON_SMOKE_USER_DATA_DIR: "/tmp/user-data" })).toMatchObject({ kind: "development" });
    expect(() => resolveElectronSmokeConfig({ REALM_ELECTRON_SMOKE_KIND: "development", REALM_ELECTRON_SMOKE_REPORT_PATH: "report.json", REALM_ELECTRON_SMOKE_USER_DATA_DIR: "/tmp/user-data" })).toThrow("absolute");
  });

  it("configures Electron before startup", () => {
    const app = { setPath: vi.fn() };
    expect(configureElectronSmokeUserDataPath(app, { kind: "package", reportPath: "/tmp/report.json", userDataPath: "/tmp/user-data" })).toBe(true);
    expect(app.setPath).toHaveBeenCalledWith("userData", "/tmp/user-data");
  });
});
