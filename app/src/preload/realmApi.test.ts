// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcRenderer: { invoke: vi.fn() } }));

import { createRealmApi } from "./realmApi";

describe("typed preload Realm API", () => {
  it("maps every renderer method to its realm IPC channel", async () => {
    const calls: Array<[string, unknown]> = [];
    const invoke = async (channel: string, input?: unknown): Promise<unknown> => {
      calls.push([channel, input]);
      return { channel, input };
    };
    const api = createRealmApi(invoke);
    await api.listProjects();
    await api.createProject({ name: "World" });
    await api.openProject({ libraryId: "world" });
    await api.createFeature({ featureType: "city", name: "A", geometry: { type: "Point", coordinates: [0, 0] } });
    await api.undoProject();
    await api.chooseTransferPath({ mode: "export", suggestedName: "world.realmmap" });
    await api.chooseArtifactPath({ format: "png", suggestedName: "world" });
    expect(calls).toEqual([
      ["realm:listProjects", undefined],
      ["realm:createProject", { name: "World" }],
      ["realm:openProject", { libraryId: "world" }],
      ["realm:createFeature", { featureType: "city", name: "A", geometry: { type: "Point", coordinates: [0, 0] } }],
      ["realm:undoProject", undefined],
      ["realm:chooseTransferPath", { mode: "export", suggestedName: "world.realmmap" }],
      ["realm:chooseArtifactPath", { format: "png", suggestedName: "world" }],
    ]);
  });
});
