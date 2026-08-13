// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { expose, invoke } = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld: expose }, ipcRenderer: { invoke } }));

describe("preload bridge", () => {
  it("exposes one typed API object and never exposes native handles", async () => {
    await import("./preload");
    expect(expose).toHaveBeenCalledOnce();
    const [name, api] = expose.mock.calls[0] as [string, { apiContractVersion: number; listProjects: () => Promise<unknown> }];
    expect(name).toBe("realmApi");
    expect(api.apiContractVersion).toBe(1);
    await api.listProjects();
    expect(invoke).toHaveBeenCalledWith("realm:listProjects", undefined);
  });

  it("provides the same contract through the preload api module", async () => {
    const { realmApi } = await import("./api");
    expect(realmApi.apiContractVersion).toBe(1);
    await realmApi.getOpenProject();
    expect(invoke).toHaveBeenCalledWith("realm:getOpenProject", undefined);
  });
});
