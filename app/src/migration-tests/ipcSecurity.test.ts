// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmCommands } from "../main/commands/realmCommands";
import { registerIpcHandlers, REALM_IPC_CHANNELS } from "../main/ipc/registerIpcHandlers";

type Listener = (...args: unknown[]) => Promise<unknown>;
function fakeIpc(): { handlers: Map<string, Listener>; ipc: { handle: (channel: string, listener: Listener) => void; removeHandler: (channel: string) => void } } {
  const handlers = new Map<string, Listener>();
  return { handlers, ipc: { handle: (channel, listener) => { handlers.set(channel, listener); }, removeHandler: (channel) => { handlers.delete(channel); } } };
}
const event = (id: number, url = "file:///app/index.html") => ({ sender: { id }, senderFrame: { url } });

describe("Realm IPC sender and payload boundary", () => {
  it("requires sender id and renderer origin allow-lists", async () => {
    const commands = new RealmCommands({ libraryDirectory: mkdtempSync(join(tmpdir(), "realm-ipc-")) }); const fake = fakeIpc();
    expect(() => registerIpcHandlers(fake.ipc, commands, { allowedSenderIds: [], allowedRendererOrigins: ["file:///app/index.html"] })).toThrow();
    const close = registerIpcHandlers(fake.ipc, commands, { allowedSenderIds: [7], allowedRendererOrigins: ["file:///app/index.html"] });
    const handler = fake.handlers.get("realm:listProjects")!;
    await expect(handler(event(8))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(handler(event(7, "https://evil.invalid/index.html"))).rejects.toMatchObject({ code: "invalid_input" });
    close();
  });

  it("rejects oversized payloads before a command runs and serializes mutations", async () => {
    const commands = new RealmCommands({ libraryDirectory: mkdtempSync(join(tmpdir(), "realm-ipc-")) }); const fake = fakeIpc();
    const close = registerIpcHandlers(fake.ipc, commands, { allowedSenderIds: [7], allowedRendererOrigins: ["file:///app/index.html"], maxPayloadBytes: 128 }); const create = fake.handlers.get("realm:createProject")!;
    await expect(create(event(7), { name: "x".repeat(256) })).rejects.toThrow("payload");
    const opened = await create(event(7), { name: "Concurrent" }); expect((opened as { world: { name: string } }).world.name).toBe("Concurrent"); close();
  });

  it("registers every coarse command channel", () => {
    const commands = new RealmCommands({ libraryDirectory: mkdtempSync(join(tmpdir(), "realm-ipc-")) }); const fake = fakeIpc(); const close = registerIpcHandlers(fake.ipc, commands, { allowedSenderIds: [7], allowedRendererOrigins: ["file:///app/index.html"] });
    expect([...fake.handlers.keys()]).toEqual(expect.arrayContaining([...REALM_IPC_CHANNELS])); close(); expect(fake.handlers.size).toBe(0);
  });

  it("validates path, identifier, and dialog payloads at the IPC boundary", async () => {
    const commands = new RealmCommands({ libraryDirectory: mkdtempSync(join(tmpdir(), "realm-ipc-")) }); const fake = fakeIpc();
    const close = registerIpcHandlers(fake.ipc, commands, { allowedSenderIds: [7], allowedRendererOrigins: ["file:///app/index.html"] }, {
      chooseTransferPath: async () => "/tmp/example.realmmap",
      chooseArtifactPath: async () => "/tmp/example.png",
    });
    await expect(fake.handlers.get("realm:openProject")!(event(7), { path: 42 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fake.handlers.get("realm:openProject")!(event(7), { path: "/tmp/world.realmmap" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fake.handlers.get("realm:deleteFeature")!(event(7), { id: "" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fake.handlers.get("realm:chooseTransferPath")!(event(7), { mode: "other" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fake.handlers.get("realm:chooseArtifactPath")!(event(7), { format: "png" })).rejects.toMatchObject({ code: "invalid_input" });
    close();
  });
});
