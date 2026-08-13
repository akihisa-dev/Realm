// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { REALM_IPC_CHANNELS, registerIpcHandlers } from "./registerIpcHandlers";

type Listener = (...args: unknown[]) => Promise<unknown>;
const event = { sender: { id: 4 }, senderFrame: { url: "file:///app/index.html" } };
function fakeIpc() {
  const handlers = new Map<string, Listener>();
  return { handlers, ipc: { handle: (channel: string, listener: Listener) => handlers.set(channel, listener), removeHandler: (channel: string) => handlers.delete(channel) } };
}

describe("IPC command dispatch and dialog boundaries", () => {
  it("dispatches chooser dialogs, validates no-input channels, and normalizes failures", async () => {
    const { handlers, ipc } = fakeIpc();
    const chooseTransferPath = vi.fn().mockResolvedValue("/tmp/world.realmmap");
    const chooseArtifactPath = vi.fn().mockResolvedValue("/tmp/world.png");
    const commands = { listProjects: vi.fn().mockResolvedValue([]), createProject: vi.fn().mockRejectedValue(new Error("disk unavailable")) };
    const close = registerIpcHandlers(ipc, commands as never, { allowedSenderIds: [4], allowedRendererOrigins: ["file:///app/index.html"] }, { chooseTransferPath, chooseArtifactPath });
    expect(await handlers.get("realm:listProjects")!(event)).toEqual([]);
    await expect(handlers.get("realm:createProject")!(event, { name: "World" })).rejects.toEqual({ code: "storage_error", message: "disk unavailable" });
    expect(await handlers.get("realm:chooseTransferPath")!(event, { mode: "export", suggestedName: "world.realmmap" })).toBe("/tmp/world.realmmap");
    expect(await handlers.get("realm:chooseArtifactPath")!(event, { format: "png", suggestedName: "world" })).toBe("/tmp/world.png");
    expect(chooseTransferPath).toHaveBeenCalledWith({ mode: "export", suggestedName: "world.realmmap" });
    expect(chooseArtifactPath).toHaveBeenCalledWith({ format: "png", suggestedName: "world" });
    await expect(handlers.get("realm:createProject")!(event, undefined)).rejects.toMatchObject({ code: "invalid_input" });
    close(); expect(handlers.size).toBe(0);
  });

  it("rejects malformed origins, payloads, and missing handlers before side effects", async () => {
    const { handlers, ipc } = fakeIpc(); const create = vi.fn();
    const close = registerIpcHandlers(ipc, { createProject: create } as never, { allowedSenderIds: [4], allowedRendererOrigins: ["https://app.example.test"] });
    await expect(handlers.get("realm:createProject")!({ sender: { id: 4 }, senderFrame: { url: "not a url" } }, { name: "x" })).rejects.toThrow("authorized");
    const allowedEvent = { sender: { id: 4 }, senderFrame: { url: "https://app.example.test/index.html" } };
    await expect(handlers.get("realm:createProject")!(allowedEvent, undefined)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(handlers.get("realm:createProject")!(allowedEvent, null)).rejects.toMatchObject({ code: "invalid_input" });
    expect(create).not.toHaveBeenCalled();
    close();
    expect(REALM_IPC_CHANNELS.length).toBeGreaterThan(20);
  });

  it("drains an in-flight mutation before handlers are removed", async () => {
    const { handlers, ipc } = fakeIpc();
    let release!: () => void;
    const pending = new Promise<unknown>((resolve) => { release = () => resolve(["done"]); });
    const commands = { listProjects: vi.fn().mockReturnValue(pending) };
    const close = registerIpcHandlers(ipc, commands as never, { allowedSenderIds: [4], allowedRendererOrigins: ["file:///app/index.html"] });
    const request = handlers.get("realm:listProjects")!(event);
    let drained = false;
    const waiting = close.drain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await request;
    await waiting;
    expect(drained).toBe(true);
    close();
    expect(handlers.size).toBe(0);
  });
});
