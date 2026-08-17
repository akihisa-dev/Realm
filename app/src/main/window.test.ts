// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";

describe("window security and options", () => {
  it("accepts only the renderer origin and configures a hardened window", async () => {
    const { createMainWindowOptions, showWhenReady } = await import("./windowOptions");
    const options = createMainWindowOptions("/tmp/preload.js");
    expect(options).toMatchObject({ width: 1440, height: 920, show: false, title: `Realm ${packageJson.version}`, webPreferences: { preload: "/tmp/preload.js", contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    const listeners = new Map<string, () => void>();
    const window = { once: (name: string, callback: () => void) => { listeners.set(name, callback); }, isDestroyed: () => false, show: vi.fn() };
    showWhenReady(window as never);
    listeners.get("ready-to-show")?.();
    expect(window.show).toHaveBeenCalledOnce();

    const security = await import("./windowSecurity");
    expect(security.isAllowedRendererNavigation("file:///app/index.html", "file:///app/index.html")).toBe(true);
    expect(security.isAllowedRendererNavigation("file:///app/index.html#route", "file:///app/index.html")).toBe(true);
    expect(security.isAllowedRendererNavigation("file:///app/other.html", "file:///app/index.html")).toBe(false);
    expect(security.isAllowedRendererNavigation("http://127.0.0.1:1420/route", "file:///app/index.html", "http://127.0.0.1:1420")).toBe(true);
    expect(security.isAllowedRendererNavigation("http://127.0.0.1:1421/route", "file:///app/index.html", "http://127.0.0.1:1420")).toBe(false);
    expect(security.isSafeExternalUrl("https://example.com")).toBe(false);
    expect(security.rendererContentSecurityPolicy()).toContain("script-src 'self'");
    expect(security.rendererContentSecurityPolicy()).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(security.rendererContentSecurityPolicy("http://127.0.0.1:1420")).toContain("script-src 'self' 'unsafe-inline'");
    expect(security.rendererContentSecurityPolicy("http://127.0.0.1:1420")).toContain("ws://127.0.0.1:1420");
  });

  it("prevents navigation, webviews, permissions, and new windows", async () => {
    const { installWindowSecurityPolicy } = await import("./windowSecurity");
    const callbacks = new Map<string, (...args: any[]) => unknown>();
    const session = { setPermissionRequestHandler: vi.fn() };
    const webContents = { on: (name: string, callback: (...args: any[]) => unknown) => callbacks.set(name, callback), removeListener: vi.fn(), setWindowOpenHandler: vi.fn((handler) => callbacks.set("window-open", handler)), session };
    const window = { webContents, once: (name: string, callback: () => void) => callbacks.set(name, callback) };
    const cleanup = installWindowSecurityPolicy(window as never, (url) => url === "file:///allowed.html");
    const blocked = { preventDefault: vi.fn() };
    callbacks.get("will-navigate")?.(blocked, "https://evil.invalid");
    expect(blocked.preventDefault).toHaveBeenCalledOnce();
    const allowed = { preventDefault: vi.fn() };
    callbacks.get("will-redirect")?.(allowed, "file:///allowed.html");
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    const webview = { preventDefault: vi.fn() };
    callbacks.get("will-attach-webview")?.(webview);
    expect(webview.preventDefault).toHaveBeenCalledOnce();
    expect(callbacks.get("window-open")?.({ url: "https://example.com" })).toEqual({ action: "deny" });
    expect(session.setPermissionRequestHandler).toHaveBeenCalledWith(expect.any(Function));
    const permissionHandler = session.setPermissionRequestHandler.mock.calls[0]?.[0] as (...args: any[]) => void;
    const done = vi.fn(); permissionHandler({}, "clipboard", done); expect(done).toHaveBeenCalledWith(false);
    cleanup();
    expect(webContents.removeListener).toHaveBeenCalledTimes(3);
    expect(session.setPermissionRequestHandler).toHaveBeenLastCalledWith(null);
  });
});
